import { loadKey } from "../claude/key";
import { useIsImmersive } from "../shell/immersive";
import { href, useRoute } from "../shell/router";
import { TangentPage } from "../tangent/TangentPage";
import { useSaved } from "./saved";
import { Settings } from "./Settings";

// The frame: a top bar with the name (home to the library) and Settings, which says when there is
// no key; under it the page, which scrolls in <main> (tangent/nav.ts saves and puts back that
// scroll). On the phone the bar hides while a thread sheet is open, so the lit sentence has room.

export function App() {
  const path = useRoute();
  const immersive = useIsImmersive();
  const hasKey = useSaved(loadKey) !== null;
  const inSettings = path[0] === "settings";

  return (
    <div className="flex h-full flex-col">
      <header
        className={`${immersive ? "max-md:hidden" : ""} flex h-(--app-header) shrink-0 items-center gap-3 border-b border-line px-(--page-margin)`}
      >
        <a href={href()} className="font-mono text-small font-medium tracking-[0.04em] text-fg">
          Tangent Reader
        </a>
        <span className="flex-1" />
        <a
          href={href("settings")}
          aria-current={inSettings ? "page" : undefined}
          aria-label={hasKey ? "Settings" : "Settings: add your key"}
          className={`flex items-center gap-2 rounded-(--radius-control) px-2 py-1 text-small hover:text-fg ${inSettings ? "text-fg" : "text-muted"}`}
        >
          {!hasKey && <span className="text-accent">Add your key</span>}
          <Gear />
        </a>
      </header>
      {/* Keyed, so Settings opens at its top, not at the scroll of the article you left. */}
      <main key={inSettings ? "settings" : "reading"} className="min-h-0 flex-1 overflow-y-auto">
        {inSettings ? <Settings /> : <TangentPage path={path} />}
      </main>
    </div>
  );
}

/** A line gear on a 20px grid, 1.5px stroke. */
function Gear() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
      <circle cx="10" cy="10" r="5.5" />
    </svg>
  );
}
