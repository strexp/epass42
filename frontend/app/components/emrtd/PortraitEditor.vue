<script setup lang="ts">
import { NAlert, NButton, NModal, NSpace, NText } from 'naive-ui'
import { Cropper } from 'vue-advanced-cropper'
import 'vue-advanced-cropper/dist/style.css'
import { nextTick, onBeforeUnmount, ref } from 'vue'

/** The encoded portrait and the dimensions recorded in DG2. */
export interface EncodedPortrait {
  jpegBase64: string
  width: number
  height: number
  previewDataUrl: string
  bytes: number
}

const model = defineModel<EncodedPortrait | null>({ default: null })
const { t } = useI18n()

/** Portrait aspect ratio (ICAO Doc 9303-9: 4:5) and the JPEG byte budget. */
const PORTRAIT_W = 4
const PORTRAIT_H = 5
/** Try progressively smaller sides/qualities until the JPEG fits the budget. */
const MAX_SIDES = [512, 448, 384, 320, 256, 192]
const QUALITIES = [0.7, 0.55, 0.45, 0.35]
/** Target JPEG bytes; the server limit (DG2) is 16 KiB including the wrapper. */
const TARGET_BYTES = 15_000

const modalOpen = ref(false)
const mode = ref<'choose' | 'camera' | 'crop'>('choose')
const sourceImage = ref<string | null>(null)
const error = ref<string | null>(null)
const tooLarge = ref(false)
const encoding = ref(false)

const cropper = ref<InstanceType<typeof Cropper> | null>(null)
const video = ref<HTMLVideoElement | null>(null)
let stream: MediaStream | null = null

function openModal(): void {
  error.value = null
  sourceImage.value = null
  mode.value = 'choose'
  modalOpen.value = true
}

function stopCamera(): void {
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
}

function closeModal(): void {
  stopCamera()
  modalOpen.value = false
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/** A chosen file becomes the crop source. */
async function onFile(event: Event): Promise<void> {
  error.value = null
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    sourceImage.value = await readAsDataUrl(file)
    mode.value = 'crop'
  } catch {
    error.value = t('errors.generic')
  }
}

/** Opens the front camera; the user captures a still into the crop source. */
async function startCamera(): Promise<void> {
  error.value = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
    mode.value = 'camera'
    await nextTick()
    if (video.value) {
      video.value.srcObject = stream
      await video.value.play()
    }
  } catch {
    error.value = t('dsc.photoCameraError')
    stopCamera()
    mode.value = 'choose'
  }
}

function capture(): void {
  const element = video.value
  if (!element) return
  const canvas = document.createElement('canvas')
  canvas.width = element.videoWidth
  canvas.height = element.videoHeight
  canvas.getContext('2d')?.drawImage(element, 0, 0, canvas.width, canvas.height)
  sourceImage.value = canvas.toDataURL('image/jpeg', 0.9)
  stopCamera()
  mode.value = 'crop'
}

