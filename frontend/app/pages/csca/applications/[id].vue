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
  NSpace,
  NTag,
  NText,
  useDialog,
  useMessage,
} from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import StatusTag from '~/components/common/StatusTag.vue'
import { errorMessageKey, useApiBase } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { documentTypesLabel } from '~/utils/documentTypes'
import { downloadUrl } from '~/utils/download'

interface Application {
  id: number
  mnt: string | null
  applicantAccountId: number | null
  ip: string | null
  keyMode: string
  subjectCn: string | null
  subjectO: string | null
  subjectOu: string | null
  csrPem: string | null
  publicKeyPem: string | null
  documentTypes: string[] | null
  validityDays: number | null
  issuancePolicy: string | null
  applicationUrl: string | null
  notes: string | null
  status: string
  reviewedAt: string | null
  rejectReason: string | null
  /** The issued DSC certificate, for the one-time private-key export. */
  dscCertId: number | null
  /** Whether the issued DSC private key is still available. */
  hasPrivateKey: boolean
  createdAt: string
}

const route = useRoute()
const api = useApi()
const apiBase = useApiBase()
const { t } = useI18n()
usePageTitle(() => t('csca.applicationTitle'))
const message = useMessage()
const dialog = useDialog()
const { state, ensureLoaded } = useRealm('csca')

const id = computed(() => String(route.params.id ?? ''))
const application = ref<Application | null>(null)
const busy = ref(false)
const rejectOpen = ref(false)
const rejectReason = ref('')

const isAdmin = computed(() => state.value.me?.isAdmin ?? false)
const canReview = computed(() => isAdmin.value && application.value?.status === 'submitted')

/** A system-generated DSC key may be claimed once, from the application. */
const canDownloadKey = computed(
  () => application.value?.status === 'approved' && application.value.hasPrivateKey,
)

/** Confirms the one-time, irreversible claim before handing out the key. */
function confirmDownloadKey(): void {
  const row = application.value
  if (!row?.dscCertId) return
  dialog.warning({
    title: t('csca.privateKeyTitle'),
    content: t('csca.privateKeyWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      downloadUrl(
        `${apiBase}/csca/certificates/${row.dscCertId}/private-key`,
        `dsc-${row.dscCertId}.key`,
      )
      window.setTimeout(() => void load(), 1500)
    },
  })
}

async function load(): Promise<void> {
  try {
    application.value = await api<Application>(`/csca/applications/${id.value}`)
  } catch (error) {
    message.error(t(errorMessageKey(error)))
    application.value = null
  }
}

async function approve(): Promise<void> {
  busy.value = true
  try {
    await api(`/csca/applications/${id.value}/approve`, { method: 'POST' })
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
    await api(`/csca/applications/${id.value}/reject`, {
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
        :title="$t('csca.applicationTitle')"
        :subtitle="`#${id}`"
        :breadcrumbs="[{ label: $t('nav.csca'), to: '/csca' }, { label: `#${id}` }]"
      />

      <NCard v-if="application" size="small" :title="$t('csca.applicationTitle')">
        <template #header-extra>
          <StatusTag :status="application.status" />
        </template>
        <NDescriptions :column="2" size="small" :bordered="false">
          <NDescriptionsItem :label="$t('csca.subjectCn')">
            {{ application.subjectCn ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.subjectO')">
            {{ application.subjectO ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.subjectOu')">
            {{ application.subjectOu ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.keyMode')">
            {{
              application.keyMode === 'remote_generated'
                ? $t('csca.keyModeNia')
                : $t('csca.keyModeUpload')
            }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('common.mnt')">{{
            application.mnt ?? '—'
          }}</NDescriptionsItem>
          <NDescriptionsItem :label="$t('common.ip')">{{
            application.ip ?? '—'
          }}</NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.documentType')">
            {{ documentTypesLabel(application.documentTypes ?? [], t) }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.validityDays')">
            {{ application.validityDays ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.issuancePolicy')">
            {{ application.issuancePolicy ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.applicationUrl')">
            {{ application.applicationUrl ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.submittedAt')">
            <DateTimeText :value="application.createdAt" />
          </NDescriptionsItem>
          <NDescriptionsItem v-if="application.reviewedAt" :label="$t('csca.reviewedAt')">
            <DateTimeText :value="application.reviewedAt" />
          </NDescriptionsItem>
        </NDescriptions>
        <NText v-if="application.notes" depth="3" style="display: block; margin-top: 8px">
          {{ application.notes }}
        </NText>
        <NCollapse v-if="application.csrPem || application.publicKeyPem" style="margin-top: 12px">
          <NCollapseItem v-if="application.csrPem" :title="$t('csca.csr')" name="csr">
            <NInput
              :value="application.csrPem"
              type="textarea"
              :rows="6"
              readonly
              class="epass42-mono"
            />
          </NCollapseItem>
          <NCollapseItem v-if="application.publicKeyPem" :title="$t('csca.publicKey')" name="spki">
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
          {{ $t('csca.rejectReason') }}: {{ application.rejectReason }}
        </NText>

        <template v-if="canDownloadKey">
          <NAlert type="warning" :title="$t('csca.privateKeyTitle')" style="margin-top: 12px">
            {{ $t('csca.privateKeyWarning') }}
          </NAlert>
          <div class="epass42-actions" style="margin-top: 12px">
            <NButton type="warning" @click="confirmDownloadKey">
              {{ $t('csca.privateKeyTitle') }}
            </NButton>
          </div>
        </template>

        <div v-if="canReview" class="epass42-actions" style="margin-top: 12px">
          <NButton type="primary" :loading="busy" @click="approve">
            {{ $t('csca.approve') }}
          </NButton>
          <NButton @click="rejectOpen = true">{{ $t('common.reject') }}</NButton>
        </div>
        <NTag v-if="canReview" size="small" type="info" style="margin-top: 8px">
          {{ $t('csca.reviewHint') }}
        </NTag>
      </NCard>

      <NText v-else depth="3">{{ $t('errors.not_found') }}</NText>

      <NuxtLink to="/csca">
        <NButton quaternary size="small">{{ $t('common.back') }}</NButton>
      </NuxtLink>
    </NSpace>

    <NModal
      v-model:show="rejectOpen"
      preset="card"
      :title="$t('csca.rejectReason')"
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
