import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { askAgain, askQuestion } from "../app/asking";
import { db } from "../app/db";
import { useSaved } from "../app/saved";
import { loadModel } from "../claude/choice";
import { budget, budgetNote, cacheCold, loadLimit, overNote, readInCost, readInNote, type Budget } from "../claude/guard";
import { loadKey } from "../claude/key";
import { linkable } from "../claude/search";
import { href } from "../shell/router";
import { useLive } from "../shell/useLive";
import { useSave } from "../shell/useSave";
import { lastCacheCall, spending } from "../store/reads";
import { setFlag } from "../store/store";
import type { Citation, Message, Session, Thread } from "./data";
import { loadDraft, saveDraft } from "./drafts";
import { MapPanel } from "./MapPanel";
import { SHEET_SCROLL } from "./nav";
import { outline, pillParts, threadLabel } from "./outline";
import { Prose } from "./Prose";
import { PathParts, SHEET, SHEET_FULL, SHEET_HALF } from "./parts";
import { parseArticle, type Sentence } from "./sentences";
import { PHONE_QUERY } from "./style";
import { estimateTokens, isDrag, isLookingUp, isThinking, isWaiting, keyboardUp, lookItUpCost, pendingIn, sheetFrame, stripRelease, tangentMarks, threadMessages, withPending, type Detent, type Viewport } from "./tangent";

// One thread: what it is about, the conversation, and the question box. On a laptop it sits
// beside the article; on the phone it is a sheet at half height, so the lit sentence shows above
// it, and a drag on its top (or a tap) takes it to full height, back, or closed. With the
// keyboard up it fills just the visible area, so its sentence never slides off screen. On the
// laptop, Full widens the panel instead, as a new history entry, so Back narrows it again.
// Asking returns once the question is saved. The reply streams in as the store saves it, which
// the page is watching (ArticleView); its sentences can be tapped once it has ended.

