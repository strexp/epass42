import { computed } from 'vue'
import type { Realm } from '@epass42/shared'
import { useAuthStore } from '~/stores/auth'

/**
 * Per-realm authentication access: the reactive state plus a one-shot loader
 * used by page `onMounted` hooks.
 */
export function useRealm(realm: Realm) {
  const auth = useAuthStore()
  const state = computed(() => auth.realms[realm])

  async function ensureLoaded(): Promise<void> {
    if (!auth.realms[realm].loaded) await auth.fetchMe(realm)
  }

  return { auth, state, ensureLoaded }
}
