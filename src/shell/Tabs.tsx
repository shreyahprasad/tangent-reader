import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

// Tabs over one panel, as a screen reader expects them (WAI-ARIA tabs): the arrow keys, Home and
// End move between tabs and choose as they go, and Tab moves on into the panel.

export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  children,
}: {
  label: string;
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (tab: T) => void;
  children: ReactNode;
}) {
  const base = useId();
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const tabId = (id: T) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;

  const moveBy = (e: KeyboardEvent, at: number) => {
    const steps: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 };
    if (!(e.key in steps)) return;
    e.preventDefault();
    const next = tabs[(steps[e.key] + tabs.length) % tabs.length].id;
    onChange(next);
    buttons.current.get(next)?.focus();
  };

  return (
    <div className="flex flex-col gap-[var(--gap-item)]">
      <div role="tablist" aria-label={label} className="tabs">
        {tabs.map((tab, at) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) buttons.current.set(tab.id, el);
                else buttons.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => moveBy(e, at)}
              className="tab"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(value)}>
        {children}
      </div>
    </div>
  );
}
