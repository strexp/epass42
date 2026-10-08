<script setup lang="ts">
import { NButton, NIcon, NInput, NSpace, NTag } from 'naive-ui'
import { Plus } from '@lucide/vue'
import { ref } from 'vue'

const model = defineModel<string[]>({ default: () => [] })
const draft = ref('')

function add(): void {
  const value = draft.value.trim()
  if (value === '' || model.value.includes(value)) {
    draft.value = ''
    return
  }
  model.value = [...model.value, value]
  draft.value = ''
}

function remove(value: string): void {
  model.value = model.value.filter((entry) => entry !== value)
}
</script>

<template>
  <NSpace vertical size="small">
    <NSpace v-if="model.length">
      <NTag v-for="value in model" :key="value" closable @close="remove(value)">{{ value }}</NTag>
    </NSpace>
    <NSpace>
      <NInput v-model:value="draft" @keyup.enter="add" />
      <NButton @click="add">
        <template #icon
          ><NIcon><Plus /></NIcon
        ></template>
      </NButton>
    </NSpace>
  </NSpace>
</template>
