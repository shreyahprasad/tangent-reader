import { defineConfig, devices } from "@playwright/test";

// Tangent Reader on a phone, in a real browser (docs/design.md, Testing and evals): `pnpm e2e`. The page runs
// on its own Vite port; e2e/fake.ts saves made-up reading through the app's store and answers for
// Anthropic, so a test never calls the real API. Chromium with the iPhone's screen, touch and user
// agent; Safari's own swipe Back is checked by hand on the preview.

// csp.built.ts runs on the built page instead, under `vite preview` with the headers Cloudflare
// sends (src/shell/headers.ts), so a CSP that blocks the page fails there.

const PORT = 5192;
const BUILT = 5194;
const phone = { ...devices["iPhone 15"], browserName: "chromium" as const };

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  projects: [
    { name: "dev", testMatch: "*.e2e.ts", use: { ...phone, baseURL: `http://127.0.0.1:${PORT}` } },
    { name: "built", testMatch: "*.built.ts", use: { ...phone, baseURL: `http://127.0.0.1:${BUILT}` } },
  ],
  webServer: [
    { command: `pnpm exec vite --port ${PORT} --strictPort`, url: `http://127.0.0.1:${PORT}`, reuseExistingServer: false },
    {
      command: `pnpm exec vite build --outDir e2e-dist --emptyOutDir --logLevel warn && pnpm exec vite preview --outDir e2e-dist --port ${BUILT} --strictPort`,
      url: `http://127.0.0.1:${BUILT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
