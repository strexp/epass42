<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NFormItem,
  NIcon,
  NInput,
  NModal,
  NResult,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { ChevronDown, ChevronUp, LogIn } from '@lucide/vue'
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
  revokedAt: string | null
  revokeReason: string | null
  requesterAccountId: number | null
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
const { t, te } = useI18n()
const message = useMessage()
const notify = useNotify()
const { auth, state, ensureLoaded } = useRealm('dsc')

const reference = computed(() => String(route.params.reference ?? ''))
const meta = ref<RequestMeta | null>(null)
const masked = ref<Record<string, unknown> | null>(null)
const reviewed = ref<RequestMeta | null>(null)
const loading = ref(true)
const busy = ref(false)
/** The "Included information" data-group list is collapsed by default. */
const showDataGroups = ref(false)

const rejectOpen = ref(false)
const rejectReason = ref('')
const deliveryMode = ref<'applicant' | 'reviewer'>('applicant')

const me = computed(() => state.value.me)
const isReviewer = computed(() => (me.value?.reviewScope ?? 'none') !== 'none')
const isAdmin = computed(() => me.value?.isAdmin ?? false)

/** Whether the signed-in user owns this request (and may revoke it). */
const isOwner = computed(
  () =>
    meta.value?.requesterAccountId != null &&
    meta.value.requesterAccountId === me.value?.account.id,
)

const revokeOpen = ref(false)
const revokeReason = ref('')
const canRevoke = computed(() => isOwner.value && meta.value?.status === 'approved')

async function revokePassport(): Promise<void> {
  busy.value = true
  try {
    await api(`/dsc/passports/${reference.value}/revoke`, {
      method: 'POST',
      body: { reason: revokeReason.value || undefined },
    })
    revokeOpen.value = false
    revokeReason.value = ''
    message.success(t('common.success'))
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    busy.value = false
  }
}

/** Whether the produced perso may still be handed out (not yet consumed). */
const pendingDelivery = computed(() => meta.value?.status === 'approved' && !meta.value.consumedAt)

/**
 * The owner claiming their own applicant-delivery file.  Only this path is a
 * one-time "claim": a reviewer producing a file on the applicant's behalf is
 * not a claim and must not carry the claim warning.
 */
const canClaim = computed(
  () => isOwner.value && pendingDelivery.value && meta.value?.deliveryMode === 'applicant',
)

/** A NIA admin producing a reviewer-delivery file from the queue. */
const canProduce = computed(
  () => isAdmin.value && pendingDelivery.value && meta.value?.deliveryMode === 'reviewer',
)

/** Whether a reviewer may show/preview the unmasked submission. */
const signedIn = computed(() => me.value !== null)

/** Sends a signed-out visitor to the realm login, returning to this request. */
function login(): void {
  auth.login('dsc', `/dsc/requests/${reference.value}`)
}

const deliveryOptions = computed(() => [
  { label: t('dsc.deliveryApplicant'), value: 'applicant' },
  { label: t('dsc.deliveryReviewer'), value: 'reviewer' },
])

/** The data groups present in the request, in ascending order. */
const dataGroups = computed(() => meta.value?.dataGroups ?? [])

