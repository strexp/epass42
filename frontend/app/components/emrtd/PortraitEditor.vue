<script setup lang="ts">
import { NButton, NText } from 'naive-ui'
import { ref } from 'vue'

/** The encoded portrait and the dimensions recorded in DG2. */
export interface EncodedPortrait {
  jpegBase64: string
  width: number
  height: number
  previewDataUrl: string
}

const model = defineModel<EncodedPortrait | null>({ default: null })
const error = ref<string | null>(null)

const PORTRAIT_W = 4
const PORTRAIT_H = 5
const MAX_SIDE = 512
const QUALITY = 0.7

function cropToPortrait(width: number, height: number) {
  const targetHeight = (width * PORTRAIT_H) / PORTRAIT_W
  if (targetHeight <= height) {
    const h = Math.floor(targetHeight)
    return { x: 0, y: Math.floor((height - h) / 2), w: width, h }
  }
  const w = Math.floor((height * PORTRAIT_W) / PORTRAIT_H)
  return { x: Math.floor((width - w) / 2), y: 0, w, h: height }
}

function scaleToMaxSide(width: number, height: number) {
  const longest = Math.max(width, height)
  if (longest <= MAX_SIDE) return { width, height }
  const scale = MAX_SIDE / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encoding failed'))),
      'image/jpeg',
      QUALITY,
    )
  })
}

async function onChange(event: Event): Promise<void> {
  error.value = null
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const bitmap = await createImageBitmap(file)
    const crop = cropToPortrait(bitmap.width, bitmap.height)
    const scaled = scaleToMaxSide(crop.w, crop.h)
    const canvas = document.createElement('canvas')
    canvas.width = scaled.width
    canvas.height = scaled.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no 2d context')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, scaled.width, scaled.height)
    context.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, scaled.width, scaled.height)
    bitmap.close()
    const blob = await canvasToJpeg(canvas)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    model.value = {
      jpegBase64: btoa(binary),
      width: scaled.width,
      height: scaled.height,
      previewDataUrl: canvas.toDataURL('image/jpeg', QUALITY),
    }
  } catch (cause) {
    error.value = (cause as Error).message
  }
}
</script>

<template>
  <div>
    <div class="pkd42-actions">
      <NButton tag="label">
        {{ $t('dsc.portrait') }}
        <input type="file" accept="image/*" hidden @change="onChange" />
      </NButton>
      <NText v-if="model" depth="3">{{ model.width }}×{{ model.height }}</NText>
    </div>
    <NText depth="3" style="font-size: 12px">{{ $t('dsc.portraitHint') }}</NText>
    <NText v-if="error" type="error" style="font-size: 12px">{{ error }}</NText>
    <img
      v-if="model"
      :src="model.previewDataUrl"
      alt=""
      style="max-width: 120px; margin-top: 8px"
    />
  </div>
</template>
