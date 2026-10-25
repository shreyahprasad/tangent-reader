import type { Line } from "./outline";
import { FlagMark, LineMark, UnreadMark } from "./parts";

// The map: the session as a tree under the article, in the thread's sheet (or panel) in place of
// the conversation. Each anchor in article order, its tangents below; the way from the article
// down to where you are drawn in accent. A tap on a line goes there.

export function MapPanel({
  lines,
  onGo,
  onArticle,
  onClose,
}: {
  lines: Line[];
  onGo: (threadId: string) => void;
  onArticle: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--gap-item)] overflow-y-auto overscroll-contain px-[var(--panel-pad)] py-[var(--gap-item)]">
      <header className="flex items-center justify-between gap-3">
        <h2 className="label">Map</h2>
        <button type="button" onClick={onClose} className="button px-2 py-1 text-small">
          Close
        </button>
      </header>
      <ul className="flex flex-col">
        <li>
          <button type="button" onClick={onArticle} className="flex w-full items-stretch rounded-sm text-left text-copy hover:bg-[var(--anchor-hover)]">
            <span aria-hidden="true" className="flex w-[var(--map-indent)] shrink-0 items-center justify-center">
              <span className="size-[var(--dot-1)] rounded-full bg-accent" />
            </span>
            <span className="py-1.5 pl-1.5 font-medium">Article</span>
          </button>
        </li>
        {lines.map((line) => (
          <li key={line.thread.id}>
            <button
              type="button"
              onClick={() => (line.here ? onClose() : onGo(line.thread.id))}
              aria-current={line.here ? "location" : undefined}
              className={`flex w-full items-stretch gap-2 rounded-sm pr-2 text-left text-copy ${
                line.here ? "bg-[var(--anchor-tint)]" : "hover:bg-[var(--anchor-hover)]"
              }`}
            >
              <Branches line={line} />
              <span className={`min-w-0 flex-1 truncate py-1.5 ${line.onPath ? "text-fg" : "text-muted"}`}>{line.label}</span>
              {line.here && <span className="label shrink-0 self-center text-accent">Here</span>}
              {line.waiting && <LineMark label="An answer on the way" className="animate-pulse bg-muted motion-reduce:animate-none" />}
              {line.unread && <UnreadMark />}
              {line.flagged && <FlagMark />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The tree's lines on the left of a row: one column per level above (a line down while that
 *  level has more below), then the elbow into this thread, accent when it is on your path. */
function Branches({ line }: { line: Line }) {
  const cell = "relative w-[var(--map-indent)] shrink-0";
  const color = line.onPath ? "border-accent" : "border-muted/50";
  return (
    <span aria-hidden="true" className="flex shrink-0 self-stretch">
      {line.guides.map((down, i) => (
        <span key={i} className={cell}>
          {down && <span className="absolute inset-y-0 left-1/2 border-l border-muted/50" />}
        </span>
      ))}
      <span className={cell}>
        <span className={`absolute top-0 left-1/2 border-l ${color} ${line.last ? "h-1/2" : "h-full"}`} />
        <span className={`absolute top-1/2 right-0 left-1/2 border-t ${color}`} />
      </span>
    </span>
  );
}
