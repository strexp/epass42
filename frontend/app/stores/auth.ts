import { defineStore } from 'pinia'
import type { Realm } from '@epass42/shared'

/** The `/auth/{realm}/me` payload. */
export interface Me {
  account: {
    id: number
    realm: Realm
    activeMnt: string | null
    email: string | null
    name: string | null
  }
  isAdmin: boolean
  /** DSC review scope: `nia`/`mnt` reviewers, otherwise `none`. */
  reviewScope: 'nia' | 'mnt' | 'none'
  csrf: string
  prefill: Record<string, unknown>
}

interface RealmState {
  me: Me | null
  loading: boolean
  loaded: boolean
}

/** Per-realm authentication state (the two realms never share a session). */
export const useAuthStore = defineStore('auth', () => {
  const realms = reactive<Record<Realm, RealmState>>({
    csca: { me: null, loading: false, loaded: false },
    cvca: { me: null, loading: false, loaded: false },
    dsc: { me: null, loading: false, loaded: false },
  })

  async function fetchMe(realm: Realm): Promise<Me | null> {
    const api = useApi()
    realms[realm].loading = true
    try {
      const me = await api<Me>(`/auth/${realm}/me`)
      realms[realm].me = me
      return me
    } catch {
      realms[realm].me = null
      return null
    } finally {
      realms[realm].loading = false
      realms[realm].loaded = true
    }
  }

  async function logout(realm: Realm): Promise<void> {
    const api = useApi()
    const me = realms[realm].me
    try {
      await api(`/auth/${realm}/logout`, {
        method: 'POST',
        headers: me?.csrf ? { 'x-csrf-token': me.csrf } : {},
      })
    } finally {
      realms[realm].me = null
    }
  }

  /** Redirects the browser to the realm login (full page navigation). */
  function login(realm: Realm, redirectTo?: string, provider?: number | string): void {
    const config = useRuntimeConfig()
    const base = (config.public.apiBase as string) || ''
    const params = new URLSearchParams()
    if (provider !== undefined) params.set('provider', String(provider))
    if (redirectTo) params.set('redirect_to', redirectTo)
    const query = params.toString()
    window.location.href = `${base}/auth/${realm}/login${query ? `?${query}` : ''}`
  }

  return { realms, fetchMe, logout, login }
})
