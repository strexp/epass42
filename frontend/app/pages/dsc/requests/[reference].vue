<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NDescriptions,
  NDescriptionsItem,
  NInput,
  NModal,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import type { SignRequest } from '@epass42/shared'
import StatusTag from '~/components/common/StatusTag.vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { downloadText } from '~/utils/download'

interface RequestMeta {
  reference: string
  status: string
  createdAt: string
  reviewedAt: string | null
  rejectReason: string | null
  deliveryMode: string
  consumedAt: string | null
  dscSelection: string
  mnt: string | null
  ip: string | null
  dataGroups: number[]
  email: string | null
  payload?: SignRequest
}

const route = useRoute()
const api = useApi()
const { t } = useI18n()
const message = useMessage()
const { state, ensureLoaded } = useRealm('dsc')

const reference = computed(() => String(route.params.reference ?? ''))
const meta = ref<RequestMeta | null>(null)
const masked = ref<Record<string, unknown> | null>(null)
const reviewed = ref<RequestMeta | null>(null)
const loading = ref(true)
const busy = ref(false)

const rejectOpen = ref(false)
const rejectReason = ref('')
const deliveryMode = ref<'applicant' | 'reviewer'>('applicant')

const me = computed(() => state.value.me)
const isReviewer = computed(() => (me.value?.reviewScope ?? 'none') !== 'none')
const isAdmin = computed(() => me.value?.isAdmin ?? false)

/** Whether the current user may claim the produced file right now. */
const canRevealApplicant = computed(
  () => meta.value?.status === 'approved' && !meta.value.consumedAt,
)

/** Whether a reviewer may show/preview the unmasked submission. */
const signedIn = computed(() => me.value !== null)

const deliveryOptions = computed(() => [
  { label: t('dsc.deliveryApplicant'), value: 'applicant' },
  { label: t('dsc.deliveryReviewer'), value: 'reviewer' },
])

async function load(): Promise<void> {
  loading.value = true
  try {
    meta.value = await api<RequestMeta>(`/dsc/requests/${reference.value}`)
    deliveryMode.value = (meta.value.deliveryMode as 'applicant' | 'reviewer') ?? 'applicant'
  } catch (error) {
    message.error(t(errorMessageKey(error)))
    meta.value = null
  } finally {
    loading.value = false
  }
}

