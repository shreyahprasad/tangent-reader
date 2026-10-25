import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { isOutdated, messageFor, Outdated } from "./errors";
import { DB_VERSION, migrateRows, TABLES, VERSIONS, type Call, type OldRows, type TangentDB, type Version } from "./schema";
import { openStore } from "./store";
import { answeredThread, freshDB } from "./testing";
import { rowProblem } from "./rules";
import { exportAll, importFile } from "./transfer";

// Rule 7: the harness every future version's migration test uses. A made-up next version shouts
// every session title, so its work is easy to see. The real version 2 is tested below the same
// way, from version 1 rows.

const shout = (rows: OldRows): OldRows => ({ ...rows, sessions: rows.sessions.map((s) => ({ ...s, title: String(s.title).toUpperCase() })) });
const NEXT: Version[] = [...VERSIONS, { version: DB_VERSION + 1, stores: VERSIONS[VERSIONS.length - 1].stores, migrate: shout }];

const counts = async (db: TangentDB) => Promise.all(TABLES.map((t) => db.table(t).count()));

describe("the database", () => {
  it("starts at version 2", async () => {
    const db = freshDB();
    await db.open();
    expect([DB_VERSION, db.verno]).toEqual([2, 2]);
    db.close();
  });

  it("migrates the rows on your device when a newer page opens it", async () => {
    const device = new IDBFactory();
    const old = freshDB(device);
    await answeredThread(old);
    const before = await counts(old);
    old.close();

    const next = freshDB(device, NEXT);
    await next.open();
    expect(next.verno).toBe(DB_VERSION + 1);
    expect((await next.sessions.toArray()).map((s) => s.title)).toEqual(["RIVERS CARVE CANYONS OVER MILLIONS OF YEARS."]);
    expect(await counts(next)).toEqual(before);
    next.close();
  });

  it("migrates an older export with the same code on import", async () => {
    const db = freshDB();
    await answeredThread(db);
    const file = await exportAll(db);
    const migrated = migrateRows(file as unknown as OldRows, file.version, NEXT);
    expect(migrated.sessions.map((s) => s.title)).toEqual(["RIVERS CARVE CANYONS OVER MILLIONS OF YEARS."]);
    expect(migrateRows(file as unknown as OldRows, file.version + 1, NEXT)).toEqual(file); // already current
    db.close();
  });

  it("left open in another tab is closed by a newer version, and asks you to reload", async () => {
    const device = new IDBFactory();
    const tab = freshDB(device);
    await answeredThread(tab);
    const newer = freshDB(device, NEXT);
    await newer.open();
    const error = await tab.sessions.count().catch((e: unknown) => e);
    expect(messageFor(error)).toBe("Tangent Reader was updated in another tab. Reload this page to keep going.");
    expect(isOutdated(error)).toBe(true); // the page offers Reload
    newer.close();
  });

  it("is not opened by a page older than it", async () => {
    const device = new IDBFactory();
    const newer = freshDB(device, NEXT);
    await newer.open();
    newer.close();
    const stale = freshDB(device);
    await expect(openStore(stale)).rejects.toThrow(Outdated);
    await expect(stale.sessions.count()).rejects.toThrow();
  });
});

describe("version 2", () => {
  // Version 1 calls had neither field: the prompt that asked, and when the first text arrived.
  const asVersion1 = (call: Call) => {
    const { prompt_version: _, first_token_ms: __, ...rest } = call;
    return rest;
  };

  it("gives the calls on your device no prompt version and no first-text time", async () => {
    const device = new IDBFactory();
    const old = freshDB(device, VERSIONS.slice(0, 1));
    await answeredThread(old);
    await old.calls.toCollection().modify((c) => {
      delete (c as Partial<typeof c>).prompt_version;
      delete (c as Partial<typeof c>).first_token_ms;
    });
    old.close();

    const next = freshDB(device);
    await next.open();
    const [call] = await next.calls.toArray();
    expect(call).toMatchObject({ prompt_version: null, first_token_ms: null });
    expect(rowProblem("calls", call)).toBeNull();
    next.close();
  });

  it("brings in a version 1 backup the same way", async () => {
    const db = freshDB();
    await answeredThread(db);
    const file = await exportAll(db);
    const v1 = { ...file, version: 1, calls: file.calls.map(asVersion1) };

    const fresh = freshDB();
    expect(await importFile(fresh, JSON.stringify(v1))).toMatchObject({ added: 1 });
    expect(await fresh.calls.toArray()).toMatchObject([{ prompt_version: null, first_token_ms: null }]);
    db.close();
    fresh.close();
  });
});
