import Dexie, { type DexieOptions, type Table } from "dexie";
import type { Message, Source, Thread, Visit } from "../tangent/data";

// The database on your device (docs/design.md, Data). Every row is a node and every reference
// between rows is an edge. Nothing is ever deleted except a thread that never had a message (tap to
// undo), so every call stays linked to the question it answered.

/** An article, stored once however many sessions use it. id is the sha-256 of the text. */
export interface Article {
  id: string;
  text: string;
  title: string;
  created_at: string;
  source: Source;
  /** The link or the file name. Null for a paste. */
  source_ref: string | null;
}

/** One reading of one article. */
export interface SessionRow {
  id: string;
  article_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/** A thread, with its session. */
export interface ThreadRow extends Thread {
  session_id: string;
}

/** Every call to Claude, whether it worked or not, in full. request_json is the exact body sent,
 *  with the article swapped for its id, and never any headers. Cost is priced when the call is
 *  made, so a later price change never rewrites it. Null for a model with no known price. */
export interface Call {
  id: string;
  session_id: string;
  thread_id: string;
  asked_message_id: string;
  article_id: string;
  model: string;
  served_model: string | null;
  request_json: string;
  response_json: string | null;
  status: "ok" | "error";
  stop_reason: string | null;
  error_kind: string | null;
  http_status: number | null;
  request_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  web_search_requests: number;
  /** The whole call, its searches included. */
  cost_usd: number | null;
  /** The searches' share of cost_usd. */
  web_search_cost_usd: number | null;
  started_at: string;
  finished_at: string;
  latency_ms: number;
  /** The prompt that asked (PROMPT_VERSION in context.ts), so use can be compared before and
   *  after a change to it. Null for a call saved before version 2. */
  prompt_version: number | null;
  /** From the start of the call to the first text of the answer you saw, so after any search.
   *  Null when no text came, or for a call saved before version 2. */
  first_token_ms: number | null;
}

/** A call as the Claude client hands it over. The store fills in where it belongs. */
export type NewCall = Omit<Call, "id" | "session_id" | "thread_id" | "asked_message_id" | "article_id">;

/** A visit, with its session. Append only. thread_id has no reference on purpose: the trail keeps a
 *  visit to a thread you later undid. */
export interface VisitRow extends Visit {
  session_id: string;
}

export interface Rows {
  articles: Article[];
  sessions: SessionRow[];
  threads: ThreadRow[];
  messages: Message[];
  calls: Call[];
  visits: VisitRow[];
}

export type TableName = keyof Rows;
export const TABLES: TableName[] = ["articles", "sessions", "threads", "messages", "calls", "visits"];

/** Rows as an older version kept them, before a migration brings them up to date. */
export type OldRows = Record<string, Record<string, unknown>[]>;

/** One version of the database (rule 7). stores is Dexie's index list for each table. migrate
 *  turns every row of the version before into this one's. It runs on the device when the page
 *  opens the database, and on an older export when you import it, so each change is written once. */
export interface Version {
  version: number;
  stores: Record<string, string>;
  migrate?: (rows: OldRows) => OldRows;
}

export const VERSIONS: Version[] = [
  {
    version: 1,
    stores: {
      articles: "id",
      sessions: "id, article_id",
      threads: "id, session_id, parent_thread_id, from_message_id",
      messages: "id, thread_id, &[thread_id+seq], status",
      calls: "id, session_id",
      visits: "[session_id+seq]",
    },
  },
  {
    // Each call keeps the prompt that asked and when its first text came.
    version: 2,
    stores: {
      articles: "id",
      sessions: "id, article_id",
      threads: "id, session_id, parent_thread_id, from_message_id",
      messages: "id, thread_id, &[thread_id+seq], status",
      calls: "id, session_id",
      visits: "[session_id+seq]",
    },
    migrate: (rows) => ({ ...rows, calls: rows.calls.map((c) => ({ ...c, prompt_version: null, first_token_ms: null })) }),
  },
];

export const DB_VERSION = VERSIONS[VERSIONS.length - 1].version;

const DB_NAME = "tangent-reader";

export class TangentDB extends Dexie {
  articles!: Table<Article, string>;
  sessions!: Table<SessionRow, string>;
  threads!: Table<ThreadRow, string>;
  messages!: Table<Message, string>;
  calls!: Table<Call, string>;
  visits!: Table<VisitRow, [string, number]>;

  /** The newest version this page's code knows. */
  readonly known: number;

  constructor(options: DexieOptions = {}, versions: Version[] = VERSIONS, name = DB_NAME) {
    super(name, options);
    this.known = versions[versions.length - 1].version;
    // Another tab opened a newer version. This page's code is now older than the data, so it stops
    // for good rather than write old rows into new tables (Dexie would quietly reopen it).
    this.on("versionchange", () => {
      this.close({ disableAutoOpen: true });
      return false;
    });
    for (const v of versions) {
      const declared = this.version(v.version).stores(v.stores);
      const migrate = v.migrate;
      if (!migrate) continue;
      declared.upgrade(async (tx) => {
        const names = Object.keys(v.stores);
        const before = Object.fromEntries(await Promise.all(names.map(async (t) => [t, await tx.table(t).toArray()])));
        const after = migrate(before);
        for (const t of names) {
          await tx.table(t).clear();
          await tx.table(t).bulkAdd(after[t] ?? []);
        }
      });
    }
  }

  /** The version on the device, once open. Dexie keeps version n as IndexedDB version n × 10, and
   *  its own verno says the version this code declared even when it opened a newer one. */
  installed(): number {
    return this.backendDB().version / 10;
  }
}

/** An export from an older version, brought up to date by the same migrations the device runs. */
export function migrateRows(rows: OldRows, from: number, versions: Version[] = VERSIONS): OldRows {
  return versions.filter((v) => v.version > from).reduce((acc, v) => (v.migrate ? v.migrate(acc) : acc), rows);
}
