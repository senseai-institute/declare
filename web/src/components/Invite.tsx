import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Button } from './ui';

export function Invite({ code, label }: { code: string; label: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/join/${code}`;

  useEffect(() => {
    if (showQr && !qr) QRCode.toDataURL(url, { width: 480, margin: 1 }).then(setQr);
  }, [showQr, qr, url]);

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${label} on Declare`, text: `Join "${label}" with code ${code}`, url });
        return;
      } catch {
        /* cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard refused (some in-app browsers): show the link so it can be copied by hand.
      window.prompt?.('Copy this link', url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (import.meta.env.VITE_DEMO) {
    return (
      <p className="text-sm text-white/60">
        In the real app, people join with code <span className="font-mono font-bold text-gold-300">{code}</span> or a QR code on
        their own phone. This demo runs only in your browser, so everyone else is played by the computer.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-white/50">Join code</div>
          <div className="font-mono text-3xl font-bold tracking-[0.2em] text-gold-300">{code}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowQr((s) => !s)} aria-label="Show QR code">
            QR
          </Button>
          <Button variant="secondary" onClick={share}>
            {copied ? 'Copied!' : 'Share'}
          </Button>
        </div>
      </div>
      {showQr && (
        <div className="flex justify-center rounded-xl bg-white p-3">
          {qr ? <img src={qr} alt={`QR code to join ${label}`} className="h-56 w-56" /> : <div className="h-56 w-56" />}
        </div>
      )}
    </div>
  );
}
