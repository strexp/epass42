<script setup lang="ts">
import { computed } from 'vue'

/**
 * Renders an ISO timestamp in the selected locale and in UTC (see the copy style
 * guide in `i18n/i18n.config.ts`).  By default the calendar day only; pass
 * `with-time` for the date and time of day.  Falls back to an em dash for
 * missing/invalid values.
 */
const props = defineProps<{ value: string | null | undefined; withTime?: boolean }>()

const { formatDate, formatDateTime } = useDateTime()

const label = computed(() =>
  props.withTime ? formatDateTime(props.value) : formatDate(props.value),
)
</script>

<template>
  <span>{{ label }}</span>
</template>
