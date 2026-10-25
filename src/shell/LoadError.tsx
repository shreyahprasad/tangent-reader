import { isOutdated, messageFor } from "../store/errors";

// What a page shows when its data did not load from the store (docs/design.md, Architecture). A page
// left behind by a newer version in another tab offers to reload; anything else says why.

export function LoadError({ what, error, className = "" }: { what: string; error: Error; className?: string }) {
  return (
    <div role="alert" className={`flex flex-col items-start gap-2 text-muted ${className}`}>
      <span className="text-fg">Could not load {what}.</span>
      <span>{messageFor(error)}</span>
      {isOutdated(error) && (
        <button type="button" onClick={() => location.reload()} className="button button-primary">
          Reload
        </button>
      )}
    </div>
  );
}
