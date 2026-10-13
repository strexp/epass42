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
  useDialog,
  useMessage,
} from 'naive-ui'
import type { DvClass, DvPermissions } from '@epass42/shared'
import { computed, onMounted, ref } from 'vue'
import StatusTag from '~/components/common/StatusTag.vue'
import PermissionsEditor from '~/components/cvca/PermissionsEditor.vue'
import PermissionsSummary from '~/components/cvca/PermissionsSummary.vue'
import { errorMessageKey, useApiBase } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { downloadUrl } from '~/utils/download'

interface Application {
  id: number
  mnt: string | null
  applicantAccountId: number | null
  ip: string | null
  keyMode: string
  subjectCn: string | null
  holderMnemonic: string | null
  dvClass: string
  csrPem: string | null
  publicKeyPem: string | null
  permissionsJson: string | null
  overridePermissionsJson: string | null
  overrideDvClass: string | null
  validityDays: number | null
  applicationUrl: string | null
  notes: string | null
  status: string
  reviewedAt: string | null
  rejectReason: string | null
  /** The issued DV certificate, for the one-time private-key export. */
  dvCertId: number | null
  /** Whether the issued DV private key is still available. */
  hasPrivateKey: boolean
  createdAt: string
}

const EMPTY: DvPermissions = {
  epassport: { dg3: false, dg4: false },
  travel: { read: false, write: false },
  visa: { read: false, write: false },
  biometrics: { read: false, write: false },
}

const route = useRoute()
const api = useApi()
const apiBase = useApiBase()
const { t } = useI18n()
usePageTitle(() => t('cvca.applicationTitle'))
const message = useMessage()
const dialog = useDialog()
const { state, ensureLoaded } = useRealm('cvca')

const id = computed(() => String(route.params.id ?? ''))
const application = ref<Application | null>(null)
const requested = ref<DvPermissions>({ ...EMPTY })
const review = ref<DvPermissions>({ ...EMPTY })
const requestedClass = ref<DvClass>('domestic')
const reviewClass = ref<DvClass>('domestic')
const busy = ref(false)
const rejectOpen = ref(false)
const rejectReason = ref('')

const isAdmin = computed(() => state.value.me?.isAdmin ?? false)
const canReview = computed(() => isAdmin.value && application.value?.status === 'submitted')

/** A system-generated DV key may be claimed once, from the application. */
const canDownloadKey = computed(
  () => application.value?.status === 'approved' && application.value.hasPrivateKey,
)

/** Confirms the one-time, irreversible claim before handing out the key. */
function confirmDownloadKey(): void {
  const row = application.value
  if (!row?.dvCertId) return
  dialog.warning({
    title: t('cvca.privateKeyTitle'),
    content: t('cvca.privateKeyWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      downloadUrl(
        `${apiBase}/cvca/certificates/${row.dvCertId}/private-key`,
        `dv-${row.dvCertId}.key`,
      )
      window.setTimeout(() => void load(), 1500)
    },
  })
}

const dvClassOptions = computed(() => [
  { label: t('cvca.dvClassDomestic'), value: 'domestic' },
  { label: t('cvca.dvClassForeign'), value: 'foreign' },
])

function classLabel(value: DvClass): string {
  return value === 'foreign' ? t('cvca.dvClassForeign') : t('cvca.dvClassDomestic')
}

function parse(json: string | null): DvPermissions {
  if (!json) return { ...EMPTY }
  try {
    return { ...EMPTY, ...(JSON.parse(json) as DvPermissions) }
  } catch {
    return { ...EMPTY }
  }
}

function samePermissions(a: DvPermissions, b: DvPermissions): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function load(): Promise<void> {
  try {
    const row = await api<Application>(`/cvca/applications/${id.value}`)
    application.value = row
    requested.value = parse(row.permissionsJson)
    review.value = parse(row.overridePermissionsJson ?? row.permissionsJson)
    requestedClass.value = row.dvClass === 'foreign' ? 'foreign' : 'domestic'
    reviewClass.value = (row.overrideDvClass ?? row.dvClass) === 'foreign' ? 'foreign' : 'domestic'
  } catch (error) {
    message.error(t(errorMessageKey(error)))
    application.value = null
  }
}

async function approve(): Promise<void> {
  busy.value = true
  try {
    const body: { permissions?: DvPermissions; dvClass?: DvClass } = {}
    if (!samePermissions(review.value, requested.value)) body.permissions = review.value
    if (reviewClass.value !== requestedClass.value) body.dvClass = reviewClass.value
    await api(`/cvca/applications/${id.value}/approve`, {
      method: 'POST',
      body: Object.keys(body).length ? body : undefined,
    })
    message.success(t('common.approved'))
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    busy.value = false
  }
}

