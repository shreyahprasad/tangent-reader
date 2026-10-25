// An unsent question, kept per thread in the tab's session storage, so a reload (Safari's
// pull-to-refresh, a crash) never loses what you were typing. Cleared once it is sent. Storage
// can be missing or refuse (Safari private browsing); then drafts simply are not kept.

const key = (threadId: string) => `tangent:draft:${threadId}`;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const store = (): Store | null => (typeof sessionStorage === "undefined" ? null : sessionStorage);

export function loadDraft(threadId: string, storage: Store | null = store()): string {
  try {
    return storage?.getItem(key(threadId)) ?? "";
  } catch {
    return ""; // storage refused: start empty
  }
}

/** A blank draft (sent, or emptied) removes the entry. */
export function saveDraft(threadId: string, text: string, storage: Store | null = store()): void {
  try {
    if (text.trim()) storage?.setItem(key(threadId), text);
    else storage?.removeItem(key(threadId));
  } catch {
    // storage full or refused: the draft lives only on screen, as before
  }
}

/** Every draft in this tab, for Delete everything. */
export function clearDrafts(storage: Pick<Storage, "length" | "key" | "removeItem"> | null = typeof sessionStorage === "undefined" ? null : sessionStorage): void {
  try {
    if (!storage) return;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k) => k?.startsWith(key("")));
    keys.forEach((k) => storage.removeItem(k!));
  } catch {
    // storage refused: there were no drafts kept
  }
}
