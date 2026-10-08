<script setup lang="ts">
import { NButton, NText } from 'naive-ui'

/** A file input that base64-encodes the selected file (no hex input, T11.4). */
export interface EncodedFile {
  base64: string
  name: string
}

const model = defineModel<EncodedFile | null>({ default: null })
defineProps<{ accept?: string; label?: string }>()

function onChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    model.value = null
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const result = String(reader.result ?? '')
    const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result
    model.value = { base64, name: file.name }
  }
  reader.readAsDataURL(file)
}
</script>

<template>
  <div class="pkd42-actions">
    <NButton tag="label">
      {{ label ?? 'Choose file' }}
      <input
        type="file"
        :accept="accept"
        hidden
        :aria-label="label ?? 'Choose file'"
        @change="onChange"
      />
    </NButton>
    <NText v-if="model" depth="3">{{ model.name }}</NText>
  </div>
</template>
