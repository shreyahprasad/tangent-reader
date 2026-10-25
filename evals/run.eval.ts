import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { answer } from "../src/claude/answer";
import { clientFor } from "../src/claude/client";
import { DEFAULT_MODEL, ratesFor } from "../src/claude/models";
import { freshDB } from "../src/store/testing";
import { ask, createSession, openAnchor } from "../src/store/store";
import { sentenceAt } from "../src/demo/demo";
import { estimateTokens } from "../src/tangent/tangent";
import { CASES } from "./cases/robustness";
import { grade, shape } from "./graders";

// The robustness run: `ANTHROPIC_API_KEY=... pnpm eval`. Each case goes through the app's own
// answer(), with a throwaway store in memory and the real API, so the request is exactly what the
// page sends. Real calls cost money, so the run refuses to start when its estimate would take the
// total spent across every saved run past BUDGET_USD, and stops if it gets there midway.
//
// Options: EVAL_MODEL (the page's default), EVAL_REPS (2), BUDGET_USD (2), EVAL_CASES (ids, comma
// separated: all when unset). Run one at a time: the total is read once at the start. The total
// lives in results/, so keep those files.

const RESULTS = join(import.meta.dirname, "results");
const wanted = process.env.EVAL_CASES?.split(",").map((id) => id.trim());
const cases = wanted ? CASES.filter((c) => wanted.includes(c.id)) : CASES;
const model = process.env.EVAL_MODEL ?? DEFAULT_MODEL;
const reps = Number(process.env.EVAL_REPS ?? 2);
const budget = Number(process.env.BUDGET_USD ?? 2);
// A typo must stop the run, never switch the guard off: every comparison with NaN is false.
if (!Number.isInteger(reps) || reps < 1) throw new Error("EVAL_REPS must be a whole number, 1 or more.");
if (!Number.isFinite(budget) || budget <= 0) throw new Error("BUDGET_USD must be a number above 0, like 2.");
/** Output tokens a call is assumed to spend, thinking included, before any are measured. */
const ASSUMED_OUTPUT = 1500;
/** The prompt beyond the article: guidance, the tapped sentence, the question. */
const PROMPT_EXTRA = 400;

interface Row {
  case: string;
  rep: number;
  model: string;
  served_model: string | null;
  status: string;
  stop_reason: string | null;
  error_kind: string | null;
  pass: boolean;
  why: string;
  answer: string;
  shape: ReturnType<typeof shape>;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  latency_ms: number;
  first_token_ms: number | null;
}

/** What every saved run has spent, failed calls included. */
function spentSoFar(): number {
  if (!existsSync(RESULTS)) return 0;
  return readdirSync(RESULTS).reduce((sum, dir) => {
    const file = join(RESULTS, dir, "answers.jsonl");
    if (!existsSync(file)) return sum;
    return sum + readFileSync(file, "utf8").split("\n").filter(Boolean).reduce((s, l) => s + ((JSON.parse(l) as Row).cost_usd ?? 0), 0);
  }, 0);
}

function estimate(): number {
  const r = ratesFor(model)!.rates;
  return cases.reduce((sum, c) => {
    const input = estimateTokens(c.article) + PROMPT_EXTRA;
    return sum + reps * ((input * r.cacheWrite1h + ASSUMED_OUTPUT * r.output) / 1e6);
  }, 0);
}