export function ThreadSheet({
  session,
  path,
  detent,
  onDetent,
  onWiden,
  busy,
  onTapAnswer,
  onChanged,
  onBack,
  onStart,
  onMap,
  onArticle,
  onClose,
}: {
  session: Session;
  /** From the anchor down to this thread. */
  path: Thread[];
  /** Half or full height on the phone, from the address. */
  detent: Detent;
  /** A drag on the phone: the address is replaced. */
  onDetent: (d: Detent) => void;
  /** Full and back on a laptop: a new history entry. */
  onWiden: (d: Detent) => void;
  busy: Map<string, "anchor" | "undo">;
  onTapAnswer: (answer: Message, sentence: Sentence, on: "sentence" | "dot") => void;
  /** Something was saved: load the session again. */
  onChanged: () => Promise<void>;
  onBack: () => void;
  /** Back to the article, at the sentence this path began on. */
  onStart: () => void;
  /** A thread tapped in the map. */
  onMap: (threadId: string) => void;
  /** The article tapped in the map. */
  onArticle: () => void;
  onClose: () => void;
}) {
  const thread = path[path.length - 1];
  const messages = threadMessages(session, thread.id);
  const waiting = isWaiting({ messages });
  const thinking = isThinking(messages);
  const sheet = useRef<HTMLElement>(null);
  const view = usePhoneViewport();
  const frame = view && sheetFrame(detent, view, document.documentElement.clientHeight);
  const keyboard = view !== null && keyboardUp(view, document.documentElement.clientHeight);
  const scroller = useRef<HTMLDivElement>(null);
  // The map, in place of the conversation, until you pick a line or close it. Kept by thread, so
  // it is closed once you land somewhere else.
  const [mapFor, setMapFor] = useState<string | null>(null);
  const mapOpen = mapFor === thread.id;
  const toggleMap = () => setMapFor(mapOpen ? null : thread.id);
  // Flag: marks the thread to come back to, for the library's Pick up card and the map.
  const flag = useSave(onChanged);
  const hasKey = useSaved(loadKey) !== null;
  const guard = useGuard(session);
  const clearFlagError = flag.clearError;
  useEffect(clearFlagError, [thread.id]); // a refusal is about the thread it was on

  // On opening, and when something is added: a newest answer shows from its first line, so a
  // long one reads top-down; otherwise (a question, the wait) the bottom is in view.
  const last = messages.at(-1);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const answer = last?.role === "assistant" ? box.querySelector<HTMLElement>(`[data-message="${last.id}"]`) : null;
    box.scrollTo({ top: answer ? answer.offsetTop - box.offsetTop - box.clientTop : box.scrollHeight });
  }, [thread.id, last?.id, last?.role, waiting]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      ref={sheet}
      aria-label="Thread"
      className={`${SHEET} ${detent === "full" ? SHEET_FULL : SHEET_HALF}`}
      style={frame ? { top: frame.top, bottom: "auto", height: frame.height } : undefined}
    >
      <DragBar sheet={sheet} detent={detent} still={keyboard} maxHeight={view?.height ?? 0} onDetent={onDetent} onClose={onClose}>
        <header className="flex items-center gap-2 border-b border-line px-[var(--panel-pad)] py-2">
          <button type="button" onClick={onBack} className="button px-2 py-1" aria-label="Back">
            ‹ Back
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => flag.save(() => setFlag(db, thread.id, !thread.flagged))}
            disabled={flag.busy}
            aria-pressed={thread.flagged}
            aria-label="Flag this thread"
            className={`button px-2 py-1 ${thread.flagged ? "text-accent" : ""}`}
          >
            <span aria-hidden="true">{thread.flagged ? "⚑" : "⚐"}</span>
          </button>
          <button type="button" onClick={toggleMap} aria-pressed={mapOpen} className="button px-2 py-1" aria-label="Map of this session">
            Map
          </button>
          {path.length > 1 && (
            <button type="button" onClick={onStart} className="button px-2 py-1" aria-label="Back to start: the article sentence this began on">
              Start
            </button>
          )}
          <button
            type="button"
            onClick={() => onWiden(detent === "full" ? "half" : "full")}
            className="button px-2 py-1 max-md:hidden"
            aria-label={detent === "full" ? "Narrow the thread" : "Full: widen the thread"}
          >
            {detent === "full" ? "Narrow" : "Full"}
          </button>
          <button type="button" onClick={onClose} className="button px-2 py-1" aria-label="Close the thread">
            ×
          </button>
        </header>
      </DragBar>
      {flag.error && (
        <p role="alert" className="border-b border-line px-[var(--panel-pad)] py-1.5 text-small text-negative">
          {flag.error}
        </p>
      )}

      {mapOpen && <MapPanel lines={outline(session, thread.id)} onGo={onMap} onArticle={onArticle} onClose={() => setMapFor(null)} />}

      {/* Hidden, not unmounted, under the map: closing it finds the conversation where it was. */}
      <div ref={scroller} {...{ [SHEET_SCROLL]: "" }} hidden={mapOpen} className="flex min-h-0 flex-1 flex-col gap-[var(--gap-item)] overflow-y-auto overscroll-contain px-[var(--panel-pad)] py-[var(--gap-item)]">
        <blockquote className="border-l-2 border-accent pl-3 text-copy text-muted">{thread.anchor_text}</blockquote>
        {messages.map((m) =>
          m.role === "user" ? (
            <Question key={m.id} message={m} budget={guard.budget} onChanged={onChanged} />
          ) : (
            <Answer key={m.id} session={session} answer={m} busy={busy} onTap={(s, on) => onTapAnswer(m, s, on)} />
          ),
        )}
        {thinking && <Thinking lookingUp={isLookingUp(messages)} />}
      </div>

      <div hidden={mapOpen} className="shrink-0 border-t border-line">
        <PathPill parts={pillParts(path.map((t) => threadLabel(session, t)))} onOpen={toggleMap} />
        <Compose
          key={thread.id}
          thread={thread}
          waiting={waiting}
          hasKey={hasKey}
          guard={guard}
          onChanged={onChanged}
          // On the phone, a question asked from half height opens the sheet full, so the answer has
          // room. Replaced like a drag, so Back never steps through heights.
          onAsked={() => detent === "half" && matchMedia(PHONE_QUERY).matches && onDetent("full")}
        />
      </div>
    </aside>
  );
}

