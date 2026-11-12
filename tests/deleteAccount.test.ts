import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A throwaway database, so the real data/db.json is never touched. Made-up people and trips only.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-delete-")), "db.json");
delete process.env.SUPABASE_URL;
const { db } = await import("../server/db.ts");
const { accountDeletionPlan, deleteAccount, setUpPeople } = await import("../server/auth.ts");

setUpPeople();
const ana = { id: "ana", name: "Ana", email: "ana@example.test", isAdmin: false, createdAt: "" };
const leo = { id: "leo", name: "Leo", email: "leo@example.test", isAdmin: false, createdAt: "" };
const tia = { id: "tia", name: "Tía", placeholder: true, isAdmin: false, createdAt: "" };
db.users.push(ana, leo, tia);
db.trips.push(
  { id: "solo", name: "Madeup Solo", ownerId: "ana", members: [] } as never,
  { id: "shared", name: "Madeup Shared", ownerId: "ana", members: [{ userId: "leo", role: "editor", addedAt: "" }] } as never,
  { id: "viewed", name: "Madeup Viewed", ownerId: "ana", members: [{ userId: "tia", role: "viewer", addedAt: "" }] } as never,
  { id: "leos", name: "Madeup Leo's", ownerId: "leo", members: [{ userId: "ana", role: "viewer", addedAt: "" }] } as never,
);
db.items.push({ id: "i1", tripId: "solo", kind: "activity" } as never, { id: "i2", tripId: "shared", kind: "activity" } as never);
db.sessions.push({ id: "s-ana", userId: "ana", device: "Mac", createdAt: "", lastSeenAt: "" });
db.invites.push({ id: "inv-tia", purpose: "invite", userId: "tia", tripId: "viewed", createdAt: "", expiresAt: "2099-01-01T00:00:00Z" });

test("the plan: trips only you can edit are deleted, a shared one goes to its editor, others' trips are left", () => {
  const plan = accountDeletionPlan(ana as never);
  assert.deepEqual(plan.deleted.map((t) => t.id), ["solo", "viewed"]);
  assert.deepEqual(plan.handedOver.map((h) => [h.trip.id, h.to.id]), [["shared", "leo"]]);
  assert.deepEqual(plan.left.map((t) => t.id), ["leos"]);
});

test("deleting does what the plan said, and removes everything that was only yours", async () => {
  const headers: Record<string, string> = {};
  const req = { secure: false, get: () => undefined } as never;
  const res = { setHeader: (k: string, v: string) => void (headers[k.toLowerCase()] = v) } as never;
  const deleted: string[] = [];
  await deleteAccount(req, res, ana as never, async (id) => {
    deleted.push(id);
    db.trips = db.trips.filter((t) => t.id !== id);
    db.items = db.items.filter((i) => i.tripId !== id);
  });
  assert.deepEqual(deleted, ["solo", "viewed"]);
  assert.equal(db.trips.find((t) => t.id === "shared")?.ownerId, "leo");
  assert.deepEqual(db.trips.find((t) => t.id === "shared")?.members, []);
  assert.deepEqual(db.trips.find((t) => t.id === "leos")?.members, []);
  assert.deepEqual(db.items.map((i) => i.id), ["i2"]);
  assert.ok(!db.users.some((u) => u.id === "ana"));
  assert.ok(!db.users.some((u) => u.id === "tia")); // invited to a trip that's gone, never joined
  assert.ok(!db.invites.some((i) => i.userId === "tia"));
  assert.ok(!db.sessions.some((s) => s.userId === "ana"));
  assert.match(headers["set-cookie"], /Max-Age=0/);
  assert.ok(db.users.some((u) => u.id === "leo"));
});
