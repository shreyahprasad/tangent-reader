import { loadKey } from "../claude/key";
import { SOURCE } from "../claude/KeyScreen";
import { useIsImmersive } from "../shell/immersive";
import { href, useRoute } from "../shell/router";
import { TangentPage } from "../tangent/TangentPage";
import { useSaved } from "./saved";
import { Settings } from "./Settings";

// The frame: a top bar with the name (home to the library), the source on GitHub, and Settings,
// which says when there is no key; under it the page, which scrolls in <main> (tangent/nav.ts saves and puts back that
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
        {/* On a phone it is the mark alone. Under 360px "Add your key" needs the room, so it waits for a key. */}
        <a
          href={SOURCE}
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          className={`${hasKey ? "" : "max-[359px]:hidden"} button inline-flex items-center gap-1.5 whitespace-nowrap text-small`}
        >
          <GitHubMark />
          <span aria-hidden="true" className="max-md:hidden">
            GitHub ↗
          </span>
        </a>
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

/** GitHub's mark (Primer's mark-github, 16px grid). */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="size-4">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}
