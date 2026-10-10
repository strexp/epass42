<script setup lang="ts">
import { NIcon, NMenu, NSpace, NText } from 'naive-ui'
import { BookUser, FileBadge, FolderTree, ShieldCheck } from '@lucide/vue'
import { computed, h } from 'vue'

const { t } = useI18n()
const route = useRoute()

const options = computed(() => [
  {
    label: t('nav.csca'),
    key: '/csca',
    icon: () => h(NIcon, null, { default: () => h(ShieldCheck) }),
  },
  {
    label: t('nav.dsc'),
    key: '/dsc',
    icon: () => h(NIcon, null, { default: () => h(FileBadge) }),
  },
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
  <div class="epass42-header">
    <NuxtLink to="/" class="epass42-brand">
      <NIcon size="26"><BookUser /></NIcon>
      <span class="epass42-brand-text">
        <span class="epass42-brand-name">{{ $t('app.name') }}</span>
        <span class="epass42-brand-authority">{{ $t('app.authority') }}</span>
      </span>
    </NuxtLink>
    <NMenu
      mode="horizontal"
      :options="options"
      :value="active"
      class="epass42-menu"
      @update:value="onSelect"
    />
    <NSpace class="epass42-header-actions" align="center">
      <NText depth="3" class="epass42-header-identifier">{{ $t('app.authorityShort') }}</NText>
      <ThemeToggle />
    </NSpace>
  </div>
</template>

<style scoped>
.epass42-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  height: 64px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.18);
}
.epass42-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
}
.epass42-brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.epass42-brand-name {
  font-weight: 700;
  font-size: 18px;
}
.epass42-brand-authority {
  font-size: 11px;
  opacity: 0.65;
}
.epass42-menu {
  flex: 1;
  min-width: 0;
}
.epass42-header-actions {
  margin-left: auto;
}
@media (max-width: 720px) {
  .epass42-header-identifier {
    display: none;
  }
}
</style>
