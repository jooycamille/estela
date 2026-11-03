import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A throwaway database, so the real data/db.json is never touched.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-auth-")), "db.json");
const { db } = await import("../server/db.ts");
const { createLink, guard, redeemLink, setUpPeople, canSeeAttachment } = await import("../server/auth.ts");

type Res = { statusCode: number; body?: unknown; headers: Record<string, string>; locals: Record<string, unknown> };
function fakeRes(): Res & { status(c: number): unknown; json(b: unknown): unknown; setHeader(k: string, v: string): void } {
  const r = { statusCode: 200, headers: {} as Record<string, string>, locals: {} as Record<string, unknown> };
  return Object.assign(r, {
    status(c: number) { r.statusCode = c; return this; },
    json(b: unknown) { (r as Res).body = b; return this; },
    setHeader(k: string, v: string) { r.headers[k.toLowerCase()] = v; },
  });
}
const fakeReq = (method: string, path: string, cookie?: string, extra: Record<string, unknown> = {}) =>
  ({ method, path, query: {}, body: {}, secure: false, get: (h: string) => (h.toLowerCase() === "cookie" ? cookie : h.toLowerCase() === "host" ? "localhost:3001" : undefined), ...extra }) as never;

/** Signs someone in with a fresh link and returns their cookie. */
function signIn(userId: string) {
  const res = fakeRes();
  assert.ok(redeemLink(fakeReq("POST", "/api/auth/redeem"), res as never, createLink("device", userId, 10)));
  return res.headers["set-cookie"].split(";")[0];
}
/** Runs the guard: the status it answers with (or 200 if the route would run). */
function call(method: string, path: string, cookie?: string, extra?: Record<string, unknown>) {
  const res = fakeRes();
  let passed = false;
  guard(fakeReq(method, path, cookie, extra), res as never, () => (passed = true));
  return passed ? 200 : res.statusCode;
}

const admin = setUpPeople();
const friend = { id: "friend", name: "Andrés", isAdmin: false, createdAt: "" };
const viewer = { id: "viewer", name: "Tía", isAdmin: false, createdAt: "" };
db.users.push(friend, viewer);
const mine = { id: "mine", name: "Solo trip", ownerId: admin.id, members: [] } as never;
const shared = { id: "shared", name: "Colombia", ownerId: admin.id, members: [{ userId: "friend", role: "editor", addedAt: "" }, { userId: "viewer", role: "viewer", addedAt: "" }] } as never;
db.trips.push(mine, shared);
db.items.push({ id: "item-shared", tripId: "shared", kind: "stay", attachments: [{ id: "file-shared" }] } as never, { id: "item-mine", tripId: "mine", kind: "stay" } as never);
db.attachments.push({ id: "file-shared", path: "", filename: "", contentType: "", size: 0, createdAt: "" }, { id: "file-mine", path: "", filename: "", contentType: "", size: 0, createdAt: "", uploadedBy: admin.id } as never);

const me = signIn(admin.id), andres = signIn("friend"), tia = signIn("viewer");

test("everything needs sign-in, except using a link", () => {
  assert.equal(call("GET", "/api/trips"), 401);
  assert.equal(call("GET", "/api/trips/shared"), 401);
  assert.equal(call("POST", "/api/auth/signin"), 200);
  assert.equal(call("POST", "/api/auth/signup"), 200);
  assert.equal(call("GET", "/api/trips/shared", "joy_session=forged"), 401);
});

test("people only reach trips they're on; others look like they don't exist", () => {
  assert.equal(call("GET", "/api/trips/shared", andres), 200);
  assert.equal(call("GET", "/api/trips/mine", andres), 404);
  assert.equal(call("GET", "/api/items/item-mine", andres), 404);
  assert.equal(call("GET", "/api/lodging/search", andres, { query: { tripId: "mine" } }), 404);
  assert.equal(call("POST", "/api/parse-email", andres, { body: { tripId: "mine" } }), 404);
  assert.equal(call("GET", "/api/trips/mine", me), 200);
});

test("editors change the trip but not who's on it; viewers only look", () => {
  assert.equal(call("POST", "/api/trips/shared/items", andres), 200);
  assert.equal(call("DELETE", "/api/trips/shared", andres), 403);
  assert.equal(call("POST", "/api/trips/shared/members", andres), 403);
  assert.equal(call("POST", "/api/trips/shared/items", tia), 403);
  assert.equal(call("GET", "/api/trips/shared/prep", tia), 200);
  assert.equal(call("DELETE", "/api/trips/shared", me), 200);
});

test("the app's settings are the admin's alone", () => {
  assert.equal(call("GET", "/api/settings/flight-data", andres), 403);
  assert.equal(call("GET", "/api/settings/flight-data", me), 200);
});

test("files follow their trip (or whoever uploaded them)", () => {
  assert.equal(canSeeAttachment(friend, "file-shared"), true);
  assert.equal(canSeeAttachment(friend, "file-mine"), false);
  assert.equal(canSeeAttachment(admin, "file-mine"), true);
});

test("links work once, and changes from other sites are blocked", () => {
  const link = createLink("device", "friend", 10);
  assert.ok(redeemLink(fakeReq("POST", "/x"), fakeRes() as never, link));
  assert.equal(redeemLink(fakeReq("POST", "/x"), fakeRes() as never, link), null);
  assert.equal(call("POST", "/api/trips/shared/items", andres, { get: (h: string) => (h === "cookie" ? andres : h === "origin" ? "https://evil.example" : h === "host" ? "localhost:3001" : undefined) }), 403);
});
