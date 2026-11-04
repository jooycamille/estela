import { useEffect, useRef, useState } from "react";
import type { ActivityGuide, ActivityItem, DraftItem } from "../../shared/types.ts";
import { api } from "../api.ts";

const LISTS: { key: keyof ActivityGuide; title: string; icon: string }[] = [
  { key: "beforeYouGo", title: "Before you go", icon: "✅" },
  { key: "itinerary", title: "Itinerary", icon: "🗺️" },
  { key: "whatToBring", title: "What to bring", icon: "🎒" },
  { key: "whatToWear", title: "What to wear", icon: "👟" },
  { key: "dos", title: "Do's", icon: "👍" },
  { key: "donts", title: "Don'ts / not allowed", icon: "🚫" },
  { key: "goodToKnow", title: "Good to know", icon: "ℹ️" },
];

const MEETING = "Meeting point / pickup";
const ENDS = "Ends";

/** "What to bring" as a checklist for this activity. Separate from the packing list: this is what you need with you that day. */
function BringChecklist({ items, item, onChange }: { items: string[]; item?: ActivityItem; onChange?: () => void }) {
  const [ticked, setTicked] = useState(item?.broughtItems ?? []);
  const [error, setError] = useState<string>();
  const saving = useRef(Promise.resolve());
  const saved = (item?.broughtItems ?? []).join("|");
  useEffect(() => setTicked(item?.broughtItems ?? []), [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (text: string, on: boolean) => {
    if (!item) return;
    const next = on ? [...ticked, text] : ticked.filter((x) => x !== text);
    setTicked(next);
    setError(undefined);
    // One at a time, so quick ticks can't land out of order.
    saving.current = saving.current
      .then(() => api.updateItem(item.id, { ...item, broughtItems: next } as unknown as DraftItem))
      .then(() => onChange?.())
      .catch((e) => setError((e as Error).message));
  };
  const done = items.filter((x) => ticked.includes(x)).length;
  return (
    <section className="guide-section whatToBring">
      <h5>🎒 What to bring <span className="muted tiny">{done} of {items.length}</span></h5>
      <ul className="bring-checklist">
        {items.map((x) => (
          <li key={x} className={ticked.includes(x) ? "done" : ""}>
            <label>
              <input className="edit-lock" type="checkbox" checked={ticked.includes(x)} onChange={(e) => toggle(x, e.target.checked)} />
              <span>{x}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

/** The practical "before the day" information for an activity, collapsed by default. */
export default function ActivityGuidePanel({ guide, item, onChange }: { guide: ActivityGuide; item?: ActivityItem; onChange?: () => void }) {
  const [open, setOpen] = useState(false);
  const lists = LISTS.filter((l) => (guide[l.key] as string[] | undefined)?.length);
  const facts = [
    guide.meetingPoint && [MEETING, guide.meetingPoint],
    guide.endPoint && [ENDS, guide.endPoint],
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
                  <dd>
                    {v}
                    {(k === MEETING || k === ENDS) && (
                      <>
                        {" "}
                        <a className="small map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.split(" · ")[0])}`} target="_blank" rel="noopener noreferrer">Map ↗</a>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {lists.map((l) => l.key === "whatToBring" && item ? (
            <BringChecklist key={l.key} items={guide.whatToBring!} item={item} onChange={onChange} />
          ) : (
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
