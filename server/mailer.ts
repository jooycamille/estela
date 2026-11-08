// Sending email (password resets). Uses Resend (resend.com) when RESEND_API_KEY and MAIL_FROM are set, e.g.
// MAIL_FROM="Estela <hello@yourdomain.com>" with that domain verified in Resend. Without them (running on your own
// Mac), the email is printed in the server's Terminal instead, so you can still use the link.

export async function sendEmail(to: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) {
    console.log(`\n  ✉️  Email to ${to} (no email service set up, so it's shown here):\n  ${subject}\n\n${text.replace(/^/gm, "  ")}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Email service error ${res.status}`);
}

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
