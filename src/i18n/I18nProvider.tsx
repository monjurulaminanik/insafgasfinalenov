import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { bn, type BnMessages, type MessageKey } from "./bn";
import { en } from "./en";
import type { Locale } from "./types";

const STORAGE_KEY = "insaf-locale";
const catalogs: Record<Locale, BnMessages> = { bn: bn as BnMessages, en };

type Vars = Record<string, string | number>;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "bn";
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "en" || raw === "bn" ? raw : "bn";
}

function interpolate(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("bn");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLocaleState(readStoredLocale());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.lang = locale === "bn" ? "bn" : "en";
    localStorage.setItem(STORAGE_KEY, locale);
  }, [locale, ready]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Vars) => {
      const dict = catalogs[locale] ?? (bn as BnMessages);
      const value = dict[key] ?? (bn as BnMessages)[key] ?? String(key);
      return interpolate(value, vars);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function fallbackT(key: MessageKey, vars?: Vars) {
  const value = (en as BnMessages)[key] ?? (bn as BnMessages)[key] ?? String(key);
  return interpolate(value, vars);
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  return (
    ctx ?? {
      locale: "bn" as Locale,
      setLocale: () => {},
      t: fallbackT,
    }
  );
}

export function useT() {
  return useI18n().t;
}
