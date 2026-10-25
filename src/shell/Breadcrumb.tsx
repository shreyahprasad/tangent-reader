import { Fragment } from "react";
import { opensElsewhere } from "./router";

// Where a page is, as links back up: "Library / The article / Your question". The last crumb is
// the place itself, not a link. Every page with depth uses it, so they all read the same.

export interface Crumb {
  label: string;
  href: string;
  /** Runs instead of following href, for a page that moves itself (Tangent logs each move). */
  onClick?: () => void;
}

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="label flex flex-wrap items-center gap-2">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <Fragment key={crumb.href}>
            {last ? (
              <span className="min-w-0 truncate text-fg" aria-current="location">
                {crumb.label}
              </span>
            ) : (
              <a
                href={crumb.href}
                onClick={(e) => {
                  if (!crumb.onClick || opensElsewhere(e)) return;
                  e.preventDefault();
                  crumb.onClick();
                }}
                className="hover:text-fg"
              >
                {crumb.label}
              </a>
            )}
            {!last && <span aria-hidden="true">/</span>}
          </Fragment>
        );
      })}
    </nav>
  );
}
