import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { InboxEmail, ItineraryItem, StoredAttachment, Trip, TripList } from "../shared/types.ts";

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
  createdAt: string;
}

// A tiny JSON-file store. Swap for Postgres/SQLite when you need multi-user.
interface Data {
  trips: Trip[];
  items: ItineraryItem[];
  inboxes: InboxRecord[];
  attachments: AttachmentRecord[];
  lists: TripList[];
}

const DB_PATH = resolve(process.env.DB_PATH ?? "data/db.json");

function load(): Data {
  const empty: Data = { trips: [], items: [], inboxes: [], attachments: [], lists: [] };
  try {
    return { ...empty, ...(JSON.parse(readFileSync(DB_PATH, "utf8")) as Partial<Data>) };
  } catch {
    return empty;
  }
}

export const db: Data = load();
export const DATA_DIR = dirname(DB_PATH);

export function save() {
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
