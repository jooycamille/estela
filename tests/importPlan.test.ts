import assert from "node:assert/strict";
import { test } from "node:test";
import type { Data } from "../server/db.ts";
import { planImport } from "../server/importPlan.ts";

// Made-up data only.
const empty = (): Data => ({ trips: [], items: [], inboxes: [], attachments: [], lists: [], users: [], sessions: [], invites: [], pushSubs: [], remindersSent: [] });
const source: Data = {
  ...empty(),
  users: [
    { id: "u-owner", name: "Owner", email: "owner@example.test", passwordHash: "scrypt$x", isAdmin: true, claimedAt: "2026-01-01", createdAt: "" },
    { id: "u-ana", name: "Ana", email: "ana@example.test", passwordHash: "scrypt$y", isAdmin: false, createdAt: "" },
    { id: "u-leo", name: "Leo", placeholder: true, isAdmin: false, createdAt: "" },
  ],
  trips: [{ id: "t1", name: "Madeup Coast", ownerId: "u-owner" } as never],
  sessions: [{ id: "s-old", userId: "u-owner", device: "Mac · Safari", createdAt: "", lastSeenAt: "" }],
  invites: [
    { id: "i-leo", purpose: "invite", userId: "u-leo", tripId: "t1", createdAt: "", expiresAt: "2099-01-01T00:00:00Z" },
    { id: "i-old", purpose: "invite", userId: "u-leo", tripId: "t1", createdAt: "", expiresAt: "2001-01-01T00:00:00Z" },
    { id: "i-reset", purpose: "reset", userId: "u-ana", createdAt: "", expiresAt: "2099-01-01T00:00:00Z" },
  ],
  remindersSent: ["t1|i1|a"],
};

test("everything is copied except old sign-ins, old passwords and one-time links", () => {
  const plan = planImport(source, empty());
  assert.equal(plan.data.trips.length, 1);
  assert.deepEqual(plan.data.users.map((u) => u.id), ["u-owner", "u-ana", "u-leo"]);
  assert.ok(plan.data.users.every((u) => !u.passwordHash));
  assert.equal(plan.data.sessions.length, 0);
  assert.deepEqual(plan.data.invites.map((i) => i.id), ["i-leo"]); // still-valid trip invite only
  assert.equal(source.users[0].passwordHash, "scrypt$x"); // the source isn't changed
});

test("someone who signed in to the new project first is joined to their imported account, staying signed in", () => {
  const target = {
    ...empty(),
    users: [
      { id: "new-owner", name: "Owner", email: "OWNER@example.test", authId: "sb-owner", isAdmin: true, claimedAt: "2026-11-09", createdAt: "" },
      { id: "new-sam", name: "Sam", email: "sam@example.test", authId: "sb-sam", isAdmin: false, createdAt: "" },
    ],
    sessions: [{ id: "s-new", userId: "new-owner", device: "Mac · Chrome", createdAt: "", lastSeenAt: "" }],
    pushSubs: [{ userId: "new-owner", endpoint: "https://push.example.test/1", keys: { p256dh: "k", auth: "a" }, device: "Mac", createdAt: "" }],
  };
  const plan = planImport(source, target);
  assert.deepEqual(plan.dropUsers, ["new-owner"]);
  const owner = plan.data.users.find((u) => u.id === "u-owner")!;
  assert.equal(owner.authId, "sb-owner");
  assert.equal(owner.isAdmin, true);
  assert.deepEqual(plan.data.sessions.map((s) => [s.id, s.userId]), [["s-new", "u-owner"]]);
  assert.equal(plan.data.pushSubs[0].userId, "u-owner");
  // Someone new to the project stays as they are.
  assert.ok(plan.data.users.some((u) => u.id === "new-sam" && u.authId === "sb-sam"));
});

test("only one owner: whoever owns the imported trips", () => {
  const target = { ...empty(), users: [{ id: "early", name: "Early", email: "early@example.test", isAdmin: true, createdAt: "" }] };
  const plan = planImport(source, target);
  assert.deepEqual(plan.data.users.filter((u) => u.isAdmin).map((u) => u.id), ["u-owner"]);
});
