import type { LucideIcon } from "../icons.ts";

/** A line icon chosen at runtime (a booking's kind, a list's theme). Decorative: the text next to it says what it is. */
export default function Ico({ icon: I }: { icon: LucideIcon }) {
  return <I aria-hidden="true" />;
}
