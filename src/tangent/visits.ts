import type { Visit } from "./data";
import type { View } from "./route";
import { VISIT_BATCH, VISIT_FLUSH_MS, VISITS_PER_BATCH } from "./style";

// The trail of where you went: each place you land is a visit, kept in order by the store and
// never edited (docs/design.md, Reading and navigation). Pure and tested (visits.test.ts), apart from the
// timer the queue sets.

export type Via = Visit["via"];
export type NewVisit = Omit<Visit, "seq">;

/** The visit for landing on a place. anchorKey is the article sentence a thread's anchor sits on. */
export function visitFor(view: Exclude<View, { kind: "library" }>, anchorKey: string | null, via: Via, now: Date): NewVisit {
  const at = now.toISOString();
  if (view.kind === "article") return { at, view: "article", thread_id: null, anchor_key: view.at, sheet: null, via };
  return { at, view: "thread", thread_id: view.thread, anchor_key: anchorKey, sheet: view.sheet, via };
}

/** Visits waiting to be saved. They go together once VISIT_BATCH are waiting or VISIT_FLUSH_MS has
 *  passed, one batch at a time so the store keeps them in order. A batch the store did not take
 *  stays and is tried again after VISIT_FLUSH_MS. As the page hides, or you leave the session,
 *  flush(true) sends all the rest at once. */
export class VisitQueue {
  private waiting: NewVisit[] = [];
  private sending = new Set<NewVisit>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private post: (batch: NewVisit[]) => Promise<unknown>) {}

  add(visit: NewVisit) {
    this.waiting = [...this.waiting, visit];
    if (this.waiting.length - this.sending.size >= VISIT_BATCH) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), VISIT_FLUSH_MS);
  }

  flush(all = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.sending.size > 0 && !all) return; // the batch on its way sends the next when it lands
    const unsent = this.waiting.filter((v) => !this.sending.has(v));
    for (let i = 0; i < unsent.length; i += VISITS_PER_BATCH) {
      this.send(unsent.slice(i, i + VISITS_PER_BATCH), all);
      if (!all) return;
    }
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private send(batch: NewVisit[], all: boolean) {
    batch.forEach((v) => this.sending.add(v));
    this.post(batch)
      .then(
        () => (this.waiting = this.waiting.filter((v) => !batch.includes(v))),
        () => {}, // stays waiting, and goes with the next try
      )
      .finally(() => {
        batch.forEach((v) => this.sending.delete(v));
        if (all) return;
        const left = this.waiting.length - this.sending.size;
        if (left >= VISIT_BATCH) this.flush();
        else if (left > 0) this.timer ??= setTimeout(() => this.flush(), VISIT_FLUSH_MS);
      });
  }
}
