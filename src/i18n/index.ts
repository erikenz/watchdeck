import i18next, { init, t as i18t, changeLanguage } from 'i18next';
import { languageResources } from 'virtual:i18n';

export const APPLICATION_NAME = 'Watchdeck';

export const loadI18n = async () =>
  await init({
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    lng: 'en',
    resources: await languageResources(),
  });

export const setLanguage = async (language: string) =>
  await changeLanguage(language);

export const t = i18t.bind(i18next);
