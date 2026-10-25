import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { forgetModel, loadModel, saveModel } from "../claude/choice";
import { dollars, forgetLimit, loadLimit, readLimit, saveLimit, WARN_PERCENT } from "../claude/guard";
import { removeKey } from "../claude/key";
import { KeyScreen, PRIVACY, SECURITY } from "../claude/KeyScreen";
import { MODELS } from "../claude/models";
import { Breadcrumb } from "../shell/Breadcrumb";
import { LoadError } from "../shell/LoadError";
import { href } from "../shell/router";
import { useLive } from "../shell/useLive";
import { useSave } from "../shell/useSave";
import { spending } from "../store/reads";
import { eraseEverything, importFile } from "../store/transfer";
import { clearDrafts } from "../tangent/drafts";
import { usd } from "../tangent/tangent";
import { downloadBackup } from "./backup";
import { db } from "./db";
import { savedChanged, useSaved } from "./saved";
import { applyTheme, forgetTheme, loadTheme, saveTheme, THEMES, type Theme } from "./theme";

// Settings (#/settings, docs/design.md, Screens): your key, the model, the theme, what you have
// spent, backup, and delete everything.

export function Settings() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-[var(--gap-block)] p-[var(--page-margin)]">
      <header className="flex flex-col gap-1">
        <Breadcrumb crumbs={[{ label: "Library", href: href() }, { label: "Settings", href: href("settings") }]} />
        <h1>Settings</h1>
      </header>
      <KeyScreen />
      <ModelCard />
      <ThemeCard />
      <SpendingCard />
      <BackupCard />
      <EraseCard />
      <p className="text-small text-muted">
        <a className="text-accent underline" href={PRIVACY} target="_blank" rel="noreferrer">
          Privacy: what stays here, and what goes where
        </a>
        {" · "}
        <a className="text-accent underline" href={SECURITY} target="_blank" rel="noreferrer">
          Report a security problem
        </a>
      </p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="panel flex flex-col gap-3">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const Problem = ({ text }: { text: string | null }) =>
  text && (
    <p role="alert" className="text-small text-negative">
      {text}
    </p>
  );

const unkept = (what: string) => `This browser would not keep your ${what}. Check that it allows this site to store data.`;

function ModelCard() {
  const chosen = useSaved(loadModel);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = (id: string) => {
    try {
      saveModel(id);
      setProblem(null);
      savedChanged();
    } catch {
      setProblem(unkept("choice"));
    }
  };
  return (
    <Card title="Model">
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">The model that answers</legend>
        {MODELS.map((m) => (
          <label key={m.id} className="flex min-h-(--tap-min) items-center gap-2 text-copy">
            <input type="radio" name="model" checked={chosen === m.id} onChange={() => choose(m.id)} />
            {m.label}
          </label>
        ))}
      </fieldset>
      <p className="text-small text-muted">Your next question uses it. Answers already saved stay as they are.</p>
      <Problem text={problem} />
    </Card>
  );
}

function ThemeCard() {
  const chosen = useSaved(loadTheme);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = (id: Theme) => {
    try {
      saveTheme(id);
      applyTheme(id);
      setProblem(null);
      savedChanged();
    } catch {
      setProblem(unkept("choice"));
    }
  };
  return (
    <Card title="Theme">
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">How the page looks</legend>
        {THEMES.map((t) => (
          <label key={t.id} className="flex min-h-(--tap-min) items-center gap-2 text-copy">
            <input type="radio" name="theme" checked={chosen === t.id} onChange={() => choose(t.id)} />
            {t.label}
          </label>
        ))}
      </fieldset>
      <Problem text={problem} />
    </Card>
  );
}

function SpendingCard() {
  const { load } = useLive(() => spending(db), "spending");
  return (
    <Card title="Spending">
      {load.state === "error" && <LoadError what="your spending" error={load.error} />}
      {load.state === "ready" && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-copy">
            <dt className="text-muted">This month</dt>
            <dd className="num font-mono">{usd(load.data.month_usd)}</dd>
            <dt className="text-muted">In all</dt>
            <dd className="num font-mono">
              {usd(load.data.total_usd)} <span className="text-small text-muted">over {load.data.calls} {load.data.calls === 1 ? "call" : "calls"}</span>
            </dd>
          </dl>
          {load.data.unpriced > 0 && (
            <p className="text-small text-muted">
              {load.data.unpriced} {load.data.unpriced === 1 ? "call was" : "calls were"} answered by a model this page has no price for, so {load.data.unpriced === 1 ? "it is" : "they are"} not counted.
            </p>
          )}
          <p className="text-small text-muted">Worked out on this device from each call's tokens. Your Anthropic Console has the bill.</p>
        </>
      )}
      <LimitForm />
    </Card>
  );
}

