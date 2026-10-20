import { useState } from "react";
import type { ActivityGuide } from "../../shared/types.ts";

const LISTS: { key: keyof ActivityGuide; title: string; icon: string }[] = [
  { key: "beforeYouGo", title: "Before you go", icon: "✅" },
  { key: "itinerary", title: "Itinerary", icon: "🗺️" },
  { key: "whatToBring", title: "What to bring", icon: "🎒" },
  { key: "whatToWear", title: "What to wear", icon: "👟" },
  { key: "dos", title: "Do's", icon: "👍" },
  { key: "donts", title: "Don'ts / not allowed", icon: "🚫" },
  { key: "goodToKnow", title: "Good to know", icon: "ℹ️" },
];

/** The practical "before the day" information for an activity, collapsed by default. */
export default function ActivityGuidePanel({ guide }: { guide: ActivityGuide }) {
  const [open, setOpen] = useState(false);
  const lists = LISTS.filter((l) => (guide[l.key] as string[] | undefined)?.length);
  const facts = [
    guide.meetingPoint && ["Meeting point / pickup", guide.meetingPoint],
    guide.endPoint && ["Ends", guide.endPoint],
    guide.provider && ["Provider", guide.provider],
    guide.pin && ["PIN", guide.pin],
    guide.cancellation && ["Cancellation", guide.cancellation],
  ].filter(Boolean) as [string, string][];
  if (!lists.length && !facts.length) return null;

  const count = lists.reduce((n, l) => n + ((guide[l.key] as string[]).length ?? 0), 0);
  return (
    <div className="guide">
      <button type="button" className="link guide-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "▾" : "▸"} Activity guide{count ? ` · ${count} tips` : ""}
      </button>
      {open && (
        <div className="guide-body">
          {facts.length > 0 && (
            <dl className="guide-facts">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {lists.map((l) => (
            <section key={l.key} className={`guide-section ${l.key}`}>
              <h5>{l.icon} {l.title}</h5>
              <ul>
                {(guide[l.key] as string[]).map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
