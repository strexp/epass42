<script setup lang="ts">
import { NAvatar, NButton, NCard, NIcon, NTag, NText } from 'naive-ui'
import { LogIn, LogOut, ShieldCheck, ShieldOff } from '@lucide/vue'
import { computed, onMounted } from 'vue'
import { useAuthStore } from '~/stores/auth'
import type { Realm } from '@pkd42/shared'

const props = defineProps<{ realm: Realm }>()
const auth = useAuthStore()
const route = useRoute()

const me = computed(() => auth.realms[props.realm].me)
const label = computed(() => (props.realm === 'csca' ? 'CSCA' : 'DSC'))

onMounted(() => {
  if (!auth.realms[props.realm].loaded) void auth.fetchMe(props.realm)
})

function login(): void {
  auth.login(props.realm, route.fullPath)
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
          <NAvatar
            round
            size="small"
            :style="{ background: me ? (realm === 'csca' ? '#2080f0' : '#18a058') : '#a0a0a0' }"
          >
            <NIcon><ShieldCheck v-if="me" /><ShieldOff v-else /></NIcon>
          </NAvatar>
          <NText strong class="realm-session-label">{{ label }}</NText>
          <NTag v-if="me" size="small" type="success">
            {{ $t('auth.signedInAs') }} {{ me.account.name ?? me.account.asn ?? me.account.id }}
          </NTag>
          <NText v-else depth="3">{{ $t('auth.signInTo', { realm: label }) }}</NText>
          <NTag v-if="me?.account.asn" size="small">{{ $t('auth.asn') }} {{ me.account.asn }}</NTag>
          <NTag v-if="me?.account.activeMnt" size="small" :bordered="false">
            {{ me.account.activeMnt }}
          </NTag>
          <NTag v-if="me?.isAdmin" size="small" type="info">{{ $t('auth.admin') }}</NTag>
        </div>
        <NButton v-if="!me" type="primary" size="small" @click="login">
          <template #icon
            ><NIcon><LogIn /></NIcon
          ></template>
          {{ $t('common.login') }}
        </NButton>
        <NButton v-else size="small" @click="logout">
          <template #icon
            ><NIcon><LogOut /></NIcon
          ></template>
          {{ $t('common.logout') }}
        </NButton>
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
