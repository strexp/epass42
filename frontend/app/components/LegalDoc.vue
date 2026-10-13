<script setup lang="ts">
import { NSpace } from 'naive-ui'

/**
 * Renders a legal document from an i18n namespace: a lead paragraph followed by
 * named sections (`<ns>.sections.<id>.title` / `.body`).  Bodies may contain
 * newlines for bullet-like lists (see the copy style guide).
 */
const props = defineProps<{ ns: string; sections: readonly string[] }>()
</script>

<template>
  <NSpace vertical size="large">
    <p class="epass42-legal-lead">{{ $t(`${props.ns}.lead`) }}</p>
    <section v-for="id in props.sections" :key="id" class="epass42-legal-section">
      <h2 class="epass42-legal-heading">{{ $t(`${props.ns}.sections.${id}.title`) }}</h2>
      <p class="epass42-legal-body">{{ $t(`${props.ns}.sections.${id}.body`) }}</p>
    </section>
  </NSpace>
</template>

<style scoped>
.epass42-legal-lead {
  margin: 0;
  font-size: 14px;
}
.epass42-legal-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.epass42-legal-heading {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
.epass42-legal-body {
  margin: 0;
  white-space: pre-line;
  line-height: 1.7;
}
</style>
