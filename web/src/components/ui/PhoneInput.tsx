"use client";

import { Field } from "@/components/ui/Field";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { normalizeLocalizedDigits } from "@/lib/i18n/locale";

interface Props {
  value: string;
  onChange: (phone: string) => void;
  error?: string | null;
  label?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function PhoneInput({ value, onChange, error, label = "Phone number", disabled, autoFocus }: Props) {
  const { t } = useI18n();
  return (
    <Field
      label={t(label)}
      value={value}
      onChange={(event) => onChange(normalizeLocalizedDigits(event.target.value).replace(/\D/g, "").slice(0, 11))}
      error={error}
      disabled={disabled}
      autoFocus={autoFocus}
      inputMode="tel"
      autoComplete="tel"
      placeholder="01712345678"
      hint={t("Use an 11-digit Bangladeshi mobile number.")}
    />
  );
}
