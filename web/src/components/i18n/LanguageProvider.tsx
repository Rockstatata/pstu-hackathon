"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LOCALE_STORAGE_KEY,
  intlLocale,
  readStoredLocale,
  translate,
  type Locale,
  type MessageVariables,
} from "@/lib/i18n/locale";

interface LanguageValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (message: string, variables?: MessageVariables) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | string, options?: Intl.DateTimeFormatOptions) => string;
}

const LanguageContext = createContext<LanguageValue | null>(null);

function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.classList.toggle("lang-bn", locale === "bn");
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const stored = readStoredLocale();
    const next = stored ?? (navigator.language.toLowerCase().startsWith("bn") ? "bn" : "en");
    queueMicrotask(() => setLocaleState(next));
    applyLocale(next);
  }, []);

  function setLocale(locale: Locale) {
    setLocaleState(locale);
    applyLocale(locale);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
  }

  const value = useMemo<LanguageValue>(() => ({
    locale,
    setLocale,
    t: (message, variables) => translate(locale, message, variables),
    formatNumber: (number, options) => new Intl.NumberFormat(intlLocale(locale), options).format(number),
    formatDate: (input, options) => new Intl.DateTimeFormat(intlLocale(locale), {
      timeZone: "Asia/Dhaka",
      ...options,
    }).format(typeof input === "string" ? new Date(input) : input),
  }), [locale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useI18n must be used inside LanguageProvider");
  return value;
}