interface Guard {
  budget: Budget;
  /** The line before a question that must read the article in again, or null. */
  readIn: (search: boolean) => string | null;
}

/** The spending guard for this session (docs/design.md, Asking Claude): this month against your limit,
 *  and what the next question costs to read the article in once the cache has gone cold. A soft
 *  guard: if its read fails, you can still ask. */
function useGuard(session: Session): Guard {
  const model = useSaved(loadModel);
  const limit = useSaved(loadLimit);
  const id = session.session.id;
  const { load } = useLive(async () => ({ month_usd: (await spending(db)).month_usd, last: await lastCacheCall(db, id, model) }), `guard:${id}:${model}`);
  const tokens = useMemo(() => estimateTokens(session.article), [session.article]);
  if (load.state !== "ready") return { budget: { state: "none" }, readIn: () => null };
  const cold = cacheCold(load.data.last, new Date());
  return { budget: budget(load.data.month_usd, limit), readIn: (search) => (cold ? readInNote(readInCost(tokens, model, search), search) : null) };
}

/** Past your monthly limit, a question waits for you to say yes. */
function ConfirmOver({ budget, onYes, onNo }: { budget: Budget; onYes: () => void; onNo: () => void }) {
  return (
    <div role="alertdialog" aria-label="Past your monthly limit" className="flex flex-col items-end gap-2">
      <p className="text-right text-small">{overNote(budget)}</p>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onNo} className="link-button link-button-quiet text-small">
          Not now
        </button>
        <button type="button" autoFocus onClick={onYes} className="button button-primary text-small">
          Ask anyway
        </button>
      </div>
    </div>
  );
}

/** The phone's sheet follows Safari's visible area (the visual viewport), which moves when the
 *  keyboard opens. null on wider screens, where the thread is a panel. */
function usePhoneViewport(): Viewport | null {
  const read = (): Viewport | null => {
    const vv = window.visualViewport;
    return vv && matchMedia(PHONE_QUERY).matches ? { height: vv.height, offsetTop: vv.offsetTop } : null;
  };
  const [view, setView] = useState(read);
  useEffect(() => {
    const update = () => setView(read());
    const vv = window.visualViewport;
    const phone = matchMedia(PHONE_QUERY);
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    phone.addEventListener("change", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      phone.removeEventListener("change", update);
    };
  }, []);
  return view;
}

/** The top of the phone's sheet: the grey bar and the header row, all of it a place to drag.
 *  A drag moves the sheet's top edge (writing the height directly, no render per move) and
 *  letting go settles it at a stop. A tap off the buttons toggles half and full, and a tap on
 *  Back or × is just that button: the drag only takes over once the finger has moved TAP_SLOP.
 *  Held still while the keyboard is up. */
function DragBar({
  sheet,
  detent,
  still,
  maxHeight,
  onDetent,
  onClose,
  children,
}: {
  sheet: RefObject<HTMLElement | null>;
  detent: Detent;
  still: boolean;
  maxHeight: number;
  onDetent: (d: Detent) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const drag = useRef<{ y: number; height: number; dragging: boolean; style: { top: string; bottom: string; height: string } } | null>(null);
  const toggle = () => onDetent(detent === "half" ? "full" : "half");

  const down = (e: PointerEvent) => {
    const el = sheet.current;
    if (!el || still || !matchMedia(PHONE_QUERY).matches) return;
    const { top, bottom, height } = el.style;
    drag.current = { y: e.clientY, height: el.getBoundingClientRect().height, dragging: false, style: { top, bottom, height } };
  };
  const move = (e: PointerEvent) => {
    const el = sheet.current;
    const d = drag.current;
    if (!el || !d) return;
    const dy = e.clientY - d.y;
    if (!d.dragging) {
      if (!isDrag(dy)) return;
      d.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      el.dataset.dragging = "";
      el.style.top = "auto"; // the top edge follows the finger; the bottom stays put
      el.style.bottom = "0px";
    }
    el.style.height = `${Math.min(maxHeight || window.innerHeight, d.height - dy)}px`;
  };
  const up = (e: PointerEvent) => {
    const el = sheet.current;
    const d = drag.current;
    drag.current = null;
    if (!el || !d) return;
    if (d.dragging) {
      delete el.dataset.dragging;
      Object.assign(el.style, d.style); // back to what React set; the new stop renders next
    }
    const release = stripRelease(detent, d.dragging ? e.clientY - d.y : 0, (e.target as Element).closest("button") !== null, window.innerHeight);
    if (release.kind === "button") return; // the button's own click does it
    if (release.to === "closed") onClose();
    else onDetent(release.to);
  };

  return (
    <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} className="shrink-0 max-md:touch-none">
      <button
        type="button"
        onClick={toggle}
        aria-label={detent === "half" ? "Show the whole thread" : "Show the article above"}
        className="flex w-full justify-center pt-2 pb-1.5 md:hidden"
      >
        <span aria-hidden="true" className="h-1 w-9 rounded-full bg-line" />
      </button>
      {children}
    </div>
  );
}

