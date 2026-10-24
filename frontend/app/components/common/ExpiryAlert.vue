<script setup lang="ts">
import { NAlert } from 'naive-ui'

/** A standard error banner used when a CA/signer certificate has expired. */
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <NAlert type="error" :title="title" style="margin-bottom: 12px">
    <template v-if="description">{{ description }}</template>
  </NAlert>
</template>
