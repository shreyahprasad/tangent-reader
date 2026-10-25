import { liveQuery } from "dexie";
import { useCallback, useEffect, useRef, useState } from "react";

// A page's data from the store as it loads: loading, an error to show (shell/LoadError), or ready.
// It stays live: any change the store saves to what the query read, from this tab or another,
// reads it again (Dexie's liveQuery), so a reply streaming in shows as it is saved. reload() reads
// at once, for a change the page must see before it moves on (a new thread before going to it).
// A change of key reads afresh. The query may only read the store: liveQuery tracks what it reads.

export type Load<T> = { state: "loading" } | { state: "error"; error: Error } | { state: "ready"; data: T };

export function useLive<T>(query: () => Promise<T>, key: string): { load: Load<T>; reload: () => Promise<void> } {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const latest = useRef(query);
  latest.current = query; // the key names what is read; query is a fresh closure on every render

  useEffect(() => {
    setLoad({ state: "loading" });
    const watch = liveQuery(() => latest.current()).subscribe({
      next: (data) => setLoad({ state: "ready", data }),
      error: (error: Error) => setLoad({ state: "error", error }),
    });
    return () => watch.unsubscribe();
  }, [key]);

  const reload = useCallback(async () => {
    try {
      setLoad({ state: "ready", data: await latest.current() });
    } catch (error) {
      setLoad({ state: "error", error: error as Error });
    }
  }, []);

  return { load, reload };
}