function scaleToMaxSide(width: number, height: number, maxSide: number) {
  const longest = Math.max(width, height)
  if (longest <= maxSide) return { width, height }
  const scale = maxSide / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no 2d context')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  return canvas
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

/** Scales and compresses a cropped canvas until it fits the DG2 budget. */
async function encodeSource(source: HTMLCanvasElement): Promise<EncodedPortrait> {
  let best: EncodedPortrait | null = null
  outer: for (const maxSide of MAX_SIDES) {
    const scaled = scaleToMaxSide(source.width, source.height, maxSide)
    const canvas = draw(source, scaled.width, scaled.height)
    for (const quality of QUALITIES) {
      const blob = await canvasToJpeg(canvas, quality)
      const candidate: EncodedPortrait = {
        jpegBase64: '',
        width: scaled.width,
        height: scaled.height,
        previewDataUrl: canvas.toDataURL('image/jpeg', quality),
        bytes: blob.size,
      }
      if (!best || candidate.bytes < best.bytes) best = candidate
      if (blob.size <= TARGET_BYTES) {
        best = candidate
        break outer
      }
    }
  }
  if (!best) throw new Error('could not encode the portrait')
  // Keep the raw base64 payload (strip the `data:image/jpeg;base64,` prefix);
  // the API contract expects base64, not the decoded binary string.
  best.jpegBase64 = best.previewDataUrl.slice(best.previewDataUrl.indexOf(',') + 1)
  return best
}

async function useCropped(): Promise<void> {
  const result = cropper.value?.getResult()
  const canvas = result?.canvas
  if (!canvas) return
  encoding.value = true
  try {
    const encoded = await encodeSource(canvas)
    model.value = encoded
    tooLarge.value = encoded.bytes > TARGET_BYTES
    closeModal()
  } catch {
    error.value = t('errors.generic')
  } finally {
    encoding.value = false
  }
}

function remove(): void {
  model.value = null
  tooLarge.value = false
}

onBeforeUnmount(stopCamera)
</script>

<template>
  <div>
    <div class="epass42-actions">
      <NButton @click="openModal">
        {{ model ? $t('dsc.portraitChange') : $t('dsc.portraitAdd') }}
      </NButton>
      <NButton v-if="model" quaternary @click="remove">
        {{ $t('dsc.portraitRemove') }}
      </NButton>
      <NText v-if="model" depth="3">
        {{ model.width }}×{{ model.height }} · {{ (model.bytes / 1024).toFixed(1) }} KB
      </NText>
    </div>
    <NText depth="3" style="font-size: 12px">{{ $t('dsc.portraitHint') }}</NText>
    <NText v-if="tooLarge" type="warning" style="display: block; font-size: 12px">
      {{ $t('dsc.portraitTooLarge') }}
    </NText>

    <NModal
      v-model:show="modalOpen"
      preset="card"
      :title="$t('dsc.portrait')"
      style="max-width: 560px"
      @after-leave="stopCamera"
    >
      <NAlert v-if="error" type="error" style="margin-bottom: 12px">{{ error }}</NAlert>

      <template v-if="mode === 'choose'">
        <NText depth="3">{{ $t('dsc.photoFileHint') }}</NText>
        <NSpace style="margin-top: 12px">
          <NButton tag="label">
            {{ $t('dsc.photoChoose') }}
            <input type="file" accept="image/*" hidden @change="onFile" />
          </NButton>
          <NButton @click="startCamera">{{ $t('dsc.photoTake') }}</NButton>
        </NSpace>
      </template>

      <template v-else-if="mode === 'camera'">
        <!-- eslint-disable-next-line vuejs-accessibility/media-has-caption -->
        <video ref="video" playsinline muted style="width: 100%; border-radius: 6px" />
        <NSpace justify="end" style="margin-top: 12px">
          <NButton quaternary @click="closeModal">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" @click="capture">{{ $t('dsc.photoCapture') }}</NButton>
        </NSpace>
      </template>

      <template v-else>
        <NText depth="3">{{ $t('dsc.photoCropHint') }}</NText>
        <div class="epass42-cropper">
          <Cropper
            ref="cropper"
            :src="sourceImage ?? ''"
            :stencil-props="{ aspectRatio: PORTRAIT_W / PORTRAIT_H }"
            :resize-image="{ adjustStencil: false }"
            :auto-zoom="true"
          />
        </div>
        <NSpace justify="end" style="margin-top: 12px">
          <NButton quaternary @click="startCamera">{{ $t('dsc.photoRetake') }}</NButton>
          <NButton type="primary" :loading="encoding" @click="useCropped">
            {{ $t('dsc.photoUse') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.epass42-cropper {
  margin-top: 12px;
  height: 360px;
  background: rgba(128, 128, 128, 0.1);
  border-radius: 6px;
  overflow: hidden;
}
</style>
