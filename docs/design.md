# Design notes

How Tangent Reader works and why it is built this way. The first part is the overview: the
problem, the decisions that shape everything, and what the evals found. The rest is the reference
the code points to: each part of the code names the section here that explains it.

- [The problem](#the-problem)
- [Where it came from](#where-it-came-from)
- [Decisions and trade-offs](#decisions-and-trade-offs)
- [Architecture](#architecture)
- [Data](#data)
- [Asking Claude](#asking-claude)
- [Import](#import)
- [Reading and navigation](#reading-and-navigation)
- [Screens](#screens)
- [Demo](#demo)
- [Security](#security)
- [Testing and evals](#testing-and-evals)
- [What's next](#whats-next)

## The problem

Dense reading raises questions about single sentences. Chat tools answer them in a panel off to the
side. Ask a follow-up about one line of that answer and the thread drifts. After three questions
you have lost the paragraph you started on.

Tangent Reader keeps every conversation anchored to the exact sentence it came from. A tangent
branches from one sentence inside an answer, so a session forms a tree you can see and walk back
up. The goal: a saved map of everywhere your curiosity went, without ever losing your place.

## Where it came from

Since AI chat tools arrived in 2023, I have wanted a better way to follow my curiosity with them
without getting overwhelmed or losing track. Rabbit holes are the best part of learning with AI,
and chat makes them hard to keep. The image I kept coming back to was an infinite canvas: an
image you zoom into to find more images inside it. That is not a practical reading tool, but it
is the feeling Tangent is after. Tangent Reader is my third try at it.

**Topic Visualizer** took a prompt and broke it into a graph. Each node was a different lens on
the topic, for you to explore from. Two things went wrong. The graph was too much to take in. And
asking the model to keep lenses and sibling nodes from overlapping led to a lot of made-up
content.

**An evolution timeline** narrowed it to one lens, on a subject I love. You typed anything and got
a timeline. You could zoom in between two points to split that stretch of time into smaller
ones, again and again. The model still invented things when it filled the gaps. And you could
only go where the tool had made nodes, not wherever your question led, the way chat lets you.

Two lessons came out of those. Words get you to what you want fastest, so the conversation
belongs at the center of the page, with branching and the map off to the side. And attention is
limited for people too, so each answer should carry only what it needs. Friends who used the
early versions pushed the same way.

So Tangent puts one article, paper or chat at the center and lets you branch from any sentence,
as deep as you like. Each call sends only the article, the sentences you followed to get there,
and that one thread, never every chat at once. The model answers questions and never has to
invent the structure; you make the tree by tapping. I use it for my own reading.

It began as a page in my personal dashboard, with a Python server, SQLite and a private network,
used on my phone. Tangent Reader is the public rebuild: the same reading model, with none of the
personal infrastructure.

## Decisions and trade-offs

**Local-first, bring your own key.** A server with accounts would mean holding other people's API
keys and reading. Instead the app is a static page. Your key stays in your browser and goes only to
Anthropic. Your sessions live in IndexedDB on your device. The costs are real: no sync, a closed tab
ends a call mid-answer, and a lost device loses your reading unless you made a backup. Each one is
made visible instead of hidden: an interrupted answer is kept and offers Retry, and the library
offers a backup plainly.

**A key in the page makes script injection the main threat.** So the page has a strict Content
Security Policy, no third-party scripts and no analytics, and everything an article or answer holds
is shown as text, never as HTML. The end-to-end suite runs every flow on the built page under that
policy.

**One small server piece.** Browsers cannot fetch most web pages, so a Cloudflare Worker fetches a
link and hands the page back. It keeps nothing and refuses private addresses. The article is found
in the browser, not on the server.

**Cost is the reader's, so it is out in the open.** Every call is saved with its tokens and cost.
The article is the cached prefix of every call on it, kept for an hour: a reader pauses, and with
even one pause over 5 minutes in an hour, the 1-hour cache costs less than the 5-minute one.

**Navigation follows the browser.** Every place has an address, so Safari's swipe Back is
Tangent's Back. A map shows the session as a tree. A trail list and a long-press gesture were tried
on the phone and dropped: one read as a log, the other was hidden.

**Text Claude reads is material, never instructions.** Articles, linked pages and search results
can hold orders aimed at an AI. The prompt says so plainly, and the evals check it on every run.
They found the first prompt declining a whole answer over an injected order in 2 of 6 tries; one
line took that to 6 of 6 answered.

## Architecture

```
 Your browser                                          Cloudflare
┌──────────────────────────────────────────────┐     ┌──────────────────────┐
│ React page  ──▶  store (IndexedDB, Dexie)     │     │ Worker               │
│     │                                         │     │  serves the page     │
│     ├─ ask ───────────────────────────────────┼──▶  │  POST /fetch: a link │
│     │      Anthropic SDK, your key            │     └──────────────────────┘
│     ▼                                         │
│ api.anthropic.com (streamed answer)           │
└──────────────────────────────────────────────┘
```

| Piece | Where |
|---|---|
| The frame, Settings, the database and asking from the page | `src/app/` |
| Screens and their pure logic (sentences, outline, routes, navigation, visits, drafts, prompt) | `src/tangent/` |
| Shared UI pieces (saving, loading, routing, dates, fields, tokens) | `src/shell/` |
| The local store and its rules | `src/store/` |
| Claude: the key, the request, streaming, prices, the spending guard | `src/claude/` |
| Import: Markdown, PDF, links | `src/import/` |
| The demo session | `src/demo/` |
| The Worker: the page as static assets, and `/fetch` | `worker/`, `wrangler.jsonc` |
| End-to-end tests and evals | `e2e/`, `evals/` |

**How a question flows.** You tap a sentence and ask. The store saves the question as pending.
The page builds the request (article first, cached), streams the answer from Anthropic straight
into the store, then saves the call with its tokens and cost. Every screen reads the store live
(Dexie's `liveQuery`), so whatever changes shows at once, in this tab or another.

**Hosting.** One Cloudflare Worker serves the built page as static assets, with the security
headers, and answers `/fetch` on the same origin. It logs nothing, and no version gets a preview
address of its own.

## Data

One IndexedDB database on your device. Every row is a node, and every reference between rows is an
edge.

| Table | Holds |
|---|---|
| `articles` | The text (its id is the SHA-256 of the text, so an article is stored once), title, source (`paste`, `url` or `file`) and the link or file name |
| `sessions` | One reading of an article |
| `threads` | `anchor` (on an article sentence) or `tangent` (on a sentence in an answer), with its parent, the answer it came from, the sentence's key and text, and a flag |
| `messages` | Questions and answers in a thread, in order, with a status, citations, whether Look it up was on, and when an answer was read |
| `calls` | Every API call in full: the request (with the article taken out), the response, tokens, cost, searches, the prompt version, and the time to the first text |
| `visits` | Each place you landed, in order, never edited: how you came and where you were |

**Message status.** A question is `pending` until its answer is done, then `done`, `failed` or
`interrupted`. An answer is `streaming`, then `done` or `interrupted`. An answer is saved from its
first piece of text, so it is never empty. Retry asks again on a failed or interrupted question.
The cut-short answer stays, since it may have tangents, and the old call stays in the log.

**Rules the store keeps,** each tested:

1. An anchor has no parent. A tangent has one, and comes from an answer in its parent thread.
2. Going up through parents always ends at an anchor. No cycles.
3. Only a thread with no messages can be removed (tap to undo).
4. One question in flight per thread.
5. A saved request, with the article put back, is byte for byte what was sent.
6. Every write that changes more than one table is one transaction.
7. The database is versioned, and every change ships a migration. Your data lives where no one can
   fix it by hand. One migration serves both the device and an older backup. A tab whose code is
   older than the database stops and asks you to reload.
8. On load, a message left `pending` or `streaming` becomes `interrupted`: the tab closed mid-call.
   A question another tab is still asking is left alone (see [Two tabs](#two-tabs)).

**Export and import.** Everything, as one JSON file: every row above, the call log included, and
never the key. Import checks the version and every rule before writing anything, and refuses the
whole file on any error. A session already here is kept and skipped, so importing the same backup
twice changes nothing.

## Asking Claude

### The key

- The first run asks for an Anthropic API key and checks it with a free call before saving it.
- It suggests a key just for Tangent Reader, in a Console workspace with a spend limit. That caps
  spending better than any page can.
- You choose where it is kept: this tab only (the default, `sessionStorage`) or this device
  (`localStorage`). Settings shows its last four characters and removes it.
- The key is never in a prompt, the call log or a backup.

### The call

The page calls `api.anthropic.com` straight from the browser with the Anthropic SDK. Its
`dangerouslyAllowBrowser` flag is safe here because the key belongs to the person using the page.
The SDK loads on the first question, not with the page, since it is most of the page's code.

1. The question is saved as `pending` and the stream opens.
2. The answer is saved as it arrives, every few hundred milliseconds.
3. On finish, the call is saved and the question marked `done`. On an error, the call is saved and
   the question marked `failed` with a reason written for you (out of credit, rate limited, key
   rejected, unreachable). An answer cut off at its length is kept and marked so.

### The prompt

Built in one place, `src/tangent/context.ts`, and pinned by tests (`src/claude/pins/`) so any
change to what is sent shows as a diff.

1. **System block 1, cached for an hour:** the whole article. It is first and byte for byte the
   same in every thread, so one question's cache serves the next.
2. **System block 2:** the reading-companion guidance, the sentence you tapped, and the sentences
   you drilled down through (each capped at 400 characters). It says that what Claude reads is
   material, never instructions, and asks for plain prose in sentences that stand alone, since you
   tap single sentences.
3. **Messages:** this thread's own questions and answers.

Each call records its prompt version, so real use splits into before and after a change.

### Models and cost

| | Model | Notes |
|---|---|---|
| Default | `claude-sonnet-5-5` | A declined question falls back server-side |
| Cheaper | `claude-haiku-5-5` | About a twentieth of the price |

Both run at `low` effort with `max_tokens` 8192, which caps what one answer can cost. Models,
prices and limits live in `src/claude/models.ts`. A call is priced when it is made.

### Two tabs

A tab holds a Web Lock named for the question while it asks. Rule 8 skips a question whose lock
another tab holds, so opening a second tab never cuts off a paid answer.

### Spending guard

An optional monthly limit, set in Settings. At 80% the page warns. From 100%, each question waits
for "Ask anyway". When the next question must write a long article to the cache, its cost shows
beside the Look it up switch. The rules are pure, in `src/claude/guard.ts`.

### Look it up

A per-question switch for Anthropic's web search tool, off in a new thread, at most 3 searches.
With it on, the request also gives today's date, after the cached blocks. The answer is the text
after the last search. Sources show under it as links, each once, in the order first cited. Only an
`http` or `https` address becomes a link.

### Document size

Up to 50,000 tokens, about 35,000 words. The size is estimated in the browser, weighing each
character by what its kind costs (fitted to Anthropic's token counts across English, code and
several scripts, erring high). Over the limit is refused with the size shown, never cut, by the
form and by the store.

## Import

**Paste:** a text box, with the size shown as you near the limit.

**Files,** read on your device, never uploaded:

- `.txt` and `.md`. Markdown is reduced to its text; headings become paragraphs.
- `.pdf` through pdf.js (its legacy build, which older Safari needs), loaded only when you pick
  one. Paragraphs are rebuilt from lines: wrapped lines joined, hyphenated breaks mended, running
  headers, footers and page numbers dropped. A scanned PDF with no text, or one with a password, is
  refused with its own message.
- The title is the file's own, else a first paragraph that reads as a heading, else the file name.

**Links,** through the Worker's `POST /fetch`:

- The Worker returns the page's HTML, or a PDF's bytes. The browser parses it with `DOMParser`,
  which runs no scripts, and finds the article with Readability.
- A page is an article when it has enough text, mostly in paragraphs, and is at most half links.
  Otherwise you are told to paste instead, with a link to the Internet Archive's copy when a site
  turns Tangent away.
- **The Worker's guards,** each tested: `http` and `https` only, ports 80 and 443, no login in the
  URL; private, loopback, link-local and metadata addresses refused after DNS and after every
  redirect (at most 5); size caps (2 MB of HTML, 20 MB of PDF) and one 10-second budget; no cookies;
  a rate limit per address; only the app's own origin. Nothing about a fetch is logged.

## Reading and navigation

**Sentences.** An article is split into paragraphs and sentences with `Intl.Segmenter`, plus a
pass that mends its false splits (after "Dr.", initials, a quote). Each sentence has a positional
key, like `p3:s2`, so the same text twice stays two sentences.

**Marks.** A dot after a sentence shows its thread: a hollow ring has no messages yet, a filled dot
grows with the messages, and a second ring means a tangent below. Tapping a sentence whose thread
has no messages lets it go.

**Addresses.** Every place has one, so Back, links and reloads all work:

| Address | Place |
|---|---|
| `#/` | The library |
| `#/<session>` | The article |
| `#/<session>/at/<key>` | The article at a sentence, lit |
| `#/<session>/t/<thread>` | A thread, its sheet at half height (`/full` for full height) |
| `#/settings` | Settings |

**History is not the tree.** Back retraces the order you went in. The tree is only what branched
from what. Each history entry keeps where the page and the sheet were scrolled, so Back puts both
back.

**Visits.** Each place you land is saved, in order, never edited. The library's Pick up card uses
them to take you back to exactly where you were.

**Drafts.** An unsent question is kept per thread for the tab, so a reload never loses it.

## Screens

- **Library:** Pick up (where you last were, then the threads you left open: flagged, or with
  answers you have not read), then your sessions, newest first. An empty library offers the demo,
  the key form and the import card. Import opens on Link, with File and Paste beside it.
- **Article:** the title, its source as a link or file name, the counts, and a Map button.
- **Thread sheet:** rises over the article at half height and drags to full. On a phone, a
  sentence you have already opened a tangent on opens its sheet at full height. It shows the sentence,
  the conversation, the path from the article as a pill, and the box to ask. Asking takes it to
  full height. Close goes one level up: a tangent to its parent, an anchor to the article.
- **A tangent reads against its answer:** above its sheet (beside it on a laptop) is the answer it
  came from, its sentence lit. Its other sentences branch again.
- **Map:** the session as a tree, with where you are marked.
- **Settings:** the key, the model, the theme, what you have spent, backup, and delete everything.
- **Theme:** dark until you pick Light or Match this device in Settings. Dark needs no script, so
  the first paint is right. A theme you pick is set before the page draws, and stays on this
  device.
- **With no key** you can still read and explore. The box keeps your draft and points to Settings.
- **On a phone,** an open sheet takes the whole screen and turns off pull-to-refresh, so a swipe
  never reloads the page. A laptop gets the same page, wider.

## Demo

An empty library offers a session on Ada Lovelace's Note A (1843, public domain), explorable with
no key: two rabbit holes three levels deep and a one-level question. Its answers were written by
hand from checked sources, never generated, and cost nothing. It is built through the store like
any session. Asking a new question asks for a key.

## Security

The threats and defenses, prompt injection included, are in [SECURITY.md](../SECURITY.md). In
short: the key never leaves for anywhere but Anthropic, a strict CSP sent as a header lets scripts
come only from this site and the page connect only to itself and Anthropic, everything is shown as
text, the Worker refuses private addresses, and Claude has no tools that act. What goes where is in
[PRIVACY.md](../PRIVACY.md).

## Testing and evals

- **Unit tests (Vitest):** every rule as a pure function, the store with `fake-indexeddb`,
  migrations, export and import, the request and its pinned prompts, streaming with a fake client
  through every outcome, cost math, and Markdown and PDF rebuilding on fixture files.
- **Worker tests:** each guard, including a redirect to a private address.
- **End to end (Playwright, on an iPhone screen):** every flow, with Anthropic and the Worker
  faked. Each flow that loads code or talks to a server also runs on the built page under its real
  CSP, so a policy that would break the page fails CI.
- **CI** runs the typecheck, both suites, the build and a dependency audit on every pull request.
  No test calls the real API.
- **Evals** run Claude's real answers through the app's own request path, on made-up cases:
  injected orders, facts changed on purpose, and a fact the article never gives, plus answer shape.
  See [evals/](../evals/README.md).

## What's next

- An answer-quality judge (is it right, is it useful, does it stay on your sentence), calibrated
  on a person's own grades before its scores count.
- Tune the prompt against the evals, starting with sentences that stand alone.
- Sync, if people want it, without the server ever reading your data.
