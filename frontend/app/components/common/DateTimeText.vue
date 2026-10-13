<script setup lang="ts">
import { computed } from 'vue'
import { formatDate, formatDateTime } from '~/utils/datetime'

/**
 * Renders an ISO timestamp.  By default the calendar day only (`YYYY-MM-DD`);
 * pass `with-time` for the locale date and time of day.  Falls back to an em
 * dash for missing/invalid values.
 */
const props = defineProps<{ value: string | null | undefined; withTime?: boolean }>()

const label = computed(() =>
  props.withTime ? formatDateTime(props.value) : formatDate(props.value),
)
</script>

<template>
  <span>{{ label }}</span>
</template>
