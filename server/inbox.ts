import { randomBytes } from "node:crypto";
import type { InboxEmail, TripInbox } from "../shared/types.ts";
import { storeAttachment } from "./attachmentStore.ts";
import { attachmentsText, relevantAttachments, type Attachment } from "./attachments.ts";
import { db, now, save, type InboxRecord } from "./db.ts";
import { parseEmail } from "./emailParser.ts";
import { upsertFromEmail } from "./items.ts";

/**
 * Each trip can have its own forwarding address. Two modes:
 *  - "domain": set INBOUND_EMAIL_DOMAIN to a domain whose inbound mail is posted to /api/inbound-email
 *    (Postmark, Mailgun, SendGrid, Cloudflare Email Workers). Addresses look like trip-<token>@<domain>.
 *  - "mailtm" (default, zero setup): a temporary mailbox on mail.tm that this server polls.
 *    Good for development and personal use; mail.tm is a public disposable-mail service.
 */
const DOMAIN = process.env.INBOUND_EMAIL_DOMAIN;
const POLL_SECONDS = Number(process.env.INBOX_POLL_SECONDS ?? 20);
const MAX_LOG = 50;

const randomId = (bytes: number) => randomBytes(bytes).toString("base64url").replace(/[-_]/g, "").toLowerCase();

export function inboxView(r: InboxRecord): TripInbox {
  return {
    address: r.address,
    provider: r.provider,
    createdAt: r.createdAt,
    lastCheckedAt: r.lastCheckedAt,
    pollSeconds: POLL_SECONDS,
    emails: r.emails.map((e) => ({ ...e, canReimport: !!r.bodies?.[e.id] || r.provider === "mailtm" })),
  };
}

export const getInbox = (tripId: string) => db.inboxes.find((i) => i.tripId === tripId);

// ---------- mail.tm client ----------

const MAILTM = process.env.MAILTM_API_URL ?? "https://api.mail.tm";
const tokens = new Map<string, string>(); // address -> bearer token (in memory)

