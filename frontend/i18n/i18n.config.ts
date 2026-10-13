// I18n messages, split by module under `locales/{en,zh}`.  All UI copy is
// referenced through these keys (never hard-coded).
//
// Copy style guide (keep `en` and `zh` in step; apply to every new key)
// ---------------------------------------------------------------------
// Language
//   - English is US English: -ize/-ization, not -ise/-isation (organization,
//     authorization, personalization, recognize).
//   - Chinese is Simplified, with full-width punctuation （）。 ：、；「」 and a
//     single space between CJK and Latin/digits, e.g. "上传 CSR 或公钥".
// Voice
//   - Address the reader as "you" (zh: 您).  Do not assume the reader is an
//     organization: never write "贵机构"; use "您的机构" only when the subject
//     really is an organization, otherwise "您".
//   - Sentence case for labels, buttons and titles; keep acronyms and proper
//     nouns uppercase (ePass 42, CSCA, CVCA, DV, DSC, PKD, LDS1/LDS2, DG3/DG4,
//     EF.SOD, MRZ, NIA, ICAO, dn42, MNT).
//   - Short labels and buttons take no trailing period; full sentences do.
//   - Prefer no serial (Oxford) comma in English lists.
// Content
//   - Say what the user must do, not what the system does internally.
//   - For irreversible actions, state the consequence, not just the action.
//   - Errors say what happened and what to do next; never blame the user.
//   - `en` and `zh` must be semantically equal and of the same register and
//     roughly the same length; never leave one side machine-translated.
// Timestamps
//   - Rendered by `app/utils/datetime.ts` in the selected locale and always in
//     UTC, so a value never shifts by a day between viewers (en "Oct 13, 2026",
//     zh "2026年10月13日"; with time, en "Oct 13, 2026, 7:47 AM").
// Status values are a closed set under `status`; a new backend status needs a
// label+description here before it may be shown.
//
// ---------------------------------------------------------------------
// Glossary (use these exact renderings)
// ---------------------------------------------------------------------
// realm                    业务            (e.g. 证书业务)
// maintainer               维护者          (a dn42 maintainer object)
// organization (X.509 O)   组织（O）        (the subject attribute only)
// organization (actor)     机构            (a company or agency as an actor)
// signing certificate      签名证书        (the certificate)
// to sign                  签署 / 签名      (the act of signing)
// issuance / to issue      签发            (issuing a certificate)
// review                   审核            (an administrator's decision)
// review (before submit)   复核
// reject                   驳回
// revoke                   吊销
// claim (one-time)         领取
// deliver                  交付
// personalization file     个性化文件       (fixed term; keep verbatim)
// Document Signer          文档签名证书     (certificate) / 文档签名者 (role)
// Document Verifier        文档验证者
// terminal certificate     终端证书
// inspection system        检查系统
import enCsca from './locales/en/csca'
import enCommon from './locales/en/common'
import enCvca from './locales/en/cvca'
import enDsc from './locales/en/dsc'
import enDv from './locales/en/dv'
import enHelp from './locales/en/help'
import enMisc from './locales/en/misc'
import enPkd from './locales/en/pkd'
import zhCsca from './locales/zh/csca'
import zhCommon from './locales/zh/common'
import zhCvca from './locales/zh/cvca'
import zhDsc from './locales/zh/dsc'
import zhDv from './locales/zh/dv'
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
      dv: enDv,
      dsc: enDsc,
      pkd: enPkd,
      help: enHelp,
      ...enMisc,
    },
    zh: {
      ...zhCommon,
      csca: zhCsca,
      cvca: zhCvca,
      dv: zhDv,
      dsc: zhDsc,
      pkd: zhPkd,
      help: zhHelp,
      ...zhMisc,
    },
  },
}))
