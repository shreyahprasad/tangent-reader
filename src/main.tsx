import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { opened } from "./app/db";
import { applyTheme, loadTheme } from "./app/theme";
import { LoadError } from "./shell/LoadError";
import "./shell/index.css";

// The page draws once the store is open (app/db.ts). A store that will not open (a newer version
// in another tab, site data blocked) says why instead. Your theme is set first, and again when
// another tab changes it.

applyTheme(loadTheme());
window.addEventListener("storage", () => applyTheme(loadTheme()));

const root = createRoot(document.getElementById("root")!);
opened.then(
  () =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  (error: Error) =>
    root.render(
      <main className="mx-auto flex max-w-xl flex-col p-(--page-margin)">
        <LoadError what="your reading" error={error} className="panel" />
      </main>,
    ),
);
