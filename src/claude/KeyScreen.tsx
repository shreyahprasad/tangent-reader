import { useState } from "react";
import { savedChanged, useSaved } from "../app/saved";
import { Field } from "../shell/Field";
import { lastFour, loadKey, removeKey, saveKey, type Keep } from "./key";

// Your Anthropic API key: add it, see where it is kept, remove it (docs/design.md, Asking Claude). In
// Settings, and on an empty library the first time.

const GET_KEY = "https://platform.claude.com/settings/keys";
export const SOURCE = "https://github.com/shreyahprasad/tangent-reader";
export const PRIVACY = `${SOURCE}/blob/main/PRIVACY.md`;
export const SECURITY = `${SOURCE}/blob/main/SECURITY.md`;

const WHERE: Record<Keep, string> = {
  tab: "in this tab only",
  device: "on this device",
};

export function KeyScreen() {
  const saved = useSaved(loadKey);
  const [key, setKey] = useState("");
  const [keep, setKeep] = useState<Keep>("tab");
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (saved) {
    return (
      <section className="panel flex flex-col gap-3">
        <h2>Your Anthropic key</h2>
        <p className="text-copy">
          Your key ends in <span className="num font-mono">{lastFour(saved.key)}</span> and is kept {WHERE[saved.keep]}.
        </p>
        <button
          type="button"
          className="link-button link-button-quiet self-start"
          onClick={() => {
            removeKey();
            savedChanged();
          }}
        >
          Remove key
        </button>
      </section>
    );
  }

  const submit = async () => {
    setChecking(true);
    setProblem(null);
    const why = await import("./client").then(
      ({ checkKey }) => checkKey(key),
      () => "Could not load the part of the page that checks your key. Check your connection, then reload the page.",
    );
    setChecking(false);
    if (why) return setProblem(why);
    try {
      saveKey(key, keep);
    } catch {
      return setProblem("This browser would not keep your key. Check that it allows this site to store data, then try again.");
    }
    setKey("");
    // On a phone the keyboard is still up for the key box, and iOS has shifted the whole page to
    // show it. The form is about to go, so close the keyboard first, then put the page back:
    // only <main> scrolls here, so a page left shifted stays cut off.
    (document.activeElement as HTMLElement | null)?.blur();
    savedChanged();
    requestAnimationFrame(() => window.scrollTo(0, 0));
  };

  return (
    <form
      className="panel flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2>Add your Anthropic API key</h2>
      <div className="flex flex-col gap-2 text-copy text-muted">
        <p>
          Tangent Reader asks Claude with your own key. It goes only from this browser to Anthropic, never to us. The{" "}
          <a className="text-accent underline" href={SOURCE} target="_blank" rel="noreferrer">
            code is open
          </a>{" "}
          for you to check, and the{" "}
          <a className="text-accent underline" href={PRIVACY} target="_blank" rel="noreferrer">
            privacy note
          </a>{" "}
          says what goes where.
        </p>
        <p>
          Make a key just for Tangent Reader, in a Console workspace with a spend limit. That caps what it can spend better than
          this page can.{" "}
          <a className="text-accent underline" href={GET_KEY} target="_blank" rel="noreferrer">
            Get a key
          </a>
        </p>
      </div>

      <Field label="API key">
        {(id) => (
          <input
            id={id}
            className="control font-mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-..."
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">Keep it</legend>
        {(["tab", "device"] as const).map((place) => (
          <label key={place} className="flex min-h-(--tap-min) items-center gap-2 text-small">
            <input type="radio" name="keep" checked={keep === place} onChange={() => setKeep(place)} />
            {place === "tab" ? "In this tab only" : "Remember on this device"}
          </label>
        ))}
        <p className="text-small text-muted">
          Phones often close tabs in the background, so with this tab only you may need to paste the key again.
        </p>
      </fieldset>

      {problem && (
        <p role="alert" className="text-small text-negative">
          {problem}
        </p>
      )}
      <button type="submit" className="button button-primary self-start" disabled={checking}>
        {checking ? "Checking your key" : "Check and save"}
      </button>
    </form>
  );
}
