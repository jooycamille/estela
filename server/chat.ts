import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { ItineraryItem, ListEntry, PrepItem, Trip } from "../shared/types.ts";
import { claude, MODEL } from "./ai.ts";

// "Ask Estela": questions about your trip, or one you're thinking about, answered from your itinerary and, for anything that
// changes or needs checking, a web search with its sources. Estela can't change the trip from here; it only answers.

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type ChatSource = { url: string; title: string };
export type ChatEvents = {
  onText: (delta: string) => void;
  onSearch: (query: string) => void;
  onSources: (sources: ChatSource[]) => void;
};

const SYSTEM = `You are Estela, the travel assistant in the Estela app. People ask you instead of searching the web.

What you help with: the traveller's trip described below, or a trip they're thinking about. That covers destinations, getting around, what to see, do and eat, weather and packing, money and tipping, customs and etiquette, safety, health, visas and entry rules, and their own bookings and plans. If a question isn't about travel, say in one sentence that you can help with their trip and travel, and suggest something you could help with.

How to answer:
- Answer the question first, in plain words, then only the detail that helps. Short paragraphs; a list when there are several options or steps. No filler, no repeating the question.
- Use their trip when it matters: their dates, where they're staying, what's booked each day. Say which booking or day you mean.
- Never invent bookings, times, confirmation details or addresses. If it isn't in the trip below and you can't find it, say so.
- Search the web for anything that changes or that you aren't sure of: opening hours, prices, schedules and routes, events on their dates, entry and visa rules, current safety advice. Don't search for things you know well and that don't change.
- Health, safety, visas and entry rules: use official sources (government travel advice, embassies and consulates, health authorities such as the WHO or CDC), and say to confirm with them before travelling. Where official sources disagree, say so.
- You can't book, change or add anything to their trip from this chat. If they ask, tell them where in the app to do it (the + under a day, Add to your trip, or the Prepare checklist).
- Write for a phone screen. Use **bold** sparingly. Don't paste raw URLs; sources are shown under your answer.`;

const day = (iso?: string) => iso?.slice(0, 10) ?? "";
const time = (iso?: string) => (iso && iso.length > 10 ? iso.slice(11, 16) : "");
const clip = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? "");

/** One line per booking, in order. Confirmation codes, prices paid and who you're travelling with stay out. */
function itemLine(i: ItineraryItem) {
  if (i.kind === "flight") {
    const dep = i.live?.departureTime ?? i.departureTime;
    const bags = i.baggage ? `; baggage: ${[i.baggage.cabin && `cabin ${i.baggage.cabin}`, i.baggage.checked && `checked ${i.baggage.checked}`].filter(Boolean).join(", ")}` : "";
    return `${day(dep)} ${time(dep)} Flight ${i.flightNumber} ${i.from} → ${i.to}${i.arrivalTime ? `, lands ${time(i.arrivalTime)}${day(i.arrivalTime) !== day(dep) ? ` on ${day(i.arrivalTime)}` : ""}` : ""}${bags}`;
  }
  if (i.kind === "stay") return `${day(i.checkIn)} Stay: ${i.name}${i.address ? ` (${i.address})` : ""}, check-in ${time(i.checkIn) || "?"}, check-out ${day(i.checkOut)} ${time(i.checkOut)}`;
  const end = i.end ? ` to ${day(i.end) !== day(i.start) ? `${day(i.end)} ` : ""}${time(i.end)}` : "";
  const what = i.category === "transfer" ? "Transfer" : "Activity";
  const notes = i.notes ? ` Notes: ${clip(i.notes.replace(/\s+/g, " "), 200)}` : "";
  return `${day(i.start)} ${time(i.start)}${end} ${what}: ${i.title}${i.location ? ` at ${i.location}` : ""}.${notes}`;
}

const startOf = (i: ItineraryItem) => (i.kind === "flight" ? i.live?.departureTime ?? i.departureTime : i.kind === "stay" ? i.checkIn : i.start);

