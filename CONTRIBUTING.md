# Contributing

Thanks for looking. Issues and pull requests are welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Report security problems privately, as [SECURITY.md](SECURITY.md) describes, never in a public
  issue.

## Setup

You need Node 24 and pnpm.

```sh
pnpm install
pnpm dev
```

## The checks a pull request needs

```sh
pnpm typecheck
pnpm test
pnpm e2e
```

CI runs these, the build and a dependency audit.

## How the code is written

- **Rules live in pure functions with tests**, written first. Components stay thin.
- **Numbers live in one place:** page numbers and thresholds in `src/tangent/style.ts`, sizes in
  `src/shell/tokens.css`, models and prices in `src/claude/models.ts`.
- **No test calls the real API or the internet.** End-to-end tests fake Anthropic and the Worker
  (`e2e/fake.ts`). Fixtures are made up or freely licensed.
- **A change to what is sent to Claude** shows up in the pinned prompts (`src/claude/pins/`).
  Explain why in the pull request, and run the evals if you can (`evals/README.md`).
- **New dependencies** need a good reason, an exact version, and a release at least 3 days old.
- Copy and comments are plain, short sentences that speak to "you".
