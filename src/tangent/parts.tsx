import { dotStep, type Mark } from "./tangent";

// The marks of where you went: a dot after an anchored sentence, the rail beside a paragraph,
// and the small marks and path a line about a thread carries (the map, the library's Pick up
// card). Sizes are tokens (--dot-*, --rail-*); when they step is style.ts.

const DOT_SIZE = ["size-[var(--dot-1)]", "size-[var(--dot-1)]", "size-[var(--dot-2)]", "size-[var(--dot-3)]"] as const;

/** Hollow ring: anchored, nothing said yet. Filled, a step bigger as more is said. A ring around
 *  it: a tangent hangs below. It breathes while an answer is on the way, and carries a small bright
 *  badge while one waits unread, here or below. A real button, inline with the text. */
export function AnchorDot({ mark, label, onActivate }: { mark: Mark; label: string; onActivate: () => void }) {
  const step = dotStep(mark.messages);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onActivate}
      className="group relative mx-0.5 inline-flex size-[var(--dot-box)] items-center justify-center align-[-0.15em]"
    >
      {mark.nested && (
        <span aria-hidden="true" className="absolute size-[var(--dot-ring)] rounded-full border border-accent/60" />
      )}
      <span
        aria-hidden="true"
        className={`rounded-full transition-[width,height,background-color] motion-reduce:transition-none ${DOT_SIZE[step]} ${
          step === 0 ? "border-[1.5px] border-accent group-hover:bg-accent/30" : "bg-accent group-hover:bg-fg"
        } ${mark.waiting ? "animate-pulse motion-reduce:animate-none" : ""}`}
      />
      {mark.unread && <span aria-hidden="true" className="absolute top-0 right-0 size-[var(--unread-badge)] rounded-full bg-fg" />}
    </button>
  );
}

/** Beside a paragraph: a mark per anchor, one bar once they merge. Lit once something was said.
 *  Decorative: every anchor is reachable through its own dot. */
export function Rail({ marks, merged, said }: { marks: number; merged: boolean; said: boolean }) {
  const color = said ? "bg-accent" : "bg-muted";
  return (
    <span aria-hidden="true" className="absolute top-1.5 bottom-1.5 left-0 flex w-[var(--rail-width)] flex-col gap-1">
      {merged ? (
        <span className={`h-full rounded-full ${color}`} />
      ) : (
        Array.from({ length: marks }, (_, i) => <span key={i} className={`h-[var(--rail-mark)] rounded-full ${color}`} />)
      )}
    </span>
  );
}

/** A small round mark on a line about a thread: unread (accent) or an answer on the way. */
export function LineMark({ label, className }: { label: string; className: string }) {
  return <span role="img" aria-label={label} className={`size-[var(--dot-1)] shrink-0 self-center rounded-full ${className}`} />;
}

export const UnreadMark = () => <LineMark label="An answer you have not read" className="bg-accent" />;

export function FlagMark() {
  return (
    <span role="img" aria-label="Flagged" className="shrink-0 self-center text-small text-accent">
      ⚑
    </span>
  );
}

/** "Article › … › How Y", the last part brightest, each part cut short to fit. */
export function PathParts({ parts }: { parts: string[] }) {
  return parts.map((part, i) => (
    <span key={i} className={`flex min-w-0 items-center gap-1.5 ${i === parts.length - 1 ? "text-fg" : ""} ${i === 0 || part === "…" ? "shrink-0" : ""}`}>
      {i > 0 && <span aria-hidden="true">›</span>}
      <span className="truncate">{part}</span>
    </span>
  ));
}

/** The frame of a sheet beside the article: a panel to its right on a laptop, a sheet from the
 *  bottom on the phone. The thread and the article's map both sit in one. */
export const SHEET =
  "panel flex flex-col p-0 md:sticky md:top-[var(--page-margin)] md:h-[calc(100dvh-var(--app-header)-2*var(--page-margin))] md:shrink-0 md:self-start max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:rounded-b-none max-md:pb-[env(safe-area-inset-bottom,0px)] max-md:shadow-[var(--sheet-shadow)] max-md:transition-[height] max-md:duration-[var(--motion-page)] max-md:ease-[var(--ease-page)] motion-reduce:transition-none data-dragging:transition-none";

/** A sheet's two heights on the phone, and its two widths on a laptop. */
export const SHEET_HALF = "max-md:h-[var(--sheet-half)] md:w-[var(--tangent-panel)]";
export const SHEET_FULL = "max-md:h-[100dvh] md:w-[var(--tangent-panel-full)]";
