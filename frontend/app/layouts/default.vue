<script setup lang="ts">
import { NButton, NCard, NSpace, NTag, NText } from 'naive-ui'
import { onMounted } from 'vue'
import { useAuthStore } from '~/stores/auth'
import type { Realm } from '@pkd42/shared'

const auth = useAuthStore()
const { load } = usePkdConfig()
const route = useRoute()

onMounted(async () => {
  await load()
  await auth.fetchMe('csca')
  await auth.fetchMe('dsc')
})

function login(realm: Realm): void {
  auth.login(realm, route.fullPath)
}

async function logout(realm: Realm): Promise<void> {
  await auth.logout(realm)
  await navigateTo('/')
}
</script>

<template>
  <div>
    <header class="pkd42-header">
      <NuxtLink to="/" class="pkd42-brand">{{ $t('app.name') }}</NuxtLink>
      <nav class="pkd42-nav">
        <NuxtLink to="/csca">{{ $t('nav.csca') }}</NuxtLink>
        <NuxtLink to="/dsc">{{ $t('nav.dsc') }}</NuxtLink>
        <NuxtLink to="/pkd">{{ $t('nav.pkd') }}</NuxtLink>
      </nav>
      <div class="pkd42-actions">
        <ThemeToggle />
      </div>
    </header>

    <NCard size="small" class="pkd42-session" :bordered="false">
      <NSpace align="center" justify="space-between">
        <NSpace align="center" size="small">
          <NTag size="small" :type="auth.realms.csca.me ? 'success' : 'default'">
            {{ $t('auth.realmCsca') }}
          </NTag>
          <NText v-if="auth.realms.csca.me" depth="2">
            {{ $t('auth.signedInAs') }}
            {{ auth.realms.csca.me.account.name ?? auth.realms.csca.me.account.asn }}
          </NText>
          <NTag v-if="auth.realms.csca.me?.isAdmin" size="small" type="info">{{
            $t('auth.admin')
          }}</NTag>
          <NButton v-if="!auth.realms.csca.me" size="tiny" @click="login('csca')">{{
            $t('common.login')
          }}</NButton>
          <NButton v-else size="tiny" @click="logout('csca')">{{ $t('common.logout') }}</NButton>
        </NSpace>

        <NSpace align="center" size="small">
          <NTag size="small" :type="auth.realms.dsc.me ? 'success' : 'default'">
            {{ $t('auth.realmDsc') }}
          </NTag>
          <NText v-if="auth.realms.dsc.me" depth="2">
            {{ $t('auth.signedInAs') }}
            {{ auth.realms.dsc.me.account.name ?? auth.realms.dsc.me.account.asn }}
          </NText>
          <NTag v-if="auth.realms.dsc.me?.isAdmin" size="small" type="info">{{
            $t('auth.admin')
          }}</NTag>
          <NButton v-if="!auth.realms.dsc.me" size="tiny" @click="login('dsc')">{{
            $t('common.login')
          }}</NButton>
          <NButton v-else size="tiny" @click="logout('dsc')">{{ $t('common.logout') }}</NButton>
        </NSpace>
      </NSpace>
    </NCard>

    <main>
      <slot />
    </main>
  </div>
</template>

<style scoped>
.pkd42-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}
.pkd42-brand {
  font-weight: 700;
  text-decoration: none;
}
.pkd42-nav {
  display: flex;
  gap: 12px;
  flex: 1;
}
.pkd42-nav a {
  text-decoration: none;
}
.pkd42-session {
  margin: 12px 16px 0;
}
</style>