/** Where you are, just above the question box where your thumb is: "Article › … › How Y". A tap
 *  opens the map. */
function PathPill({ parts, onOpen }: { parts: string[]; onOpen: () => void }) {
  return (
    <div className="px-[var(--panel-pad)] pt-2 pb-2">
      <button
        type="button"
        onClick={onOpen}
        // Starts with what it shows, so speaking what you see finds it (WCAG 2.5.3).
        aria-label={`${parts.join(" ")}: you are here. Map of this session`}
        className="flex max-w-full items-center gap-1.5 rounded-full border border-line px-3 py-1 text-small text-muted hover:text-fg"
      >
        <PathParts parts={parts} />
      </button>
    </div>
  );
}

/** Your question. One that failed, or was cut short, says why and can be asked again. */
function Question({ message, budget, onChanged }: { message: Message; budget: Budget; onChanged: () => Promise<void> }) {
  const { busy, error, save } = useSave(onChanged);
  const [confirming, setConfirming] = useState(false);
  const again = (confirmed = false) => {
    if (budget.state === "over" && !confirmed) return setConfirming(true);
    setConfirming(false);
    save(() => askAgain(message.id));
  };
  return (
    <div className="flex flex-col items-end gap-1.5">
      <p className="max-w-[85%] rounded-[var(--radius-control)] bg-bg px-3 py-2 text-copy whitespace-pre-line">{message.text}</p>
      {(message.status === "failed" || message.status === "interrupted") && (
        <div className="flex max-w-[85%] flex-col items-end gap-1.5">
          <p className="text-right text-small text-negative">{message.error}</p>
          {error && <p className="text-right text-small text-negative">{error}</p>}
          {confirming ? (
            <ConfirmOver budget={budget} onYes={() => again(true)} onNo={() => setConfirming(false)} />
          ) : (
            <button type="button" onClick={() => again()} disabled={busy} className="button text-small">
              {busy ? "Asking…" : "Ask again"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Answer({
  session,
  answer,
  busy,
  onTap,
}: {
  session: Session;
  answer: Message;
  busy: Map<string, "anchor" | "undo">;
  onTap: (sentence: Sentence, on: "sentence" | "dot") => void;
}) {
  const pending = pendingIn(busy, answer.id);
  if (answer.status === "streaming") {
    // Plain text while it arrives: its last sentence is still growing, so its place would move.
    return (
      <div data-message={answer.id} aria-busy="true" className="flex flex-col gap-1.5 scroll-mt-[var(--gap-item)]">
        <p className="text-body leading-[var(--read-leading)] whitespace-pre-line">{answer.text.trim()}</p>
        <span className="sr-only">Claude is still answering</span>
      </div>
    );
  }
  return (
    <div data-message={answer.id} className="flex flex-col gap-1.5 scroll-mt-[var(--gap-item)]">
      <Prose
        scope={answer.id}
        paragraphs={parseArticle(answer.text)}
        marks={withPending(tangentMarks(session, answer.id), pending)}
        busy={new Set(pending.keys())}
        rail={false}
        onTap={onTap}
        className="gap-[var(--gap-item)] text-body leading-[var(--read-leading)]"
      />
      {answer.citations.length > 0 && <Sources citations={answer.citations} />}
      {answer.truncated && <p className="text-small text-muted">Cut off before it finished. Ask it to go on.</p>}
      {answer.status === "interrupted" && <p className="text-small text-muted">This answer was cut short.</p>}
    </div>
  );
}

/** The pages an answer cited, numbered in the order it first cites them. Only a web page becomes
 *  a link. */
function Sources({ citations }: { citations: Citation[] }) {
  return (
    <section aria-label="Sources" className="flex flex-col gap-1 text-small">
      <h3 className="label">Sources</h3>
      <ol className="list-decimal pl-5 text-muted">
        {citations.map((c) => (
          <li key={c.url} className="break-words">
            {linkable(c.url) ? (
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                {c.title}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              c.title
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Where the answer will be, until its first words arrive: a shape, not a spinner. With Look it
 *  up on, it says so, since a search takes a while. */
function Thinking({ lookingUp }: { lookingUp: boolean }) {
  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      {lookingUp ? <p className="text-small text-muted">Looking it up…</p> : <span className="sr-only">Claude is thinking</span>}
      {["w-3/4", "w-full", "w-1/2"].map((w) => (
        <span key={w} aria-hidden="true" className={`block h-3 ${w} animate-pulse rounded bg-line motion-reduce:animate-none`} />
      ))}
    </div>
  );
}

/** The question box. With no key it keeps your draft and points to Settings instead of asking. */
function Compose({
  thread,
  waiting,
  hasKey,
  guard,
  onChanged,
  onAsked,
}: {
  thread: Thread;
  waiting: boolean;
  hasKey: boolean;
  guard: Guard;
  onChanged: () => Promise<void>;
  /** The question is saved and being asked. */
  onAsked: () => void;
}) {
  // Kept across a reload until it is sent (drafts.ts).
  const [draft, setDraftState] = useState(() => loadDraft(thread.id));
  const setDraft = (text: string) => {
    setDraftState(text);
    saveDraft(thread.id, text);
  };
  const { busy: sending, error, save } = useSave(onChanged);
  // "Look it up": off until you turn it on, then on for this thread's next questions until you
  // turn it off or leave the thread.
  const [search, setSearch] = useState(false);
  // Past your monthly limit: the question you sent, waiting for you to say yes.
  const [confirming, setConfirming] = useState<string | null>(null);
  // Kept to one line beside the switch: the phone's half sheet has little room.
  const spent = budgetNote(guard.budget);
  const readIn = guard.readIn(search);

  const send = (text: string, confirmed = false) => {
    if (!text.trim() || waiting || !hasKey) return;
    if (guard.budget.state === "over" && !confirmed) return setConfirming(text);
    setConfirming(null);
    save(async () => {
      await askQuestion(thread.id, text.trim(), search);
      setDraft("");
      onAsked();
    });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };
  const sendOnModEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(draft);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 px-[var(--panel-pad)] pb-3">
      {hasKey && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button type="button" onClick={() => setSearch(!search)} aria-pressed={search} className={`button px-2 py-1 text-small ${search ? "text-accent" : ""}`}>
            <span aria-hidden="true">{search ? "◉" : "○"}</span> Look it up
          </button>
          {search && <span className="text-small text-muted">{lookItUpCost()}</span>}
          {readIn && <span className="text-small text-muted">{readIn}</span>}
        </div>
      )}
      {hasKey && spent && <p className="text-small">{spent}</p>}
      {confirming !== null && <ConfirmOver budget={guard.budget} onYes={() => send(confirming, true)} onNo={() => setConfirming(null)} />}
      {error && <p className="text-small text-negative">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setConfirming(null); // a changed question asks again, so the yes is for what it says
          }}
          onKeyDown={sendOnModEnter}
          rows={2}
          aria-label="Your question"
          placeholder={waiting ? "Waiting for the answer…" : "Ask about this"}
          className="control min-w-0 flex-1 resize-none"
        />
        {hasKey ? (
          <button type="submit" disabled={!draft.trim() || sending || waiting} className="button button-primary">
            {sending ? "Asking…" : "Ask"}
          </button>
        ) : (
          <a href={href("settings")} className="button button-primary">
            Add your key to ask
          </a>
        )}
      </div>
    </form>
  );
}

