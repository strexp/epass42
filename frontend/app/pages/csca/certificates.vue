<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import { NButton, NCard, NDataTable, NDropdown, useDialog, useMessage } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import { errorMessageKey, useApiBase } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { downloadUrl } from '~/utils/download'
import StatusTag from '~/components/common/StatusTag.vue'

interface Certificate {
  id: number
  serial: string
  subjectDn: string
  status: string
  source: string
  mnt: string | null
  fingerprintSha256: string
  hasPrivateKey: boolean
}

const api = useApi()
const apiBase = useApiBase()
const { state, ensureLoaded } = useRealm('csca')
const { t } = useI18n()
usePageTitle(() => t('csca.certificatesTitle'))
const message = useMessage()
const dialog = useDialog()
const certificates = ref<Certificate[]>([])
const loading = ref(false)

const isCscaAdmin = computed(() => state.value.me?.isAdmin ?? false)
const myMnt = computed(() => state.value.me?.account.activeMnt ?? null)

/** Whether the current user may download this certificate's private key. */
function canDownloadKey(row: Certificate): boolean {
  if (!row.hasPrivateKey || state.value.me === null) return false
  return isCscaAdmin.value || (row.mnt !== null && row.mnt === myMnt.value)
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
      downloadUrl(keyUrl(row.id), `dsc-${row.id}.key`)
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

async function revoke(id: number): Promise<void> {
  try {
    await api(`/csca/certificates/${id}/revoke`, {
      method: 'POST',
      body: { reason: 'revoked via UI' },
    })
    message.success(t('common.revoked'))
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
    ...(isCscaAdmin.value && row.status === 'active' && row.source === 'owned'
      ? [{ label: t('common.revoke'), key: 'revoke' }]
      : []),
  ]
  return h(
    NDropdown,
    { options, onSelect: (key: string | number) => onAction(row, String(key)) },
    { default: () => h(NButton, { size: 'tiny' }, { default: () => t('common.actions') }) },
  )
}

/** Confirms before revoking (the menu item is easy to hit by mistake). */
function confirmRevoke(row: Certificate): void {
  dialog.warning({
    title: t('common.revoke'),
    content: t('csca.revokeConfirm'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      void revoke(row.id)
    },
  })
}

function onAction(row: Certificate, key: string): void {
  if (key === 'pem') {
    downloadUrl(`${apiBase}/csca/certificates/${row.id}.pem`, `dsc-${row.id}.pem`)
  } else if (key === 'der') {
    downloadUrl(`${apiBase}/csca/certificates/${row.id}.der`, `dsc-${row.id}.der`)
  } else if (key === 'key') {
    downloadKey(row)
  } else if (key === 'revoke') {
    confirmRevoke(row)
  }
}

const columns = computed(() => [
  { title: '#', key: 'id' },
  { title: t('common.subject'), key: 'subjectDn' },
  { title: t('common.mnt'), key: 'mnt' },
  {
    title: t('common.status'),
    key: 'status',
    render: (row: Certificate) => h(StatusTag, { status: row.status }),
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
  await load()
})
</script>

<template>
  <div class="epass42-page">
    <PageHeader
      :title="$t('csca.certificatesTitle')"
      :breadcrumbs="[{ label: $t('nav.csca'), to: '/csca' }, { label: $t('nav.certificates') }]"
    />
    <NCard>
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
  </div>
</template>
