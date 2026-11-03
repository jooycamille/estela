import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A fresh, throwaway install (the real data/db.json is never touched).
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-accounts-")), "db.json");
const { db } = await import("../server/db.ts");
const auth = await import("../server/auth.ts");

// On the Mac itself, vs. someone coming through Tailscale or a host's proxy.
const onMac = { get: (h: string) => (h === "host" ? "localhost:3001" : undefined), secure: false, socket: { remoteAddress: "127.0.0.1" } } as never;
const remote = (ip = "100.119.45.25") =>
  ({ get: (h: string) => (h === "x-forwarded-for" ? ip : h === "host" ? "my-mac.example.ts.net" : undefined), secure: true, socket: { remoteAddress: "127.0.0.1" } }) as never;
const res = () => {
  const headers: Record<string, string> = {};
  return { headers, setHeader: (k: string, v: string) => (headers[k.toLowerCase()] = v) } as never as { headers: Record<string, string> };
};
const user = (r: unknown) => {
  assert.ok(r && typeof r === "object" && "user" in r, JSON.stringify(r));
  return (r as { user: { id: string; name: string; isAdmin: boolean; email?: string; passwordHash?: string } }).user;
};

db.trips.push({ id: "old", name: "The Americas", members: [] } as never);
const owner = auth.setUpPeople();

test("someone else signing up first gets an empty account, not your trips", async () => {
  const andres = user(await auth.signUp(remote(), res() as never, { name: "Andrés", email: "andres@example.com", password: "correct horse battery" }));
  assert.equal(andres.isAdmin, false);
  assert.equal(auth.tripRole(andres as never, db.trips[0]), null);
  assert.equal(auth.needsOwner(), true);
});

test("signing up on the Mac claims Hey Joy and the trips already in it", async () => {
  const joy = user(await auth.signUp(onMac, res() as never, { name: "Joy", email: "Joy@Example.com ", password: "trip of a lifetime" }));
  assert.equal(joy.id, owner.id);
  assert.equal(joy.isAdmin, true);
  assert.equal(joy.email, "joy@example.com");
  assert.equal(auth.tripRole(joy as never, db.trips[0]), "owner");
  assert.match(joy.passwordHash!, /^scrypt\$/);
  assert.equal(auth.needsOwner(), false);
  // Another sign-up on the Mac after that is just another account.
  const other = user(await auth.signUp(onMac, res() as never, { name: "Guest", email: "guest@example.com", password: "another long one" }));
  assert.equal(other.isAdmin, false);
});

test("emails are unique and passwords have to be reasonable", async () => {
  assert.deepEqual(await auth.signUp(remote(), res() as never, { name: "X", email: "JOY@example.com", password: "whatever123" }), {
    status: 409,
    error: "There's already an account with that email. Sign in instead.",
  });
  assert.equal(((await auth.signUp(remote(), res() as never, { name: "X", email: "x@example.com", password: "short" })) as { status: number }).status, 400);
  assert.equal(auth.passwordProblem("password1"), "That password is too easy to guess");
});

test("signing in: right password works, wrong ones don't say why, and repeated tries are stopped", async () => {
  const r = res();
  assert.equal(user(await auth.signIn(remote(), r as never, { email: "joy@example.com", password: "trip of a lifetime" })).name, "Joy");
  assert.match(r.headers["set-cookie"], /^joy_session=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  assert.deepEqual(await auth.signIn(remote(), res() as never, { email: "joy@example.com", password: "nope" }), { status: 401, error: "Email or password is incorrect" });
  assert.deepEqual(await auth.signIn(remote(), res() as never, { email: "nobody@example.com", password: "nope" }), { status: 401, error: "Email or password is incorrect" });
  let last;
  for (let i = 0; i < 9; i++) last = await auth.signIn(remote("100.1.1.1"), res() as never, { email: "andres@example.com", password: "wrong" });
  assert.equal((last as { status: number }).status, 429);
});

test("a reset link sets a new password once, and signs out other devices", async () => {
  const joy = auth.findByEmail("joy@example.com")!;
  const before = db.sessions.filter((s) => s.userId === joy.id).length;
  assert.ok(before > 0);
  const link = auth.createLink("reset", joy.id, 60);
  user(await auth.resetPassword(remote(), res() as never, link, "a brand new password"));
  assert.equal(db.sessions.filter((s) => s.userId === joy.id).length, 1); // just this device
  assert.equal(((await auth.resetPassword(remote(), res() as never, link, "again and again")) as { status: number }).status, 400);
  user(await auth.signIn(remote("100.2.2.2"), res() as never, { email: "joy@example.com", password: "a brand new password" }));
});

test("an invite moves the trip from the invited name to the account that accepts it", () => {
  const trip = db.trips[0];
  const placeholder = { id: "invited-ana", name: "Ana", isAdmin: false, placeholder: true, createdAt: "" };
  db.users.push(placeholder);
  trip.members = [{ userId: placeholder.id, role: "editor", addedAt: "" }];
  const link = auth.createLink("invite", placeholder.id, 60, trip.id);
  assert.deepEqual(auth.invitePreview(link), { tripName: "The Americas", invitedBy: "Joy", invitedName: "Ana" });
  const andres = auth.findByEmail("andres@example.com")!;
  assert.deepEqual(auth.acceptInvite(andres, link), { tripId: "old" });
  assert.equal(auth.tripRole(andres, trip), "editor");
  assert.equal(db.users.some((u) => u.id === placeholder.id), false);
  assert.ok("error" in auth.acceptInvite(andres, link)); // used up
});

test("the owner link (for a deployed server) claims Hey Joy once", () => {
  db.users.find((u) => u.isAdmin)!.claimedAt = undefined; // pretend it's a fresh deploy
  const admin = db.users.find((u) => u.isAdmin)!;
  const link = auth.createLink("owner", admin.id, 60);
  assert.equal(auth.redeemLink(remote(), res() as never, link)?.user.id, admin.id);
  assert.equal(auth.needsOwner(), false);
  assert.equal(auth.redeemLink(remote(), res() as never, link), null);
});
