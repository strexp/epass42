<script setup lang="ts">
import { NIcon, NTooltip } from 'naive-ui'
import { ShieldCheck } from '@lucide/vue'

/** A shield marker for cards that are visible to administrators only. */
const { t } = useI18n()
</script>

<template>
  <NTooltip>
    <template #trigger>
      <span class="epass42-admin-badge" role="img" tabindex="0" :aria-label="t('common.adminOnly')">
        <NIcon :size="19"><ShieldCheck /></NIcon>
      </span>
    </template>
    {{ t('common.adminOnlyHint') }}
  </NTooltip>
</template>

<style scoped>
.epass42-admin-badge {
  display: inline-flex;
  align-items: center;
  color: #d97706;
  opacity: 0.9;
  cursor: help;
}
</style>
