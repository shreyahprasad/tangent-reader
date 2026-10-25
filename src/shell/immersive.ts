import { useEffect, useSyncExternalStore } from "react";

// Immersive mode: a page asks for the whole screen while something needs it (Tangent's thread
// sheet). While any page asks:
// - the app hides its top bar on the phone, and
// - the page and its body stop overscrolling, which turns off Safari's pull-to-refresh, so a
//   swipe down near a sheet never reloads the page.
// Counted, so two askers never undo each other.

let asking = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The page's <html> and <body>: Safari needs overscroll off on both to skip pull-to-refresh. */
type Page = { style: { overscrollBehaviorY: string } }[];

/** One more asker. Exported, with leave(), for the tests; pages use useImmersive. */
export function enter(page: Page): void {
  asking += 1;
  page.forEach((el) => (el.style.overscrollBehaviorY = "none"));
  emit();
}

export function leave(page: Page): void {
  asking = Math.max(0, asking - 1);
  if (asking === 0) page.forEach((el) => (el.style.overscrollBehaviorY = ""));
  emit();
}

export const isImmersive = () => asking > 0;

/** While on is true, the page is immersive. */
export function useImmersive(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const page = [document.documentElement, document.body];
    enter(page);
    return () => leave(page);
  }, [on]);
}

/** For the shell: whether any page is asking. */
export function useIsImmersive(): boolean {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, isImmersive);
}
