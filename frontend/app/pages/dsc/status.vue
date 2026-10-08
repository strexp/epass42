<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NInput,
  NTag,
  useMessage,
} from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { downloadText } from '~/utils/download'

interface RequestPreview {
  surname: { present: boolean; value?: string }
  givenNames: { present: boolean; value?: string }
  documentNumber: { present: boolean; value?: string }
  dateOfBirth: { present: boolean; value?: string }
  images: { dg2: boolean; dg5: boolean; dg7: boolean }
}

const route = useRoute()
const api = useApi()
const { t } = useI18n()
const message = useMessage()

const reference = ref((route.query.reference as string) ?? '')
const id = ref((route.query.id as string) ?? '')
const metadata = ref<Record<string, unknown> | null>(null)
const preview = ref<RequestPreview | null>(null)
const claimed = ref(false)

/** Owner requests may be addressed by id (from the history list) or reference. */
const base = computed(() =>
  reference.value ? `/dsc/requests/${reference.value}` : `/dsc/requests/id/${id.value}`,
)

async function lookup(): Promise<void> {
  metadata.value = null
  preview.value = null
  claimed.value = false
  if (!reference.value && !id.value) return
  try {
    metadata.value = await api(base.value)
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

async function loadPreview(): Promise<void> {
  try {
    preview.value = await api(`${base.value}/preview`)
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

async function reveal(): Promise<void> {
  try {
    const perso = await api<string>(`${base.value}/reveal`, { method: 'POST' })
    downloadText(`perso-${reference.value || id.value}.txt`, perso)
    claimed.value = true
    message.success(t('common.success'))
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

onMounted(() => {
  if (reference.value || id.value) void lookup()
})
</script>

<template>
  <div class="epass42-page">
    <NCard :title="$t('dsc.statusTitle')">
      <div class="epass42-actions">
        <NInput v-model:value="reference" :placeholder="$t('dsc.referencePlaceholder')" />
        <NButton @click="lookup">{{ $t('dsc.query') }}</NButton>
      </div>

      <NCard v-if="metadata" size="small" style="margin-top: 12px">
        <NDescriptions :column="2" size="small">
          <NDescriptionsItem label="Status">
            <NTag size="small">{{ metadata.status }}</NTag>
          </NDescriptionsItem>
          <NDescriptionsItem label="Delivery">{{ metadata.deliveryMode }}</NDescriptionsItem>
          <NDescriptionsItem label="DSC">{{ metadata.dscSelection }}</NDescriptionsItem>
          <NDescriptionsItem label="DGs">
            {{ (metadata.dataGroups as number[])?.join(', ') }}
          </NDescriptionsItem>
        </NDescriptions>
        <NAlert
          v-if="metadata.status === 'approved'"
          type="warning"
          :title="$t('dsc.revealWarningTitle')"
          style="margin-top: 12px"
        >
          {{ $t('dsc.revealWarning') }}
        </NAlert>
        <div class="epass42-actions" style="margin-top: 12px">
          <NButton size="small" @click="loadPreview">{{ $t('dsc.previewTitle') }}</NButton>
          <NButton
            v-if="metadata.status === 'approved'"
            size="small"
            type="warning"
            @click="reveal"
          >
            {{ $t('dsc.reveal') }}
          </NButton>
        </div>
      </NCard>

      <NCard v-if="preview" size="small" style="margin-top: 12px" :title="$t('dsc.previewTitle')">
        <NDescriptions :column="2" size="small">
          <NDescriptionsItem label="Surname">{{
            preview.surname.value ?? $t('mask.hidden')
          }}</NDescriptionsItem>
          <NDescriptionsItem label="Given names">{{
            preview.givenNames.value ?? $t('mask.hidden')
          }}</NDescriptionsItem>
          <NDescriptionsItem label="Document number">
            {{ preview.documentNumber.value ?? $t('mask.hidden') }}
          </NDescriptionsItem>
          <NDescriptionsItem label="Birth">{{ preview.dateOfBirth.value }}</NDescriptionsItem>
          <NDescriptionsItem label="Images">
            DG2 {{ preview.images.dg2 ? '✓' : '—' }} / DG5 {{ preview.images.dg5 ? '✓' : '—' }} /
            DG7
            {{ preview.images.dg7 ? '✓' : '—' }}
          </NDescriptionsItem>
        </NDescriptions>
      </NCard>

      <NAlert
        v-if="claimed"
        type="warning"
        style="margin-top: 12px"
        :title="$t('dsc.claimedWarning')"
      />
    </NCard>
  </div>
</template>
