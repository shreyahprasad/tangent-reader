import { useState, type ReactNode } from "react";
import { downloadBackup } from "../app/backup";
import { db } from "../app/db";
import { useSaved } from "../app/saved";
import { KeyScreen } from "../claude/KeyScreen";
import { openDemo } from "../demo/demo";
import { loadKey } from "../claude/key";
import { LoadError } from "../shell/LoadError";
import { href, opensElsewhere } from "../shell/router";
import { useLive } from "../shell/useLive";
import { useSave } from "../shell/useSave";
import { loops as openLoops, session, sessionSummaries } from "../store/reads";
import type { SessionSummary } from "./data";
import { move } from "./nav";
import { FlagMark, PathParts, UnreadMark } from "./parts";
import { ImportCard } from "./ImportCard";
import { pickUp } from "./pickup";
import { toHash, type View } from "./route";
import type { Via } from "./visits";
import { dayLabel, lastActive, sessionShape, sessionUsage } from "./tangent";

// The front page (#/): add something to read, or pick up a session, most recently read first. With
// no sessions yet, the import card is open, and with no key the key form sits above it. Starting a
// session opens it, and opening one lands where you last were on its article. Above them, the
// Pick up card: where you last were, exactly (the thread, at its height), and the threads you left
// open. It all stays live: the visits of the session you just left land a moment after you do.

export function Library() {
  const { load } = useLive(() => sessionSummaries(db), "sessions");
  const hasKey = useSaved(loadKey) !== null;
  const [adding, setAdding] = useState(false);
  // Most recently read first, as the store gives them.
  const sessions = load.state === "ready" ? load.data : null;
  const open = (sessionId: string) => move({ kind: "article", session: sessionId, at: null }, "open");

  return (
    <div className="flex flex-col gap-[var(--gap-block)] p-[var(--page-margin)]">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1>Library</h1>
        {sessions && sessions.length > 0 && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="button button-primary">
            + Add something to read
          </button>
        )}
      </header>
      {load.state === "loading" && <p className="text-muted">Loading</p>}
      {load.state === "error" && <LoadError what="your sessions" error={load.error} className="panel" />}
      {sessions && sessions.length === 0 && <DemoCard onOpened={open} />}
      {sessions && !hasKey && (sessions.length === 0 ? <KeyScreen /> : <NoKey />)}
      {sessions && (adding || sessions.length === 0) && (
        <ImportCard onStarted={open} onClose={sessions.length > 0 ? () => setAdding(false) : undefined} focus={adding} />
      )}
      {sessions && sessions.length > 0 && !adding && <PickUpCard sessions={sessions} />}
      {sessions && sessions.length > 0 && <SessionsCard sessions={sessions} />}
    </div>
  );
}

