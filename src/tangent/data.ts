// Shapes the pure modules work on. Times are UTC ISO strings. The call log never comes here: a
// session carries its token and cost totals only. The local store (src/store/) reads and writes
// these.

/** A place you went, as the trail keeps it. anchor_key is the article sentence: the one an article
 *  visit was at, or for a thread visit the sentence its anchor sits on, so a visit to a thread later
 *  undone still knows where on the article it was. */
export interface Visit {
  seq: number;
  at: string;
  view: "article" | "thread";
  thread_id: string | null;
  anchor_key: string | null;
  sheet: "half" | "full" | null;
  via: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  threads: number;
  questions: number;
  /** Answers you have not seen yet. */
  unread: number;
  /** Questions still waiting for an answer. */
  pending: number;
  flagged: number;
  tokens: number;
  cost_usd: number;
  last_visit: Visit | null;
}

/** A thread you left open, from any session: flagged, or with answers you have not seen. */
export interface Loop {
  thread_id: string;
  session_id: string;
  session_title: string;
  anchor_text: string;
  flagged: boolean;
  /** Your first question in it; null before you ask. */
  first_question: string | null;
  unread: number;
  last_message_at: string | null;
}

export interface Thread {
  id: string;
  kind: "anchor" | "tangent";
  parent_thread_id: string | null;
  /** The answer a tangent branched from. */
  from_message_id: string | null;
  /** Position of its sentence, "p3:s2": in the article for an anchor, in that answer for a tangent. */
  anchor_key: string;
  anchor_text: string;
  flagged: boolean;
  created_at: string;
}

/** A source an answer cited, when "Look it up" was on. */
export interface Citation {
  url: string;
  title: string;
}

/** Your question: pending until its answer is done (so a reply still arriving counts as waiting),
 *  then done, failed, or interrupted when the tab closed mid-call. An answer: streaming while it
 *  arrives, then done, or interrupted when it was cut short (docs/design.md, Data). */
export type MessageStatus = "pending" | "streaming" | "done" | "interrupted" | "failed";

export interface Message {
  id: string;
  thread_id: string;
  seq: number;
  role: "user" | "assistant";
  /** Never empty: an answer is saved from its first piece of text. */
  text: string;
  status: MessageStatus;
  /** Why a question failed or was interrupted, in words written by us. Null otherwise. */
  error: string | null;
  /** A question: "Look it up" was on. Always false on an answer. */
  search: boolean;
  /** An answer's sources. Always empty on a question. */
  citations: Citation[];
  /** The call that made an answer. Null on a question, and on an answer cut short by the tab closing. */
  call_id: string | null;
  /** An answer that hit the length limit. */
  truncated: boolean;
  /** When you saw an answer. Always null on a question. */
  read_at: string | null;
  created_at: string;
}

/** Where an article came from: pasted, fetched from a link, or read from a file. */
export type Source = "paste" | "url" | "file";

export interface Session {
  session: Omit<SessionSummary, "last_visit">;
  article: string;
  source: Source;
  /** The link or the file name. Null for a paste. */
  source_ref: string | null;
  threads: Thread[];
  /** By thread, then in order. */
  messages: Message[];
  /** The last places you went, newest first. */
  trail: Visit[];
}
