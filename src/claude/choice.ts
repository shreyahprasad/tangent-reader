import { DEFAULT_MODEL, MODELS } from "./models";

// The model you chose in Settings (docs/design.md, Asking Claude), kept on this device. Anything this
// page does not offer (an old choice, storage that refuses) reads as the default.

const NAME = "tangent-reader:model";

export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const device = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

const offered = (id: string | null | undefined): id is string => MODELS.some((m) => m.id === id);

export function loadModel(storage: Store | null = device()): string {
  try {
    const id = storage?.getItem(NAME);
    return offered(id) ? id : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/** The default is kept as no choice at all. Throws when this browser will not keep site data. */
export function saveModel(id: string, storage: Store | null = device()): void {
  if (!offered(id)) throw new Error(`Tangent Reader does not offer ${id}.`);
  if (id === DEFAULT_MODEL) storage?.removeItem(NAME);
  else storage?.setItem(NAME, id);
}

export function forgetModel(storage: Store | null = device()): void {
  storage?.removeItem(NAME);
}