/** A monthly limit, kept on this device. At SPEND_WARN_AT the thread warns you; past it, each question asks
 *  first. Your Console's spend limit is the one that stops spending. */
function LimitForm() {
  const limit = useSaved(loadLimit);
  const [text, setText] = useState(() => (limit === null ? "" : String(limit)));
  const [problem, setProblem] = useState<string | null>(null);
  const keep = (change: () => void) => {
    try {
      change();
      setProblem(null);
      savedChanged();
    } catch {
      setProblem(unkept("limit"));
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const read = readLimit(text);
    if ("error" in read) return setProblem(read.error);
    keep(() => saveLimit(read.usd));
    setText(String(read.usd));
  };
  const remove = () => {
    keep(forgetLimit);
    setText("");
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line pt-3">
      <label htmlFor="limit" className="text-copy">
        Monthly limit
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input id="limit" inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder="None" className="control w-32 font-mono" />
        <button type="submit" className="button">
          {limit === null ? "Set" : "Change"}
        </button>
        {limit !== null && (
          <button type="button" onClick={remove} className="link-button link-button-quiet">
            Remove
          </button>
        )}
      </div>
      <p className="text-small text-muted">
        {limit === null
          ? `In dollars. At ${WARN_PERCENT} of it, the page warns you. Past it, each question asks you first.`
          : `${dollars(limit)} a month. At ${WARN_PERCENT} the page warns you; past it, each question asks you first.`}{" "}
        The spend limit on your Console workspace is what really stops spending.
      </p>
      <Problem text={problem} />
    </form>
  );
}

function BackupCard() {
  const backup = useSave();
  const restore = useSave();
  const [result, setResult] = useState<string | null>(null);
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be picked again
    if (!file) return;
    setResult(null);
    restore.save(async () => {
      const { added, skipped } = await importFile(db, await file.text());
      setResult(`Added ${added} ${added === 1 ? "session" : "sessions"}.${skipped ? ` ${skipped} ${skipped === 1 ? "was" : "were"} already here.` : ""}`);
    });
  };
  return (
    <Card title="Backup">
      <p className="text-copy text-muted">
        Your reading is kept only in this browser. A backup holds every session and the call log, never your key. Import one here, or on another device.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={backup.busy} onClick={() => backup.save(() => downloadBackup(db))} className="button">
          Export everything
        </button>
        <label className={`button cursor-pointer focus-within:outline-2 focus-within:outline-accent ${restore.busy ? "pointer-events-none opacity-50" : ""}`}>
          {restore.busy ? "Importing…" : "Import a backup"}
          <input type="file" accept=".json,application/json" onChange={pick} className="sr-only" />
        </label>
      </div>
      {result && (
        <p role="status" className="text-small">
          {result}
        </p>
      )}
      <Problem text={backup.error ?? restore.error} />
    </Card>
  );
}

/** Erases the only copy, so it asks first and offers a backup. */
function EraseCard() {
  const [asking, setAsking] = useState(false);
  const erase = useSave();
  const exporting = useSave();
  const everything = () =>
    erase.save(async () => {
      await eraseEverything(db);
      removeKey();
      clearDrafts();
      forgetModel();
      forgetLimit();
      forgetTheme();
      applyTheme("dark");
      savedChanged();
      location.hash = href();
    });
  return (
    <Card title="Delete everything">
      <p className="text-copy text-muted">Removes every session, the call log and your key from this browser.</p>
      {asking ? (
        <div role="alertdialog" aria-label="Delete everything?" className="flex flex-col gap-3">
          <p className="text-copy">This is the only copy of your reading. Export it first if you may want it back.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={exporting.busy} onClick={() => exporting.save(() => downloadBackup(db))} className="button">
              Export first
            </button>
            <button type="button" disabled={erase.busy} onClick={everything} className="button border-negative text-negative">
              {erase.busy ? "Deleting…" : "Delete everything"}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="link-button link-button-quiet">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className="button self-start text-negative">
          Delete everything…
        </button>
      )}
      <Problem text={erase.error ?? exporting.error} />
    </Card>
  );
}
