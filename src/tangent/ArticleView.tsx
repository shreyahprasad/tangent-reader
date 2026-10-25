import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { db } from "../app/db";
import { Breadcrumb } from "../shell/Breadcrumb";
import { useImmersive } from "../shell/immersive";
import { LoadError } from "../shell/LoadError";
import { href } from "../shell/router";
import { useLive } from "../shell/useLive";
import { useSaveEach } from "../shell/useSave";
import { session as readSession } from "../store/reads";
import { addVisits, markRead, openAnchor, openTangent, undoThread } from "../store/store";
import type { Message, Session, Thread } from "./data";
import { MapPanel } from "./MapPanel";
import { SHEET, SHEET_HALF } from "./parts";
import { Prose } from "./Prose";
import { arrival, markArrived, move, restoreScroll, showSentence } from "./nav";
import { outline, threadLabel } from "./outline";
import { fallback, placeKey, toHash, type View } from "./route";
import { parseArticle, type Sentence } from "./sentences";
import {
  anchorMarks,
  baseFor,
  closesTo,
  pathTo,
  pendingIn,
  sessionShape,
  sessionUsage,
  sourceLine,
  tangentMarks,
  tapAction,
  threadMessages,
  unreadIn,
  withPending,
  type Detent,
  type Mark,
} from "./tangent";
import { visitFor, VisitQueue, type NewVisit, type Via } from "./visits";
import { PHONE_QUERY } from "./style";
import { ThreadSheet } from "./ThreadSheet";

// One session's article (#/<session>), maybe at a sentence, and the thread open on it
// (route.ts has the addresses). The thread is read against its base: the article for an anchor,
// and for a tangent the answer it branched from, with its sentence lit (tangent.ts, baseFor).
// Every sentence, in the article and in Claude's answers, is tappable: a tap anchors it and
// opens its thread; tapping one with nothing said lets it go; tapping one with a conversation
// opens it. A tap shows at once and the store catches up. The session stays live (useLive), so a
// reply streaming in, from this tab or another, shows as it is saved.

