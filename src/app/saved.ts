import { useSyncExternalStore } from "react";

// What Settings keeps outside the store (the key, the model) is plain browser storage, which tells
// no one when it changes. Settings calls savedChanged() after each change, another tab's change
// arrives as a storage event, and useSaved reads it again for every page showing it.

let version = 0;
const listeners = new Set<() => void>();

export function savedChanged(): void {
  version += 1;
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") window.addEventListener("storage", savedChanged);

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** read() again whenever something Settings keeps changes. */
export function useSaved<T>(read: () => T): T {
  useSyncExternalStore(subscribe, () => version);
  return read();
}
