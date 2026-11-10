import assert from "node:assert/strict";
import { test } from "node:test";
import { changes, markSaved } from "../server/supabaseStore.ts";

// Made-up records only.
test("only records that changed are written, and removed ones are deleted", () => {
  const a = { id: "t1", name: "Madeup Coast" };
  const b = { id: "t2", name: "Madeup Hills" };
  markSaved("trips", [a, b]);

  assert.deepEqual(changes("trips", [a, b]), { upserts: [], removed: [], now: changes("trips", [a, b]).now });

  const edited = { ...b, name: "Madeup Hills, again" };
  const c = { id: "t3", name: "Madeup Lake" };
  const out = changes("trips", [edited, c]);
  assert.deepEqual(out.upserts.map((u) => u.id), ["t2", "t3"]);
  assert.deepEqual(out.removed, ["t1"]);
});

test("records without an id field use their own key (inboxes by trip, reminders by text)", () => {
  markSaved("inboxes", []);
  assert.deepEqual(changes("inboxes", [{ tripId: "t9", address: "x@example.test" }]).upserts.map((u) => u.id), ["t9"]);
  markSaved("remindersSent", ["t1|i1|2027-05-10T08:00"]);
  const r = changes("remindersSent", ["t1|i1|2027-05-10T08:00", "t1|i2|2027-05-11T08:00"]);
  assert.deepEqual(r.upserts.map((u) => u.id), ["t1|i2|2027-05-11T08:00"]);
  assert.deepEqual(r.removed, []);
});
