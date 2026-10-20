import { extractText, getDocumentProxy } from "unpdf";

export interface Attachment {
  filename: string;
  contentType: string;
  data: Uint8Array;
}

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PDFS = 5;

/** Files worth keeping with a booking: tickets, vouchers, itineraries (PDF) and ticket images/QR codes. */
export function relevantAttachments(attachments: Attachment[]): Attachment[] {
  const keep = attachments.filter((a) => isPdf(a) || /^image\/(png|jpe?g|gif|webp)$/i.test(a.contentType) || /\.pkpass$/i.test(a.filename));
  // Tiny images are logos/tracking pixels, not tickets.
  const meaningful = keep.filter((a) => isPdf(a) || a.data.byteLength > 15_000);
  const likely = meaningful.filter((a) => /itinerar|ticket|booking|confirm|invoice|receipt|reservation|voucher|boarding|qr/i.test(a.filename));
  return likely.length ? likely : meaningful;
}

export const isPdf = (a: Pick<Attachment, "filename" | "contentType">) =>
  a.contentType === "application/pdf" || /\.pdf$/i.test(a.filename);

/** Text of a PDF, page by page. Returns "" for scanned/image-only or unreadable PDFs. */
export async function pdfToText(data: Uint8Array): Promise<string> {
  try {
    // pdf.js takes ownership of (detaches) the buffer it's given, so hand it a copy: the file is still stored afterwards.
    const pdf = await getDocumentProxy(data.slice());
    const { text } = await extractText(pdf, { mergePages: false });
    return text.join("\n");
  } catch (err) {
    console.warn("Could not read PDF:", (err as Error).message);
    return "";
  }
}

/**
 * Booking sites often put the itinerary only in an attached PDF (e.g. Webjet, Expedia, airline e-tickets).
 * Returns the readable text of PDF attachments, labelled, ready to append to the email body.
 */
export async function attachmentsText(attachments: Attachment[]): Promise<string> {
  const parts: string[] = [];
  // Itineraries/tickets first, so generic "important information" PDFs never crowd them out.
  const likely = (a: Attachment) => (/itinerar|ticket|booking|confirm|invoice|receipt|reservation|voucher/i.test(a.filename) ? 0 : 1);
  let pdfs = attachments.filter(isPdf).sort((a, b) => likely(a) - likely(b));
  // When there's clearly an itinerary/ticket, skip the rest (e.g. long "important information" PDFs) to keep imports fast.
  if (pdfs.some((a) => likely(a) === 0)) pdfs = pdfs.filter((a) => likely(a) === 0);
  for (const a of pdfs.slice(0, MAX_PDFS)) {
    if (a.data.byteLength > MAX_PDF_BYTES) continue;
    const text = (await pdfToText(a.data)).trim();
    if (text) parts.push(`\n\n=== Attachment: ${a.filename} ===\n${text}`);
  }
  return parts.join("");
}
