import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-merge-")), "db.json");
const { upsertFromEmail } = await import("../server/items.ts");
const { db } = await import("../server/db.ts");

test("a shorter follow-up email keeps the details an earlier one gave", async () => {
  const tripId = "guide-merge-trip";
  const base = { kind: "activity", source: "email", title: "Blue Lagoon Tour", start: "2028-03-05T09:00", confirmationCode: "BR-1111111111" } as const;
  await upsertFromEmail(tripId, [{ ...base, guide: { meetingPoint: "12 Sample St", whatToBring: ["Towel"] } }]);
  const result = await upsertFromEmail(tripId, [{ ...base, guide: {} }]);
  assert.equal(result.updated, 1);
  const item = db.items.find((i) => i.tripId === tripId);
  assert.ok(item?.kind === "activity");
  assert.equal(item.guide?.meetingPoint, "12 Sample St");
  assert.deepEqual(item.guide?.whatToBring, ["Towel"]);
});
