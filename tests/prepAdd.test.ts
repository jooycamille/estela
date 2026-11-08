import assert from "node:assert/strict";
import { test } from "node:test";
import { findSamePrepItem, prepGroupFor } from "../shared/prepAdd.ts";

test("what you add goes in the group it belongs to", () => {
  const packing: [string, string][] = [
    ["Rain jacket", "For the weather"],
    ["Sunblock", "For the weather"],
    ["Compression socks", "For long flights"],
    ["Hiking boots", "For your activities"],
    ["T-shirts", "Clothes"],
    ["Sandals", "Clothes"],
    ["Laptop", "For work"],
    ["Toothbrush", "Essentials"],
    ["Ibuprofen", "Medications"],
    ["Blister plasters", "Medications"],
    ["Printed hotel address", "Essentials"], // has "dress" in it, but isn't one
  ];
  for (const [text, group] of packing) assert.equal(prepGroupFor("packing", text), group, text);
  const todo: [string, string][] = [
    ["Apply for visa", "Border forms"],
    ["Choose my seat", "Before each flight"],
    ["Print tour tickets", "For your activities"],
    ["Download apps", "Do soon"],
    ["Get a metro card", "Public transport"],
  ];
  for (const [text, group] of todo) assert.equal(prepGroupFor("todo", text), group, text);
});

const item = (text: string, section: "todo" | "packing" = "packing") => ({ text, section });
const list = [
  item("Passport"),
  item("Phone and charger"),
  item("Cards and some cash"),
  item("Plug adapter (check plug types)"),
  item("Sunscreen (SPF 50), hat and sunglasses"),
  item("Book airport transfers", "todo"),
  item("Check in online for your flight", "todo"),
];
const same = (text: string) => findSamePrepItem(text, list)?.text;

test("something already on the list is found, however it's written", () => {
  assert.equal(same("passport"), "Passport");
  assert.equal(same("PASSPORTS"), "Passport");
  assert.equal(same("charger"), "Phone and charger");
  assert.equal(same("Sunblock"), "Sunscreen (SPF 50), hat and sunglasses");
  assert.equal(same("adaptor"), "Plug adapter (check plug types)");
  assert.equal(same("travel plug adapter"), "Plug adapter (check plug types)");
  assert.equal(same("Book the airport transfers"), "Book airport transfers");
  assert.equal(same("airport transfers"), "Book airport transfers");
});

test("a medicine named in another medicine's description is already covered", () => {
  const meds = [{ text: "Pain and fever relief", section: "packing" as const, group: "Medications", detail: "Such as paracetamol or ibuprofen." }, { text: "Passport", section: "packing" as const, group: "Essentials", detail: "Check its expiry date." }];
  assert.equal(findSamePrepItem("Ibuprofen", meds)?.text, "Pain and fever relief");
  assert.equal(findSamePrepItem("expiry date", meds), undefined); // only Medications is read this way
});

test("something new isn't mistaken for what's there", () => {
  assert.equal(same("Toothbrush"), undefined);
  assert.equal(same("Book"), undefined); // one word says too little about a to-do
  assert.equal(same("Book restaurant"), undefined);
  assert.equal(same("Rain jacket"), undefined);
  assert.equal(same("!!!"), undefined);
});
