<script setup lang="ts">
import { NTime } from 'naive-ui'
import { computed } from 'vue'

/**
 * Renders an ISO timestamp with Naive UI's `NTime`, so the format follows the
 * configured date locale.  Falls back to an em dash for missing/invalid values.
 */
const props = defineProps<{ value: string | null | undefined }>()

const time = computed<Date | null>(() => {
  if (!props.value) return null
  const parsed = new Date(props.value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
})
</script>

<template>
  <NTime v-if="time" :time="time" />
  <span v-else>—</span>
</template>
