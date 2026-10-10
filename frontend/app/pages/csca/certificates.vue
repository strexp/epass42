<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import { NButton, NCard, NDataTable, useDialog, useMessage } from 'naive-ui'
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
const message = useMessage()
const dialog = useDialog()
const certificates = ref<Certificate[]>([])

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
  const result = await api<{ items: Certificate[] }>('/csca/certificates?includeRevoked=true')
  certificates.value = result.items ?? []
}

async function revoke(id: number): Promise<void> {
  try {
    await api(`/csca/certificates/${id}/revoke`, {
      method: 'POST',
      body: { reason: 'revoked via UI' },
    })
    message.success(t('common.success'))
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

const columns = computed(() => [
  { title: '#', key: 'id' },
  { title: 'Subject', key: 'subjectDn' },
  { title: 'MNT', key: 'mnt' },
  {
    title: 'Status',
    key: 'status',
    render: (row: Certificate) => h(StatusTag, { status: row.status }),
  },
  { title: 'SHA-256', key: 'fingerprintSha256', ellipsis: { tooltip: true } },
  {
    title: '',
    key: 'download',
    render: (row: Certificate) =>
      h('div', { class: 'epass42-actions' }, [
        h(
          NButton,
          {
            size: 'tiny',
            onClick: () =>
              downloadUrl(`${apiBase}/csca/certificates/${row.id}.pem`, `dsc-${row.id}.pem`),
          },
          { default: () => 'PEM' },
        ),
        h(
          NButton,
          {
            size: 'tiny',
            onClick: () =>
              downloadUrl(`${apiBase}/csca/certificates/${row.id}.der`, `dsc-${row.id}.der`),
          },
          { default: () => 'DER' },
        ),
        canDownloadKey(row)
          ? h(NButton, { size: 'tiny', onClick: () => downloadKey(row) }, () =>
              t('csca.privateKey'),
            )
          : null,
        isCscaAdmin.value && row.status === 'active' && row.source === 'owned'
          ? h(NButton, { size: 'tiny', onClick: () => revoke(row.id) }, () => t('common.revoke'))
          : null,
      ]),
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
      <NDataTable :columns="columns" :data="certificates" size="small" />
      <template #footer>
        <NuxtLink to="/csca"
          ><NButton size="small">{{ $t('common.back') }}</NButton></NuxtLink
        >
      </template>
    </NCard>
  </div>
</template>
