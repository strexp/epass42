<script setup lang="ts">
import { computed } from 'vue'
import { formatDate } from '~/utils/datetime'

/**
 * Renders an ISO timestamp as `YYYY-MM-DD` (no time of day).  Falls back to an
 * em dash for missing/invalid values.
 */
const props = defineProps<{ value: string | null | undefined }>()

const label = computed(() => (props.value ? formatDate(props.value) : '—'))
</script>

<template>
  <span>{{ label }}</span>
</template>
