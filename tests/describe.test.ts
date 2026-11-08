import assert from "node:assert/strict";
import { test } from "node:test";
import { fromGuide, pickPage, tidyExtract } from "../server/describe.ts";

const page = (title: string, extract: string, index = 1, disambig = false) => ({ title, extract, index, ...(disambig ? { pageprops: { disambiguation: "" } } : {}) });

test("uses Estela's own guide first, exactly anywhere, loosely only in your country", () => {
  assert.ok(fromGuide("Tacos al pastor", "MX")?.text);
  assert.equal(fromGuide("Tacos al pastor", "MX")?.source, "guide");
  assert.ok(fromGuide("tacos al pastor", "PA")?.text);
  assert.ok(fromGuide("Lucha libre", "MX")?.text);
  assert.equal(fromGuide("Lucha libre", "PA"), undefined);
  assert.equal(fromGuide("Tacos", "MX"), undefined); // not any one kind of taco
  assert.equal(fromGuide("Hot chocolate", "MX"), undefined); // not the churros that come with it
  assert.equal(fromGuide("Something Nobody Has Heard Of", "MX"), undefined);
});

test("only an article clearly about the same thing", () => {
  assert.equal(pickPage("Tacos al pastor", [page("Al pastor", "Al pastor, or tacos al pastor, is spit-grilled pork."), page("Taco", "A taco is…", 2)])?.title, "Al pastor");
  assert.equal(pickPage("Xochimilco trajineras", [page("Trajinera", "A trajinera is a boat on Lake Xochimilco.")])?.title, "Trajinera");
  assert.equal(pickPage("Patacones", [page("Tostones", "Tostones, also called patacones, are fried plantain.")])?.title, "Tostones");
  assert.equal(pickPage("Mole poblano", [page("Poblano", "The poblano is a mild chili pepper.")]), undefined);
  assert.equal(pickPage("Coffee farm tour", [page("Farm Tour", "Farm Tour is a concert series.")]), undefined);
  // The real results for these were a sitcom, and events elsewhere.
  assert.equal(pickPage("Salsa class", [page("Here We Go (TV series)", "A British sitcom."), page("Quikr", "A marketplace.", 2)]), undefined);
  assert.equal(pickPage("Sunday bike ride", [page("Bike Week (cycling)", "A yearly event."), page("Great Victorian Bike Ride", "An annual event.", 2)]), undefined);
  assert.equal(pickPage("Temazcal", [page("Temescal", "Temazcal may refer to several things.", 1, true)]), undefined);
});

test("tidies Wikipedia's opening", () => {
  assert.equal(tidyExtract('Pozole (Spanish pronunciation: [po\'sole]; from Nahuatl languages: pozolli) is a traditional soup. It is made from hominy. It is served with radishes.').startsWith("Pozole is a traditional soup."), true);
  assert.equal(tidyExtract("A temazcal [temasˈkal] is a type of sweat lodge."), "A temazcal is a type of sweat lodge.");
  const long = tidyExtract(`${"A very long opening sentence about this thing goes on. ".repeat(10)}`);
  assert.ok(long.length <= 240);
});

test("food: 'Tacos de X' can use an article on X, and it must be about food", () => {
  const carnitas = page("Carnitas", "Carnitas, in Mexican cuisine, is a dish of braised pork.");
  const stand = page("Taco stand", "A taco stand is a food stall.", 2);
  assert.equal(pickPage("Tacos de carnitas", [carnitas, stand], true)?.title, "Carnitas");
  assert.equal(pickPage("Tacos de carnitas", [carnitas, stand]), undefined); // only for food
  assert.equal(pickPage("Tacos de carnitas", [stand], true), undefined);
  // A dish called after a thing shouldn't get that thing's article.
  assert.equal(pickPage("Cafe de olla", [page("Olla", "An olla is a clay pot.")], true), undefined);
  const grape = page("Corvina", "Corvina is an Italian wine grape variety grown near Verona.");
  assert.equal(pickPage("Corvina", [grape], true), undefined);
  assert.equal(pickPage("Corvina", [grape])?.title, "Corvina");
  assert.equal(pickPage("Sancocho", [page("Sancocho", "Sancocho is a traditional stew in several Caribbean countries.")], true)?.title, "Sancocho");
});

test("an article with exactly the name wins, in food", () => {
  const birria = page("Birria", "Birria is a regional variation of barbacoa from western Mexico, a stewed meat dish.", 1);
  const barbacoa = page("Barbacoa", "Barbacoa is the indigenous variation of a method of cooking meat over an open fire.", 2);
  assert.equal(pickPage("Barbacoa", [birria, barbacoa], true)?.title, "Barbacoa");
  assert.equal(pickPage("Tacos de Barbacoa", [birria, barbacoa], true)?.title, "Barbacoa");
});

test("'may refer to' only rules out an article when it opens with it", () => {
  const good = page("Barbacoa", "Barbacoa is a method of cooking meat in a pit, usually over a long time and on special occasions in many regions of the country. The word may refer to the meal too.");
  assert.equal(pickPage("Barbacoa", [good], true)?.title, "Barbacoa");
  assert.equal(pickPage("Barbacoa", [page("Barbacoa", "Barbacoa may refer to a cooked food or a town.")], true), undefined);
});
