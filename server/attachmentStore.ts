import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoredAttachment } from "../shared/types.ts";
import type { Attachment } from "./attachments.ts";
import { DATA_DIR, db, newId, now, save, type AttachmentRecord } from "./db.ts";

const DIR = join(DATA_DIR, "attachments");
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const publicView = ({ id, filename, contentType, size }: AttachmentRecord): StoredAttachment => ({ id, filename, contentType, size });

/** Save a file and return its reference. Re-importing the same email reuses the file instead of copying it again. */
export function storeAttachment(file: Attachment, emailId?: string, uploadedBy?: string): StoredAttachment {
  const existing = emailId && db.attachments.find((a) => a.emailId === emailId && a.filename === file.filename && a.size === file.data.byteLength);
  if (existing) return publicView(existing);
  if (file.data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`${file.filename} is larger than 15 MB`);
  const id = newId();
  const safeName = file.filename.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
  mkdirSync(join(DIR, id), { recursive: true });
  const path = join(DIR, id, safeName);
  writeFileSync(path, file.data);
  const record: AttachmentRecord = { id, filename: file.filename, contentType: file.contentType || "application/octet-stream", size: file.data.byteLength, path, emailId, uploadedBy, createdAt: now() };
  db.attachments.push(record);
  save();
  return publicView(record);
}

export const getAttachment = (id: string) => db.attachments.find((a) => a.id === id);

/** Remove files that were saved empty (an earlier bug), and their references, so the bookings can be re-imported cleanly. */
export function dropEmptyAttachments() {
  const empty = new Set(db.attachments.filter((a) => a.size === 0).map((a) => a.id));
  if (!empty.size) return 0;
  for (const item of db.items) {
    item.attachments = item.attachments?.filter((a) => !empty.has(a.id));
    if (!item.attachments?.length) delete item.attachments;
  }
  for (const id of empty) rmSync(join(DIR, id), { recursive: true, force: true });
  db.attachments = db.attachments.filter((a) => !empty.has(a.id));
  save();
  return empty.size;
}

/** Delete stored files no item refers to any more. */
export function pruneAttachments() {
  const used = new Set([
    ...db.items.flatMap((i) => i.attachments?.map((a) => a.id) ?? []),
    // Your own photos of places on your lists.
    ...db.lists.flatMap((l) => l.entries.map((e) => e.photo?.url.match(/^\/api\/attachments\/([\w-]+)$/)?.[1]).filter((id): id is string => !!id)),
  ]);
  const unused = db.attachments.filter((a) => !used.has(a.id) && !a.emailId);
  for (const a of unused) rmSync(join(DIR, a.id), { recursive: true, force: true });
  if (unused.length) {
    db.attachments = db.attachments.filter((a) => !unused.includes(a));
    save();
  }
}

/** Deletes one stored file, if nothing (a booking or a place's photo) uses it any more. */
export function removeIfUnused(id: string) {
  const url = `/api/attachments/${id}`;
  const used = db.items.some((i) => i.attachments?.some((a) => a.id === id)) || db.lists.some((l) => l.entries.some((e) => e.photo?.url === url));
  const record = db.attachments.find((a) => a.id === id);
  if (used || !record) return;
  rmSync(join(DIR, id), { recursive: true, force: true });
  db.attachments = db.attachments.filter((a) => a.id !== id);
  save();
}
