import { Refused, Rejected } from "./errors";
import { fileProblem, interrupted, pick } from "./rules";
import { DB_VERSION, migrateRows, TABLES, type OldRows, type Rows, type TableName, type TangentDB } from "./schema";
import { articleId } from "./store";

// Export and import (docs/design.md, Data): your only backup, and how you move to another
// device. A file carries every table's rows, the call log included, and only their listed
// fields, so never your key. An import checks the whole file before writing anything and
// refuses all of it on any error.

const FORMAT = "tangent-reader";

export interface ExportFile extends Rows {
  format: typeof FORMAT;
  /** The database version the rows are in. An older file is migrated on import. */
  version: number;
  exported_at: string;
}

function fileOf(rows: Rows): ExportFile {
  const picked = Object.fromEntries(TABLES.map((t) => [t, rows[t].map((r) => pick(t, r))])) as unknown as Rows;
  return { format: FORMAT, version: DB_VERSION, exported_at: new Date().toISOString(), ...picked };
}

const everyTable = (db: TangentDB) => TABLES.map((t) => db.table(t));

/** Everything on this device. */
export async function exportAll(db: TangentDB): Promise<ExportFile> {
  return db.transaction("r", everyTable(db), async () => {
    const rows = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await db.table(t).toArray()])));
    return fileOf(rows as Rows);
  });
}

const NOT_OURS = "This is not a Tangent Reader export.";
const refused = (problem: string) => new Rejected(`This file can't be imported: ${problem}. Nothing was changed.`);

/** The file's rows at this version, every rule checked, or the reason it is refused. */
async function readFile(json: string): Promise<Rows> {
  let file: unknown;
  try {
    file = JSON.parse(json);
  } catch {
    throw new Rejected(NOT_OURS);
  }
  if (typeof file !== "object" || file === null || (file as { format?: unknown }).format !== FORMAT) throw new Rejected(NOT_OURS);
  const { version, ...tables } = file as Record<string, unknown>;
  if (!Number.isInteger(version) || (version as number) < 1) throw refused("its version is not valid");
  if (version as number > DB_VERSION) throw new Refused("This file is from a newer Tangent Reader. Reload the page to update it, then import again.");
  const missing = TABLES.find((t) => !Array.isArray(tables[t]));
  if (missing) throw refused(`${missing} is missing`);

  let rows: Rows;
  try {
    rows = migrateRows(Object.fromEntries(TABLES.map((t) => [t, tables[t]])) as OldRows, version as number) as unknown as Rows;
  } catch {
    throw refused("it could not be brought up to this version");
  }
  const texts = rows.articles.filter((a) => typeof a?.text === "string");
  const hashes = new Map(await Promise.all(texts.map(async (a) => [a.id, await articleId(a.text)] as const)));
  const problem = fileProblem(rows, hashes);
  if (problem) throw refused(problem);
  return rows;
}

/** Delete everything: every table emptied in one transaction, so another tab open on the store
 *  shows an empty library rather than half of one. The key and the drafts are the page's to clear. */
export async function eraseEverything(db: TangentDB): Promise<void> {
  await db.transaction("rw", everyTable(db), () => Promise.all(TABLES.map((t) => db.table(t).clear())));
}

/** Adds the file's sessions. A session already on this device stays as it is here, so importing
 *  the same backup twice changes nothing. What was in flight when it was exported arrives
 *  interrupted (rule 8). */
export async function importFile(db: TangentDB, json: string): Promise<{ added: number; skipped: number }> {
  const rows = await readFile(json);
  return db.transaction("rw", everyTable(db), async () => {
    const present = new Set((await db.sessions.bulkGet(rows.sessions.map((s) => s.id))).flatMap((s) => (s ? [s.id] : [])));
    const sessions = rows.sessions.filter((s) => !present.has(s.id));
    const kept = new Set(sessions.map((s) => s.id));
    const threads = rows.threads.filter((t) => kept.has(t.session_id));
    const threadIds = new Set(threads.map((t) => t.id));
    const adding: Rows = {
      articles: [],
      sessions,
      threads,
      messages: rows.messages.filter((m) => threadIds.has(m.thread_id)).map((m) => interrupted(m) ?? m),
      calls: rows.calls.filter((c) => kept.has(c.session_id)),
      visits: rows.visits.filter((v) => kept.has(v.session_id)),
    };
    const needed = new Set(sessions.map((s) => s.article_id));
    const stored = new Set((await db.articles.bulkGet([...needed])).flatMap((a) => (a ? [a.id] : [])));
    adding.articles = rows.articles.filter((a) => needed.has(a.id) && !stored.has(a.id));

    for (const table of ["threads", "messages", "calls"] as const satisfies TableName[]) {
      const clash = (await db.table(table).bulkGet(adding[table].map((r) => r.id))).some(Boolean);
      if (clash) throw new Refused("Part of this file is already here under another session, so nothing was imported.");
    }
    for (const t of TABLES) await db.table(t).bulkAdd(adding[t]);
    return { added: sessions.length, skipped: present.size };
  });
}
