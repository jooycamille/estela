import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityItem } from "../shared/types.ts";
import { healthAdvice } from "../server/travelHealth.ts";

const names: Record<string, string> = { CO: "Colombia", MX: "Mexico", PA: "Panama", SG: "Singapore", JP: "Japan" };
const list = (xs: string[]) => xs.join(" and ");
const advice = (countries: string[], cities: string[] = [], activities: Partial<ActivityItem>[] = []) => healthAdvice(countries, cities, activities as ActivityItem[], (c) => names[c] ?? c, list);
const texts = (a: ReturnType<typeof advice>) => a.packing.map((p) => p.text);
const tour = (title: string, more: Partial<ActivityItem> = {}) => ({ title, ...more });

test("everyone gets the basics, with no doses", () => {
  const a = advice(["JP"]);
  assert.ok(texts(a).includes("Pain and fever relief"));
  assert.ok(texts(a).includes("First-aid kit"));
  assert.doesNotMatch(JSON.stringify(a), /\d+ ?mg\b/i);
});

test("the place decides mosquito and malaria items", () => {
  assert.ok(!texts(advice(["JP"])).includes("Insect repellent"));
  assert.ok(texts(advice(["SG"])).includes("Insect repellent"));
  assert.ok(!texts(advice(["SG"])).some((t) => /malaria/i.test(t)));
  const malaria = advice(["MX"]).packing.find((p) => /malaria/i.test(p.text));
  assert.match(malaria!.text, /only if a doctor prescribes/);
  assert.match(malaria!.detail!, /Chiapas/);
});

test("what you're doing decides motion sickness, and says which activity", () => {
  assert.ok(!texts(advice(["JP"], [], [tour("Made-up museum visit")])).includes("Motion sickness medicine"));
  const item = advice(["JP"], [], [tour("Made-up boat trip"), tour("Made-up day", { guide: { itinerary: ["Board the catamaran"] } })]).packing.find((p) => p.text === "Motion sickness medicine");
  assert.equal(item?.source, "Made-up boat trip and Made-up day");
});

test("altitude: a high city or activity adds it, a nearly high city is only raised with the doctor", () => {
  const altitude = (a: ReturnType<typeof advice>) => a.packing.find((p) => /altitude/i.test(p.text));
  assert.ok(altitude(advice(["CO"], ["Bogotá"])));
  assert.ok(altitude(advice(["MX"], [], [tour("Hike the Madeup Nevado")])));
  const city = advice(["MX"], ["Mexico City"]);
  assert.equal(altitude(city), undefined);
  assert.match(city.clinic.detail, /Mexico City is about 2,240 m/);
  assert.equal(altitude(advice(["CO"], ["Medellín"])), undefined);
});

test("yellow fever says the sources differ rather than picking one, only where it applies", () => {
  assert.equal(advice(["MX", "SG"]).yellowFever, undefined);
  const co = advice(["CO"]).yellowFever!;
  assert.match(co.detail, /sources differ/);
  assert.ok(co.links.some((l) => l.url.includes("cdc.gov")) && co.links.some((l) => l.url.includes("gov.uk")));
  assert.ok(advice(["PA"]).yellowFever);
  assert.match(co.detail, /at least 10 days/);
  assert.doesNotMatch(co.detail, /Coming home/);
  const fromAustralia = healthAdvice(["CO"], [], [], (c) => names[c] ?? c, list, "AU").yellowFever!;
  assert.match(fromAustralia.detail, /Coming home, Australia asks/);
});
