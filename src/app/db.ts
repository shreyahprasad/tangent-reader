import { TangentDB } from "../store/schema";
import { openStore } from "../store/store";

// The page's one database. The app draws once opened resolves: rule 8 has run, so nothing left
// pending by a closed tab shows as still waiting. It rejects with Outdated when another tab
// already moved the database to a newer version.

export const db = new TangentDB();

export const opened = openStore(db);
