<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import {
  NButton,
  NCard,
  NDataTable,
  NDropdown,
  NFormItem,
  NInput,
  NModal,
  NSpace,
  NText,
  useDialog,
  useMessage,
} from 'naive-ui'
import type { Lds2SignerType } from '@epass42/shared'
import { computed, h, onMounted, ref } from 'vue'
import { errorMessageKey, useApiBase } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { signerCertificateLabel } from '~/utils/lds2'
import { downloadUrl } from '~/utils/download'
import StatusTag from '~/components/common/StatusTag.vue'
import ExpiryAlert from '~/components/common/ExpiryAlert.vue'
import ValidityCell from '~/components/common/ValidityCell.vue'
import { expiryDescription, useCscaStatus } from '~/composables/useLifecycleStatus'

interface Certificate {
  id: number
  serial: string
  subjectDn: string
  status: string
  source: string
  mnt: string | null
  certificateType: 'dsc' | 'lds2'
  lds2Types: Lds2SignerType[] | null
  fingerprintSha256: string
  hasPrivateKey: boolean
  notBefore: string | null
  notAfter: string | null
  privateKeyNotAfter: string | null
}

const api = useApi()
const apiBase = useApiBase()
const { state, ensureLoaded, showAdmin } = useRealm('csca')
const { t } = useI18n()
const { formatDate } = useDateTime()
usePageTitle(() => t('csca.certificatesTitle'))
const message = useMessage()
const dialog = useDialog()
const certificates = ref<Certificate[]>([])
const loading = ref(false)
const revokeOpen = ref(false)
const revokeTarget = ref<Certificate | null>(null)
const revokeReason = ref('')
const { status: lifecycle, refresh: refreshLifecycle } = useCscaStatus()
const cscaExpiryText = computed(() =>
  expiryDescription(
    lifecycle.value?.csca ?? null,
    {
      missing: t('csca.expiredTitle'),
      certificate: (date) => t('csca.expiredWarning', { date }),
      privateKey: (date) => t('csca.privateKeyExpiredWarning', { date }),
    },
    formatDate,
  ),
)

const myMnt = computed(() => state.value.me?.account.activeMnt ?? null)

/** Whether the signed-in user owns this certificate's maintainer. */
function isOwner(row: Certificate): boolean {
  return row.mnt !== null && row.mnt === myMnt.value
}

/** Whether the current user may revoke this certificate. */
function canRevoke(row: Certificate): boolean {
  return (
    row.status === 'active' &&
    row.source === 'owned' &&
    state.value.me !== null &&
    (showAdmin.value || isOwner(row))
  )
}

/** Whether the current user may download this certificate's private key. */
function canDownloadKey(row: Certificate): boolean {
  if (!row.hasPrivateKey || state.value.me === null) return false
  return showAdmin.value || (row.mnt !== null && row.mnt === myMnt.value)
}

/** The file stem used for a certificate's downloads. */
function fileStem(row: Certificate): string {
  return `${row.certificateType === 'lds2' ? 'lds2' : 'dsc'}-${row.id}`
}

function keyUrl(id: number): string {
  return `${apiBase}/csca/certificates/${id}/private-key`
}

/** Confirms the one-time download, then triggers it and refreshes the list. */
function downloadKey(row: Certificate): void {
  dialog.warning({
    title: t('csca.privateKeyTitle'),
    content: t('csca.privateKeyWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      downloadUrl(keyUrl(row.id), `${fileStem(row)}.key`)
      // The key is consumed by the download; refresh so the action disappears.
      window.setTimeout(() => void load(), 1500)
    },
  })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await api<{ items: Certificate[] }>('/csca/certificates?includeRevoked=true')
    certificates.value = result.items ?? []
  } finally {
    loading.value = false
  }
}

