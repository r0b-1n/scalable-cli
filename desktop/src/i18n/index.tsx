import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { de, en, type Translations } from "./translations";

export { enumLabel, prettifyEnum } from "./translations";
export type { Translations } from "./translations";

export type Language = "de" | "en";

const STORAGE_KEY = "sc-desktop-lang";

const dictionaries: Record<Language, Translations> = { de, en };
// "en-US" instead of "en-DE": WebKitGTK's ICU data for en-DE is patchy and
// mixes German and English number symbols; currency stays EUR either way.
const intlLocales: Record<Language, string> = { de: "de-DE", en: "en-US" };

function readStoredLanguage(): Language | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "de" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

export function hasStoredLanguage(): boolean {
  return readStoredLanguage() !== null;
}

// Profile locales arrive as "de-DE", "en_DE", … — normalize both separators.
export function normalizeLocale(
  locale: string | null | undefined
): Language | null {
  if (!locale) return null;
  return locale.replace("_", "-").toLowerCase().startsWith("de") ? "de" : "en";
}

function detectLanguage(): Language {
  const stored = readStoredLanguage();
  if (stored) return stored;
  const nav = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return nav.toLowerCase().startsWith("de") ? "de" : "en";
}

// lib/format.ts reads this synchronously; the provider keeps it in step with
// the context so Intl formatting always matches the visible language.
let currentIntlLocale = intlLocales[detectLanguage()];

export function getIntlLocale(): string {
  return currentIntlLocale;
}

interface I18nContextValue {
  lang: Language;
  t: Translations;
  setLang: (lang: Language, opts?: { persist?: boolean }) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(detectLanguage);

  useEffect(() => {
    currentIntlLocale = intlLocales[lang];
    document.documentElement.lang = lang;
  }, [lang]);

  // persist defaults to true (a user-initiated switch); the profile-derived
  // initial pick passes false so it never overrides an explicit choice.
  const setLang = useCallback(
    (next: Language, opts?: { persist?: boolean }) => {
      if (opts?.persist !== false) {
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {}
      }
      currentIntlLocale = intlLocales[next];
      setLangState(next);
    },
    []
  );

  return (
    <I18nContext.Provider value={{ lang, t: dictionaries[lang], setLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within LanguageProvider");
  return ctx;
}
