import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { HEADERS, headersFile } from "./src/shell/headers.ts";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The CSP and the other headers, for Cloudflare to send with every file (src/shell/headers.ts).
    { name: "headers", generateBundle() { this.emitFile({ type: "asset", fileName: "_headers", source: headersFile() }); } },
  ],
  // Local only. /fetch goes to the Worker under `pnpm dlx wrangler@4.149.0 dev --port 5193`, when it
  // runs; e2e fakes it. No CSP here: Vite's dev server injects styles and a live-reload script.
  server: { host: "127.0.0.1", port: 5190, strictPort: true, proxy: { "/fetch": "http://127.0.0.1:5193" } },
  // The built page as Cloudflare serves it, for e2e/csp.built.ts.
  preview: { host: "127.0.0.1", headers: HEADERS },
});
