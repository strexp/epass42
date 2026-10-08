<script setup lang="ts">
import { NIcon, NMenu, NSpace } from 'naive-ui'
import { FileBadge, FolderTree, ShieldCheck, Waypoints } from '@lucide/vue'
import { computed, h } from 'vue'

const { t } = useI18n()
const route = useRoute()

const options = computed(() => [
  {
    label: t('nav.csca'),
    key: '/csca',
    icon: () => h(NIcon, null, { default: () => h(ShieldCheck) }),
  },
  { label: t('nav.dsc'), key: '/dsc', icon: () => h(NIcon, null, { default: () => h(FileBadge) }) },
  {
    label: t('nav.pkd'),
    key: '/pkd',
    icon: () => h(NIcon, null, { default: () => h(FolderTree) }),
  },
])

const active = computed(() => {
  const segment = route.path.split('/')[1]
  return segment ? `/${segment}` : '/'
})

function onSelect(key: string): void {
  void navigateTo(key)
}
</script>

<template>
  <div class="pkd42-header">
    <NuxtLink to="/" class="pkd42-brand">
      <NIcon size="22"><Waypoints /></NIcon>
      <span>{{ $t('app.name') }}</span>
    </NuxtLink>
    <NMenu
      mode="horizontal"
      :options="options"
      :value="active"
      class="pkd42-menu"
      @update:value="onSelect"
    />
    <NSpace class="pkd42-header-actions">
      <ThemeToggle />
    </NSpace>
  </div>
</template>

<style scoped>
.pkd42-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  height: 56px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.18);
}
.pkd42-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 18px;
  text-decoration: none;
  color: inherit;
}
.pkd42-menu {
  flex: 1;
  min-width: 0;
}
.pkd42-header-actions {
  margin-left: auto;
}
</style>
