/**
 * Accessibility bridge for Naive UI and client-side navigation.
 *
 * Naive UI does not wire `NFormItem` labels to their controls, does not expose
 * validation errors to assistive technology, and does not mark its message /
 * notification containers as live regions.  This plugin fills those gaps in the
 * DOM (idempotently) and moves focus to the main landmark on navigation.
 *
 * It can be removed once Naive UI fixes the underlying behaviour upstream.
 */
let sequence = 0

/** Links each form label to its control and exposes validation state. */
function linkFormItems(): void {
  for (const item of document.querySelectorAll<HTMLElement>('.n-form-item')) {
    const label = item.querySelector<HTMLLabelElement>('.n-form-item-label')
    const control = item.querySelector<HTMLElement>(
      '.n-form-item-blank input, .n-form-item-blank textarea, .n-form-item-blank select',
    )
    if (!label || !control) continue

    if (!control.id) control.id = `epass42-field-${++sequence}`
    if (label.htmlFor !== control.id) label.htmlFor = control.id

    const feedback = item.querySelector<HTMLElement>('.n-form-item-feedback')
    if (!feedback) continue
    if (!feedback.id) feedback.id = `${control.id}-feedback`
    if (control.getAttribute('aria-describedby') !== feedback.id) {
      control.setAttribute('aria-describedby', feedback.id)
    }
    if (feedback.classList.contains('n-form-item-feedback--error')) {
      if (!feedback.hasAttribute('aria-live')) feedback.setAttribute('aria-live', 'polite')
      control.setAttribute('aria-invalid', 'true')
    } else {
      control.removeAttribute('aria-invalid')
    }
  }
}

/** Marks Naive's transient message/notification containers as live regions. */
function markLiveRegions(): void {
  for (const selector of ['.n-message-container', '.n-notification-container']) {
    const element = document.querySelector<HTMLElement>(selector)
    if (!element || element.dataset.epass42Live === '1') continue
    element.setAttribute('role', 'status')
    element.setAttribute('aria-live', 'polite')
    element.dataset.epass42Live = '1'
  }
}

/** Names dialogs/modals from their title (Naive renders the title as a div). */
function nameDialogs(): void {
  for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
    if (dialog.hasAttribute('aria-label') || dialog.hasAttribute('aria-labelledby')) continue
    const title = dialog.querySelector<HTMLElement>('.n-card-header__main, .n-dialog__title')
    if (!title) continue
    if (!title.id) title.id = `epass42-dialog-${++sequence}`
    dialog.setAttribute('aria-labelledby', title.id)
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const sync = (): void => {
    linkFormItems()
    markLiveRegions()
    nameDialogs()
  }
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true })
  sync()

  let initial = true
  nuxtApp.$router.afterEach(() => {
    if (initial) {
      initial = false
      return
    }
    window.setTimeout(() => document.getElementById('epass42-main')?.focus(), 0)
  })
})