async function revoke(): Promise<void> {
  const row = revokeTarget.value
  if (!row) return
  try {
    await api(`/csca/certificates/${row.id}/revoke`, {
      method: 'POST',
      body: { reason: revokeReason.value || undefined },
    })
    message.success(t('common.revoked'))
    revokeOpen.value = false
    revokeReason.value = ''
    revokeTarget.value = null
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

/** The per-certificate menu: format downloads and, for admins, revoke. */
function actionMenu(row: Certificate) {
  const options = [
    { label: t('common.pem'), key: 'pem' },
    { label: t('common.der'), key: 'der' },
    ...(canDownloadKey(row) ? [{ label: t('csca.privateKey'), key: 'key' }] : []),
    ...(canRevoke(row) ? [{ label: t('common.revoke'), key: 'revoke' }] : []),
  ]
  return h(
    NDropdown,
    { options, onSelect: (key: string | number) => onAction(row, String(key)) },
    { default: () => h(NButton, { size: 'tiny' }, { default: () => t('common.actions') }) },
  )
}

/** Opens the reason dialog before revoking. */
function confirmRevoke(row: Certificate): void {
  revokeTarget.value = row
  revokeReason.value = ''
  revokeOpen.value = true
}

function onAction(row: Certificate, key: string): void {
  if (key === 'pem') {
    downloadUrl(`${apiBase}/csca/certificates/${row.id}.pem`, `${fileStem(row)}.pem`)
  } else if (key === 'der') {
    downloadUrl(`${apiBase}/csca/certificates/${row.id}.der`, `${fileStem(row)}.der`)
  } else if (key === 'key') {
    downloadKey(row)
  } else if (key === 'revoke') {
    confirmRevoke(row)
  }
}

const columns = computed(() => [
  { title: '#', key: 'id' },
  {
    title: t('common.certificateType'),
    key: 'certificateType',
    render: (row: Certificate) => signerCertificateLabel(row.certificateType, row.lds2Types, t),
  },
  { title: t('common.subject'), key: 'subjectDn' },
  { title: t('common.mnt'), key: 'mnt' },
  {
    title: t('common.status'),
    key: 'status',
    render: (row: Certificate) => h(StatusTag, { status: row.status }),
  },
  {
    title: t('common.certificateValidity'),
    key: 'validity',
    render: (row: Certificate) =>
      h(ValidityCell, {
        notBefore: row.notBefore,
        notAfter: row.notAfter,
        privateKeyNotAfter: row.privateKeyNotAfter,
      }),
  },
  { title: t('common.sha256'), key: 'fingerprintSha256', ellipsis: { tooltip: true } },
  {
    title: '',
    key: 'actions',
    render: (row: Certificate) => actionMenu(row),
  },
])

onMounted(async () => {
  await ensureLoaded()
  await Promise.all([load(), refreshLifecycle()])
})
</script>

<template>
  <div class="epass42-page">
    <PageHeader
      :title="$t('csca.certificatesTitle')"
      :breadcrumbs="[{ label: $t('nav.csca'), to: '/csca' }, { label: $t('nav.certificates') }]"
    />
    <NCard>
      <ExpiryAlert
        v-if="lifecycle?.csca?.expired"
        :title="$t('csca.expiredTitle')"
        :description="cscaExpiryText"
      />
      <template #header-extra>
        <NButton size="small" @click="downloadUrl(`${apiBase}/csca/crl.pem`, 'crl.pem')">
          {{ $t('csca.crl') }} (PEM)
        </NButton>
      </template>
      <div role="region" :aria-label="$t('csca.certificatesTitle')">
        <NDataTable
          :columns="columns"
          :data="certificates"
          :loading="loading"
          :pagination="{ pageSize: 10 }"
          size="small"
        />
      </div>
      <template #footer>
        <NuxtLink to="/csca"
          ><NButton size="small">{{ $t('common.back') }}</NButton></NuxtLink
        >
      </template>
    </NCard>

    <NModal
      v-model:show="revokeOpen"
      preset="card"
      :title="$t('common.revoke')"
      style="max-width: 520px"
    >
      <NText depth="3">{{ $t('csca.revokeConfirm') }}</NText>
      <NFormItem :label="$t('csca.revokeReason')" style="margin-top: 12px">
        <NInput v-model:value="revokeReason" type="textarea" :rows="3" />
      </NFormItem>
      <template #footer>
        <NSpace justify="end">
          <NButton quaternary @click="revokeOpen = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="error" @click="revoke">{{ $t('common.revoke') }}</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
