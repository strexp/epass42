<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import { NButton, NCard, NDataTable, NDropdown, NTag, useDialog, useMessage } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import { errorMessageKey, useApiBase } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { downloadUrl } from '~/utils/download'
import StatusTag from '~/components/common/StatusTag.vue'
import PermissionsSummary from '~/components/cvca/PermissionsSummary.vue'
import type { DvPermissions } from '@epass42/shared'

interface Certificate {
  id: number
  holderReference: string
  authorityReference: string
  subjectCn: string | null
  status: string
  source: string
  mnt: string | null
  keyMode: string
  dvClass: string
  permissions: DvPermissions
  hasPrivateKey: boolean
  notBefore: string | null
  notAfter: string | null
}

const api = useApi()
const apiBase = useApiBase()
const { state, ensureLoaded } = useRealm('cvca')
const { t } = useI18n()
const { formatDate } = useDateTime()
usePageTitle(() => t('cvca.certificatesTitle'))
const message = useMessage()
const dialog = useDialog()
const certificates = ref<Certificate[]>([])
const loading = ref(false)

const isAdmin = computed(() => state.value.me?.isAdmin ?? false)
const myMnt = computed(() => state.value.me?.account.activeMnt ?? null)

function isOwner(row: Certificate): boolean {
  return row.mnt !== null && row.mnt === myMnt.value
}

/** Whether the current user may download this certificate's private key. */
function canDownloadKey(row: Certificate): boolean {
  if (!row.hasPrivateKey || state.value.me === null) return false
  return isAdmin.value || isOwner(row)
}

function keyUrl(id: number): string {
  return `${apiBase}/cvca/certificates/${id}/private-key`
}

/** Confirms the one-time download, then triggers it and refreshes the list. */
function downloadKey(row: Certificate): void {
  dialog.warning({
    title: t('cvca.privateKeyTitle'),
    content: t('cvca.privateKeyWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      downloadUrl(keyUrl(row.id), `dv-${row.id}.key`)
      window.setTimeout(() => void load(), 1500)
    },
  })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await api<{ items: Certificate[] }>('/cvca/certificates')
    certificates.value = result.items ?? []
  } catch (error) {
    message.error(t(errorMessageKey(error)))
    certificates.value = []
  } finally {
    loading.value = false
  }
}

/** The per-certificate menu: DER download and, when allowed, the private key. */
function actionMenu(row: Certificate) {
  const options = [
    { label: t('common.der'), key: 'der' },
    ...(canDownloadKey(row) ? [{ label: t('cvca.privateKey'), key: 'key' }] : []),
  ]
  return h(
    NDropdown,
    { options, onSelect: (key: string | number) => onAction(row, String(key)) },
    { default: () => h(NButton, { size: 'tiny' }, { default: () => t('common.actions') }) },
  )
}

function onAction(row: Certificate, key: string): void {
  if (key === 'der') {
    downloadUrl(`${apiBase}/cvca/certificates/${row.id}.der`, `dv-${row.id}.der`)
  } else if (key === 'key') {
    downloadKey(row)
  }
}

const columns = computed(() => [
  { title: '#', key: 'id' },
  { title: t('common.cn'), key: 'subjectCn' },
  {
    title: t('cvca.holderReference'),
    key: 'holderReference',
    render: (row: Certificate) => h('span', { class: 'epass42-mono' }, row.holderReference),
  },
  { title: t('common.mnt'), key: 'mnt' },
  {
    title: t('cvca.dvClass'),
    key: 'dvClass',
    render: (row: Certificate) =>
      h(
        NTag,
        { size: 'small' },
        {
          default: () =>
            row.dvClass === 'foreign' ? t('cvca.dvClassForeign') : t('cvca.dvClassDomestic'),
        },
      ),
  },
  {
    title: t('cvca.permissionsTitle'),
    key: 'permissions',
    width: 180,
    ellipsis: true,
    render: (row: Certificate) =>
      h(PermissionsSummary, { permissions: row.permissions, maxWidth: '180px' }),
  },
  {
    title: t('common.status'),
    key: 'status',
    render: (row: Certificate) => h(StatusTag, { status: row.status }),
  },
  {
    title: t('pkd.validity'),
    key: 'validity',
    render: (row: Certificate) => `${formatDate(row.notBefore)} → ${formatDate(row.notAfter)}`,
  },
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
      :title="$t('cvca.certificatesTitle')"
      :breadcrumbs="[{ label: $t('nav.cvca'), to: '/cvca' }, { label: $t('nav.certificates') }]"
    />
    <NCard>
      <p>{{ $t('pkd.dvsHint') }}</p>
      <div role="region" :aria-label="$t('cvca.certificatesTitle')">
        <NDataTable
          :columns="columns"
          :data="certificates"
          :loading="loading"
          :pagination="{ pageSize: 10 }"
          size="small"
        />
      </div>
      <template #footer>
        <NuxtLink to="/cvca"
          ><NButton size="small">{{ $t('common.back') }}</NButton></NuxtLink
        >
      </template>
    </NCard>
  </div>
</template>
