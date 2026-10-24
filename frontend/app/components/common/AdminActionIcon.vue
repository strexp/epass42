<script setup lang="ts">
import { NIcon, NTooltip } from 'naive-ui'
import { ShieldCheck } from '@lucide/vue'

/** An inline shield marker for buttons that require administrator rights. */
const { t } = useI18n()
</script>

<template>
  <NTooltip>
    <template #trigger>
      <span class="epass42-admin-action-icon" role="img" :aria-label="t('common.adminOnly')">
        <NIcon :size="15"><ShieldCheck /></NIcon>
      </span>
    </template>
    {{ t('common.adminOnlyHint') }}
  </NTooltip>
</template>

<style scoped>
.epass42-admin-action-icon {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  color: currentColor;
  opacity: 0.8;
}
</style>
