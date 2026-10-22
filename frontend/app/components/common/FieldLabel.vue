<script setup lang="ts">
import { NIcon, NSpace, NTooltip } from 'naive-ui'
import { Info } from '@lucide/vue'

/**
 * A form-field label with an optional `ⓘ` hint.
 *
 * The hint opens in a tooltip instead of a paragraph under the field, so long
 * explanations stay next to the label they explain without pushing the rest of
 * the form down.
 */
defineProps<{
  label: string
  hint?: string
}>()
</script>

<template>
  <NSpace align="center" :size="4">
    <span>{{ label }}</span>
    <NTooltip v-if="hint">
      <template #trigger>
        <NIcon :size="14" style="opacity: 0.6; cursor: help">
          <Info />
        </NIcon>
      </template>
      {{ hint }}
    </NTooltip>
  </NSpace>
</template>
