<script setup lang="ts">
import { NBreadcrumb, NBreadcrumbItem, NPageHeader } from 'naive-ui'

/** A crumb in the page breadcrumb. */
export interface Crumb {
  label: string
  to?: string
}

const props = defineProps<{ title: string; subtitle?: string; breadcrumbs?: Crumb[] }>()

function go(to?: string): void {
  if (to) void navigateTo(to)
}
</script>

<template>
  <div class="epass42-page-header">
    <NBreadcrumb v-if="props.breadcrumbs?.length" class="epass42-breadcrumb">
      <NBreadcrumbItem
        v-for="(crumb, index) in props.breadcrumbs"
        :key="index"
        :clickable="Boolean(crumb.to)"
        @click="go(crumb.to)"
      >
        {{ crumb.label }}
      </NBreadcrumbItem>
    </NBreadcrumb>
    <NPageHeader :title="title" :subtitle="subtitle">
      <template v-if="$slots.extra" #extra><slot name="extra" /></template>
      <slot />
    </NPageHeader>
  </div>
</template>

<style scoped>
.epass42-page-header {
  margin-bottom: 16px;
}
.epass42-breadcrumb {
  margin-bottom: 8px;
}
</style>
