<script setup lang="ts">
import { NButton, NCard, NGi, NGrid, NIcon, NSpace, NTag, NText } from 'naive-ui'
import { FileBadge, FolderTree, ShieldCheck } from '@lucide/vue'

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
      <PageHeader :title="$t('app.name')" :subtitle="$t('home.intro')">
        <NText depth="3">{{ $t('home.publicHint') }}</NText>
      </PageHeader>
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
              <template #header>
                <NSpace align="center" :size="8">
                  <NIcon size="22"><component :is="card.icon" /></NIcon>
                  {{ $t(card.title) }}
                </NSpace>
              </template>
              <template #header-extra>
                <NTag size="small" :type="card.public ? 'success' : 'info'">
                  {{ card.public ? $t('home.public') : $t('home.requiresSignIn') }}
                </NTag>
              </template>
              <NText depth="2">{{ $t(card.body) }}</NText>
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
