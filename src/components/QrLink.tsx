import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** A one-time sign-in link: a QR code to scan with a phone camera, plus Copy and Share (Messages, WhatsApp…). */
export default function QrLink({ url, title, note }: { url: string; title: string; note: string }) {
  const [qr, setQr] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#1E2140", light: "#FFFFFF" } }).then(setQr, () => setQr(undefined));
  }, [url]);

  return (
    <div className="qr-link">
      {qr && <img src={qr} width={180} height={180} alt={`QR code: ${title}`} />}
      <div className="qr-link-body">
        <b>{title}</b>
        <p className="muted small">{note}</p>
        <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Sign-in link" />
        <div className="actions left">
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await navigator.clipboard?.writeText(url).catch(() => undefined);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied ✓" : "Copy link"}
          </button>
          {"share" in navigator && (
            <button type="button" className="ghost" onClick={() => navigator.share({ title: "Estela", text: title, url }).catch(() => undefined)}>
              Share…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
