import { defineStore } from 'pinia'
import type { Realm } from '@pkd42/shared'

/** The `/auth/{realm}/me` payload. */
export interface Me {
  account: {
    id: number
    realm: Realm
    asn: number | null
    activeMnt: string | null
    email: string | null
    name: string | null
  }
  isAdmin: boolean
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
  function login(realm: Realm, redirectTo?: string): void {
    const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''
    window.location.href = `/auth/${realm}/login${query}`
  }

  return { realms, fetchMe, logout, login }
})
