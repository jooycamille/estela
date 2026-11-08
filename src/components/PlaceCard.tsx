import { useState } from "react";
import { MapPin, X } from "lucide-react";
import type { AreaGroup } from "../../shared/types.ts";

type Entry = AreaGroup["entries"][number];

const mapsUrl = (e: Entry) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.lat !== undefined ? `${e.lat},${e.lon}` : [e.title, e.address].filter(Boolean).join(", "))}`;

/** A place planned for a day: a photo (from Wikipedia, when there's an article about it), what it is, and where. */
export default function PlaceCard({ entry: e, number, onOpen, onRemove }: { entry: Entry; number?: number; onOpen: () => void; onRemove: () => void }) {
  const [broken, setBroken] = useState(false); // a photo that won't load shows the plain pin instead
  const photo = e.photo?.near && !broken ? e.photo : undefined; // older photos matched by name alone are left out
  return (
    <article className="place-card">
      <div className={`place-photo ${photo ? "" : "none"}`}>
        {photo ? (
          // No referrer: Wikimedia doesn't need to know which page showed it.
          <img src={photo.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        ) : (
          <MapPin aria-hidden="true" />
        )}
        {number !== undefined && <span className="place-number" aria-label={`Stop ${number}`}>{number}</span>}
        <button type="button" className="place-remove edit-only" title="Take off this day (stays on your list)" aria-label={`Take ${e.title} off this day`} onClick={onRemove}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="place-body">
        <h4>
          <button type="button" className="link plain" onClick={onOpen} title={`Open ${e.listName}`}>{e.title}</button>
        </h4>
        {(e.area || e.address) && <p className="muted tiny place-where">{e.area ?? e.address}</p>}
        {e.notes && <p className="small place-notes">{e.notes}</p>}
        <p className="tiny place-links">
          <a href={mapsUrl(e)} target="_blank" rel="noopener noreferrer">Map ↗</a>
          {photo && <a className="muted" href={photo.page} target="_blank" rel="noopener noreferrer" title="The photo and more about it, on Wikipedia">Photo: Wikipedia ↗</a>}
        </p>
      </div>
    </article>
  );
}
