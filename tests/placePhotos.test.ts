import assert from "node:assert/strict";
import { test } from "node:test";
import { pickNearby } from "../server/describe.ts";

const page = (title: string, index: number, photo = true) => ({ title, index, ...(photo ? { thumbnail: { source: `https://example.test/${index}.jpg` } } : {}) });

test("a nearby article sharing the place's own name is its photo, in another language too", () => {
  const pages = [page("Madeup Station", 1), page("Museum of Zefiria", 2)];
  assert.equal(pickNearby("Museo de Zefiria", pages)?.title, "Museum of Zefiria");
});

test("sharing only the kind of place isn't enough, and an article without a photo is skipped", () => {
  assert.equal(pickNearby("Museo de Zefiria", [page("Madeup Museum", 1)]), undefined);
  assert.equal(pickNearby("Plaza Mayor", [page("Plaza Madeup", 1)]), undefined);
  assert.equal(pickNearby("Zefiria Park", [page("Zefiria Park", 1, false), page("Zefiria Tower", 2)])?.title, "Zefiria Tower");
});

test("an article saying it's a band, film or singer isn't a description of a place", async () => {
  const { aboutMedia, pickPage } = await import("../server/describe.ts");
  assert.equal(aboutMedia("Then Zefiria are an English rock band. They had five hits."), true);
  assert.equal(aboutMedia("Zefiria is a 1998 American film directed by someone."), true);
  assert.equal(aboutMedia("Zefiria is a town in the Madeup region, known for its cathedral."), false);
  assert.equal(aboutMedia("Casa Zefiria is a museum dedicated to the tango singer Madeup Zefiria."), false);
  const band = { title: "Zefiria (band)", index: 1, extract: "Zefiria are an English rock band." };
  const town = { title: "Zefiria, Madeupland", index: 2, extract: "Zefiria is a town and municipality in Madeupland." };
  assert.equal(pickPage("Zefiria", [band, town])?.title, "Zefiria, Madeupland");
});

test("only photographs are used, not maps, logos or diagrams", async () => {
  const { isPhoto } = await import("../server/describe.ts");
  assert.equal(isPhoto("https://upload.wikimedia.org/wikipedia/commons/8/8b/Madeup-Location-Map.png?utm_source=x"), false);
  assert.equal(isPhoto("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Madeup_logo.svg/640px-Madeup_logo.svg.png"), false);
  assert.equal(isPhoto("https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Madeup_Museum.jpg/960px-Madeup_Museum.jpg?utm=1"), true);
});
