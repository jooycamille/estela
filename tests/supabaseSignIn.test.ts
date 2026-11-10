import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A throwaway database, so the real data/db.json is never touched. Made-up people only.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-supa-")), "db.json");
delete process.env.SUPABASE_URL;
const { db } = await import("../server/db.ts");
const { setUpPeople, signInWithIdentity, userOf } = await import("../server/auth.ts");

function fakeRes() {
  const headers: Record<string, string> = {};
  return { headers, setHeader: (k: string, v: string) => void (headers[k.toLowerCase()] = v) };
}
// From a phone (through Tailscale), unless `mac`: on the Mac running Estela.
const fakeReq = (mac = false, cookie?: string) =>
  ({
    secure: false,
    socket: { remoteAddress: mac ? "127.0.0.1" : "100.64.0.2" },
    get: (h: string) => {
      const k = h.toLowerCase();
      if (k === "cookie") return cookie;
      if (k === "host") return "localhost:3001";
      if (k === "x-forwarded-for" && !mac) return "100.64.0.2";
      return undefined;
    },
  }) as never;

const owner = setUpPeople();
const existing = { id: "u-ana", name: "Ana", email: "ana@example.test", passwordHash: "scrypt$old", isAdmin: false, createdAt: "" };
db.users.push(existing);

test("an email that isn't confirmed yet can't sign in", () => {
  const r = signInWithIdentity(fakeReq(), fakeRes() as never, { id: "sb-1", email: "ana@example.test", confirmed: false });
  assert.ok("error" in r && r.status === 403);
  assert.equal(existing.passwordHash, "scrypt$old"); // nothing linked
});

test("an account from before Supabase is linked by its confirmed email, trips and all, and its old password dropped", () => {
  const res = fakeRes();
  const r = signInWithIdentity(fakeReq(), res as never, { id: "sb-ana", email: "Ana@Example.test", confirmed: true });
  assert.ok("user" in r);
  assert.equal(r.user.id, "u-ana");
  const u = db.users.find((x) => x.id === "u-ana")!;
  assert.equal(u.authId, "sb-ana");
  assert.equal(u.passwordHash, undefined);
  // The session works.
  const cookie = res.headers["set-cookie"].split(";")[0];
  assert.equal(userOf(fakeReq(false, cookie))?.id, "u-ana");
});

test("another Supabase user can't take over an account by its email", () => {
  const r = signInWithIdentity(fakeReq(), fakeRes() as never, { id: "sb-someone-else", email: "ana@example.test", confirmed: true });
  assert.ok("error" in r && r.status === 409);
});

test("a new person gets a new, empty account; signing up on the Mac claims Estela", () => {
  const phone = signInWithIdentity(fakeReq(), fakeRes() as never, { id: "sb-leo", email: "leo@example.test", confirmed: true, name: "Leo" });
  assert.ok("user" in phone);
  assert.notEqual(phone.user.id, owner.id);
  assert.equal(phone.user.name, "Leo");
  assert.equal(phone.user.isAdmin, false);

  const mac = signInWithIdentity(fakeReq(true), fakeRes() as never, { id: "sb-me", email: "me@example.test", confirmed: true }, "Me Myself");
  assert.ok("user" in mac);
  assert.equal(mac.user.id, owner.id);
  assert.equal(mac.user.isAdmin, true);
  assert.ok(mac.user.claimedAt);
  assert.equal(mac.user.name, "Me Myself");
});

test("signing in again finds the same account by its Supabase id, even after the email changed there", () => {
  const r = signInWithIdentity(fakeReq(), fakeRes() as never, { id: "sb-ana", email: "ana.new@example.test", confirmed: true });
  assert.ok("user" in r);
  assert.equal(r.user.id, "u-ana");
  assert.equal(r.user.email, "ana.new@example.test");
});
