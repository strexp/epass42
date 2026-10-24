<script setup lang="ts">
import { NButton, NDropdown, NIcon, NMenu, NSpace } from 'naive-ui'
import {
  BookUser,
  CircleHelp,
  CreditCard,
  ExternalLink,
  FileBadge,
  FileCheck,
  FolderTree,
  Languages,
  ShieldCheck,
  BadgeCheck,
  ScanLine,
} from '@lucide/vue'
import { computed, h } from 'vue'

const { t, locales, setLocale } = useI18n()
const route = useRoute()

const options = computed(() => [
  {
    label: t('nav.csca'),
    key: '/csca',
    icon: () => h(NIcon, null, { default: () => h(ShieldCheck) }),
  },
  {
    label: t('nav.cvca'),
    key: '/cvca',
    icon: () => h(NIcon, null, { default: () => h(BadgeCheck) }),
  },
  {
    label: t('nav.dv'),
    key: '/dv',
    icon: () => h(NIcon, null, { default: () => h(ScanLine) }),
  },
  {
    label: t('nav.dsc'),
    key: '/dsc',
    icon: () => h(NIcon, null, { default: () => h(FileBadge) }),
  },
  {
    label: t('nav.ml'),
    key: '/ml',
    icon: () => h(NIcon, null, { default: () => h(FileCheck) }),
  },
  {
    label: t('nav.pkd'),
    key: '/pkd',
    icon: () => h(NIcon, null, { default: () => h(FolderTree) }),
  },
  {
    label: () =>
      h('span', { style: 'display: inline-flex; align-items: center; gap: 4px' }, [
        t('nav.passcard'),
        h(NIcon, { size: 13, style: 'opacity: 0.7' }, { default: () => h(ExternalLink) }),
        h('span', { class: 'epass42-sr-only' }, ` (${t('common.opensInNewTab')})`),
      ]),
    key: 'https://passcard.nia.gov.dn42',
    icon: () => h(NIcon, null, { default: () => h(CreditCard) }),
  },
  {
    label: t('nav.help'),
    key: '/help',
    icon: () => h(NIcon, null, { default: () => h(CircleHelp) }),
  },
])

/** The configured locales, for the language switcher. */
const localeOptions = computed(() =>
  (locales.value as { code: string; name?: string }[]).map((item) => ({
    label: item.name ?? item.code,
    key: item.code,
  })),
)

function onLocaleSelect(key: string): void {
  void setLocale(key as 'en' | 'zh')
}

const active = computed(() => {
  const segment = route.path.split('/')[1]
  return segment ? `/${segment}` : '/'
})

function onSelect(key: string): void {
  if (/^https?:\/\//i.test(key)) {
    window.open(key, '_blank', 'noopener,noreferrer')
    return
  }
  void navigateTo(key)
}
</script>

<template>
  <header class="epass42-header">
    <NuxtLink to="/" class="epass42-brand">
      <NIcon size="26"><BookUser /></NIcon>
      <span class="epass42-brand-text">
        <span class="epass42-brand-name">{{ $t('app.name') }}</span>
        <span class="epass42-brand-authority">{{ $t('app.authority') }}</span>
      </span>
    </NuxtLink>
    <nav :aria-label="$t('common.navigation')" class="epass42-nav">
      <NMenu
        mode="horizontal"
        :options="options"
        :value="active"
        responsive
        class="epass42-menu"
        @update:value="onSelect"
      />
    </nav>
    <NSpace class="epass42-header-actions" align="center">
      <NDropdown :options="localeOptions" @select="(key) => onLocaleSelect(String(key))">
        <NButton quaternary circle :aria-label="$t('common.language')">
          <template #icon
            ><NIcon><Languages /></NIcon
          ></template>
        </NButton>
      </NDropdown>
      <ThemeToggle />
    </NSpace>
  </header>
</template>

<style scoped>
.epass42-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 8px 16px;
  min-height: 64px;
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
  opacity: 0.85;
}
.epass42-nav {
  flex: 1;
  min-width: 0;
}
.epass42-menu {
  flex: 1;
  min-width: 0;
}
.epass42-header-actions {
  margin-left: auto;
}
</style>
