import { toValue, type MaybeRefOrGetter } from 'vue'

/**
 * Sets the per-route document title.  Nuxt applies the `titleTemplate` from
 * `nuxt.config.ts`, so pass only the page name and it becomes e.g.
 * "Directory · ePass 42".
 */
export function usePageTitle(title: MaybeRefOrGetter<string>): void {
  useHead({ title: () => toValue(title) })
}