async function one(c: (typeof CASES)[number], rep: number, key: string): Promise<Row> {
  const db = freshDB();
  const { session_id } = await createSession(db, { text: c.article, title: c.id });
  const s = sentenceAt(c.article, c.tap);
  const { thread_id } = await openAnchor(db, session_id, s.key, s.text);
  const { message_id } = await ask(db, thread_id, c.question);
  await answer(db, message_id, clientFor(key), model);
  const reply = await db.messages.where("thread_id").equals(thread_id).filter((m) => m.role === "assistant").first();
  const call = reply?.call_id ? await db.calls.get(reply.call_id) : await db.calls.filter((c) => c.thread_id === thread_id).first();
  const text = reply?.status === "done" ? reply.text : "";
  const verdict = text ? grade(c.check, text, c.article) : { pass: false, why: `no answer: ${call?.error_kind ?? reply?.status ?? "none"}` };
  return {
    case: c.id,
    rep,
    model,
    served_model: call?.served_model ?? null,
    status: reply?.status ?? "none",
    stop_reason: call?.stop_reason ?? null,
    error_kind: call?.error_kind ?? null,
    ...verdict,
    answer: text,
    shape: shape(text),
    cost_usd: (call?.cost_usd ?? 0) + (call?.web_search_cost_usd ?? 0),
    input_tokens: call?.input_tokens ?? 0,
    output_tokens: call?.output_tokens ?? 0,
    cache_write_tokens: call?.cache_write_tokens ?? 0,
    latency_ms: call?.latency_ms ?? 0,
    first_token_ms: call?.first_token_ms ?? null,
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function summary(rows: Row[], spent: number): string {
  const lines = [
    `# Robustness run, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `Model ${model}, ${reps} reps per case, ${rows.length} calls, $${spent.toFixed(4)} spent.`,
    "",
    "| Case | What it tests | Passed | Why it failed |",
    "|---|---|---|---|",
  ];
  for (const c of cases) {
    const mine = rows.filter((r) => r.case === c.id);
    const failed = [...new Set(mine.filter((r) => !r.pass).map((r) => r.why))].join("; ");
    lines.push(`| \`${c.id}\` | ${c.about} | ${mine.filter((r) => r.pass).length} of ${mine.length} | ${failed || ""} |`);
  }
  const done = rows.filter((r) => r.answer);
  lines.push(
    "",
    "## Shape, over every answer",
    "",
    `- Words per answer: mean ${mean(done.map((r) => r.shape.words)).toFixed(0)}, most ${Math.max(0, ...done.map((r) => r.shape.words))}.`,
    `- Opens with filler: ${done.filter((r) => r.shape.filler).length} of ${done.length}.`,
    `- Headings, tables or code: ${done.filter((r) => r.shape.markup).length} of ${done.length}.`,
    `- Sentences after the first that lean on the one before: ${(100 * mean(done.map((r) => r.shape.leaning))).toFixed(0)}% on average.`,
    `- Time to first text: mean ${(mean(done.flatMap((r) => (r.first_token_ms === null ? [] : [r.first_token_ms]))) / 1000).toFixed(1)} s.`,
  );
  return lines.join("\n") + "\n";
}

test("robustness", { timeout: 15 * 60_000 }, async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Set ANTHROPIC_API_KEY to run the evals. They call the real API.");
  const before = spentSoFar();
  const guess = estimate();
  if (before + guess > budget) throw new Error(`This run is estimated at $${guess.toFixed(2)}; $${before.toFixed(2)} is already spent of $${budget}. Not started.`);
  console.log(`Estimated $${guess.toFixed(2)}, $${before.toFixed(2)} spent before.`);

  const dir = join(RESULTS, `${new Date().toISOString().slice(0, 19).replace(/:/g, "")}-${model}`);
  mkdirSync(dir, { recursive: true });
  const rows: Row[] = [];
  let spent = 0;
  try {
    for (const c of cases)
      for (let rep = 1; rep <= reps; rep++) {
        if (before + spent > budget) throw new Error(`Stopped at the budget: $${(before + spent).toFixed(2)} spent.`);
        const row = await one(c, rep, key);
        rows.push(row);
        spent += row.cost_usd;
        writeFileSync(join(dir, "answers.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
        console.log(`${c.id} #${rep}: ${row.pass ? "pass" : "FAIL"} (${row.why}) $${row.cost_usd.toFixed(4)}`);
      }
  } finally {
    // A run cut short still says what it found.
    writeFileSync(join(dir, "summary.md"), summary(rows, spent));
  }
  expect(rows).toHaveLength(cases.length * reps);
  expect(rows.filter((r) => !r.pass).map((r) => `${r.case} #${r.rep}: ${r.why}`)).toEqual([]);
});
