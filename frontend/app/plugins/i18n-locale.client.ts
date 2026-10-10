/**
 * Chooses the UI locale on the client: a stored preference wins, otherwise the
 * browser language decides, and every change is persisted to localStorage.
 */
const LANGS: Record<string, string> = { en: 'en', zh: 'zh-CN' }

export default defineNuxtPlugin((nuxtApp) => {
  const i18n = nuxtApp.$i18n as unknown as { locale?: { value: string } } | undefined
  const locale = i18n?.locale
  if (!locale) return

  const storageKey = 'epass42-locale'
  const supported = Object.keys(LANGS)
  const stored = window.localStorage.getItem(storageKey)
  const browser = navigator.language?.toLowerCase() ?? ''
  const detected = stored ?? (browser.startsWith('zh') ? 'zh' : 'en')
  const initial = supported.includes(detected) ? detected : 'en'

  if (locale.value !== initial) locale.value = initial

  const apply = (value: string): void => {
    window.localStorage.setItem(storageKey, value)
    document.documentElement.lang = LANGS[value] ?? 'en'
  }
  apply(locale.value)
  watch(
    () => locale.value,
    (value) => apply(value),
  )
})
