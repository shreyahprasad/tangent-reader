// What the store refuses, in words the page can show as they are (docs/design.md, Data).

export class StoreError extends Error {}

/** A row that is not saved, or is gone. */
export class NotFound extends StoreError {}

/** Allowed in general, not right now: a thread with a conversation in it, a question still waiting. */
export class Refused extends StoreError {}

/** Input that does not add up: an empty question, a sentence that is not in the text. */
export class Rejected extends StoreError {}

/** This page's code is older than the database on your device, which a newer page moved on. */
export class Outdated extends StoreError {
  constructor() {
    super("Tangent Reader was updated in another tab. Reload this page to keep going.");
  }
}

const UNKNOWN = "Your reading could not be saved on this device. Reload the page and try again.";

/** This page must reload to go on. A database closed under this page was closed by a newer
 *  version opening in another tab (schema.ts). */
export const isOutdated = (error: unknown) => error instanceof Outdated || (error instanceof Error && error.name === "DatabaseClosedError");

/** Words for any error a store call throws. A store error says its own. */
export function messageFor(error: unknown): string {
  if (isOutdated(error)) return new Outdated().message;
  return error instanceof StoreError ? error.message : UNKNOWN;
}
