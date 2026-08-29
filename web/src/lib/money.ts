/**
 * Money is an integer count of poisha, everywhere, always. One taka is 100 poisha.
 * Taka exist only in what a human reads (CONTEXT.md).
 *
 * This module is the ONLY place taka strings are produced. No component calls
 * toFixed on money. No component does arithmetic on taka floats.
 */

import { localizeDigits, normalizeLocalizedDigits, type Locale } from "@/lib/i18n/locale";

const TAKA = "৳";

/** Poisha -> "৳2,500.00". The single formatter. */
export function formatTaka(poisha: number, opts?: { sign?: "+" | "-" | null; locale?: Locale }): string {
  const negative = poisha < 0;
  const abs = Math.abs(Math.trunc(poisha));
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;

  const locale = opts?.locale ?? "en";
  const grouped = whole.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD");
  const decimal = ".";
  const digits = localizeDigits(String(fraction).padStart(2, "0"), locale);
  const body = `${TAKA}${grouped}${decimal}${digits}`;

  if (opts?.sign === "+") return `+${body}`;
  if (opts?.sign === "-") return `−${body}`; // real minus sign, not a hyphen
  return negative ? `−${body}` : body;
}

/** Poisha -> "2,500.00", for input fields where the ৳ is rendered separately. */
export function formatTakaBare(poisha: number, locale: Locale = "en"): string {
  const abs = Math.abs(Math.trunc(poisha));
  const whole = Math.floor(abs / 100).toLocaleString(locale === "bn" ? "bn-BD" : "en-BD");
  return `${whole}.${localizeDigits(String(abs % 100).padStart(2, "0"), locale)}`;
}

/**
 * Typed taka -> poisha. Returns null for anything that is not a clean amount,
 * so callers must handle the invalid case rather than receive a silent NaN.
 * Parsing is a UX convenience; the backend re-validates every amount it is sent.
 */
export function parseTakaToPoisha(input: string): number | null {
  const cleaned = normalizeLocalizedDigits(input).replace(/[,\s৳]/g, "");
  if (cleaned === "") return null;
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned)) return null;

  const [whole, fraction = ""] = cleaned.split(".");
  const poisha = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  return Number.isSafeInteger(poisha) ? poisha : null;
}

/** `017•••••432` — used everywhere a phone number is shown. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 3)}•••••${digits.slice(-3)}`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
