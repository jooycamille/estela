// Adding your own item to the Prepare checklist: which group it belongs in, and whether it's already on the list.

type Section = "todo" | "packing";

const PACKING_GROUPS: [RegExp, string][] = [
  [/medicines?\b|medications?\b|tablets?\b|\bpills?\b|paracetamol|acetaminophen|ibuprofen|antihistamine|antacid|antiseptic|plasters?\b|bandages?\b|band-?aids?\b|first.?aid|rehydration|sanitis?z?er|vitamins?\b|prescriptions?\b/i, "Medications"],
  [/neck pillow|travel pillow|eye ?mask|ear ?plugs?|ear ?buds?|headphones|compression/i, "For long flights"],
  [/umbrella|\brain|poncho|sun ?(screen|block|glasses|cream)|\bhats?\b|\bcaps?\b|\bcoats?\b|\bjackets?\b|\bjumpers?\b|\bsweaters?\b|\bhood(ie|y)\b|\bscarf\b|\bscarves\b|\bgloves\b|\bbeanie\b|\bthermals?\b/i, "For the weather"],
  [/swim|bikini|towel|hiking|\bboots?\b|walking shoes|sneakers|trainers|day ?pack|backpack|insect|repellent|snorkel|goggles/i, "For your activities"],
  [/\b(t-?)?shirts?\b|\btops?\b|\btees?\b|\bpants\b|\btrousers\b|\bshorts\b|\bjeans\b|\bdress(es)?\b|\bskirts?\b|\bsocks\b|\bunderwear\b|\bbras?\b|\bpyjamas\b|\bpajamas\b|\boutfits?\b|\bclothes\b|\bsandals\b|\bshoes\b|\bbelts?\b|\blaundry\b/i, "Clothes"],
  [/laptop|business|notebook|\bwork\b/i, "For work"],
];
const TODO_GROUPS: [RegExp, string][] = [
  [/\b(metro|subway|bus pass|train card|travel card|transit|public transport|ez-?link|beep card)\b/i, "Public transport"],
  [/visa\b|customs|immigration|arrival (card|form)|entry (form|permit)|\besta\b|\beta\b|declaration/i, "Border forms"],
  [/check.?in|boarding|flights?\b|baggage|luggage|\bseats?\b/i, "Before each flight"],
  [/\btours?\b|excursion|activit(y|ies)|tickets?\b/i, "For your activities"],
];

/** The group an item you've added belongs in, by what it's about. */
export function prepGroupFor(section: Section, text: string) {
  const groups = section === "packing" ? PACKING_GROUPS : TODO_GROUPS;
  return groups.find(([words]) => words.test(text))?.[1] ?? (section === "packing" ? "Essentials" : "Do soon");
}

const FILLER = new Set(["a", "an", "the", "and", "or", "some", "my", "your", "for", "of", "to", "with", "any", "on", "in"]);
const SAME_WORD: Record<string, string> = { sunblock: "sunscreen", adaptor: "adapter", medicine: "medication", med: "medication", raincoat: "rain" };

function words(text: string) {
  const out = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(/[a-z0-9]+/g) ?? [];
  return new Set(
    out
      .filter((w) => !FILLER.has(w))
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
      .map((w) => SAME_WORD[w] ?? w),
  );
}
const within = (some: Set<string>, all: Set<string>) => some.size > 0 && [...some].every((w) => all.has(w));

/**
 * An item on the list that already covers this one: "Sunscreen" for "Sunscreen (SPF 50), hat and sunglasses", or
 * "Plug adapter (check plug types)" for "travel plug adapter". A to-do's one word says too little ("Book" isn't "Book
 * airport transfers"), so to-dos need at least two words in common, or the same words exactly.
 */
export function findSamePrepItem<T extends { text: string; section: Section; group?: string; detail?: string }>(text: string, items: T[]): T | undefined {
  const adding = words(text);
  if (!adding.size) return undefined;
  const covers = (item: T) => {
    const full = words(item.text);
    const core = words(item.text.replace(/\(.*?\)/g, " "));
    if (adding.size === core.size && within(adding, core)) return true;
    // Medicines are named in the description: "Pain and fever relief" covers ibuprofen.
    if (item.group === "Medications" && item.detail && within(adding, words(item.detail))) return true;
    if (item.section === "todo" && adding.size < 2) return false;
    return within(adding, full) || (item.section === "packing" && within(core, adding));
  };
  return items.find(covers);
}
