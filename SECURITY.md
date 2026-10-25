# Security

## Reporting a problem

Please report a security problem privately, through this repository's **Security** tab: "Report a
vulnerability". Don't open a public issue for it. Say what you found, how to reproduce it, and what
someone could do with it. You'll get an answer within a week.

## What matters most here

Tangent Reader runs in your browser with your own Anthropic API key. Whatever runs in the page can
read that key, so the main threat is script getting into the page. These are the defenses, and a
way around any of them is worth a report:

- **The CSP** (`src/shell/headers.ts`) lets scripts come only from this site and lets the page
  connect only to this site and `api.anthropic.com`. No inline or evaluated code, no third-party
  scripts, no analytics.
- **Text stays text.** Articles, answers, search results and imported pages are shown as text,
  never as HTML. A page brought in by link is parsed with the browser's `DOMParser`, which runs no
  scripts, and only its text is kept. Only `http` and `https` links are ever made clickable.
- **The key** goes only to Anthropic. It is never in the call log, a backup or a request the page
  stores.
- **The Worker's `/fetch`** fetches public pages only. It refuses private, local and reserved
  addresses, including after a redirect, and caps size, time and rate (`worker/guards.ts`).

## Prompt injection and other AI risks

Anything you read can hold text aimed at an AI: an article, a page brought in by link, a search
result. Tangent Reader assumes it will, and limits what such text can do.

| Risk | What stops it |
|---|---|
| **Hidden orders in what you read** | The prompt tells Claude that the article, quotes from it and search results are material, never instructions, and that your question still gets an answer (`src/tangent/context.ts`). The evals check this on every run ([evals/](evals/README.md)). |
| **Stealing your key** | Claude never sees it. The key is not in any prompt; it only signs the request to Anthropic. |
| **Sneaking data out through an answer** (an image or link that carries your reading to someone else's server) | Answers are shown as text, never as HTML or Markdown, so nothing in them loads. The CSP lets images load only from this site and the page connect only to itself and Anthropic. Only `http` and `https` links are made clickable, and only when you tap them. |
| **Claude taking actions** | It has none. Its only tool is web search, off unless you turn on Look it up, at most 3 searches a question. It cannot fetch a page it chooses or call any other service. |
| **Running up your bill** | An answer stops at 8,192 output tokens. An optional monthly limit warns at 80% and asks before every question past it. A key made for Tangent Reader, in a Console workspace with a spend limit, caps it for certain. |
| **Misleading answers** | Not fully preventable: text you chose to read can still sway an answer. Every answer sits beside the sentence it came from, so you can check it against the source. |

A way around any of these is worth a report.

## Also in scope

- A way for one site's content to reach another session's data, or your key.
- A way to make the Worker reach an address it should refuse, or send more than it allows.
- Spending: a way to make the page call Anthropic without your question.

Out of scope: what someone with your unlocked device or your browser's developer tools can do, and
Anthropic's or Cloudflare's own services.

## Dependencies

Dependencies are kept few, pinned to exact versions at least 3 days old, and audited (`pnpm audit`)
on every pull request.
