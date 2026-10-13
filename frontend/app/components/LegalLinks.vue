<script setup lang="ts">
import { NButton, NSpace } from 'naive-ui'
import { computed } from 'vue'

/** Cross-links to the other legal pages, excluding the one being shown. */
type LegalPage = 'privacy' | 'terms' | 'retention'

const props = defineProps<{ current: LegalPage }>()

const all: { id: LegalPage; to: string }[] = [
  { id: 'privacy', to: '/privacy' },
  { id: 'terms', to: '/terms' },
  { id: 'retention', to: '/retention' },
]
const links = computed(() => all.filter((item) => item.id !== props.current))
</script>

<template>
  <NSpace :size="16" style="margin-top: 16px">
    <NuxtLink v-for="link in links" :key="link.id" :to="link.to">
      <NButton text type="primary">{{ $t(`legal.${link.id}.title`) }}</NButton>
    </NuxtLink>
  </NSpace>
</template>
