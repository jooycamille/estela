import { TRAVEL_PARTIES, type TravelParty, type TripPart } from "../../shared/types.ts";

const PARTY_LABEL: Record<TravelParty, string> = { solo: "Solo", couple: "Couple", family: "Family", friends: "Friends", colleagues: "Colleagues" };
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
      <legend>Parts of this trip (optional)</legend>
      <p className="muted small">
        Travelling with different people at different times — e.g. solo first, then with family? Add a part for each, and Estela
        will tailor suggestions and packing to who you're with.
      </p>
      {parts.map((p, i) => (
        <div key={p.id} className="part">
          <div className="part-head">
            <b>Part {i + 1}</b>
            <button type="button" className="link danger" onClick={() => onChange(parts.filter((x) => x.id !== p.id))}>Remove</button>
          </div>
          <div className="grid2">
            <label className="span2">
              Name
              <input required value={p.name} placeholder={i === 0 ? "e.g. Mexico & Panama" : "e.g. Colombia with family"} onChange={(e) => update(p.id, { name: e.target.value })} />
            </label>
            <label>
              From
              <input required type="date" min={tripStart} max={tripEnd} value={p.from} onChange={(e) => update(p.id, { from: e.target.value })} />
            </label>
            <label>
              To
              <input required type="date" min={tripStart} max={tripEnd} value={p.to} onChange={(e) => update(p.id, { to: e.target.value })} />
            </label>
          </div>
          <div className="chips part-party" role="group" aria-label="Who's travelling in this part">
            {TRAVEL_PARTIES.map((party) => (
              <button type="button" key={party} className={`chip ${p.party === party ? "on" : ""}`} onClick={() => update(p.id, { party })}>
                {PARTY_LABEL[party]}
              </button>
            ))}
          </div>
          {p.party !== "solo" && (
            <div className="grid2">
              <label>
                With
                <input value={p.companions ?? ""} placeholder="e.g. my partner & their family" onChange={(e) => update(p.id, { companions: e.target.value })} />
              </label>
              <label>
                Kids along?
                <select value={p.kids ?? "none"} onChange={(e) => update(p.id, { kids: e.target.value as TripPart["kids"] })}>
                  <option value="none">No kids</option>
                  <option value="some">On some days</option>
                  <option value="all">Every day</option>
                </select>
              </label>
            </div>
          )}
          <label className="checkbox small">
            <input type="checkbox" checked={!!p.stayingWithHosts} onChange={(e) => update(p.id, { stayingWithHosts: e.target.checked })} />
            <span>Staying with family or friends</span>
          </label>
        </div>
      ))}
      <button type="button" className="ghost" onClick={addPart} disabled={!tripStart || !tripEnd}>
        + Add a part
      </button>
      {(!tripStart || !tripEnd) && <span className="muted tiny"> Set the trip dates first.</span>}
    </fieldset>
  );
}
