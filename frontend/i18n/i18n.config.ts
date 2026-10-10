// English-only i18n messages, split by module under `locales/en`.  All UI copy
// is referenced through these keys (never hard-coded).
import csca from './locales/en/csca'
import common from './locales/en/common'
import dsc from './locales/en/dsc'
import misc from './locales/en/misc'
import pkd from './locales/en/pkd'

export default defineI18nConfig(() => ({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: {
    en: {
      ...common,
      csca,
      dsc,
      pkd,
      ...misc,
    },
  },
}))