async function loadMasked(): Promise<void> {
  try {
    masked.value = await api(`/dsc/requests/${reference.value}/preview`)
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

/** Loads the unmasked submission for a reviewer. */
async function loadReview(): Promise<void> {
  if (!isReviewer.value) return
  try {
    reviewed.value = await api<RequestMeta>(`/dsc/requests/${reference.value}/review`)
  } catch {
    reviewed.value = null
  }
}

async function approve(): Promise<void> {
  busy.value = true
  try {
    await api(`/dsc/requests/${reference.value}/approve`, {
      method: 'POST',
      body: isAdmin.value ? { deliveryMode: deliveryMode.value } : {},
    })
    message.success(t('common.success'))
    await load()
    await loadReview()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    busy.value = false
  }
}

async function reject(): Promise<void> {
  busy.value = true
  try {
    await api(`/dsc/requests/${reference.value}/reject`, {
      method: 'POST',
      body: { reason: rejectReason.value || 'rejected' },
    })
    rejectOpen.value = false
    rejectReason.value = ''
    message.success(t('common.success'))
    await load()
    await loadReview()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    busy.value = false
  }
}

async function reveal(): Promise<void> {
  const url = isAdmin.value ? '/dsc/admin/requests' : '/dsc/requests'
  try {
    const perso = await api<string>(`${url}/${reference.value}/reveal`, { method: 'POST' })
    downloadText(`perso-${reference.value}.txt`, perso)
    message.success(t('common.success'))
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

onMounted(async () => {
  await ensureLoaded()
  await load()
  await loadMasked()
  await loadReview()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <div>
        <h1 style="margin: 0">{{ $t('dsc.detailTitle') }}</h1>
        <NText depth="2">{{ $t('dsc.requestReference') }}: </NText>
        <NText class="epass42-mono" data-testid="reference">{{ reference }}</NText>
      </div>

      <NCard v-if="meta" size="small" :title="$t('dsc.statusTitle')">
        <template #header-extra>
          <StatusTag :status="meta.status" />
        </template>
        <NDescriptions :column="2" size="small">
          <NDescriptionsItem :label="$t('dsc.submittedAt')">{{ meta.createdAt }}</NDescriptionsItem>
          <NDescriptionsItem v-if="meta.reviewedAt" :label="$t('dsc.reviewedAt')">
            {{ meta.reviewedAt }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dsc.receiveHow')">
            {{ meta.deliveryMode === 'reviewer' ? $t('dsc.receiveStaff') : $t('dsc.receiveSelf') }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dsc.includedData')">
            {{ meta.dataGroups.join(', ') }}
          </NDescriptionsItem>
        </NDescriptions>
        <NAlert
          v-if="meta.rejectReason"
          type="error"
          :title="$t('dsc.rejectReason')"
          style="margin-top: 12px"
        >
          {{ meta.rejectReason }}
        </NAlert>
        <NAlert
          v-if="canRevealApplicant"
          type="warning"
          :title="$t('dsc.revealWarningTitle')"
          style="margin-top: 12px"
        >
          {{ $t('dsc.revealWarning') }}
        </NAlert>
        <div class="epass42-actions" style="margin-top: 12px">
          <NButton
            v-if="canRevealApplicant && meta.deliveryMode === 'applicant'"
            type="warning"
            @click="reveal"
          >
            {{ $t('dsc.reveal') }}
          </NButton>
          <NButton
            v-if="canRevealApplicant && meta.deliveryMode === 'reviewer' && isAdmin"
            type="warning"
            @click="reveal"
          >
            {{ $t('dsc.reveal') }}
          </NButton>
        </div>
      </NCard>

      <!-- Reviewer-only: the unmasked submission and the decision. -->
      <NCard v-if="isReviewer" size="small" :title="$t('dsc.reviewTitle')">
        <NText depth="3">{{ $t('dsc.reviewHint') }}</NText>
        <template #header-extra>
          <NTag size="small" type="info">{{ $t('dsc.reviewerBadge') }}</NTag>
        </template>

        <template v-if="reviewed?.payload">
          <NDescriptions :column="2" size="small" style="margin-top: 8px">
            <NDescriptionsItem :label="$t('dsc.documentNumber')">
              {{ reviewed.payload.mrz.documentNumber }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.surname')">
              {{ reviewed.payload.mrz.surname }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.givenNames')">
              {{ reviewed.payload.mrz.givenNames }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.dateOfBirth')">
              {{ reviewed.payload.mrz.dateOfBirth }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.sex')">
              {{ reviewed.payload.mrz.sex }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.signingCertificate')">
              {{ reviewed.dscSelection }}
            </NDescriptionsItem>
          </NDescriptions>

          <NSelect
            v-if="isAdmin"
            v-model:value="deliveryMode"
            :options="deliveryOptions"
            size="small"
            style="max-width: 320px; margin-top: 12px"
          />

          <div class="epass42-actions" style="margin-top: 12px">
            <NButton
              v-if="meta?.status === 'submitted'"
              type="primary"
              :loading="busy"
              @click="approve"
            >
              {{ $t('common.approve') }}
            </NButton>
            <NButton v-if="meta?.status === 'submitted'" @click="rejectOpen = true">
              {{ $t('common.reject') }}
            </NButton>
          </div>
        </template>
        <NText v-else depth="3" style="display: block; margin-top: 8px">
          {{ $t('dsc.notReviewer') }}
        </NText>
      </NCard>

      <!-- Everyone: the masked, non-destructive preview. -->
      <NCard v-if="masked" size="small" :title="$t('dsc.previewTitle')">
        <NDescriptions :column="2" size="small">
          <NDescriptionsItem :label="$t('dsc.documentNumber')">
            {{ (masked.documentNumber as { value?: string })?.value ?? $t('mask.hidden') }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dsc.surname')">
            {{ (masked.surname as { value?: string })?.value ?? $t('mask.hidden') }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dsc.givenNames')">
            {{ (masked.givenNames as { value?: string })?.value ?? $t('mask.hidden') }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dsc.cardAccess')">
            {{ (masked.can as { value?: string })?.value ?? $t('mask.hidden') }}
          </NDescriptionsItem>
        </NDescriptions>
      </NCard>

      <NCollapse>
        <NCollapseItem :title="$t('dsc.includedData')" name="dgs">
          <NText>{{ (meta?.dataGroups ?? []).join(', ') }}</NText>
        </NCollapseItem>
      </NCollapse>

      <NText v-if="!signedIn" depth="3">{{ $t('dsc.ownerOnly') }}</NText>

      <NuxtLink to="/dsc/status">
        <NButton quaternary size="small">{{ $t('common.back') }}</NButton>
      </NuxtLink>
    </NSpace>

    <NModal
      v-model:show="rejectOpen"
      preset="card"
      :title="$t('common.reject')"
      style="max-width: 480px"
    >
      <NInput v-model:value="rejectReason" type="textarea" :rows="3" />
      <template #footer>
        <NSpace justify="end">
          <NButton quaternary @click="rejectOpen = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="error" :loading="busy" @click="reject">{{ $t('common.confirm') }}</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
