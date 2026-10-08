<script setup lang="ts">
import { NInput } from 'naive-ui'

const model = defineModel<string>({ default: '' })
defineProps<{ placeholder?: string; maxlength?: number }>()
</script>

<template>
  <NInput v-model:value="model" :placeholder="placeholder" :maxlength="maxlength" />
</template>
