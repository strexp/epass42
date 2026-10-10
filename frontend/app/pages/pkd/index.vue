<script setup lang="ts">
import { NButton, NCard, NDataTable, NTabPane, NTabs, NTag } from 'naive-ui'
import { h, onMounted, ref } from 'vue'
import { useApiBase } from '~/composables/useApi'
import { downloadUrl } from '~/utils/download'

interface PkdCertificate {
  id: string
  cn: string
  subject?: string
  status?: string
}
interface PkdCrl {
  id: string
  crlNumber: number
}
interface PkdDsc {
  id: number
  serial: string
  name: string
  mnt: string | null
  status: string
  documentTypes: string[]
  issuancePolicy: string | null
  applicationUrl: string | null
  notBefore: string | null
  notAfter: string | null
}

const api = useApi()
const apiBase = useApiBase()

const certificates = ref<PkdCertificate[]>([])
const crls = ref<PkdCrl[]>([])
const masterlists = ref<{ id: string }[]>([])
const dscs = ref<PkdDsc[]>([])

function downloadLinks(id: string) {
  return h('div', { class: 'epass42-actions' }, [
    h(
      NButton,
      { size: 'tiny', onClick: () => downloadUrl(`${apiBase}/pkd/objects/${id}.der`, `${id}.der`) },
      { default: () => 'DER' },
    ),
    h(
      NButton,
      { size: 'tiny', onClick: () => downloadUrl(`${apiBase}/pkd/objects/${id}.pem`, `${id}.pem`) },
      { default: () => 'PEM' },
    ),
  ])
}

const certColumns = [
  { title: 'CN', key: 'cn' },
  { title: 'Subject', key: 'subject' },
  { title: 'Status', key: 'status' },
  { title: '', key: 'download', render: (row: PkdCertificate) => downloadLinks(row.id) },
]
const crlColumns = [
  { title: 'CRL number', key: 'crlNumber' },
  { title: '', key: 'download', render: (row: PkdCrl) => downloadLinks(row.id) },
]
const mlColumns = [
  { title: 'ID', key: 'id' },
  { title: '', key: 'download', render: (row: { id: string }) => downloadLinks(row.id) },
]

const { t } = useI18n()

const dscColumns = [
  { title: t('pkd.name'), key: 'name', ellipsis: { tooltip: true } },
  { title: 'MNT', key: 'mnt' },
  {
    title: t('pkd.type'),
    key: 'documentTypes',
    render: (row: PkdDsc) => row.documentTypes.join(', ') || '—',
  },
  {
    title: t('pkd.policy'),
    key: 'issuancePolicy',
    render: (row: PkdDsc) => row.issuancePolicy ?? '—',
  },
  {
    title: t('pkd.validity'),
    key: 'validity',
    render: (row: PkdDsc) => `${row.notBefore ?? '—'} → ${row.notAfter ?? '—'}`,
  },
  {
    title: t('pkd.url'),
    key: 'applicationUrl',
    render: (row: PkdDsc) =>
      row.applicationUrl
        ? h(
            'a',
            { href: row.applicationUrl, target: '_blank', rel: 'noopener' },
            row.applicationUrl,
          )
        : '—',
  },
  {
    title: t('pkd.status'),
    key: 'status',
    render: (row: PkdDsc) => h(NTag, { size: 'small' }, () => row.status),
  },
]

onMounted(async () => {
  certificates.value = (await api<{ items: PkdCertificate[] }>('/pkd/certificates')).items
  crls.value = (await api<{ items: PkdCrl[] }>('/pkd/crls')).items
  masterlists.value = (await api<{ items: { id: string }[] }>('/pkd/masterlists')).items
  dscs.value = (await api<{ items: PkdDsc[] }>('/pkd/dscs')).items
})
</script>

<template>
  <div class="epass42-page">
    <h1>{{ $t('pkd.title') }}</h1>
    <NTabs>
      <NTabPane name="certs" :tab="$t('pkd.certificates')">
        <NDataTable :columns="certColumns" :data="certificates" size="small" />
      </NTabPane>
      <NTabPane name="crls" :tab="$t('pkd.crls')">
        <NDataTable :columns="crlColumns" :data="crls" size="small" />
      </NTabPane>
      <NTabPane name="mls" :tab="$t('pkd.masterlists')">
        <NDataTable :columns="mlColumns" :data="masterlists" size="small" />
      </NTabPane>
      <NTabPane name="dscs" :tab="$t('pkd.dscs')">
        <NDataTable :columns="dscColumns" :data="dscs" size="small" />
      </NTabPane>
      <NTabPane name="ldif" :tab="$t('pkd.ldif')">
        <NCard size="small">
          <p>{{ $t('pkd.ldifHint') }}</p>
          <NButton size="small" @click="downloadUrl(`${apiBase}/pkd/ldif`, 'epass42.ldif')">
            {{ $t('common.download') }} LDIF
          </NButton>
        </NCard>
      </NTabPane>
    </NTabs>
  </div>
</template>
