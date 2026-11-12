import { TRAVEL_PARTIES, type TravelParty, type TripPart } from "../../shared/types.ts";
import { t } from "../i18n.ts";

const PARTY_LABEL: Record<TravelParty, string> = { get solo() { return t("Solo"); }, get couple() { return t("Couple"); }, get family() { return t("Family"); }, get friends() { return t("Friends"); }, get colleagues() { return t("Colleagues"); } };
const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/** Split a trip into parts with their own companions — e.g. solo first, then with family. */
export default function PartsEditor({
  parts,
  onChange,
  tripStart,
  tripEnd,
  defaultParty,
}: {
  parts: TripPart[];
  onChange: (parts: TripPart[]) => void;
  tripStart: string;
  tripEnd: string;
  defaultParty: TravelParty;
}) {
  const update = (id: string, patch: Partial<TripPart>) => onChange(parts.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const addPart = () => {
    const last = parts.at(-1);
    const from = last ? nextDay(last.to) : tripStart;
    onChange([...parts, { id: crypto.randomUUID(), name: "", from: from > tripEnd ? tripEnd : from, to: tripEnd, party: defaultParty }]);
  };

  return (
    <fieldset className="parts">
      <legend>{t("Parts of this trip (optional)")}</legend>
      <p className="muted small">
        {t("Travelling with different people at different times — e.g. solo first, then with family? Add a part for each, and Estela will tailor suggestions and packing to who you're with.")}
      </p>
      {parts.map((p, i) => (
        <div key={p.id} className="part">
          <div className="part-head">
            <b>{t("Part {v1}", { v1: i + 1 })}</b>
            <button type="button" className="link danger" onClick={() => onChange(parts.filter((x) => x.id !== p.id))}>{t("Remove")}</button>
          </div>
          <div className="grid2">
            <label className="span2">
              {t("Name")}
              <input required value={p.name} placeholder={i === 0 ? t("e.g. Mexico & Panama") : t("e.g. Colombia with family")} onChange={(e) => update(p.id, { name: e.target.value })} />
            </label>
            <label>
              {t("From")}
              <input required type="date" min={tripStart} max={tripEnd} value={p.from} onChange={(e) => update(p.id, { from: e.target.value })} />
            </label>
            <label>
              {t("To")}
              <input required type="date" min={tripStart} max={tripEnd} value={p.to} onChange={(e) => update(p.id, { to: e.target.value })} />
            </label>
          </div>
          <div className="chips part-party" role="group" aria-label={t("Who's travelling in this part")}>
            {TRAVEL_PARTIES.map((party) => (
              <button type="button" key={party} className={`chip ${p.party === party ? "on" : ""}`} onClick={() => update(p.id, { party })}>
                {PARTY_LABEL[party]}
              </button>
            ))}
          </div>
          {p.party !== "solo" && (
            <div className="grid2">
              <label>
                {t("With")}
                <input value={p.companions ?? ""} placeholder={t("e.g. my partner & their family")} onChange={(e) => update(p.id, { companions: e.target.value })} />
              </label>
              <label>
                {t("Kids along?")}
                <select value={p.kids ?? "none"} onChange={(e) => update(p.id, { kids: e.target.value as TripPart["kids"] })}>
                  <option value="none">{t("No kids")}</option>
                  <option value="some">{t("On some days")}</option>
                  <option value="all">{t("Every day")}</option>
                </select>
              </label>
            </div>
          )}
          <label className="checkbox small">
            <input type="checkbox" checked={!!p.stayingWithHosts} onChange={(e) => update(p.id, { stayingWithHosts: e.target.checked })} />
            <span>{t("Staying with family or friends")}</span>
          </label>
        </div>
      ))}
      <button type="button" className="ghost" onClick={addPart} disabled={!tripStart || !tripEnd}>
        {t("+ Add a part")}
      </button>
      {(!tripStart || !tripEnd) && <span className="muted tiny">{" "}{t("Set the trip dates first.")}</span>}
    </fieldset>
  );
}
