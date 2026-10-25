import { device, type Store } from "../claude/choice";

// Dark, Light, or the device's own setting (docs/design.md, Screens), kept on this device. The page is
// dark on its own (src/shell/tokens.css), so Dark is no mark on the page at all.

const NAME = "tangent-reader:theme";

export const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "system", label: "Match this device" },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

const offered = (id: string | null | undefined): id is Theme => THEMES.some((t) => t.id === id);

export function loadTheme(storage: Store | null = device()): Theme {
  try {
    const id = storage?.getItem(NAME);
    return offered(id) ? id : "dark";
  } catch {
    return "dark";
  }
}

/** Dark is kept as no choice at all. Throws when this browser will not keep site data. */
export function saveTheme(id: Theme, storage: Store | null = device()): void {
  if (!offered(id)) throw new Error(`Tangent Reader has no ${id} theme.`);
  if (id === "dark") storage?.removeItem(NAME);
  else storage?.setItem(NAME, id);
}

export function forgetTheme(storage: Store | null = device()): void {
  storage?.removeItem(NAME);
}

type Root = Pick<Element, "setAttribute" | "removeAttribute">;

export function applyTheme(id: Theme, root: Root = document.documentElement): void {
  if (id === "dark") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", id);
}
