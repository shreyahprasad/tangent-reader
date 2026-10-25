import { useState } from "react";
import { messageFor } from "../store/errors";

// The two ways a page saves. Every change goes through one of them, so each shows "Saving…" and
// a refusal the same way.
//
// useSave: one form's save. "Saving…" until the change is made and the page has caught up
// (onSaved, or the change itself when it reloads with what was saved). A refusal shows the
// store's reason (messageFor) and keeps what you typed.
//
// useSaveEach: saves on a list, one row at a time. Only the row tapped waits (pending holds its
// key, and a value the row shows meanwhile, such as the checkbox you just ticked); a second tap
// on a row still saving is ignored.

export function useSave(onSaved?: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (change: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await change();
      await onSaved?.();
    } catch (e) {
      setError(messageFor(e));
    }
    setBusy(false);
  };

  return { busy, error, save, clearError: () => setError(null) };
}

export function useSaveEach<K, V = true>(onSaved?: () => Promise<unknown>) {
  const [pending, setPending] = useState<Map<K, V>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const save = async (key: K, change: () => Promise<unknown>, value?: V) => {
    if (pending.has(key)) return;
    setError(null);
    setPending((p) => new Map(p).set(key, value ?? (true as V)));
    try {
      await change();
      await onSaved?.();
    } catch (e) {
      setError(messageFor(e));
    }
    setPending((p) => {
      const next = new Map(p);
      next.delete(key);
      return next;
    });
  };

  return { pending, error, save };
}