export function ArticleView({ view }: { view: Exclude<View, { kind: "library" }> }) {
  const sessionId = view.session;
  const threadId = view.kind === "thread" ? view.thread : null;
  const { load, reload } = useLive(() => readSession(db, sessionId), sessionId);
  // Taps saving, by "scope|key": scope is "article" or an answer's id.
  const { pending: busy, error, save } = useSaveEach<string, "anchor" | "undo">();
  const data = load.state === "ready" ? load.data : null;

  const article = data?.article;
  const paragraphs = useMemo(() => (article ? parseArticle(article) : []), [article]);
  const saved = useMemo(() => (data ? anchorMarks(data) : new Map<string, Mark>()), [data]);
  const path = useMemo(() => (data && threadId ? pathTo(data, threadId) : []), [data, threadId]);
  const open = path.length > 0 ? path : null;
  const busyKeys = (scope: string) => new Set(pendingIn(busy, scope).keys());
  // The map, opened from the article: for coming back to a reading and finding a thread without
  // hunting for its sentence. Only with no thread open; a thread has its own.
  const [mapWanted, setMapWanted] = useState(false);
  const mapShown = mapWanted && !open;
  const mapButton = useRef<HTMLButtonElement>(null);
  const closeMap = () => {
    setMapWanted(false);
    mapButton.current?.focus();
  };
  useEffect(() => {
    if (!mapShown) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && closeMap();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapShown]);
  useImmersive(open !== null || mapShown);

  // The base: the article, or the answer a tangent came from.
  const base = useMemo(() => (data ? baseFor(data, path) : null), [data, path]);
  const from = base?.kind === "answer" ? base.answer : null;
  const scope = from?.id ?? "article";
  const fromText = from?.text;
  const baseParagraphs = useMemo(() => (fromText ? parseArticle(fromText) : paragraphs), [fromText, paragraphs]);
  const baseSaved = useMemo(() => (data && from ? tangentMarks(data, from.id) : saved), [data, from, saved]);

  const atSentence = (at: string | null): View => ({ kind: "article", session: sessionId, at });
  const go = (thread: string, via: Via, sheet: Detent = "half") => move({ kind: "thread", session: sessionId, thread, sheet }, via);
  // A sentence to focus once the place you are going to has drawn: the same id can be on screen
  // before it (a tangent's base holds the sentence its parent's sheet will show).
  const focusNext = useRef<string | null>(null);
  const focusSentence = (id: string) => void (focusNext.current = id);
  useLayoutEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    document.querySelector<HTMLElement>(`[data-sentence="${id}"]`)?.focus({ preventScroll: true });
  }, [placeKey(view)]);
  // Closing goes one level up: a tangent to its parent thread, an anchor to the article. Keyboard
  // focus goes back to the sentence the thread was on, not the page's top.
  const close = () => {
    const here = open?.at(-1);
    if (!here) return;
    const up = closesTo(open!);
    if (up) {
      go(up.id, "breadcrumb");
      focusSentence(`${here.from_message_id}|${here.anchor_key}`); // in the parent's answer, in its sheet
    } else {
      move(atSentence(null), "breadcrumb");
      focusSentence(`article|${here.anchor_key}`);
    }
  };
  const toArticle = () => {
    const anchor = open?.[0]?.anchor_key;
    move(atSentence(null), "breadcrumb");
    if (anchor) focusSentence(`article|${anchor}`);
  };
  // The sheet's height is in the address, but a drag replaces it: Back never steps through heights.
  const setSheet = (sheet: Detent) => view.kind === "thread" && move({ ...view, sheet }, null, { replace: true });

  // The sentence lit in the base: a tangent's own, the open anchor's, or the one the address is at.
  const lit = base?.kind === "answer" ? base.lit : (open?.[0]?.anchor_key ?? (view.kind === "article" ? view.at : null));
  const log = useVisits(sessionId);
  useArrival(view, data, open, lit && `${scope}|${lit}`, log);
  useReadMarks(data, open?.at(-1)?.id ?? null);

  const tap = (scope: string, sentence: Sentence, marks: Map<string, Mark>, on: "sentence" | "dot") => {
    const id = `${scope}|${sentence.key}`;
    if (busy.has(id)) return;
    const mark = marks.get(sentence.key);
    const action = tapAction(mark);
    const via = on === "dot" ? "dot" : scope === "article" ? "sentence" : "branch";
    // "open" means there is a saved mark. On the phone a thread you have been down opens at full
    // height; a laptop keeps its panel narrow.
    if (action === "open") return go(mark!.threadId, via, matchMedia(PHONE_QUERY).matches ? "full" : "half");
    save(
      id,
      async () => {
        if (action === "undo") {
          await undoThread(db, mark!.threadId); // "undo" means there is a saved mark
          // Its sheet closes one level up, onto the plain article for an anchor: an address at the
          // sentence would light it, and a sentence you just let go of would look anchored still.
          if (mark!.threadId === threadId && open) {
            const up = closesTo(open);
            move(up ? { kind: "thread", session: sessionId, thread: up.id, sheet: "half" } : atSentence(null), via, { replace: true });
          }
          await reload();
        } else {
          const opened =
            scope === "article" ? await openAnchor(db, sessionId, sentence.key, sentence.text) : await openTangent(db, scope, sentence.key, sentence.text);
          await reload(); // the new thread is on the page before going to it
          go(opened.thread_id, via);
        }
      },
      action,
    );
  };
  const tapAnswer = (answer: Message, sentence: Sentence, on: "sentence" | "dot") => data && tap(answer.id, sentence, tangentMarks(data, answer.id), on);
  // One identity for the base's taps, so its Prose skips drawing while a reply streams in.
  const latestTap = useRef((s: Sentence, on: "sentence" | "dot") => tap(scope, s, baseSaved, on));
  latestTap.current = (s, on) => tap(scope, s, baseSaved, on);
  const tapBase = useCallback((s: Sentence, on: "sentence" | "dot") => latestTap.current(s, on), []);

  if (load.state === "loading") return <p className="p-[var(--page-margin)] text-muted">Loading</p>;
  if (load.state === "error") {
    return (
      <div className="flex flex-col gap-[var(--gap-block)] p-[var(--page-margin)]">
        <LoadError what="this session" error={load.error} className="panel" />
        <a href={href()} className="button self-start">
          Back to the library
        </a>
      </div>
    );
  }

  const { session } = load.data;
  const usage = sessionUsage(session);
  const marks = withPending(baseSaved, pendingIn(busy, scope));
  return (
    <div className="flex gap-[var(--gap-block)] p-[var(--page-margin)]">
      <div className={`flex min-w-0 flex-1 flex-col gap-[var(--gap-block)] ${open || mapShown ? "max-md:pb-[var(--sheet-half)]" : ""}`}>
        <header className="flex flex-col gap-1">
          <Breadcrumb
            crumbs={[
              { label: "Library", href: href() },
              { label: session.title, href: toHash(atSentence(null)), onClick: toArticle },
              ...(open ? [{ label: threadLabel(load.data, open.at(-1)!), href: toHash(view) }] : []),
            ]}
          />
          {base?.kind === "answer" ? (
            <>
              <p className="label">Claude's answer to</p>
              <h1 className="prose-width">{threadLabel(load.data, base.parent)}</h1>
            </>
          ) : (
            <>
              <h1 className="prose-width">{session.title}</h1>
              <Source data={load.data} />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="num font-mono text-meta text-muted">{[sessionShape(session), usage].filter(Boolean).join(" · ")}</p>
                {session.threads > 0 && !open && (
                  <button
                    ref={mapButton}
                    type="button"
                    onClick={() => setMapWanted(!mapWanted)}
                    aria-pressed={mapShown}
                    aria-label="Map of this session"
                    className="button px-2 py-1 text-small"
                  >
                    Map
                  </button>
                )}
              </div>
            </>
          )}
        </header>

        {marks.size === 0 && <p className="text-small text-muted">Tap a sentence to ask about it. Tap it again to let it go.</p>}

        <article aria-label={from ? "The answer this tangent came from" : "The article"}>
          <Prose
            key={scope} // a new base is new text: no marks or light carried over
            scope={scope}
            paragraphs={baseParagraphs}
            marks={marks}
            busy={busyKeys(scope)}
            lit={lit}
            rail={!from}
            onTap={tapBase}
            className="prose-width gap-[var(--gap-panel)] text-title leading-[var(--read-leading)]"
          />
        </article>

        {error && (
          <p role="alert" className="panel sticky bottom-[var(--page-margin)] text-small text-negative">
            {error}
          </p>
        )}
      </div>

      {mapShown && (
        <aside aria-label="Map" className={`${SHEET} ${SHEET_HALF}`}>
          <MapPanel
            lines={outline(load.data, null)}
            onGo={(thread) => {
              setMapWanted(false);
              go(thread, "map");
            }}
            onArticle={closeMap}
            onClose={closeMap}
          />
        </aside>
      )}

      {open && (
        <ThreadSheet
          key={sessionId}
          session={load.data}
          path={open}
          detent={view.kind === "thread" ? view.sheet : "half"}
          onDetent={setSheet}
          onWiden={(sheet) => view.kind === "thread" && move({ ...view, sheet }, null)}
          busy={busy}
          onTapAnswer={tapAnswer}
          onChanged={reload}
          onBack={() => history.back()}
          onStart={() => move(atSentence(open[0].anchor_key), "start")}
          onMap={(thread) => go(thread, "map", view.kind === "thread" ? view.sheet : "half")}
          onArticle={() => move(atSentence(null), "map")}
          onClose={close}
        />
      )}
    </div>
  );
}

