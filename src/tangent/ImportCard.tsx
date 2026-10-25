import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { db } from "../app/db";
import { FILE_ACCEPT } from "../import/files";
import { ImportError, readFile, type Draft } from "../import/read";
import { readLink } from "../import/web";
import { Field } from "../shell/Field";
import { Tabs } from "../shell/Tabs";
import { useSave } from "../shell/useSave";
import { createSession } from "../store/store";
import { PASTE_ROWS } from "./style";
import { aboutTokens, defaultTitle, sizeStatus } from "./tangent";

// Bring something to read (docs/design.md, Import and Screens): give a link, which the Worker
// fetches and this browser reads, pick a file, which is read on this device, or paste it. Link
// comes first, since it is what most people try. Each tab keeps its own draft; the title is shared,
// and blank means the draft's own (the first sentence of a paste, a page's or a file's title). Over
// the size limit is refused here, before anything is saved.
// ⌘/Ctrl-Enter in the paste box starts reading; Enter in the link box gets the page.

type Tab = "paste" | "link" | "file";

const TABS = [
  { id: "link", label: "Link" },
  { id: "file", label: "File" },
  { id: "paste", label: "Paste" },
] as const satisfies readonly { id: Tab; label: string }[];

/** The title field's hint before there is anything to take a title from. */
const TITLE_HINT: Record<Tab, string> = { paste: "The first sentence", link: "The page's own title", file: "The file's own title, or its name" };

/** A file or a page on its way in. */
type Loading = { state: "empty" } | { state: "reading"; note: string } | { state: "ready"; draft: Draft } | { state: "refused"; message: string; archive: string | null };

/** Runs one read at a time: a newer one makes an older one's result moot. */
function useLoading() {
  const [loading, setLoading] = useState<Loading>({ state: "empty" });
  const latest = useRef(0);
  const run = async (read: (progress: (note: string) => void) => Promise<Draft>, first: string) => {
    const mine = ++latest.current;
    const set = (next: Loading) => mine === latest.current && setLoading(next);
    set({ state: "reading", note: first });
    try {
      set({ state: "ready", draft: await read((note) => set({ state: "reading", note })) });
    } catch (e) {
      set(
        e instanceof ImportError
          ? { state: "refused", message: e.message, archive: e.archive }
          : { state: "refused", message: "That could not be read. Try it again, or paste the text instead.", archive: null },
      );
    }
  };
  return { loading, run };
}

/** focus: put the cursor in the link box at once, when you asked to add something. Not on an empty
 *  library, where it would scroll past the key form and raise the phone's keyboard unasked. */
