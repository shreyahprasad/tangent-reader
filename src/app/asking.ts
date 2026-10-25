import { loadModel } from "../claude/choice";
import { loadKey } from "../claude/key";
import { REASONS } from "../claude/reasons";
import { ask, failAnswer, retry } from "../store/store";
import { db } from "./db";

// Asking Claude from the page (docs/design.md, Asking Claude). The question is saved, then this tab asks
// Claude for it and the reply streams into the store, which the page is watching. The call runs
// here, not in a component, so it goes on while you read elsewhere. answer() never throws: every
// outcome ends in the store. The SDK and the code that calls it load on the first question
// (claude/client.ts); if they cannot, the question fails and says so.

/** Saves your question, then asks. search is the "Look it up" switch. Resolves once the question
 *  is saved. */
export async function askQuestion(threadId: string, text: string, search: boolean): Promise<void> {
  const { message_id } = await ask(db, threadId, text, search);
  void answerNow(message_id);
}

/** Asks a failed or interrupted question again. */
export async function askAgain(questionId: string): Promise<void> {
  await retry(db, questionId);
  void answerNow(questionId);
}

/** With the key and model as they are now. With no key, the question fails and says to add one. */
async function answerNow(questionId: string) {
  const loaded = await Promise.all([import("../claude/answer"), import("../claude/client")]).catch((error) => {
    console.error("tangent: could not load the code that asks Claude", error);
    return null;
  });
  if (!loaded) return failAnswer(db, questionId, { call: null, reason: REASONS.not_loaded }).catch((e) => console.error("tangent: could not save the failure", e));
  const [{ answer }, { clientFor }] = loaded;
  const saved = loadKey();
  return answer(db, questionId, saved ? clientFor(saved.key) : null, loadModel());
}
