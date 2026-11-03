import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import webpush from "web-push";
import type { PrepItem, Trip } from "../shared/types.ts";
import { DATA_DIR, db, now, save } from "./db.ts";

// Push notifications (reminders like "Check-MIG is open"). Each device that turns reminders on gets a browser push
// subscription; the server sends through the browser's push service (Apple, Google, Mozilla) using its own VAPID
// keys, generated once and kept in data/push-keys.json. On iPhone this works for the Home Screen app (iOS 16.4+).

const KEYS_PATH = join(DATA_DIR, "push-keys.json");
let keys: { publicKey: string; privateKey: string } | undefined;

function vapid() {
  if (keys) return keys;
  keys = existsSync(KEYS_PATH) ? JSON.parse(readFileSync(KEYS_PATH, "utf8")) : webpush.generateVAPIDKeys();
  if (!existsSync(KEYS_PATH)) writeFileSync(KEYS_PATH, JSON.stringify(keys), { mode: 0o600 });
  return keys!;
}
export const pushPublicKey = () => vapid().publicKey;

/**
 * Push services want a way to contact the sender: an https address or an email. Apple rejects made-up ones (such as
 * …@localhost), so use VAPID_SUBJECT, the public https address, or the owner's email.
 */
function sender() {
  const owner = db.users.find((u) => u.isAdmin && u.email)?.email;
  const url = process.env.PUBLIC_URL?.startsWith("https://") ? process.env.PUBLIC_URL : undefined;
  return process.env.VAPID_SUBJECT || url || (owner ? `mailto:${owner}` : "mailto:hello@heyjoy.app");
}

export function subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, device: string) {
  db.pushSubs = db.pushSubs.filter((s) => s.endpoint !== sub.endpoint);
  db.pushSubs.push({ userId, endpoint: sub.endpoint, keys: sub.keys, device, createdAt: now() });
  save();
}

export function unsubscribe(userId: string, endpoint: string) {
  db.pushSubs = db.pushSubs.filter((s) => !(s.userId === userId && s.endpoint === endpoint));
  save();
}

/** Sends to every device the person turned reminders on for. Returns how many devices got it. */
export async function notifyUser(userId: string, payload: { title: string; body: string; url: string; tag?: string }) {
  const { publicKey, privateKey } = vapid();
  const vapidDetails = { subject: sender(), publicKey, privateKey };
  let sent = 0;
  for (const sub of db.pushSubs.filter((s) => s.userId === userId)) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { TTL: 6 * 3600, vapidDetails });
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // Gone: the device turned notifications off or the app was removed.
      if (status === 404 || status === 410) {
        db.pushSubs = db.pushSubs.filter((s) => s !== sub);
        save();
      } else console.warn("Push failed:", status ?? (err as Error).message);
    }
  }
  return sent;
}

const LATE_HOURS = 6; // a reminder missed while the Mac was asleep still goes out within this long

/**
 * Every minute: reminders that are due (and not yet sent, and whose checklist item isn't ticked) go to everyone on
 * the trip who turned reminders on.
 */
export function startReminderLoop(checklistFor: (trip: Trip) => Promise<PrepItem[]>) {
  const tick = async () => {
    const nowMs = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    for (const trip of db.trips.filter((t) => t.endDate >= today)) {
      const people = [trip.ownerId, ...(trip.members ?? []).map((m) => m.userId)].filter((id): id is string => !!id);
      if (!db.pushSubs.some((s) => people.includes(s.userId))) continue;
      const items = await checklistFor(trip).catch(() => []);
      const checked = new Set(trip.prep?.checked ?? []);
      for (const item of items) {
        if (checked.has(item.id)) continue;
        for (const r of item.reminders ?? []) {
          const at = Date.parse(r.at);
          const key = `${trip.id}|${item.id}|${r.at}`;
          if (at > nowMs || at < nowMs - LATE_HOURS * 3600_000 || db.remindersSent.includes(key)) continue;
          db.remindersSent.push(key);
          save();
          for (const userId of people) {
            await notifyUser(userId, { title: `Hey Joy · ${trip.name}`, body: r.label, url: `/#/trip/${trip.id}/prepare`, tag: key });
          }
        }
      }
    }
    // Forget sent reminders for trips that ended a month ago.
    db.remindersSent = db.remindersSent.filter((k) => db.trips.some((t) => k.startsWith(`${t.id}|`) && t.endDate >= new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)));
  };
  setInterval(() => tick().catch((e) => console.warn("Reminders failed:", (e as Error).message)), 60_000);
  setTimeout(() => tick().catch(() => {}), 10_000);
}
