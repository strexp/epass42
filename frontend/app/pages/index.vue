<script setup lang="ts">
import { NButton, NCard, NGi, NGrid, NIcon, NSpace, NText } from 'naive-ui'
import { FileBadge, FolderTree, ShieldCheck } from '@lucide/vue'

const cards = [
  { key: 'csca', to: '/csca', icon: ShieldCheck, title: 'nav.csca', body: 'home.cscaCard' },
  { key: 'dsc', to: '/dsc', icon: FileBadge, title: 'nav.dsc', body: 'home.dscCard' },
  { key: 'pkd', to: '/pkd', icon: FolderTree, title: 'nav.pkd', body: 'home.pkdCard' },
] as const
</script>

<template>
  <div class="pkd42-page">
    <NSpace vertical size="large">
      <div>
        <h1 style="margin: 0">{{ $t('app.name') }}</h1>
        <NText depth="2">{{ $t('home.intro') }}</NText>
      </div>
      <NGrid
        :cols="3"
        :x-gap="16"
        :y-gap="16"
        item-responsive
        responsive="screen"
        class="pkd42-cards"
      >
        <NGi v-for="card in cards" :key="card.key" span="3 s:3 m:1">
          <NuxtLink :to="card.to" class="pkd42-card-link">
            <NCard hoverable class="pkd42-card">
              <NSpace vertical size="small" align="start">
                <NIcon size="28"><component :is="card.icon" /></NIcon>
                <NText strong style="font-size: 16px">{{ $t(card.title) }}</NText>
                <NText depth="2">{{ $t(card.body) }}</NText>
              </NSpace>
              <template #action>
                <NButton text type="primary">{{ $t('common.open') }}</NButton>
              </template>
            </NCard>
          </NuxtLink>
        </NGi>
      </NGrid>
    </NSpace>
  </div>
</template>

<style scoped>
.pkd42-card-link {
  display: block;
  height: 100%;
}
.pkd42-card {
  height: 100%;
}
:deep(.n-grid-item) {
  display: flex;
}
</style>
