<script setup lang="ts">
import { NButton, NText } from 'naive-ui'
import { ref } from 'vue'

/** The encoded portrait and the dimensions recorded in DG2. */
export interface EncodedPortrait {
  jpegBase64: string
  width: number
  height: number
  previewDataUrl: string
  bytes: number
}

const model = defineModel<EncodedPortrait | null>({ default: null })
const error = ref<string | null>(null)
const tooLarge = ref(false)

const PORTRAIT_W = 4
const PORTRAIT_H = 5
/** Try progressively smaller sides/qualities until the JPEG fits the budget. */
const MAX_SIDES = [512, 448, 384, 320, 256, 192]
const QUALITIES = [0.7, 0.55, 0.45, 0.35]
/** Target JPEG bytes; the server limit (DG2) is 16 KiB including the wrapper. */
const TARGET_BYTES = 15_000

function cropToPortrait(width: number, height: number) {
  const targetHeight = (width * PORTRAIT_H) / PORTRAIT_W
  if (targetHeight <= height) {
    const h = Math.floor(targetHeight)
    return { x: 0, y: Math.floor((height - h) / 2), w: width, h }
  }
  const w = Math.floor((height * PORTRAIT_W) / PORTRAIT_H)
  return { x: Math.floor((width - w) / 2), y: 0, w, h: height }
}

function scaleToMaxSide(width: number, height: number, maxSide: number) {
  const longest = Math.max(width, height)
  if (longest <= maxSide) return { width, height }
  const scale = maxSide / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encoding failed'))),
      'image/jpeg',
      quality,
    )
  })
}

function draw(
  bitmap: ImageBitmap,
  crop: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no 2d context')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height)
  return canvas
}

async function onChange(event: Event): Promise<void> {
  error.value = null
  tooLarge.value = false
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const bitmap = await createImageBitmap(file)
    const crop = cropToPortrait(bitmap.width, bitmap.height)
    let best: EncodedPortrait | null = null
    outer: for (const maxSide of MAX_SIDES) {
      const scaled = scaleToMaxSide(crop.w, crop.h, maxSide)
      const canvas = draw(bitmap, crop, scaled.width, scaled.height)
      for (const quality of QUALITIES) {
        const blob = await canvasToJpeg(canvas, quality)
        const bytes = blob.size
        const candidate: EncodedPortrait = {
          jpegBase64: '',
          width: scaled.width,
          height: scaled.height,
          previewDataUrl: canvas.toDataURL('image/jpeg', quality),
          bytes,
        }
        if (!best || bytes < best.bytes) best = candidate
        if (bytes <= TARGET_BYTES) break outer
      }
    }
    bitmap.close()
    if (!best) throw new Error('could not encode the portrait')
    if (best.bytes > TARGET_BYTES) tooLarge.value = true
    // Keep the raw base64 payload (strip the `data:image/jpeg;base64,` prefix);
    // the API contract expects base64, not the decoded binary string.
    best.jpegBase64 = best.previewDataUrl.slice(best.previewDataUrl.indexOf(',') + 1)
    model.value = best
  } catch (cause) {
    error.value = (cause as Error).message
  }
}
</script>

<template>
  <div>
    <div class="epass42-actions">
      <NButton tag="label">
        {{ $t('dsc.portrait') }}
        <input type="file" accept="image/*" hidden @change="onChange" />
      </NButton>
      <NText v-if="model" depth="3">
        {{ model.width }}×{{ model.height }} · {{ (model.bytes / 1024).toFixed(1) }} KB
      </NText>
    </div>
    <NText depth="3" style="font-size: 12px">{{ $t('dsc.portraitHint') }}</NText>
    <NText v-if="error" type="error" style="font-size: 12px">{{ error }}</NText>
    <NText v-if="tooLarge" type="warning" style="font-size: 12px">
      {{ $t('dsc.portraitTooLarge') }}
    </NText>
    <img
      v-if="model"
      :src="model.previewDataUrl"
      alt=""
      style="max-width: 120px; margin-top: 8px"
    />
  </div>
</template>