async function mailtm<T>(path: string, init: RequestInit & { auth?: InboxRecord } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (init.auth) headers.Authorization = `Bearer ${await mailtmToken(init.auth)}`;
  const res = await fetch(`${MAILTM}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  if (res.status === 401 && init.auth) tokens.delete(init.auth.address);
  if (!res.ok) throw new Error(`mail.tm ${init.method ?? "GET"} ${path}: ${res.status} ${await res.text().catch(() => "")}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// mail.tm returns either a plain array or a Hydra collection depending on Accept negotiation.
const members = <T>(body: T[] | { "hydra:member"?: T[] }) => (Array.isArray(body) ? body : body["hydra:member"] ?? []);

async function mailtmToken(r: InboxRecord) {
  const cached = tokens.get(r.address);
  if (cached) return cached;
  const { token } = await mailtm<{ token: string }>("/token", {
    method: "POST",
    body: JSON.stringify({ address: r.address, password: r.mailtm!.password }),
  });
  tokens.set(r.address, token);
  return token;
}

async function createMailtmInbox(tripId: string): Promise<InboxRecord> {
  const domains = members(await mailtm<{ domain: string; isActive: boolean }[]>("/domains"));
  const domain = domains.find((d) => d.isActive)?.domain;
  if (!domain) throw new Error("mail.tm has no active domains right now");
  const address = `trip-${randomId(6)}@${domain}`;
  const password = randomId(18);
  const account = await mailtm<{ id: string }>("/accounts", { method: "POST", body: JSON.stringify({ address, password }) });
  return {
    tripId,
    provider: "mailtm",
    address,
    token: randomId(8),
    mailtm: { accountId: account.id, password },
    createdAt: now(),
    processedIds: [],
    emails: [],
  };
}

interface MailtmSummary { id: string; subject?: string; from?: { address?: string; name?: string }; createdAt: string }
interface MailtmMessage extends MailtmSummary {
  text?: string;
  html?: string[] | string;
  attachments?: { id: string; filename: string; contentType: string; downloadUrl: string }[];
}

// ---------- lifecycle ----------

export async function createInbox(tripId: string): Promise<InboxRecord> {
  await deleteInbox(tripId);
  const record: InboxRecord = DOMAIN
    ? { tripId, provider: "domain", address: "", token: randomId(8), createdAt: now(), processedIds: [], emails: [] }
    : await createMailtmInbox(tripId);
  if (record.provider === "domain") record.address = `trip-${record.token}@${DOMAIN}`;
  db.inboxes.push(record);
  save();
  return record;
}

export async function deleteInbox(tripId: string) {
  const existing = getInbox(tripId);
  if (!existing) return;
  db.inboxes = db.inboxes.filter((i) => i !== existing);
  save();
  if (existing.mailtm) {
    tokens.delete(existing.address);
    await mailtm(`/accounts/${existing.mailtm.accountId}`, { method: "DELETE", auth: existing }).catch((e) =>
      console.warn("Could not delete mail.tm account:", (e as Error).message),
    );
  }
}

// ---------- processing ----------

/** Parses one received email and loads its bookings into the inbox's trip. */
export interface IncomingEmail {
  id: string;
  from?: string;
  subject: string;
  body: string; // text (or HTML) of the email, plus the text of any PDF attachments
  receivedAt?: string;
  files?: Attachment[]; // tickets/vouchers to keep with the bookings
}

export async function processEmail(inbox: InboxRecord, msg: IncomingEmail): Promise<InboxEmail> {
  const trip = db.trips.find((t) => t.id === inbox.tripId);
  const entry: InboxEmail = {
    id: msg.id,
    from: msg.from,
    subject: msg.subject || "(no subject)",
    receivedAt: msg.receivedAt ?? now(),
    status: "no_bookings",
    added: 0,
    updated: 0,
    preview: msg.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240),
  };
  try {
    const result = await parseEmail(`Subject: ${msg.subject}\nFrom: ${msg.from ?? ""}\n\n${msg.body}`, trip);
    if (result.items.length > 0) {
      const stored = (msg.files ?? []).flatMap((f) => {
        try {
          return [storeAttachment(f, msg.id)];
        } catch {
          return [];
        }
      });
      const { added, updated } = await upsertFromEmail(inbox.tripId, result.items, msg.id, stored);
      Object.assign(entry, { status: "imported", added, updated });
    }
  } catch (err) {
    Object.assign(entry, { status: "error", error: (err as Error).message });
  }
  if (!inbox.processedIds.includes(msg.id)) inbox.processedIds.push(msg.id);
  const previous = inbox.emails.findIndex((e) => e.id === msg.id);
  if (previous >= 0) inbox.emails[previous] = entry; // re-import replaces its log entry
  else inbox.emails = [entry, ...inbox.emails].slice(0, MAX_LOG);
  inbox.bodies = { ...inbox.bodies, [msg.id]: msg.body };
  for (const id of Object.keys(inbox.bodies)) if (!inbox.emails.some((e) => e.id === id)) delete inbox.bodies[id];
  save();
  return entry;
}

async function fetchMailtmMessage(inbox: InboxRecord, id: string): Promise<IncomingEmail> {
  const m = await mailtm<MailtmMessage>(`/messages/${id}`, { auth: inbox });
  const html = Array.isArray(m.html) ? m.html.join("\n") : m.html;
  // Itineraries and tickets are often attachments: keep them, and read the text of PDFs.
  const downloaded = await Promise.all(
    (m.attachments ?? []).map(async (a) => {
      const res = await fetch(`${MAILTM}${a.downloadUrl}`, { headers: { Authorization: `Bearer ${await mailtmToken(inbox)}` } });
      return res.ok ? { filename: a.filename, contentType: a.contentType, data: new Uint8Array(await res.arrayBuffer()) } : undefined;
    }),
  );
  const files = relevantAttachments(downloaded.filter((d) => d !== undefined));
  // Plain text loses strike-through, which is how "rescheduled" emails mark the old time, so use the HTML then.
  const struck = !!html && /line-through|<(?:s|del|strike)\b/i.test(html);
  const body = (struck || !m.text?.trim() ? html ?? "" : m.text) + (await attachmentsText(files));
  return { id: m.id, from: m.from?.address, subject: m.subject ?? "", body, receivedAt: m.createdAt, files };
}

/** Parse an already-received email again (e.g. after correcting the parser) and update the trip. */
export async function reimportEmail(inbox: InboxRecord, emailId: string): Promise<InboxEmail> {
  const logged = inbox.emails.find((e) => e.id === emailId);
  if (!logged) throw new Error("Email not found");
  // Prefer a fresh copy from mail.tm (it includes attachments); fall back to the stored body.
  const fresh = inbox.provider === "mailtm" ? await fetchMailtmMessage(inbox, emailId).catch(() => undefined) : undefined;
  const body = inbox.bodies?.[emailId];
  const msg = fresh ?? (body !== undefined ? { id: emailId, from: logged.from, subject: logged.subject, body, receivedAt: logged.receivedAt } : undefined);
  if (!msg) throw new Error("The original email is no longer available — forward it again.");
  return processEmail(inbox, msg);
}

const checking = new Set<string>();

/** Fetch and import any new messages in a mail.tm inbox. Domain inboxes are push-based (webhook). */
export async function checkInbox(inbox: InboxRecord): Promise<InboxEmail[]> {
  if (inbox.provider !== "mailtm" || checking.has(inbox.tripId)) return [];
  checking.add(inbox.tripId);
  try {
    const list = members(await mailtm<MailtmSummary[]>("/messages?page=1", { auth: inbox }));
    const fresh = list.filter((m) => !inbox.processedIds.includes(m.id)).reverse(); // oldest first
    const results: InboxEmail[] = [];
    for (const summary of fresh) results.push(await processEmail(inbox, await fetchMailtmMessage(inbox, summary.id)));
    inbox.lastCheckedAt = now();
    save();
    return results;
  } finally {
    checking.delete(inbox.tripId);
  }
}

/** Poll mail.tm inboxes for trips that haven't ended more than a week ago. */
export function startInboxPoller() {
  const tick = async () => {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10);
    for (const inbox of db.inboxes) {
      const trip = db.trips.find((t) => t.id === inbox.tripId);
      if (!trip || trip.endDate < cutoff) continue;
      await checkInbox(inbox).catch((e) => console.warn(`Inbox check failed for ${inbox.address}:`, (e as Error).message));
    }
  };
  setInterval(tick, POLL_SECONDS * 1000);
  console.log(`Trip inboxes: ${DOMAIN ? `custom domain @${DOMAIN} (webhook)` : `mail.tm, polling every ${POLL_SECONDS}s`}`);
}

/** For the inbound webhook: find the trip inbox an email was addressed to. */
export function inboxForRecipients(recipients: string): InboxRecord | undefined {
  for (const m of recipients.matchAll(/trip-([a-z0-9]+)@/gi)) {
    const found = db.inboxes.find((i) => i.token === m[1].toLowerCase() || i.address.toLowerCase().startsWith(`trip-${m[1].toLowerCase()}@`));
    if (found) return found;
  }
}
