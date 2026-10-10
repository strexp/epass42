<script setup lang="ts">
import { NDatePicker } from 'naive-ui'
import { computed } from 'vue'

/**
 * An MRZ-accurate date picker.
 *
 * It reads and writes the compact digit strings used in the machine-readable
 * zone (`YYMMDD` by default, `CCYYMMDD` for full-year fields such as the DG16
 * date of recording) instead of a locale-formatted date, so the value can flow
 * straight into the request payload.
 */
const model = defineModel<string>({ default: '' })
const props = withDefaults(defineProps<{ digits?: 6 | 8; disabled?: boolean }>(), {
  digits: 6,
  disabled: false,
})

/** Naive's date format for the selected digit width. */
const format = computed(() => (props.digits === 8 ? 'yyyyMMdd' : 'yyMMdd'))

/** A recorded date may not be in the future. */
function isDateDisabled(timestamp: number): boolean {
  return timestamp > Date.now()
}
</script>

<template>
  <NDatePicker
    :formatted-value="model || null"
    type="date"
    :format="format"
    :actions="null"
    :is-date-disabled="isDateDisabled"
    :start-year="1900"
    :end-year="2100"
    :disabled="disabled"
    clearable
    @update:formatted-value="(value) => (model = value ?? '')"
  />
</template>