async function reject(): Promise<void> {
  busy.value = true
  try {
    await api(`/cvca/applications/${id.value}/reject`, {
      method: 'POST',
      body: { reason: rejectReason.value || 'rejected' },
    })
    rejectOpen.value = false
    rejectReason.value = ''
    message.success(t('common.rejected'))
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await ensureLoaded()
  await load()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <PageHeader
        :title="$t('cvca.applicationTitle')"
        :subtitle="`#${id}`"
        :breadcrumbs="[{ label: $t('nav.cvca'), to: '/cvca' }, { label: `#${id}` }]"
      />

      <NCard v-if="application" size="small" :title="$t('cvca.applicationTitle')">
        <template #header-extra>
          <StatusTag :status="application.status" />
        </template>
        <NDescriptions :column="2" size="small" :bordered="false">
          <NDescriptionsItem :label="$t('cvca.subjectCn')">
            {{ application.subjectCn ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.holderMnemonic')">
            {{ application.holderMnemonic ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.dvClass')">
            {{ classLabel(requestedClass) }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.keyMode')">
            {{
              application.keyMode === 'remote_generated'
                ? $t('cvca.keyModeNia')
                : $t('cvca.keyModeUpload')
            }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('common.mnt')">{{
            application.mnt ?? '—'
          }}</NDescriptionsItem>
          <NDescriptionsItem :label="$t('common.ip')">{{
            application.ip ?? '—'
          }}</NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.validityDays')">
            {{ application.validityDays ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.applicationUrl')">
            {{ application.applicationUrl ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.submittedAt')">
            <DateTimeText :value="application.createdAt" />
          </NDescriptionsItem>
          <NDescriptionsItem v-if="application.reviewedAt" :label="$t('cvca.reviewedAt')">
            <DateTimeText :value="application.reviewedAt" />
          </NDescriptionsItem>
        </NDescriptions>

        <div style="margin-top: 12px">
          <NText strong>{{ $t('cvca.permissionsTitle') }}</NText>
          <PermissionsEditor :model-value="requested" readonly style="margin-top: 8px" />
        </div>

        <NText v-if="application.notes" depth="3" style="display: block; margin-top: 8px">
          {{ application.notes }}
        </NText>
        <NCollapse v-if="application.csrPem || application.publicKeyPem" style="margin-top: 12px">
          <NCollapseItem v-if="application.csrPem" :title="$t('cvca.csr')" name="csr">
            <NInput
              :value="application.csrPem"
              type="textarea"
              :rows="6"
              readonly
              class="epass42-mono"
            />
          </NCollapseItem>
          <NCollapseItem v-if="application.publicKeyPem" :title="$t('cvca.publicKey')" name="spki">
            <NInput
              :value="application.publicKeyPem"
              type="textarea"
              :rows="5"
              readonly
              class="epass42-mono"
            />
          </NCollapseItem>
        </NCollapse>
        <NText v-if="application.rejectReason" depth="3" style="display: block; margin-top: 8px">
          {{ $t('cvca.rejectReason') }}: {{ application.rejectReason }}
        </NText>

        <template v-if="canDownloadKey">
          <NAlert type="warning" :title="$t('cvca.privateKeyTitle')" style="margin-top: 12px">
            {{ $t('cvca.privateKeyWarning') }}
          </NAlert>
          <div class="epass42-actions" style="margin-top: 12px">
            <NButton type="warning" @click="confirmDownloadKey">
              {{ $t('cvca.privateKeyTitle') }}
            </NButton>
          </div>
        </template>

        <div v-if="canReview" style="margin-top: 16px">
          <NText strong>{{ $t('cvca.approvedPermissions') }}</NText>
          <NText depth="3" style="display: block; font-size: 12px; margin: 4px 0 8px">
            {{ $t('cvca.reviewHint') }}
          </NText>
          <div style="max-width: 280px; margin-bottom: 12px">
            <NText depth="3" style="font-size: 12px">{{ $t('cvca.dvClass') }}</NText>
            <NSelect v-model:value="reviewClass" :options="dvClassOptions" />
          </div>
          <PermissionsEditor v-model="review" />
          <div class="epass42-actions" style="margin-top: 12px">
            <NButton type="primary" :loading="busy" @click="approve">
              {{ $t('cvca.approve') }}
            </NButton>
            <NButton @click="rejectOpen = true">{{ $t('common.reject') }}</NButton>
          </div>
        </div>
        <div v-else-if="application.status === 'approved'" style="margin-top: 16px">
          <NText strong>{{ $t('cvca.approvedPermissions') }}</NText>
          <NSpace align="center" :size="8" style="margin-top: 8px">
            <NTag size="small">{{ classLabel(reviewClass) }}</NTag>
            <PermissionsSummary :permissions="review" />
          </NSpace>
        </div>
      </NCard>

      <NText v-else depth="3">{{ $t('errors.not_found') }}</NText>

      <NuxtLink to="/cvca">
        <NButton quaternary size="small">{{ $t('common.back') }}</NButton>
      </NuxtLink>
    </NSpace>

    <NModal
      v-model:show="rejectOpen"
      preset="card"
      :title="$t('cvca.rejectReason')"
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
