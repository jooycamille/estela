import { Languages } from "lucide-react";
import type { Trip, TripList } from "../../shared/types.ts";
import { phrasebooks, type Phrasebook } from "../phrases.ts";
import { EssentialsCard } from "./GuideView.tsx";
import Fold from "./Fold.tsx";

// The Essentials tab: for each city you stay in, the emergency number, what's near your stays (pharmacies, hospitals,
// police, ATMs), useful apps and safety tips; then a few phrases in each language that isn't yours.

export default function EssentialsView({ trip, lists, loaded }: { trip: Trip; lists: TripList[]; loaded: boolean }) {
  const guides = lists.filter((l) => l.auto);
  const countries = [...new Set([...(trip.places ?? []).map((p) => p.countryCode), ...guides.map((g) => g.place?.countryCode).filter((c): c is string => !!c)])];
  const books = phrasebooks(countries);
  return (
    <div className="essentials-view">
      {guides.map((g) => <EssentialsCard key={g.id} list={g} />)}
      {loaded && !guides.length && (
        <div className="card empty"><p>Add where you're staying, and Estela finds the emergency number, pharmacies, hospitals, police and ATMs nearby, with safety tips for the place.</p></div>
      )}
      {books.map((b) => <PhrasesCard key={b.lang} tripId={trip.id} book={b} />)}
    </div>
  );
}

/** A pronunciation like a dictionary's, with the stressed syllables (written in capitals) shown in bold. */
function Like({ text }: { text: string }) {
  return (
    <span className="phrase-like">
      {text.split(/([\s\-/,]+)/).map((part, i) => (/^[A-Z]{2,}$/.test(part) ? <b key={i}>{part.toLowerCase()}</b> : part))}
    </span>
  );
}

function PhrasesCard({ tripId, book }: { tripId: string; book: Phrasebook }) {
  const regions = new Intl.DisplayNames(["en"], { type: "region" });
  const stressed = book.phrases.some((p) => p.like && /[A-Z]{2}/.test(p.like));
  return (
    <section className="card phrases" aria-label={`Phrases in ${book.name}`}>
      <Fold
        id={`${tripId}:phrases:${book.lang}`}
        title={<><Languages aria-hidden="true" /> Phrases in {book.name}</>}
        summary={book.phrases.length ? `${book.phrases.length} to learn` : undefined}
      >
        <p className="muted small">Spoken in {book.countries.map((c) => regions.of(c)).join(", ")}. A few words go a long way, even with a translation app on your phone.</p>
        {book.script && <p className="muted small">{book.script}</p>}
        {book.phrases.length > 0 && (
          <p className="muted small phrase-key">
            Under each phrase is how it sounds{stressed && <>; say the <b>bold</b> part a little louder</>}.{book.how && <> {book.how}</>}
          </p>
        )}
        {book.phrases.length > 0 ? (
          <ul className="phrase-list">
            {book.phrases.map((p, i) => (
              <li key={i}>
                <span className="phrase-en">{p.en}</span>
                <span className="phrase-say">
                  <span lang={book.lang}>{p.say}</span>
                  {p.sound && <span className="phrase-sound" lang={`${book.lang}-Latn`}>{p.sound}</span>}
                  {p.like && <Like text={p.like} />}
                  {p.note && <span className="phrase-note">{p.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small">Estela doesn't have a phrase list for {book.name} yet.</p>
        )}
        <p className="muted tiny">
          More in the <a href={book.more} target="_blank" rel="noopener noreferrer">Wikivoyage {book.name} phrasebook ↗</a>.
        </p>
      </Fold>
    </section>
  );
}