function SessionsCard({ sessions }: { sessions: SessionSummary[] }) {
  const now = new Date();
  return (
    <section aria-label="Sessions" className="panel flex flex-col gap-[var(--gap-item)]">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="label">Sessions</h2>
        <span className="num font-mono text-small text-muted">{sessions.length}</span>
      </header>
      <BackUp />
      <ul className="flex flex-col">
        {sessions.map((s) => {
          const usage = sessionUsage(s);
          const there: View = { kind: "article", session: s.id, at: s.last_visit?.anchor_key ?? null };
          return (
            <li key={s.id}>
              <PlaceLink to={there} via="open">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="leading-tight">{s.title}</span>
                  <span className="truncate text-small leading-tight text-muted">{sessionShape(s)}</span>
                </span>
                <span className="num flex shrink-0 flex-col items-end gap-1 font-mono text-meta leading-tight text-muted">
                  <span>{dayLabel(lastActive(s), now)}</span>
                  {usage && <span>{usage}</span>}
                </span>
              </PlaceLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** First run: a session to explore before you add a key or anything to read (docs/design.md,
 *  Demo). */
function DemoCard({ onOpened }: { onOpened: (sessionId: string) => void }) {
  const { busy, error, save } = useSave();
  return (
    <section aria-label="Demo" className="panel flex flex-col gap-3">
      <h2 className="label">See how it works</h2>
      <p className="text-copy">
        Explore a session on Ada Lovelace's 1843 note on the Analytical Engine, from a silk loom to IBM to whether a machine can think. Tap a
        highlighted sentence to open its thread. No key needed. The answers in it were written by hand.
      </p>
      <button type="button" disabled={busy} onClick={() => save(async () => onOpened(await openDemo(db)))} className="button button-primary self-start">
        Open the demo
      </button>
      {error && (
        <p role="alert" className="text-small text-negative">
          {error}
        </p>
      )}
    </section>
  );
}

/** A key kept in this tab only is gone once the tab closes, so this shows often on a phone. */
function NoKey() {
  return (
    <section aria-label="Your key" className="panel flex flex-wrap items-center justify-between gap-3">
      <p className="text-copy">Add your Anthropic API key to ask Claude.</p>
      <a href={href("settings")} className="button button-primary">
        Add your key
      </a>
    </section>
  );
}

/** Your reading lives only in this browser, so the library offers its backup plainly. */
function BackUp() {
  const { busy, error, save } = useSave();
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-x-2 text-small text-muted">
        <span>Your reading is kept only in this browser.</span>
        <button type="button" disabled={busy} onClick={() => save(() => downloadBackup(db))} className="link-button">
          Back up everything
        </button>
      </p>
      {error && (
        <p role="alert" className="text-small text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

/** Where you last were, then the threads you left open (flagged, or with answers you have not
 *  seen), LOOPS_SHOWN of them until you ask for all. Hidden while it loads, and when there is
 *  nothing to pick up. */
function PickUpCard({ sessions }: { sessions: SessionSummary[] }) {
  const last = sessions.find((s) => s.last_visit);
  // Your path in a thread needs that session's threads.
  const inThread = last?.last_visit?.view === "thread" ? last.id : null;
  const { load } = useLive(() => Promise.all([openLoops(db), inThread ? session(db, inThread) : null]), `pickup|${inThread ?? ""}`);
  const [all, setAll] = useState(false);
  if (load.state === "loading") return null;
  if (load.state === "error") return <LoadError what="where you left off" error={load.error} className="panel" />;
  const [loops, resumed] = load.data;
  const card = pickUp(sessions, loops, resumed, all);
  if (!card) return null;
  const { resume } = card;

  return (
    <section aria-label="Pick up" className="panel flex flex-col gap-[var(--gap-item)]">
      <h2 className="label">Pick up</h2>
      <ul className="flex flex-col">
        {resume && (
          <li>
            <PlaceLink to={resume.view} via="resume" label={`Where you left off: ${resume.title}, at ${resume.parts.join(", then ")}${resume.unread ? ", with answers you have not read" : ""}`}>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="leading-tight">{resume.title}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-small leading-tight text-muted">
                  <PathParts parts={resume.parts} />
                </span>
              </span>
              {resume.unread && <UnreadMark />}
            </PlaceLink>
          </li>
        )}
        {card.loops.map((l) => (
          <li key={l.key}>
            <PlaceLink to={l.view} via="resume">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate leading-tight">{l.label}</span>
                <span className="truncate text-small leading-tight text-muted">{l.title}</span>
              </span>
              {l.unread && <UnreadMark />}
              {l.flagged && <FlagMark />}
            </PlaceLink>
          </li>
        ))}
      </ul>
      {card.total > card.loops.length && (
        <button type="button" onClick={() => setAll(true)} className="button self-start text-small">
          All {card.total}
        </button>
      )}
    </section>
  );
}

/** A row that goes to a place: a real link, so a new tab still works, and otherwise a move that
 *  says how you came. */
function PlaceLink({ to, via, label, children }: { to: View; via: Via; label?: string; children: ReactNode }) {
  return (
    <a
      href={toHash(to)}
      aria-label={label}
      onClick={(e) => {
        if (opensElsewhere(e)) return;
        e.preventDefault();
        move(to, via);
      }}
      className="flex items-start gap-3 border-b border-line px-2 py-2.5 hover:bg-bg/60"
    >
      {children}
    </a>
  );
}
