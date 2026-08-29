"use client";

import { Field } from "@/components/ui/Field";

interface Props {
  value: string;
  onChange: (phone: string) => void;
  error?: string | null;
  label?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function PhoneInput({ value, onChange, error, label = "Phone number", disabled, autoFocus }: Props) {
  return (
    <Field
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 11))}
      error={error}
      disabled={disabled}
      autoFocus={autoFocus}
      inputMode="tel"
      autoComplete="tel"
      placeholder="01712345678"
      hint="Use an 11-digit Bangladeshi mobile number."
    />
  );
}
