import { useEffect, useRef, useState } from "react";
import type { ActivityGuide, ActivityItem, DraftItem } from "../../shared/types.ts";
import { api } from "../api.ts";
import { t, tn } from "../i18n.ts";

const LISTS: { key: keyof ActivityGuide; title: string }[] = [
  { key: "beforeYouGo", get title() { return t("Before you go"); } },
  { key: "itinerary", get title() { return t("Itinerary"); } },
  { key: "whatToBring", get title() { return t("What to bring"); } },
  { key: "whatToWear", get title() { return t("What to wear"); } },
  { key: "dos", get title() { return t("Do's"); } },
  { key: "donts", get title() { return t("Don'ts / not allowed"); } },
  { key: "goodToKnow", get title() { return t("Good to know"); } },
];



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
      <h5>{t("What to bring")}{" "}<span className="muted tiny">{t("{done} of {length}", { done, length: items.length })}</span></h5>
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
    guide.meetingPoint && [t("Meeting point / pickup"), guide.meetingPoint],
    guide.endPoint && [t("Ends"), guide.endPoint],
    guide.provider && [t("Provider"), guide.provider],
    guide.pin && [t("PIN"), guide.pin],
    guide.cancellation && [t("Cancellation"), guide.cancellation],
  ].filter(Boolean) as [string, string][];
  if (!lists.length && !facts.length) return null;

  const count = lists.reduce((n, l) => n + ((guide[l.key] as string[]).length ?? 0), 0);
  return (
    <div className="guide">
      <button type="button" className="link guide-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "▾" : "▸"} {t("Activity guide")}{count ? ` · ${tn(count, "{n} tip", "{n} tips")}` : ""}
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
                    {(k === t("Meeting point / pickup") || k === t("Ends")) && (
                      <>
                        {" "}
                        <a className="small map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.split(" · ")[0])}`} target="_blank" rel="noopener noreferrer">{t("Map ↗")}</a>
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
              <h5>{l.title}</h5>
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
