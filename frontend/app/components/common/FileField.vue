<script setup lang="ts">
import { NButton, NUpload } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'

/** A file input that base64-encodes the selected file (no hex input, T11.4). */
export interface EncodedFile {
  base64: string
  name: string
}

const model = defineModel<EncodedFile | null>({ default: null })
defineProps<{ accept?: string; label?: string }>()

/**
 * Encodes the single selected file as base64 (the data-URL payload only).
 *
 * `NUpload` is used without a default upload, so nothing leaves the browser
 * until the form is submitted; removing the file clears the model.
 */
function onChange(options: { fileList: UploadFileInfo[] }): void {
  const file = options.fileList[0]?.file
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
  <NUpload
    :default-upload="false"
    :max="1"
    :accept="accept"
    :show-file-list="true"
    @change="onChange"
  >
    <NButton>{{ label ?? 'Choose file' }}</NButton>
  </NUpload>
</template>
