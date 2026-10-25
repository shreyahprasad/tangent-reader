import { memo, type KeyboardEvent } from "react";
import { AnchorDot, Rail } from "./parts";
import type { Paragraph, Sentence } from "./sentences";
import { marksKey, railFor, type Mark } from "./tangent";

// Text as tappable sentences, for the article and for each of Claude's answers alike: a tap on
// a sentence anchors it, a dot after it shows what hangs there. scope says whose sentences these
// are ("article", or the answer's id), so the same key in two texts never collides.
//
// It draws again only when what it shows changes. A long article is thousands of spans, and the
// page reads the session afresh on every save of a reply streaming in. So onTap must keep one
// identity across renders (ArticleView passes a stable one), and marks and busy are compared by
// what they hold.

export const Prose = memo(ProseAll, (a, b) =>
  a.scope === b.scope &&
  a.paragraphs === b.paragraphs &&
  a.lit === b.lit &&
  a.rail === b.rail &&
  a.className === b.className &&
  a.onTap === b.onTap &&
  [...a.busy].join() === [...b.busy].join() &&
  marksKey(a.marks) === marksKey(b.marks),
);

function ProseAll({
  scope,
  paragraphs,
  marks,
  busy,
  lit,
  rail,
  onTap,
  className = "",
}: {
  scope: string;
  paragraphs: Paragraph[];
  marks: Map<string, Mark>;
  /** Sentences with a tap in flight. */
  busy: Set<string>;
  /** The sentence of the open thread, lit brighter. */
  lit?: string | null;
  /** The margin rail: on for the article, off in an answer. */
  rail: boolean;
  /** on says what you tapped: the sentence, or the dot after it. */
  onTap: (sentence: Sentence, on: "sentence" | "dot") => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col ${className}`}>
      {paragraphs.map((paragraph) => {
        const marked = rail ? railFor(paragraph, marks) : null;
        return (
          <p key={paragraph.index} className={rail ? "relative pl-[calc(var(--rail-width)+var(--rail-gap))]" : ""}>
            {marked && <Rail {...marked} />}
            {paragraph.sentences.map((sentence) => (
              <SentenceSpan
                key={sentence.key}
                id={`${scope}|${sentence.key}`}
                sentence={sentence}
                mark={marks.get(sentence.key)}
                busy={busy.has(sentence.key)}
                lit={lit === sentence.key}
                onTap={(on) => onTap(sentence, on)}
              />
            ))}
          </p>
        );
      })}
    </div>
  );
}

function SentenceSpan({
  id,
  sentence,
  mark,
  busy,
  lit,
  onTap,
}: {
  id: string;
  sentence: Sentence;
  mark?: Mark;
  busy: boolean;
  lit: boolean;
  onTap: (on: "sentence" | "dot") => void;
}) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault(); // Space would scroll
    onTap("sentence");
  };
  const tint = lit ? "bg-[var(--anchor-lit)]" : mark ? "bg-[var(--anchor-tint)]" : "hover:bg-[var(--anchor-hover)]";
  return (
    <>
      {/* A span, not a <button>: browsers make a button a block, so a long sentence would jump
          whole to the next line instead of wrapping. Keys are wired by hand to match a button. */}
      <span
        role="button"
        tabIndex={0}
        data-sentence={id}
        aria-pressed={mark !== undefined}
        onClick={() => onTap("sentence")}
        onKeyDown={onKey}
        className={`scroll-mt-[var(--lit-margin)] cursor-pointer rounded-sm box-decoration-clone transition-colors motion-reduce:transition-none ${tint} ${busy ? "opacity-70" : ""}`}
      >
        {sentence.text}
      </span>
      {mark && <AnchorDot mark={mark} label={dotLabel(sentence.text, mark)} onActivate={() => onTap("dot")} />}{" "}
    </>
  );
}

function dotLabel(text: string, mark: Mark): string {
  if (mark.messages === 0) return `Let go of the anchor on "${text}"`;
  const notes = [mark.waiting && "an answer on the way", mark.unread && "an answer you have not read"].filter(Boolean);
  return `Conversation on "${text}", ${mark.messages} message${mark.messages === 1 ? "" : "s"}${notes.length ? `, ${notes.join(" and ")}` : ""}`;
}
