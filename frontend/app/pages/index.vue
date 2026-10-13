<script setup lang="ts">
import { NButton, NCard, NGi, NGrid, NIcon, NSpace, NTag, NText } from 'naive-ui'
import { BadgeCheck, FileBadge, FolderTree, ScanLine, ShieldCheck } from '@lucide/vue'

const { t } = useI18n()
usePageTitle(() => t('nav.home'))

/** The public service catalogue, one card per service. */
const cards = [
  {
    key: 'csca',
    to: '/csca',
    icon: ShieldCheck,
    title: 'nav.csca',
    body: 'home.cscaCard',
    cta: 'home.ctaApply',
    public: false,
  },
  {
    key: 'cvca',
    to: '/cvca',
    icon: BadgeCheck,
    title: 'nav.cvca',
    body: 'home.cvcaCard',
    cta: 'home.ctaApply',
    public: false,
  },
  {
    key: 'dv',
    to: '/dv',
    icon: ScanLine,
    title: 'nav.dv',
    body: 'home.dvCard',
    cta: 'home.ctaApply',
    public: false,
  },
  {
    key: 'dsc',
    to: '/dsc',
    icon: FileBadge,
    title: 'nav.dsc',
    body: 'home.dscCard',
    cta: 'home.ctaApply',
    public: false,
  },
  {
    key: 'pkd',
    to: '/pkd',
    icon: FolderTree,
    title: 'nav.pkd',
    body: 'home.pkdCard',
    cta: 'home.ctaBrowse',
    public: true,
  },
] as const
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <PageHeader :title="$t('home.intro')" />
      <NGrid
        :cols="3"
        :x-gap="16"
        :y-gap="16"
        item-responsive
        responsive="screen"
        class="epass42-cards"
      >
        <NGi v-for="card in cards" :key="card.key" span="3 s:3 m:1">
          <NuxtLink :to="card.to" class="epass42-card-link">
            <NCard hoverable class="epass42-card">
              <NSpace vertical size="small" align="start">
                <NIcon size="28"><component :is="card.icon" /></NIcon>
                <NText strong style="font-size: 16px">{{ $t(card.title) }}</NText>
                <NTag size="small" :type="card.public ? 'success' : 'info'">
                  {{ card.public ? $t('home.public') : $t('home.requiresSignIn') }}
                </NTag>
                <NText depth="2">{{ $t(card.body) }}</NText>
              </NSpace>
              <template #action>
                <NButton text type="primary">{{ $t(card.cta) }}</NButton>
              </template>
            </NCard>
          </NuxtLink>
        </NGi>
      </NGrid>
    </NSpace>
  </div>
</template>

<style scoped>
.epass42-card-link {
  display: block;
  height: 100%;
}
.epass42-card {
  height: 100%;
}
:deep(.n-grid-item) {
  display: flex;
}
</style>
