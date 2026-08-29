"use client";

import { ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { PinInput } from "@/components/money/PinInput";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/components/i18n/LanguageProvider";

interface Props {
  reason: string;
  onCancel: () => void;
  onVerify: (pin: string) => Promise<void> | void;
}

/** C3 is rendered over C2 only when a transfer needs another identity check. */
export function StepUpDialog({ reason, onCancel, onVerify }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const { t } = useI18n();

  async function submit() {
    if (pin.length !== 5) { setError(t("Enter your 5-digit PIN to continue.")); return; }
    setVerifying(true);
    setError(null);
    try {
      await onVerify(pin);
    } catch {
      setError(t("Your PIN could not be verified. Try again."));
      setPin("");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 p-5" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="step-up-title" className="sheet-enter w-full max-w-md rounded-xl bg-surface p-6 shadow-[var(--shadow-sheet)]">
        <div className="-mx-6 -mt-6 mb-6 rounded-t-xl bg-warning-surface px-6 py-5">
          <div className="flex items-start justify-between gap-4"><span className="flex size-10 items-center justify-center rounded-full bg-surface text-warning-text"><ShieldCheck aria-hidden className="size-5" /></span><button type="button" onClick={onCancel} disabled={verifying} className="inline-flex size-11 items-center justify-center rounded-md text-warning-text hover:bg-surface/60" aria-label={t("Cancel additional check")}><X aria-hidden className="size-5" /></button></div>
          <h2 id="step-up-title" className="mt-4 text-[22px] font-semibold leading-7 text-text">{t("One more check")}</h2>
          <p className="mt-1 text-[13px] leading-5 text-warning-text">{reason}</p>
        </div>
        <PinInput value={pin} onChange={setPin} label={t("Enter your 5-digit PIN")} error={error} autoFocus />
        <div className="mt-6 grid grid-cols-2 gap-3"><Button variant="ghost" onClick={onCancel} disabled={verifying}>{t("Cancel")}</Button><Button onClick={submit} loading={verifying}>{t("Continue")}</Button></div>
      </section>
    </div>
  );
}
