import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, MessageCircle, RotateCcw, Search, Square, X } from "lucide-react";
import type { Trip } from "../../shared/types.ts";

// "Ask Estela": a chat about your trip, or one you're thinking about, instead of searching the web. Answers arrive as
// they're written, with the pages Estela looked at. The conversation stays on this device, one per trip.

type Source = { url: string; title: string };
type Turn = { role: "user" | "assistant"; text: string; sources?: Source[]; error?: boolean };

const storeKey = (tripId: string) => `joy-chat:${tripId}`;
function loadTurns(tripId: string): Turn[] {
  try {
    const turns: Turn[] = JSON.parse(localStorage.getItem(storeKey(tripId)) ?? "[]");
    return turns.filter((t) => t.text); // an answer cut off before it started (the page closed) isn't kept
  } catch {
    return [];
  }
}
function saveTurns(tripId: string, turns: Turn[]) {
  try {
    if (turns.length) localStorage.setItem(storeKey(tripId), JSON.stringify(turns.slice(-40)));
    else localStorage.removeItem(storeKey(tripId));
  } catch {
    // Private browsing can refuse this: the chat just won't be there after a reload.
  }
}

/** Questions to start with, from what's on the trip. */
function starters(trip: Trip): string[] {
  const place = trip.places?.find((p) => p.type === "city")?.name ?? trip.destination.split(/[,·]/)[0]?.trim();
  return [
    "What's on tomorrow?",
    place ? `How do I get from the airport to where I'm staying in ${place}?` : "How do I get from the airport to where I'm staying?",
    place ? `Is the tap water safe to drink in ${place}?` : "Is the tap water safe to drink there?",
    "What should I pack for the weather?",
  ];
}

// A small, safe reader for Estela's answers: paragraphs, lists, **bold** and links. Nothing is inserted as HTML.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] ? <b key={m.index}>{m[1]}</b> : <a key={m.index} href={m[3]} target="_blank" rel="noopener noreferrer">{m[2]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function Answer({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, n) => {
        const lines = block.split("\n");
        const list = lines.every((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l));
        if (list) {
          const ordered = /^\s*\d/.test(lines[0]);
          const Tag = ordered ? "ol" : "ul";
          return <Tag key={n}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))}</li>)}</Tag>;
        }
        const heading = lines.length === 1 && /^#{1,4}\s/.test(block);
        if (heading) return <p key={n}><b>{inline(block.replace(/^#+\s*/, ""))}</b></p>;
        return <p key={n}>{lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l.replace(/^#+\s*/, ""))}</Fragment>)}</p>;
      })}
    </>
  );
}

export default function AskEstela({ trip }: { trip: Trip }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(() => loadTurns(trip.id));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState<string>();
  const stopper = useRef<AbortController>(undefined);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    saveTurns(trip.id, turns);
  }, [trip.id, turns]);
  // In braces: scrolling returns a promise in newer browsers, and an effect may only return its clean-up.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns, searching, open]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open]);
  useEffect(() => () => stopper.current?.abort(), []);

  const update = (change: (last: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), change(all[all.length - 1])]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history = [...turns.filter((t) => !t.error && t.text), { role: "user" as const, text: q }];
    setTurns([...history, { role: "assistant", text: "" }]);
    setText("");
    setBusy(true);
    const stop = (stopper.current = new AbortController());
    try {
      const res = await fetch(`/api/trips/${trip.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map(({ role, text }) => ({ role, text })) }),
        signal: stop.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Estela couldn't answer just now.");
      }
      // Server-sent events: "event: name" then "data: json", separated by a blank line.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = chunk.match(/^event: (.*)$/m)?.[1];
          const data = chunk.match(/^data: (.*)$/m)?.[1];
          if (!event || data === undefined) continue;
          const payload = JSON.parse(data);
          if (event === "text") {
            setSearching(undefined);
            update((t) => ({ ...t, text: t.text + payload }));
          } else if (event === "search") setSearching(payload);
          else if (event === "sources") update((t) => ({ ...t, sources: payload }));
          else if (event === "error") throw new Error(payload);
        }
      }
    } catch (err) {
      if (!stop.signal.aborted) update((t) => ({ ...t, text: t.text || (err as Error).message, error: !t.text }));
      else setTurns((all) => (all.at(-1)?.text ? all : all.slice(0, -1))); // stopped before any answer: drop the empty bubble
    } finally {
      setBusy(false);
      setSearching(undefined);
      if (stopper.current === stop) stopper.current = undefined;
    }
  };

  return (
    <>
      <button type="button" className={`chat-fab ${open ? "open" : ""}`} aria-expanded={open} aria-label={open ? "Close Ask Estela" : "Ask Estela"} title="Ask Estela about your trip" onClick={() => setOpen((o) => !o)}>
        {open ? <X aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
        {!open && <span>Ask Estela</span>}
      </button>
      {open && (
        <section className="chat-panel" aria-label="Ask Estela">
          <header className="chat-head">
            <div>
              <b>Ask Estela</b>
              <span className="muted tiny">About {trip.name}, or a trip you're thinking about</span>
            </div>
            {turns.length > 0 && (
              <button type="button" className="prep-action" title="New conversation" aria-label="New conversation" disabled={busy} onClick={() => setTurns([])}>
                <RotateCcw aria-hidden="true" />
              </button>
            )}
            <button type="button" className="prep-action" title="Close" aria-label="Close" onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="chat-body">
            {turns.length === 0 && (
              <div className="chat-empty">
                <p className="muted small">Ask anything you'd otherwise search for: getting around, what to do, money, safety, entry rules, or what's on your plan. Estela looks up what changes and shows where it found it.</p>
                <div className="chat-starters">
                  {starters(trip).map((s) => (
                    <button key={s} type="button" className="chip" onClick={() => ask(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, n) => (
              <div key={n} className={`chat-turn ${t.role} ${t.error ? "error" : ""}`}>
                {t.role === "user" ? <p>{t.text}</p> : t.text ? <Answer text={t.text} /> : busy && n === turns.length - 1 ? (
                  <p className="muted small chat-thinking">{searching ? <><Search aria-hidden="true" /> Searching “{searching}”…</> : "Estela is thinking…"}</p>
                ) : null}
                {t.sources && t.sources.length > 0 && (
                  <div className="chat-sources">
                    <span className="muted tiny">Sources</span>
                    {t.sources.slice(0, 6).map((s) => (
                      <a key={s.url} className="tiny" href={s.url} target="_blank" rel="noopener noreferrer" title={s.url}>{s.title} ↗</a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && searching && turns.at(-1)?.text && <p className="muted tiny chat-thinking"><Search aria-hidden="true" /> Searching “{searching}”…</p>}
            <div ref={end} />
          </div>
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
            <textarea
              ref={input}
              rows={1}
              value={text}
              maxLength={2000}
              placeholder="Ask about your trip…"
              aria-label="Your question"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(text);
                }
              }}
            />
            {busy ? (
              <button type="button" className="chat-send" title="Stop" aria-label="Stop" onClick={() => stopper.current?.abort()}><Square aria-hidden="true" /></button>
            ) : (
              <button type="submit" className="chat-send" title="Ask" aria-label="Ask" disabled={!text.trim()}><ArrowUp aria-hidden="true" /></button>
            )}
          </form>
          <p className="chat-note muted tiny">Estela can make mistakes. Check times, prices and entry rules with the official source before you rely on them.</p>
        </section>
      )}
    </>
  );
}
