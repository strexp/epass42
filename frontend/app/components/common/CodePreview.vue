<script setup lang="ts">
import { NCard, NCode } from 'naive-ui'

defineProps<{ title?: string; code: string; language?: string }>()
</script>

<template>
  <NCard :title="title" size="small">
    <NCode :code="code" :language="language ?? 'text'" word-wrap />
  </NCard>
</template>
