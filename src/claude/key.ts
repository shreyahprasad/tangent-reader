// Your Anthropic API key (docs/design.md, Asking Claude). It stays in this browser and goes only to
// api.anthropic.com. It never enters the store, the call log or an export. Checking it needs the
// SDK, which loads on first use (client.ts).

/** "tab" keeps it until this tab closes (sessionStorage), "device" until you remove it (localStorage). */
export type Keep = "tab" | "device";

export interface Places {
  tab: Storage;
  device: Storage;
}

const NAME = "tangent-reader:anthropic-key";
const here = (): Places => ({ tab: sessionStorage, device: localStorage });

/** The key and where it is kept, or null when there is none, or when this browser blocks site data
 *  (reading it then throws). */
export function loadKey(places = here): { key: string; keep: Keep } | null {
  try {
    const p = places();
    for (const keep of ["tab", "device"] as const) {
      const key = p[keep].getItem(NAME);
      if (key) return { key, keep };
    }
  } catch {
    // Blocked: there is no key to load.
  }
  return null;
}

/** Keeps the key in one place only. Throws when this browser will not keep site data. */
export function saveKey(key: string, keep: Keep, places = here): void {
  removeKey(places);
  places()[keep].setItem(NAME, key.trim());
}

export function removeKey(places = here): void {
  const p = places();
  p.tab.removeItem(NAME);
  p.device.removeItem(NAME);
}

/** All Settings shows of a saved key. */
export const lastFour = (key: string) => key.slice(-4);