/** A human-readable explanation of a data group (ICAO Doc 9303-10). */
function dataGroupLabel(dataGroup: number): string {
  const key = `dsc.dataGroups.dg${dataGroup}`
  return te(key) ? t(key) : t('dsc.dataGroups.unknown', { number: dataGroup })
}

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
    // A NIA admin may override the service-wide default per request; the
    // delivery mode is only editable until the request is approved.
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
  // Reviewer delivery is produced by staff through the admin queue; applicant
  // delivery is claimed by the owner.
  const url = canProduce.value ? '/dsc/admin/requests' : '/dsc/requests'
  try {
    const perso = await api<string>(`${url}/${reference.value}/reveal`, { method: 'POST' })
    downloadText(`perso-${reference.value}.txt`, perso)
    notify.success(t('common.success'), `perso-${reference.value}.txt`)
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

onMounted(async () => {
  await ensureLoaded()
  if (!signedIn.value) return
  await load()
  await loadMasked()
  await loadReview()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace v-if="signedIn" vertical size="large">
      <PageHeader
        :title="$t('dsc.detailTitle')"
        :breadcrumbs="[{ label: $t('nav.dsc'), to: '/dsc' }, { label: $t('dsc.detailTitle') }]"
      >
        <template #subtitle>
          <NText depth="2">{{ $t('dsc.requestReference') }}: </NText>
          <NText class="epass42-mono" data-testid="reference">{{ reference }}</NText>
        </template>
      </PageHeader>

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
            <NSpace :size="4">
              <NTag v-for="dg in meta.dataGroups" :key="dg" size="small">DG{{ dg }}</NTag>
            </NSpace>
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
          v-if="meta.status === 'revoked'"
          type="warning"
          :title="$t('status.revoked.label')"
          style="margin-top: 12px"
        >
          {{ meta.revokeReason ?? '' }}
        </NAlert>
        <NAlert
          v-if="canClaim"
          type="warning"
          :title="$t('dsc.revealWarningTitle')"
          style="margin-top: 12px"
        >
          {{ $t('dsc.revealWarning') }}
        </NAlert>
        <div class="epass42-actions" style="margin-top: 12px">
          <NButton v-if="canClaim" type="warning" @click="reveal">
            {{ $t('dsc.reveal') }}
          </NButton>
          <NButton v-if="canProduce" type="warning" @click="reveal">
            {{ $t('dsc.produce') }}
          </NButton>
          <NButton v-if="canRevoke" type="error" @click="revokeOpen = true">
            {{ $t('dsc.revokePassport') }}
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

          <div v-if="isAdmin" style="margin-top: 12px">
            <NText depth="3" style="font-size: 12px">
              {{
                meta?.status === 'submitted'
                  ? $t('dsc.deliveryModeHint')
                  : $t('dsc.deliveryModeLocked')
              }}
            </NText>
            <NSelect
              v-model:value="deliveryMode"
              :options="deliveryOptions"
              size="small"
              :disabled="meta?.status !== 'submitted'"
              style="max-width: 320px; margin-top: 4px"
            />
          </div>

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

      <!-- Included information: what each data group carries (collapsed). -->
      <NCard v-if="meta" size="small" :title="$t('dsc.includedData')">
        <template #header-extra>
          <NButton
            quaternary
            size="tiny"
            :aria-expanded="showDataGroups"
            @click="showDataGroups = !showDataGroups"
          >
            <template #icon>
              <NIcon><ChevronUp v-if="showDataGroups" /><ChevronDown v-else /></NIcon>
            </template>
          </NButton>
        </template>
        <div v-show="showDataGroups" class="epass42-dg-list">
          <div v-for="dg in dataGroups" :key="dg" class="epass42-dg-item">
            <NTag size="small" type="info">DG{{ dg }}</NTag>
            <NText depth="2">{{ dataGroupLabel(dg) }}</NText>
          </div>
        </div>
      </NCard>

      <NuxtLink to="/dsc">
        <NButton quaternary size="small">{{ $t('common.back') }}</NButton>
      </NuxtLink>
    </NSpace>

    <NCard v-else :title="$t('dsc.detailTitle')">
      <NResult status="info" :title="$t('auth.signInTo', { realm: 'DSC' })">
        <template #footer>
          <NButton type="primary" @click="login">
            <template #icon
              ><NIcon><LogIn /></NIcon
            ></template>
            {{ $t('common.login') }}
          </NButton>
        </template>
      </NResult>
    </NCard>

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

    <NModal
      v-model:show="revokeOpen"
      preset="card"
      :title="$t('dsc.revokePassport')"
      style="max-width: 480px"
    >
      <NText depth="3">{{ $t('dsc.revokePassportConfirm') }}</NText>
      <NFormItem :label="$t('dsc.revokeReason')" style="margin-top: 12px">
        <NInput v-model:value="revokeReason" type="textarea" :rows="3" />
      </NFormItem>
      <template #footer>
        <NSpace justify="end">
          <NButton quaternary @click="revokeOpen = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="error" :loading="busy" @click="revokePassport">
            {{ $t('common.confirm') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.epass42-dg-list {
  display: grid;
  gap: 8px;
}
.epass42-dg-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
