import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageOff, Search, Upload, X } from "lucide-react";
import type { PhotoChoice } from "../../shared/types.ts";
import { api } from "../api.ts";

// Change a place's photo: one taken there (Wikimedia Commons), one found by searching Commons, your own, or none.

type Tab = "suggested" | "search" | "upload";

/** A photo from your device, made smaller (at most 1600 px, as a JPEG) so it's quick to save and to load. */
async function shrink(file: File): Promise<{ filename: string; contentType: string; data: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that photo"))), "image/jpeg", 0.85));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { filename: `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, contentType: "image/jpeg", data: btoa(binary) };
}

export default function PhotoPicker({ listId, entryId, title, current, onClose, onChanged }: {
  listId: string;
  entryId: string;
  title: string;
  current?: string; // the photo it has now
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("suggested");
  const [suggested, setSuggested] = useState<PhotoChoice[]>();
  const [query, setQuery] = useState(title);
  const [results, setResults] = useState<PhotoChoice[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.entryPhotos(listId, entryId).then(setSuggested).catch((e) => { setSuggested([]); setError(e.message); });
  }, [listId, entryId]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);

  const save = async (body: Parameters<typeof api.setEntryPhoto>[2]) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.setEntryPhoto(listId, entryId, body);
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const search = async () => {
    if (query.trim().length < 2) return;
    setResults(undefined);
    setError(undefined);
    try {
      setResults(await api.searchPhotos(query.trim()));
    } catch (e) {
      setResults([]);
      setError((e as Error).message);
    }
  };

  const grid = (photos: PhotoChoice[] | undefined, empty: string) => (
    <div className="photo-grid">
      {photos === undefined && <p className="muted small">Looking…</p>}
      {photos?.length === 0 && <p className="muted small">{empty}</p>}
      {photos?.map((p) => (
        <figure key={p.page} className={`photo-choice ${p.url === current ? "on" : ""}`}>
          <button type="button" disabled={busy} onClick={() => save({ pick: { url: p.url, page: p.page } })} aria-label={`Use this photo: ${p.title}`}>
            <img src={p.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
          </button>
          <figcaption><a href={p.page} target="_blank" rel="noopener noreferrer" title="Who took it, and its licence">{p.title} ↗</a></figcaption>
        </figure>
      ))}
      <button type="button" className="photo-none" disabled={busy} onClick={() => save({ none: true })}>
        <ImageOff aria-hidden="true" /> No photo
      </button>
    </div>
  );

  // Drawn at the top of the page, not inside the card (which clips what spills over its edges).
  return createPortal(
    <div className="tour-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="photo-picker" role="dialog" aria-modal="true" aria-labelledby="photo-picker-title">
        <div className="photo-picker-head">
          <h2 id="photo-picker-title">Photo for {title}</h2>
          <button type="button" className="quiet icon-only" aria-label="Close" onClick={onClose}><X aria-hidden="true" /></button>
        </div>
        <div className="categories" role="tablist" aria-label="Where the photo comes from">
          {([["suggested", "Taken here"], ["search", "Search"], ["upload", "Your photo"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`category ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        {error && <p className="error small">{error}</p>}
        {tab === "suggested" && grid(suggested, "No photos taken right here yet. Try Search, or add your own.")}
        {tab === "search" && (
          <>
            <form className="photo-search" onSubmit={(e) => { e.preventDefault(); search(); }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Jericó botanical garden" aria-label="Search for photos" autoFocus />
              <button type="submit"><Search aria-hidden="true" /> Search</button>
            </form>
            {results !== undefined || query !== title ? grid(results, "Nothing found. Try other words, or the town's name.") : <p className="muted small">Search free photos on Wikimedia Commons.</p>}
          </>
        )}
        {tab === "upload" && (
          <div className="photo-upload">
            <p className="muted small">A photo from your phone or computer. It's made smaller and kept with this trip on your Mac, for the people on it.</p>
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  await save({ upload: await shrink(f) });
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            />
            <button type="button" disabled={busy} onClick={() => file.current?.click()}><Upload aria-hidden="true" /> {busy ? "Saving…" : "Choose a photo"}</button>
          </div>
        )}
        <p className="muted tiny">Photos from <a href="https://commons.wikimedia.org" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a> are free to use; tap a name for who took it and its licence.</p>
      </section>
    </div>,
    document.body,
  );
}