/** The open thread's answers count as seen once they are on screen: in view, in a visible tab.
 *  The store's change reaches the page through useLive. */
function useReadMarks(data: Session | null, threadId: string | null) {
  const unread = data !== null && threadId !== null && unreadIn(threadMessages(data, threadId));
  const visible = useSyncExternalStore(onVisibility, () => document.visibilityState === "visible");
  const marking = useRef(false);
  useEffect(() => {
    if (!unread || !threadId || marking.current || !visible) return;
    marking.current = true;
    markRead(db, threadId)
      .catch(() => {}) // not worth an error: the next change or open tries again
      .finally(() => (marking.current = false));
  }, [unread, threadId, visible, data]);
}

function onVisibility(change: () => void) {
  document.addEventListener("visibilitychange", change);
  return () => document.removeEventListener("visibilitychange", change);
}

/** Landing on a place, once its session has loaded: log the visit, and scroll. Back puts the page
 *  and the sheet where you left them; any other move slides the lit sentence to just below the
 *  top, above the sheet. A thread that is gone lands on its sentence instead, replacing the address
 *  so Back never finds it again. */
function useArrival(view: Exclude<View, { kind: "library" }>, data: Session | null, open: Thread[] | null, lit: string | null, log: (visit: NewVisit) => void) {
  const key = placeKey(view);
  const landed = useRef<string | null>(null);
  useEffect(() => {
    history.scrollRestoration = "manual"; // Back's scroll is put back below, once the page has drawn
    return () => void (history.scrollRestoration = "auto");
  }, []);
  // A layout effect, so it runs after ThreadSheet's own scroll to the newest answer.
  useLayoutEffect(() => {
    if (!data || landed.current === key) return;
    landed.current = key;
    const { via, scroll } = arrival();
    if (view.kind === "thread" && !open) return move(fallback(view, data.trail), via, { replace: true });
    log(visitFor(view, open?.[0]?.anchor_key ?? null, via, new Date()));
    markArrived();
    if (scroll) restoreScroll(scroll);
    else if (lit) showSentence(lit);
  }, [key, data !== null]); // once per place: not again for each change
}

/** The session's visit queue, saved as the page hides and when you leave the session. */
function useVisits(sessionId: string): (visit: NewVisit) => void {
  const [queue] = useState(() => new VisitQueue((batch) => addVisits(db, sessionId, batch)));
  useEffect(() => {
    const hidden = () => document.visibilityState === "hidden" && queue.flush(true);
    const gone = () => queue.flush(true);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", gone);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", gone);
      queue.flush(true);
      queue.stop();
    };
  }, [queue]);
  return useCallback((visit: NewVisit) => queue.add(visit), [queue]);
}

/** Where the article came from, under its title: a link opens the page in a new tab, and gives
 *  it nothing of this one (noopener, noreferrer). */
function Source({ data }: { data: Session }) {
  const line = sourceLine(data.source, data.source_ref);
  if (!line) return null;
  if (!line.href) return <p className="text-small text-muted">{line.text}</p>;
  return (
    <p className="text-small">
      <a href={line.href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
        {line.text} <span aria-hidden="true">↗</span>
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </p>
  );
}
