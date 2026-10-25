import { defineConfig } from "vitest/config";

// The evals (evals/run.eval.ts): real API calls, so never part of `pnpm test`. `pnpm eval`.
export default defineConfig({ test: { include: ["evals/**/*.eval.ts"], fileParallelism: false } });