export function ImportCard({ onStarted, onClose, focus = false }: { onStarted: (sessionId: string) => void; onClose?: () => void; focus?: boolean }) {
  const [tab, setTab] = useState<Tab>("link");
  const [title, setTitle] = useState("");
  const [pasted, setPasted] = useState("");
  const [link, setLink] = useState("");
  const file = useLoading();
  const page = useLoading();
  const { busy, error, save } = useSave();
  const noteId = useId();

  const pasteDraft = useMemo<Draft>(() => ({ text: pasted, source: "paste", source_ref: null, title: defaultTitle(pasted), about: "" }), [pasted]);
  const loaded = tab === "link" ? page.loading : tab === "file" ? file.loading : null;
  const draft = tab === "paste" ? pasteDraft : loaded?.state === "ready" ? loaded.draft : null;
  const status = useMemo(() => (draft ? sizeStatus(draft.text, draft.source) : null), [draft]);

  const start = (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft || !status?.canSave) return;
    save(async () => {
      // The store tidies the text, and checks the size again.
      const { session_id } = await createSession(db, { text: draft.text, title: title.trim() || draft.title, source: draft.source, source_ref: draft.source_ref });
      onStarted(session_id);
    });
  };

  const startOnModEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
  };

  return (
    <section aria-label="Add something to read" className="panel">
      {/* noValidate: the link box is type="url" for the phone's keyboard, and a link typed without
          https:// would otherwise block Start reading without a word. The card checks for itself. */}
      <form onSubmit={start} noValidate className="flex flex-col gap-[var(--gap-item)]">
        <h2 className="label">Add something to read</h2>
        <Tabs label="How to add it" tabs={TABS} value={tab} onChange={setTab}>
          {tab === "paste" && (
            <Field label="Article">
              {(id) => (
                <textarea
                  id={id}
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  onKeyDown={startOnModEnter}
                  rows={PASTE_ROWS}
                  autoFocus={focus}
                  aria-describedby={status?.note ? noteId : undefined}
                  placeholder="Paste the whole article. Blank lines between paragraphs."
                  className="control w-full resize-y"
                />
              )}
            </Field>
          )}
          {tab === "link" && (
            <LinkBox link={link} onLink={setLink} loading={page.loading} size={status} focus={focus} onGet={() => page.run((progress) => readLink(link, progress), "Getting the page…")} />
          )}
          {tab === "file" && <FilePicker loading={file.loading} size={status} onPick={(f) => file.run((progress) => readFile(f, progress), `Reading ${f.name}…`)} />}
        </Tabs>
        {status?.note && (
          <p id={noteId} role={status.over ? "alert" : undefined} className={`num text-small ${status.over ? "text-negative" : "text-muted"}`}>
            {status.note}
          </p>
        )}
        <Field label="Title (optional)">
          {(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={draft?.title || TITLE_HINT[tab]} className="control" />}
        </Field>
        {error && <p className="text-small text-negative">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {onClose && (
            <button type="button" onClick={onClose} className="button">
              Cancel
            </button>
          )}
          <button type="submit" disabled={!status?.canSave || busy} className="button button-primary">
            {busy ? "Starting…" : "Start reading"}
          </button>
        </div>
      </form>
    </section>
  );
}

/** A link and a button to get its page, and how that is going. Enter in the box gets the page,
 *  never submits the card: there is nothing to start until the page is in. */
function LinkBox({ link, onLink, loading, size, focus, onGet }: { link: string; onLink: (link: string) => void; loading: Loading; size: Size; focus: boolean; onGet: () => void }) {
  const get = () => link.trim() && loading.state !== "reading" && onGet();
  return (
    <div className="flex flex-col gap-2">
      <Field label="Link">
        {(id) => (
          <div className="flex flex-wrap gap-2">
            <input
              id={id}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus={focus}
              value={link}
              onChange={(e) => onLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                get();
              }}
              placeholder="https://"
              className="control min-w-0 flex-1 basis-56"
            />
            <button type="button" onClick={get} disabled={!link.trim() || loading.state === "reading"} className="button">
              Get the page
            </button>
          </div>
        )}
      </Field>
      <LoadingLine loading={loading} size={size} idle="An article on the web, or a PDF. Tangent fetches it for you, and keeps nothing." />
    </div>
  );
}

/** A button for the file picker, and how the read is going. The input itself stays hidden, since
 *  its own look differs on every browser. */
function FilePicker({ loading, size, onPick }: { loading: Loading; size: Size; onPick: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => input.current?.click()} className="button">
          {loading.state === "empty" ? "Choose a file" : "Choose another"}
        </button>
        <input
          ref={input}
          type="file"
          accept={FILE_ACCEPT}
          hidden
          aria-label="File"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = ""; // so picking the same file again reads it again
            if (picked) onPick(picked);
          }}
        />
      </div>
      <LoadingLine loading={loading} size={size} idle="A PDF, Markdown or text file. It is read on this device, never uploaded." />
    </div>
  );
}

/** The size the card measured for its draft, passed down so it is counted once. */
type Size = { over: boolean; tokens: number } | null;

/** What came in, with its size. Over the limit, the refusal below says the size, rounded up. */
function ReadyLine({ draft, size }: { draft: Draft; size: Size }) {
  return !size || size.over ? draft.about : `${draft.about}, ${aboutTokens(size.tokens)}`;
}

/** One line under a picker or a link: the hint, how far a read has got, what came in, or why not. */
function LoadingLine({ loading, size, idle }: { loading: Loading; size: Size; idle: string }) {
  if (loading.state === "refused")
    return (
      <div className="flex flex-col gap-1">
        <p role="alert" className="text-small text-negative">
          {loading.message}
        </p>
        {loading.archive && (
          <p className="text-small text-muted">
            The Internet Archive may have a copy:{" "}
            <a href={loading.archive} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              open it <span aria-hidden="true">↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            , then copy its text and paste it here.
          </p>
        )}
      </div>
    );
  return (
    <p aria-live="polite" className="num text-small text-muted">
      {loading.state === "empty" && idle}
      {loading.state === "reading" && loading.note}
      {loading.state === "ready" && <ReadyLine draft={loading.draft} size={size} />}
    </p>
  );
}
