import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { InboxEmail, ItineraryItem, StoredAttachment, Trip, TripList, User } from "../shared/types.ts";
import { flushNow, loadStore, scheduleWrite, supabaseConfigured } from "./supabaseStore.ts";

/** Server-side inbox record, including the credentials the client never sees. */
export interface InboxRecord {
  tripId: string;
  provider: "mailtm" | "domain";
  address: string;
  token: string; // random id embedded in custom-domain addresses (trip-<token>@domain)
  mailtm?: { accountId: string; password: string };
  createdAt: string;
  lastCheckedAt?: string;
  processedIds: string[];
  emails: InboxEmail[];
  bodies?: Record<string, string>; // message id -> body, kept so emails can be re-imported
}

/** A file kept on disk under data/attachments (tickets, vouchers, itineraries). */
export interface AttachmentRecord extends StoredAttachment {
  path: string;
  emailId?: string;
  uploadedBy?: string; // user id, so a file uploaded before its booking is saved stays private to them
  createdAt: string;
}

/** A person as stored: never sent to the browser as is (the password hash stays here). */
export interface UserRecord extends User {
  passwordHash?: string; // scrypt; see server/auth.ts (not used once Supabase Auth is on: Supabase holds passwords)
  authId?: string; // the Supabase Auth user this account signs in as
  placeholder?: boolean; // invited to a trip, hasn't created their account yet
  calendarTokens?: Record<string, string>; // trip id → the secret in your private calendar link for it
}

/** A signed-in device. Only a hash of its secret is stored. */
export interface SessionRecord {
  id: string; // sha256 of the cookie's secret
  userId: string;
  device: string; // e.g. "iPhone · Safari"
  createdAt: string;
  lastSeenAt: string;
}

/** A one-time sign-in link (an invite to a trip, or signing in another device). Only a hash is stored. */
export interface InviteRecord {
  id: string; // sha256 of the link's secret
  purpose: "invite" | "device" | "owner" | "reset"; // join a trip · sign in another device · claim Estela · reset password
  userId: string; // invite: the invited person's placeholder; otherwise the account it's for
  tripId?: string; // invite: the trip to join
  createdAt: string;
  expiresAt: string;
}

/** A device that asked for notifications (a browser push subscription). */
export interface PushRecord {
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  device: string;
  createdAt: string;
}

// A tiny JSON-file store. Swap for Postgres/SQLite when you need multi-user.
export interface Data {
  trips: Trip[];
  items: ItineraryItem[];
  inboxes: InboxRecord[];
  attachments: AttachmentRecord[];
  lists: TripList[];
  users: UserRecord[];
  sessions: SessionRecord[];
  invites: InviteRecord[];
  pushSubs: PushRecord[];
  remindersSent: string[]; // "tripId|itemId|at", so each reminder goes out once
}

const DB_PATH = resolve(process.env.DB_PATH ?? "data/db.json");

function load(): Data {
  try {
    return { ...EMPTY(), ...(JSON.parse(readFileSync(DB_PATH, "utf8")) as Partial<Data>) };
  } catch {
    return EMPTY();
  }
}

// With Supabase set up (SUPABASE_URL and SUPABASE_SECRET_KEY in .env), the data lives there; else in data/db.json.
const useSupabase = supabaseConfigured();
const EMPTY = (): Data => ({ trips: [], items: [], inboxes: [], attachments: [], lists: [], users: [], sessions: [], invites: [], pushSubs: [], remindersSent: [] });

export const db: Data = useSupabase ? ((await loadStore(EMPTY() as never)) as unknown as Data) : load();
export const DATA_DIR = dirname(DB_PATH); // caches (weather, routes…) stay on this computer either way
if (useSupabase) console.log(`Data: Supabase (${new URL(process.env.SUPABASE_URL!).host})`);

/** Waits for changes still on their way to Supabase (before the server stops). */
export const flushSaves = () => (useSupabase ? flushNow(db as never) : Promise.resolve());

export function save() {
  if (useSupabase) return scheduleWrite(db as never);
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_PATH);
}

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function itemStart(item: ItineraryItem): string {
  switch (item.kind) {
    case "flight":
      return item.live?.departureTime ?? item.departureTime;
    case "stay":
      return item.checkIn;
    case "activity":
      return item.start;
  }
}
