import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import de from './locales/de.json';
import ptBR from './locales/pt-BR.json';

/**
 * i18n foundation for the dashboard.
 *
 * - English (`en`) is the source of truth and the fallback language: any key
 *   missing from another locale renders the English string, so the UI stays
 *   fully functional while a translation is incomplete.
 * - Detection order: a user's saved choice (localStorage) wins, otherwise we
 *   fall back to the browser language, otherwise English.
 * - Resources are bundled inline (no async backend) so `t()` is ready
 *   synchronously — important for tests and first paint.
 *
 * Adding a language: create `src/locales/<code>.json` mirroring en.json's key
 * structure, import it here, and add it to `resources` + `supportedLngs`.
 * See docs/i18n.md.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
] as const;

// Include `pt` so navigator `pt-BR` resolves via nonExplicitSupportedLngs (not shown in switcher).
const SUPPORTED_LOCALES = [...SUPPORTED_LANGUAGES.map((l) => l.code), 'pt'] as const;

// Migrate legacy locale code saved before pt-BR was registered correctly.
if (typeof localStorage !== 'undefined' && localStorage.getItem('haip.lang') === 'ptBR') {
  localStorage.setItem('haip.lang', 'pt-BR');
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      pt: { translation: ptBR },
      'pt-BR': { translation: ptBR },
    },
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LOCALES],
    nonExplicitSupportedLngs: true, // treat de-DE, de-AT, etc. as `de`
    returnEmptyString: false, // empty "" values fall back to English, not blank
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'haip.lang',
    },
    react: { useSuspense: false },
  });

export default i18n;
