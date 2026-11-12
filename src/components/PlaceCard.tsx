import { useState } from "react";
import { Camera, MapPin, X } from "lucide-react";
import PhotoPicker from "./PhotoPicker.tsx";
import type { AreaGroup } from "../../shared/types.ts";
import { t } from "../i18n.ts";

type Entry = AreaGroup["entries"][number];

const mapsUrl = (e: Entry) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.lat !== undefined ? `${e.lat},${e.lon}` : [e.title, e.address].filter(Boolean).join(", "))}`;

/** A place planned for a day: a photo (from Wikipedia, when there's an article about it), what it is, and where. */
export default function PlaceCard({ entry: e, number, onOpen, onRemove, onPhotoChanged }: { entry: Entry; number?: number; onOpen: () => void; onRemove: () => void; onPhotoChanged: () => void }) {
  const [broken, setBroken] = useState(false); // a photo that won't load shows the plain pin instead
  const [picking, setPicking] = useState(false);
  const photo = (e.photo?.near || e.photoPicked) && !broken ? e.photo ?? undefined : undefined; // older photos matched by name alone are left out
  return (
    <article className="place-card">
      <div className={`place-photo ${photo ? "" : "none"}`}>
        {photo ? (
          // No referrer: Wikimedia doesn't need to know which page showed it.
          <img src={photo.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        ) : (
          <MapPin aria-hidden="true" />
        )}
        {number !== undefined && <span className="place-number" aria-label={t("Stop {number}", { number })}>{number}</span>}
        <button type="button" className="place-photo-change edit-only" title={t("Change photo")} aria-label={t("Change the photo of {title}", { title: e.title })} onClick={() => setPicking(true)}>
          <Camera aria-hidden="true" />
        </button>
        <button type="button" className="place-remove edit-only" title={t("Take off this day (stays on your list)")} aria-label={t("Take {title} off this day", { title: e.title })} onClick={onRemove}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="place-body">
        <h4>
          <button type="button" className="link plain" onClick={onOpen} title={t("Open {listName}", { listName: e.listName })}>{e.title}</button>
        </h4>
        {(e.area || e.address) && <p className="muted tiny place-where">{e.area ?? e.address}</p>}
        {e.notes && <p className="small place-notes">{e.notes}</p>}
        <p className="tiny place-links">
          <a href={mapsUrl(e)} target="_blank" rel="noopener noreferrer">{t("Map ↗")}</a>
          {photo?.page && (
            <a className="muted" href={photo.page} target="_blank" rel="noopener noreferrer" title={t("Where the photo is from: who took it, and its licence")}>
              {t("Photo: {v1} ↗", { v1: photo.page.includes("commons.wikimedia") ? t("Wikimedia Commons") : t("Wikipedia") })}
            </a>
          )}
        </p>
      </div>
      {picking && <PhotoPicker listId={e.listId} entryId={e.id} title={e.title} current={e.photo?.url} onClose={() => setPicking(false)} onChanged={onPhotoChanged} />}
    </article>
  );
}
