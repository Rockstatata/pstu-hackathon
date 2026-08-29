import { bnMessages } from "./messages";

export type Locale = "en" | "bn";
export type MessageVariables = Record<string, string | number>;

export const LOCALE_STORAGE_KEY = "chorui.locale";

export function translate(locale: Locale, message: string, variables?: MessageVariables): string {
  const template = locale === "bn" ? bnMessages[message] ?? message : message;
  if (!variables) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    variables[key] === undefined ? match : String(variables[key]),
  );
}

export function readClientLocale(): Locale {
  if (typeof document !== "undefined" && document.documentElement.lang === "bn") return "bn";
  if (typeof window === "undefined") return "en";
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY) === "bn" ? "bn" : "en";
  } catch {
    return "en";
  }
}

export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === "en" || stored === "bn" ? stored : null;
  } catch {
    return null;
  }
}

export function intlLocale(locale: Locale): "en-BD" | "bn-BD" {
  return locale === "bn" ? "bn-BD" : "en-BD";
}

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

export function normalizeLocalizedDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => String(BANGLA_DIGITS.indexOf(digit)));
}

export function localizeDigits(value: string, locale: Locale): string {
  if (locale === "en") return value;
  return value.replace(/\d/g, (digit) => BANGLA_DIGITS[Number(digit)]);
}
