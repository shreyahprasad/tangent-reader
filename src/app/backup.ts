import { todayISO } from "../shell/dates";
import type { TangentDB } from "../store/schema";
import { exportAll } from "../store/transfer";

// A backup of everything, handed to the browser to save (docs/design.md, Data).

/** "tangent-reader-2026-10-12.json". */
export const backupName = (now: Date) => `tangent-reader-${todayISO(now)}.json`;

export async function downloadBackup(db: TangentDB): Promise<void> {
  const file = await exportAll(db);
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: backupName(new Date()) });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0); // after the click has started the save
}
