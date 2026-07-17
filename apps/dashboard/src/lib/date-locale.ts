import type { Locale } from 'date-fns';
import { de, enUS, ptBR } from 'date-fns/locale';

const DATE_LOCALES: Record<string, Locale> = {
  de,
  en: enUS,
  ptBR: ptBR,
};

export function getDateLocale(language?: string): Locale {
  return DATE_LOCALES[language?.split('-')[0] ?? 'en'] ?? enUS;
}
