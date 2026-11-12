import { useSyncExternalStore, type ReactNode } from "react";
import { t } from "../i18n.ts";

// Sections you can minimize. What you've minimized stays that way on this device, through refreshes and reloads.

const STORE = "joy-minimized";

function load() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(STORE) ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

const minimized = load();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function setMinimized(ids: string[], on: boolean) {
  for (const id of ids) {
    if (on) minimized.add(id);
    else minimized.delete(id);
  }
  try {
    localStorage.setItem(STORE, JSON.stringify([...minimized]));
  } catch {
    // Private browsing can refuse this: it just won't be remembered.
  }
  listeners.forEach((listener) => listener());
}

/** Opens a section, for when something jumps to it or adds to it. */
export const expand = (id: string) => setMinimized([id], false);

/** A section's heading, which minimizes and expands what's under it. `summary` shows while it's minimized; `action` is a
 *  button beside the heading (not inside it, so tapping it doesn't minimize the section). */
export default function Fold({
  id,
  title,
  summary,
  heading: Heading = "h3",
  headClass = "",
  action,
  children,
}: {
  id: string;
  title: ReactNode;
  summary?: ReactNode;
  heading?: "h2" | "h3" | "h4" | "h5";
  headClass?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const folded = useSyncExternalStore(subscribe, () => minimized.has(id));
  return (
    <>
      <Heading className={`fold-head ${headClass} ${action ? "has-action" : ""}`}>
        <button type="button" className="fold-toggle" aria-expanded={!folded} title={folded ? t("Expand") : t("Minimize")} onClick={() => setMinimized([id], !folded)}>
          <span className="fold-title">{title}</span>
          {folded && summary !== undefined && <span className="fold-summary">{summary}</span>}
          <span className="fold-chevron" aria-hidden="true">▾</span>
        </button>
        {action}
      </Heading>
      {/* Hidden rather than removed, so anything half typed in it is still there when you open it again. */}
      <div className="fold-body" hidden={folded}>
        {children}
      </div>
    </>
  );
}

/** Minimizes every section on the tab, or expands them all once they're all minimized. */
export function FoldAll({ ids }: { ids: string[] }) {
  const allFolded = useSyncExternalStore(subscribe, () => ids.length > 0 && ids.every((id) => minimized.has(id)));
  if (!ids.length) return null;
  return (
    <button type="button" className="link fold-all" onClick={() => setMinimized(ids, !allFolded)}>
      {allFolded ? t("Expand all") : t("Minimize all")}
    </button>
  );
}
