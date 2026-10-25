import { useId, type ReactNode } from "react";

// A form field: its label above, tied to the control by id. Every form uses it, so labels look
// and read the same everywhere. children gets the id to put on its control.

export function Field({ label, className = "", children }: { label: string; className?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
    </div>
  );
}
