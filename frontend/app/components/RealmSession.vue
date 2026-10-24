<script setup lang="ts">
import { NAvatar, NButton, NCard, NDropdown, NIcon, NSpace, NTag, NText } from 'naive-ui'
import { ChevronDown, LogIn, LogOut, ShieldCheck, ShieldOff } from '@lucide/vue'
import { computed, onMounted } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { usePkdConfig } from '~/composables/usePkdConfig'
import type { Realm } from '@epass42/shared'

const props = defineProps<{ realm: Realm }>()
const auth = useAuthStore()
const route = useRoute()
const { t } = useI18n()
const { config, load } = usePkdConfig()

const me = computed(() => auth.realms[props.realm].me)
const adminMode = computed(() => auth.realms[props.realm].adminMode)
const label = computed(
  () =>
    ({
      csca: t('nav.csca'),
      cvca: t('nav.cvca'),
      dv: t('nav.dv'),
      dsc: t('nav.dsc'),
      ml: t('nav.ml'),
    })[props.realm],
)
const providers = computed(() => config.value?.oauthProviders[props.realm] ?? [])
/** The realm avatar colour. */
const avatarColor = computed(() => {
  if (!me.value) return '#767676'
  return { csca: '#2080f0', cvca: '#7c3aed', dv: '#0d9488', dsc: '#18a058', ml: '#d97706' }[
    props.realm
  ]
})
/** Login-method options when more than one provider is configured. */
const options = computed(() =>
  providers.value.map((provider) => ({ key: provider.id, label: provider.alias })),
)

onMounted(async () => {
  await load()
  if (!auth.realms[props.realm].loaded) void auth.fetchMe(props.realm)
})

function login(provider?: number): void {
  auth.login(props.realm, route.fullPath, provider)
}

function toggleAdminMode(): void {
  auth.toggleAdminMode(props.realm)
}

async function logout(): Promise<void> {
  await auth.logout(props.realm)
}
</script>

<template>
  <div class="realm-session">
    <NCard size="small" :bordered="false">
      <div class="realm-session-row">
        <div class="realm-session-info">
          <NAvatar round size="small" :style="{ background: avatarColor }">
            <NIcon><ShieldCheck v-if="me" /><ShieldOff v-else /></NIcon>
          </NAvatar>
          <NText strong class="realm-session-label">{{ label }}</NText>
          <NTag v-if="me" size="small" type="success">
            {{ $t('auth.signedInAs') }}
            {{ me.account.name ?? me.account.id }}
          </NTag>
          <NText v-else depth="3">{{ $t('auth.signInTo', { realm: label }) }}</NText>
          <NTag v-if="me?.account.activeMnt" size="small">{{ me.account.activeMnt }}</NTag>
          <NTag v-if="me?.isAdmin" size="small" type="info">{{ $t('auth.admin') }}</NTag>
        </div>

        <NDropdown
          v-if="!me && options.length > 1"
          trigger="click"
          :options="options"
          @select="(key) => login(Number(key))"
        >
          <NButton type="primary" size="small">
            <template #icon
              ><NIcon><LogIn /></NIcon
            ></template>
            {{ $t('common.login') }}
            <NIcon style="margin-left: 4px"><ChevronDown /></NIcon>
          </NButton>
        </NDropdown>
        <NButton v-else-if="!me" type="primary" size="small" @click="login()">
          <template #icon
            ><NIcon><LogIn /></NIcon
          ></template>
          {{ $t('common.login') }}
        </NButton>
        <NSpace v-else align="center" :size="8">
          <NButton
            v-if="me?.isAdmin"
            size="small"
            :type="adminMode ? 'primary' : 'default'"
            :aria-pressed="adminMode"
            @click="toggleAdminMode"
          >
            <template #icon
              ><NIcon><ShieldCheck v-if="adminMode" /><ShieldOff v-else /></NIcon
            ></template>
            {{ adminMode ? $t('auth.adminModeOn') : $t('auth.adminModeOff') }}
          </NButton>
          <NButton size="small" @click="logout">
            <template #icon
              ><NIcon><LogOut /></NIcon
            ></template>
            {{ $t('common.logout') }}
          </NButton>
        </NSpace>
      </div>
    </NCard>
  </div>
</template>

<style scoped>
/* The card must live in a padded box: Naive UI's `.n-card` is `width: 100%`, so
   horizontal margins on the card itself would make it wider than the viewport
   and push the sign-out button off-screen. */
.realm-session {
  padding: 12px 16px 0;
}
.realm-session-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px 12px;
}
.realm-session-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.realm-session-label {
  white-space: nowrap;
}
</style>
