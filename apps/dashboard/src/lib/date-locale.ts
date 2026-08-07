import type { Locale } from 'date-fns';
import { de, enUS, es, fr, hr, it, ptBR, srLatn } from 'date-fns/locale';

const DATE_LOCALES: Record<string, Locale> = {
  de,
  en: enUS,
  es,
  fr,
  hr,
  it,
  pt: ptBR,
  sr: srLatn,
};

export function getDateLocale(language?: string): Locale {
  return DATE_LOCALES[language?.split('-')[0] ?? 'en'] ?? enUS;
}