/** What Estela knows about the trip, as compact text for the conversation. */
export function tripContext({ trip, items, planned, todos, today, homeCountry }: {
  trip: Trip;
  items: ItineraryItem[];
  planned: Pick<ListEntry, "title" | "day" | "area" | "address">[];
  todos: Pick<PrepItem, "text" | "due">[];
  today: string;
  homeCountry?: string;
}) {
  const lines = [
    `Today is ${today}.`,
    `Trip: ${trip.name}, ${trip.startDate} to ${trip.endDate}, to ${trip.destination || "somewhere not set yet"}.`,
    `Travelling: ${trip.party}${trip.purpose ? `, for ${trip.purpose}` : ""}${trip.styles.length ? `; likes ${trip.styles.join(", ")}` : ""}.`,
    homeCountry ? `Home country: ${homeCountry}.` : "",
    ...(trip.parts ?? []).map((p) => `Part "${p.name}" ${p.from} to ${p.to}: ${p.party}${p.kids && p.kids !== "none" ? `, kids ${p.kids === "all" ? "every day" : "some days"}` : ""}${p.stayingWithHosts ? ", staying with hosts" : ""}.`),
    "",
    "Bookings:",
    ...([...items].sort((a, b) => startOf(a).localeCompare(startOf(b))).map(itemLine).map((l) => `- ${l}`)),
    items.length ? "" : "- none yet",
  ];
  const days = [...new Set([...Object.keys(trip.dayTitles ?? {}), ...Object.keys(trip.dayNotes ?? {}), ...planned.map((p) => p.day!).filter(Boolean)])].sort();
  if (days.length) {
    lines.push("", "Their own plans by day:");
    for (const d of days) {
      const bits = [
        trip.dayTitles?.[d] ? `heading "${trip.dayTitles[d]}"` : "",
        trip.dayNotes?.[d] ? `note: ${clip(trip.dayNotes[d].replace(/\s+/g, " "), 300)}` : "",
        planned.filter((p) => p.day === d).length ? `places: ${planned.filter((p) => p.day === d).map((p) => p.title + (p.area ? ` (${p.area})` : "")).join(", ")}` : "",
      ].filter(Boolean);
      lines.push(`- ${d}: ${bits.join("; ")}`);
    }
  }
  if (todos.length) {
    lines.push("", "Still to do before or during the trip:");
    for (const t of todos.slice(0, 30)) lines.push(`- ${t.text}${t.due ? ` (by ${day(t.due)})` : ""}`);
  }
  return lines.filter((l, n, all) => l !== "" || all[n - 1] !== "").join("\n").trim();
}

/** Keeps the conversation to a sensible length: the latest turns, starting with a question. */
export function recentTurns(turns: ChatTurn[], max = 16): ChatTurn[] {
  const kept = turns.filter((t) => t.text.trim()).slice(-max);
  while (kept.length && kept[0].role !== "user") kept.shift();
  return kept;
}

/** Streams Estela's answer. Web searches (and their sources) happen on Anthropic's side; a long one may pause and resume. */
export async function askEstela(context: string, turns: ChatTurn[], events: ChatEvents, signal: AbortSignal) {
  const messages: MessageParam[] = recentTurns(turns).map((t) => ({ role: t.role, content: t.text }));
  if (!messages.length || messages.at(-1)!.role !== "user") throw new Error("Ask a question first");
  const sources = new Map<string, ChatSource>();
  for (let round = 0; round < 3; round++) {
    const stream = claude().messages.stream(
      {
        model: MODEL,
        max_tokens: 8000,
        system: [{ type: "text", text: SYSTEM }, { type: "text", text: `The traveller's trip:\n${context}` }],
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      },
      { signal },
    );
    stream.on("text", (delta) => events.onText(delta));
    stream.on("contentBlock", (block) => {
      if (block.type === "server_tool_use" && block.name === "web_search") {
        const query = (block.input as { query?: unknown })?.query;
        if (typeof query === "string") events.onSearch(query);
      }
    });
    stream.on("citation", (c) => {
      if (c.type === "web_search_result_location" && !sources.has(c.url)) {
        sources.set(c.url, { url: c.url, title: c.title ?? new URL(c.url).hostname });
        events.onSources([...sources.values()]);
      }
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      events.onText("\n\nSorry, I can't help with that one. Ask me anything about your trip or travel.");
      return;
    }
    // A long search can pause partway: send back what's done so far and let it carry on.
    if (message.stop_reason !== "pause_turn") return;
    messages.push({ role: "assistant", content: message.content });
  }
}
