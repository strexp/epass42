// I18n messages, split by module under `locales/{en,zh}`.  All UI copy is
// referenced through these keys (never hard-coded).
import enCsca from './locales/en/csca'
import enCommon from './locales/en/common'
import enCvca from './locales/en/cvca'
import enDsc from './locales/en/dsc'
import enHelp from './locales/en/help'
import enMisc from './locales/en/misc'
import enPkd from './locales/en/pkd'
import zhCsca from './locales/zh/csca'
import zhCommon from './locales/zh/common'
import zhCvca from './locales/zh/cvca'
import zhDsc from './locales/zh/dsc'
import zhHelp from './locales/zh/help'
import zhMisc from './locales/zh/misc'
import zhPkd from './locales/zh/pkd'

export default defineI18nConfig(() => ({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: {
    en: {
      ...enCommon,
      csca: enCsca,
      cvca: enCvca,
      dsc: enDsc,
      pkd: enPkd,
      help: enHelp,
      ...enMisc,
    },
    zh: {
      ...zhCommon,
      csca: zhCsca,
      cvca: zhCvca,
      dsc: zhDsc,
      pkd: zhPkd,
      help: zhHelp,
      ...zhMisc,
    },
  },
}))
