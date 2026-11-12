import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Trip, TripRole, User } from "../shared/types.ts";
import { db, newId, now, save, type InviteRecord, type UserRecord } from "./db.ts";
import type { SupabaseIdentity } from "./supabaseAuth.ts";

// Accounts and access. Anyone can create an account (name, email, password); each account sees only its own trips
// and the trips it's been invited to. The app's settings (flight-data API keys) belong to the owner of Estela: the
// account that claimed it, by signing up on the Mac running it or with the one-time owner link in the server log.
//
// Passwords are stored as scrypt hashes; cookies and one-time links as SHA-256 hashes of their secrets, so a copy of
// data/db.json can't be used to sign in.

const COOKIE = "joy_session";
const SESSION_DAYS = 180;
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
export const normaliseEmail = (email: string) => email.trim().toLowerCase();

// ---------- Passwords ----------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const scryptAsync = (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function passwordMatches(password: string, stored?: string) {
  const [kind, N, r, p, salt, key] = stored?.split("$") ?? [];
  if (kind !== "scrypt" || !key) {
    // Same work either way, so response time doesn't reveal which emails have accounts.
    await scryptAsync(password, randomBytes(16), SCRYPT.keylen, SCRYPT);
    return false;
  }
  const expected = Buffer.from(key, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

/** A reason a password won't do, or undefined. Length matters most; a few obvious ones are refused. */
export function passwordProblem(password: string, email?: string) {
  if (password.length < 8) return "Use at least 8 characters";
  if (password.length > 200) return "That password is too long";
  const lower = password.toLowerCase();
  if (email && lower === email.toLowerCase()) return "Don't use your email as your password";
  if (/^(password|12345678|123456789|qwertyui|heyjoy|iloveyou|travel)/i.test(lower) && password.length < 12) return "That password is too easy to guess";
  return undefined;
}

// ---------- Too many attempts ----------

const attempts = new Map<string, number[]>();
/** At most `max` attempts per key in `minutes` (sign-in per email and per address, sign-up, reset emails). */
export function tooMany(key: string, max: number, minutes: number) {
  const since = Date.now() - minutes * 60_000;
  const recent = (attempts.get(key) ?? []).filter((t) => t > since);
  recent.push(Date.now());
  attempts.set(key, recent);
  return recent.length > max;
}
export const clientAddress = (req: Request) => req.get("x-forwarded-for")?.split(",")[0].trim() || req.socket?.remoteAddress || "?";

// ---------- People ----------

/** Before accounts: an owner placeholder holds everything until the real owner claims Estela. */
export function setUpPeople() {
  let admin = db.users.find((u) => u.isAdmin);
  let changed = false;
  if (!admin) {
    admin = { id: newId(), name: "Me", isAdmin: true, createdAt: now() };
    db.users.push(admin);
    changed = true;
  }
  // Signed in before (with a link): that was claiming it.
  if (!admin.claimedAt && db.sessions.some((s) => s.userId === admin!.id)) {
    admin.claimedAt = now();
    changed = true;
  }
  for (const t of db.trips)
    if (!t.ownerId) {
      t.ownerId = admin.id;
      changed = true;
    }
  const before = db.invites.length;
  db.invites = db.invites.filter((i) => i.expiresAt > now());
  if (changed || db.invites.length !== before) save();
  return admin;
}

/** True until someone claims Estela (and its existing trips). */
export const needsOwner = () => !db.users.some((u) => u.isAdmin && u.claimedAt);
const ownerPlaceholder = () => db.users.find((u) => u.isAdmin && !u.claimedAt);

/**
 * Is this request from the Mac running Estela itself (not a phone or anyone else)? Other devices come through
 * Tailscale (or a host's proxy), which adds forwarding headers and uses its own address, not localhost.
 */
export function onThisMac(req: Request) {
  const ip = req.socket?.remoteAddress ?? "";
  const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const forwarded = ["x-forwarded-for", "x-forwarded-host", "forwarded", "tailscale-user-login"].some((h) => req.get(h));
  const host = (req.get("host") ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return loopback && !forwarded && (host === "localhost" || host === "127.0.0.1" || host === "::1");
}

export const findByEmail = (email: string) => db.users.find((u) => u.email === normaliseEmail(email) && !u.placeholder);

// ---------- Sessions ----------

function describeDevice(ua = "") {
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "Device";
  const browser = /Firefox|FxiOS/.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "browser";
  return `${device} · ${browser}`;
}

const secure = (req: Request) => req.secure || req.get("x-forwarded-proto") === "https";
function setCookie(req: Request, res: Response, value: string, maxAgeSeconds: number) {
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure(req) ? "; Secure" : ""}`);
}

function startSession(req: Request, res: Response, user: User) {
  const s = secret();
  db.sessions.push({ id: hash(s), userId: user.id, device: describeDevice(req.get("user-agent")), createdAt: now(), lastSeenAt: now() });
  save();
  setCookie(req, res, s, SESSION_DAYS * 86_400);
}

function sessionOf(req: Request) {
  const value = req.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value ? db.sessions.find((s) => s.id === hash(value)) : undefined;
}
export const currentSessionId = (req: Request) => sessionOf(req)?.id;

export function signOut(req: Request, res: Response) {
  const s = sessionOf(req);
  if (s) {
    db.sessions = db.sessions.filter((x) => x !== s);
    save();
  }
  setCookie(req, res, "", 0);
}

/** The signed-in person for this request, if any. */
export function userOf(req: Request): UserRecord | undefined {
  const s = sessionOf(req);
  if (!s) return undefined;
  if (Date.now() - Date.parse(s.lastSeenAt) > 10 * 60_000) {
    s.lastSeenAt = now();
    save();
  }
  return db.users.find((u) => u.id === s.userId);
}

// ---------- Sign up, sign in, passwords ----------

type AuthResult = { user: UserRecord } | { error: string; status: number };

/**
 * A new account. Signing up on the Mac running Estela, while nobody has claimed it, makes you its owner and gives
 * you the trips already in it; every other sign-up starts with an empty account.
 */
export async function signUp(req: Request, res: Response, input: { name: string; email: string; password: string }): Promise<AuthResult> {
  const email = normaliseEmail(input.email);
  if (findByEmail(email)) return { status: 409, error: "There's already an account with that email. Sign in instead." };
  const problem = passwordProblem(input.password, email);
  if (problem) return { status: 400, error: problem };
  const passwordHash = await hashPassword(input.password);
  const placeholder = ownerPlaceholder();
  let user: UserRecord;
  if (placeholder && onThisMac(req)) {
    Object.assign(placeholder, { name: input.name, email, passwordHash, claimedAt: now(), tourPending: true });
    user = placeholder;
  } else {
    user = { id: newId(), name: input.name, email, passwordHash, isAdmin: false, tourPending: true, createdAt: now() };
    db.users.push(user);
  }
  startSession(req, res, user);
  return { user };
}

export async function signIn(req: Request, res: Response, input: { email: string; password: string }): Promise<AuthResult> {
  const email = normaliseEmail(input.email);
  if (tooMany(`signin:${email}`, 8, 15) || tooMany(`signin-ip:${clientAddress(req)}`, 30, 15))
    return { status: 429, error: "Too many attempts. Wait 15 minutes, or reset your password." };
  const user = findByEmail(email);
  if (!(await passwordMatches(input.password, user?.passwordHash)) || !user) return { status: 401, error: "Email or password is incorrect" };
  startSession(req, res, user);
  return { user };
}

/** Changing your password signs out your other devices (in case someone else knew the old one). */
export async function changePassword(req: Request, user: UserRecord, current: string | undefined, next: string): Promise<string | undefined> {
  // Accounts without a password yet (the owner who claimed Estela with a link) set one without the current one.
  if (user.passwordHash && !(await passwordMatches(current ?? "", user.passwordHash))) return "Your current password is incorrect";
  const problem = passwordProblem(next, user.email);
  if (problem) return problem;
  user.passwordHash = await hashPassword(next);
  const keep = currentSessionId(req);
  db.sessions = db.sessions.filter((s) => s.userId !== user.id || s.id === keep);
  save();
  return undefined;
}

// ---------- Supabase Auth ----------

/**
 * Signed in with Supabase (see server/supabaseAuth.ts): the Estela account for that identity, starting a session.
 * The first time, an existing account with the same email is linked to it (that's how accounts made before Supabase
 * carry on, trips and all), but only once Supabase has confirmed the email, so nobody can take over an account by
 * signing up with someone else's address. Signing up on the Mac running Estela while nobody owns it claims it.
 */
export function signInWithIdentity(req: Request, res: Response, identity: SupabaseIdentity, name?: string): AuthResult {
  const who = { ...identity, email: normaliseEmail(identity.email) };
  if (!who.confirmed) return { status: 403, error: "Confirm your email first: open the link we sent you." };
  let user = db.users.find((u) => u.authId === who.id);
  if (!user) {
    const sameEmail = findByEmail(who.email);
    if (sameEmail?.authId && sameEmail.authId !== who.id) return { status: 409, error: "That email belongs to another account." };
    const placeholder = ownerPlaceholder();
    if (sameEmail) user = sameEmail;
    else if (placeholder && onThisMac(req)) {
      Object.assign(placeholder, { name: name || who.name || placeholder.name, claimedAt: now(), tourPending: true });
      user = placeholder;
    } else {
      user = { id: newId(), name: name || who.name || who.email.split("@")[0].slice(0, 40), isAdmin: false, tourPending: true, createdAt: now() };
      db.users.push(user);
    }
    user.authId = who.id;
  }
  // Supabase holds the password now, and the email (changed there, after confirming the new one).
  delete user.passwordHash;
  user.email = who.email;
  startSession(req, res, user);
  return { user };
}

/** After a password change or reset: every other device is signed out (in case someone else knew the old one). */
export function signOutOtherDevices(req: Request, user: UserRecord) {
  const keep = currentSessionId(req);
  db.sessions = db.sessions.filter((s) => s.userId !== user.id || s.id === keep);
  save();
}

// ---------- Deleting an account ----------

/**
 * What deleting this account does to its trips: ones it owns are deleted, unless someone else on them can edit (then
 * they're handed to that person, so travel companions keep them); ones shared with it are left.
 */
export function accountDeletionPlan(user: UserRecord) {
  const owned = db.trips.filter((t) => t.ownerId === user.id);
  const heir = (t: Trip) =>
    t.members?.find((m) => m.role === "editor" && db.users.some((u) => u.id === m.userId && !u.placeholder));
  return {
    deleted: owned.filter((t) => !heir(t)),
    handedOver: owned.flatMap((t) => {
      const h = heir(t);
      return h ? [{ trip: t, to: db.users.find((u) => u.id === h.userId)! }] : [];
    }),
    left: db.trips.filter((t) => t.members?.some((m) => m.userId === user.id)),
  };
}

/**
 * Deletes the account and what's only its own (see accountDeletionPlan). `deleteTrip` removes a trip and everything
 * in it (bookings, lists, its email inbox).
 */
export async function deleteAccount(req: Request, res: Response, user: UserRecord, deleteTrip: (id: string) => Promise<void>) {
  const plan = accountDeletionPlan(user);
  for (const t of plan.deleted) await deleteTrip(t.id);
  for (const { trip, to } of plan.handedOver) {
    trip.ownerId = to.id;
    trip.members = trip.members?.filter((m) => m.userId !== to.id);
  }
  for (const t of plan.left) t.members = t.members?.filter((m) => m.userId !== user.id);
  setCookie(req, res, "", 0);
  db.sessions = db.sessions.filter((s) => s.userId !== user.id);
  db.invites = db.invites.filter((i) => i.userId !== user.id);
  db.pushSubs = db.pushSubs.filter((p) => p.userId !== user.id);
  db.users = db.users.filter((u) => u.id !== user.id);
  // People invited to trips that are now gone, who never joined: nothing left to join.
  const onATrip = new Set(db.trips.flatMap((t) => [t.ownerId, ...(t.members ?? []).map((m) => m.userId)]));
  const stranded = new Set(db.users.filter((u) => u.placeholder && !onATrip.has(u.id)).map((u) => u.id));
  db.users = db.users.filter((u) => !stranded.has(u.id));
  db.invites = db.invites.filter((i) => !stranded.has(i.userId));
  save();
  return plan;
}

// ---------- One-time links ----------

/** A one-time link's secret (only its hash is kept). A new link of the same kind replaces the old one. */
export function createLink(purpose: InviteRecord["purpose"], userId: string, ttlMinutes: number, tripId?: string): string {
  const s = secret();
  db.invites = db.invites.filter((i) => !(i.purpose === purpose && i.userId === userId && i.tripId === tripId));
  db.invites.push({ id: hash(s), purpose, userId, tripId, createdAt: now(), expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString() });
  save();
  return s;
}

function findLink(linkSecret: string, purpose: InviteRecord["purpose"]) {
  const link = db.invites.find((i) => i.id === hash(linkSecret) && i.purpose === purpose);
  return link && link.expiresAt > now() ? link : undefined;
}
const useUp = (link: InviteRecord) => (db.invites = db.invites.filter((i) => i !== link));

/** "Sign in another device" and the owner link: sign this device in as that account. */
export function redeemLink(req: Request, res: Response, linkSecret: string) {
  const link = findLink(linkSecret, "device") ?? findLink(linkSecret, "owner");
  const user = link && db.users.find((u) => u.id === link.userId);
  if (!link || !user) return null;
  useUp(link);
  if (link.purpose === "owner" && !user.claimedAt) user.claimedAt = now();
  startSession(req, res, user);
  return { user };
}

/** Resetting a forgotten password (from the emailed link): sets it, signs out everywhere else, signs this device in. */
export async function resetPassword(req: Request, res: Response, linkSecret: string, password: string): Promise<AuthResult> {
  const link = findLink(linkSecret, "reset");
  const user = link && db.users.find((u) => u.id === link.userId);
  if (!link || !user) return { status: 400, error: "This reset link has expired or was already used. Ask for a new one." };
  const problem = passwordProblem(password, user.email);
  if (problem) return { status: 400, error: problem };
  useUp(link);
  user.passwordHash = await hashPassword(password);
  db.sessions = db.sessions.filter((s) => s.userId !== user.id);
  startSession(req, res, user);
  return { user };
}

/** What an invite is for, so the page can say "Sam invited you to The Americas" before you sign up or in. */
export function invitePreview(linkSecret: string) {
  const link = findLink(linkSecret, "invite");
  const trip = link && db.trips.find((t) => t.id === link.tripId);
  if (!link || !trip) return null;
  return {
    tripName: trip.name,
    invitedBy: db.users.find((u) => u.id === trip.ownerId)?.name ?? "Someone",
    invitedName: db.users.find((u) => u.id === link.userId)?.name,
  };
}

/**
 * Joining a trip with an invite, once signed in: the trip moves from the invited placeholder ("Andrés, invited") to
 * your account, with the role the owner chose.
 */
export function acceptInvite(user: UserRecord, linkSecret: string): { tripId: string } | { error: string } {
  const link = findLink(linkSecret, "invite");
  const trip = link && db.trips.find((t) => t.id === link.tripId);
  if (!link || !trip) return { error: "This invite has expired or was already used. Ask for a new one." };
  useUp(link);
  const placeholder = db.users.find((u) => u.id === link.userId);
  const role = trip.members?.find((m) => m.userId === link.userId)?.role ?? "viewer";
  if (tripRole(user, trip) === null) trip.members = [...(trip.members ?? []), { userId: user.id, role, addedAt: now() }];
  // The placeholder stood in for you on every trip it was added to.
  if (placeholder?.placeholder) {
    for (const t of db.trips) {
      if (!t.members?.some((m) => m.userId === placeholder.id)) continue;
      const mine = t.members.find((m) => m.userId === user.id);
      t.members = t.members.flatMap((m) => (m.userId !== placeholder.id ? [m] : mine || t.ownerId === user.id ? [] : [{ ...m, userId: user.id }]));
    }
    db.invites = db.invites.filter((i) => i.userId !== placeholder.id);
    db.users = db.users.filter((u) => u !== placeholder);
  }
  save();
  return { tripId: trip.id };
}

// ---------- Access to trips ----------

export function tripRole(user: User | undefined, trip: Trip | undefined): TripRole | null {
  if (!user || !trip) return null;
  if (trip.ownerId === user.id) return "owner";
  return trip.members?.find((m) => m.userId === user.id)?.role ?? null;
}
export const canEdit = (role: TripRole | null) => role === "owner" || role === "editor";

/** People (with accounts) who share at least one trip with this person, to add to another trip directly. */
export function contactsOf(user: User) {
  const ids = new Set<string>();
  for (const t of db.trips) {
    const people = [t.ownerId, ...(t.members ?? []).map((m) => m.userId)];
    if (people.includes(user.id)) people.forEach((p) => p && p !== user.id && ids.add(p));
  }
  return db.users.filter((u) => ids.has(u.id) && !u.placeholder);
}

// Which trip a request is about, from its path (null: not about a single trip).
function tripOfPath(path: string, method: string): { trip?: Trip; ownerOnly: boolean } | null {
  let m = path.match(/^\/api\/trips\/([^/]+)(\/.*)?$/);
  if (m) {
    const rest = m[2] ?? "";
    return {
      trip: db.trips.find((t) => t.id === m![1]),
      // Deleting the trip and choosing who's on it are the owner's (members may remove themselves; checked in the route).
      ownerOnly: (method === "DELETE" && rest === "") || (/^\/members/.test(rest) && method !== "GET" && method !== "DELETE"),
    };
  }
  m = path.match(/^\/api\/items\/([^/]+)/);
  if (m) {
    const item = db.items.find((i) => i.id === m![1]);
    return { trip: item && db.trips.find((t) => t.id === item.tripId), ownerOnly: false };
  }
  m = path.match(/^\/api\/lists\/([^/]+)/);
  if (m) {
    const list = db.lists.find((l) => l.id === m![1]);
    return { trip: list && db.trips.find((t) => t.id === list.tripId), ownerOnly: false };
  }
  return null;
}

/** Can this person open this file? Via a trip they can see, or because they uploaded it (before saving a booking). */
export function canSeeAttachment(user: User, attachmentId: string) {
  const record = db.attachments.find((a) => a.id === attachmentId);
  if (!record) return false;
  if (record.uploadedBy === user.id) return true;
  const url = `/api/attachments/${attachmentId}`;
  return (
    db.items.some((i) => i.attachments?.some((a) => a.id === attachmentId) && tripRole(user, db.trips.find((t) => t.id === i.tripId)) !== null) ||
    // A photo of a place on a list, on a trip you can see.
    db.lists.some((l) => l.entries.some((e) => e.photo?.url === url) && tripRole(user, db.trips.find((t) => t.id === l.tripId)) !== null)
  );
}

const PUBLIC = [/^\/api\/auth\/(me|signup|signin|forgot|reset|redeem|supabase)$/, /^\/api\/auth\/invite\/[\w-]+$/, /^\/api\/inbound-email$/, /^\/api\/calendar\/[\w-]+\.ics$/];
const ADMIN_ONLY = [/^\/api\/settings\/flight-data/, /^\/api\/items\/[^/]+\/simulate-change$/];
const READS = new Set(["GET", "HEAD"]);

/**
 * Runs before every API route: blocks cross-site requests, requires sign-in, and checks the person can see (or
 * change) the trip a request is about. Trips you can't see answer "not found", so their existence isn't revealed.
 */
export function guard(req: Request, res: Response, next: NextFunction) {
  const path = req.path;
  if (!path.startsWith("/api/")) return next();

  // Changes (including signing in or up) must come from this app's own pages, not another site open in the browser.
  const origin = req.get("origin");
  if (!READS.has(req.method) && origin && path !== "/api/inbound-email") {
    let host: string | undefined;
    try {
      host = new URL(origin).host;
    } catch {
      host = undefined;
    }
    if (host !== req.get("host") && host !== req.get("x-forwarded-host")) return void res.status(403).json({ error: "Request blocked" });
  }
  // Asking who's signed in is open to anyone; changing your account (PATCH /api/auth/me) needs you signed in.
  if (PUBLIC.some((re) => re.test(path)) && !(path === "/api/auth/me" && !READS.has(req.method))) return next();

  const user = userOf(req);
  if (!user) return void res.status(401).json({ error: "Please sign in to Estela", signIn: true });
  res.locals.user = user;

  if (ADMIN_ONLY.some((re) => re.test(path)) && !user.isAdmin) return void res.status(403).json({ error: "Only the app's owner can change this" });

  const scoped = tripOfPath(path, req.method);
  // Trips are also named in queries and bodies (address search near a trip, importing an email into one).
  const named = (req.query.tripId as string | undefined) ?? (req.body as { tripId?: string } | undefined)?.tripId;
  const trip = scoped ? scoped.trip : named ? db.trips.find((t) => t.id === named) : undefined;
  if (scoped || named) {
    const role = tripRole(user, trip);
    if (!role) return void res.status(404).json({ error: "Not found" });
    if (scoped?.ownerOnly && role !== "owner") return void res.status(403).json({ error: "Only the trip's owner can do that" });
    // Asking Estela a question (the chat) or getting your own calendar link changes nothing on the trip, so viewers can too.
    if (!READS.has(req.method) && !canEdit(role) && !/^\/api\/trips\/[^/]+\/(chat|calendar)$/.test(path)) return void res.status(403).json({ error: "You can view this trip but not change it" });
    res.locals.role = role;
  }
  next();
}

export const userFrom = (res: Response) => res.locals.user as UserRecord;
