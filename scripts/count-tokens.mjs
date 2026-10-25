// Measures the token fixtures with Anthropic's free count_tokens endpoint and writes
// src/tangent/fixtures/tokens/counts.json, which estimateTokens is tested against.
// Run again when the models change. It costs nothing; it needs a key in ANTHROPIC_API_KEY:
//   ANTHROPIC_API_KEY="$(pbpaste)" fnm exec --using=24 -- node scripts/count-tokens.mjs
// The key is read from the environment only. It is never printed or written anywhere.
import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = new URL("../src/tangent/fixtures/tokens/", import.meta.url);
const MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5"];

const client = new Anthropic();
const count = async (model, content) => (await client.messages.countTokens({ model, messages: [{ role: "user", content }] })).input_tokens;

const files = readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort();
const out = { measured: new Date().toISOString().slice(0, 10), models: {} };
for (const model of MODELS) {
  // A one-character message, less its one character, is the request's own overhead.
  const overhead = (await count(model, ".")) - 1;
  out.models[model] = {};
  for (const file of files) {
    const text = readFileSync(new URL(file, DIR), "utf8");
    out.models[model][file] = { chars: [...text].length, tokens: (await count(model, text)) - overhead };
  }
}
writeFileSync(new URL("counts.json", DIR), `${JSON.stringify(out, null, 2)}\n`);
for (const [model, byFile] of Object.entries(out.models)) {
  for (const [file, { chars, tokens }] of Object.entries(byFile)) console.log(model.padEnd(20), file.padEnd(14), `${chars} chars`.padEnd(12), `${tokens} tokens`.padEnd(13), `${(chars / tokens).toFixed(2)} chars/token`);
}
