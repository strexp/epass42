<script setup lang="ts">
import { NButton, NCard, NDataTable, NTabPane, NTabs } from 'naive-ui'
import { h, onMounted, ref } from 'vue'

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

const api = useApi()

const certificates = ref<PkdCertificate[]>([])
const crls = ref<PkdCrl[]>([])
const masterlists = ref<{ id: string }[]>([])

function downloadLinks(id: string) {
  return h('div', { class: 'epass42-actions' }, [
    h('a', { href: `/pkd/objects/${id}.der` }, () => 'DER'),
    h('a', { href: `/pkd/objects/${id}.pem` }, () => 'PEM'),
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

onMounted(async () => {
  certificates.value = (await api<{ items: PkdCertificate[] }>('/pkd/certificates')).items
  crls.value = (await api<{ items: PkdCrl[] }>('/pkd/crls')).items
  masterlists.value = (await api<{ items: { id: string }[] }>('/pkd/masterlists')).items
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
      <NTabPane name="ldif" :tab="$t('pkd.ldif')">
        <NCard size="small">
          <p>{{ $t('pkd.ldifHint') }}</p>
          <a href="/pkd/ldif"
            ><NButton size="small">{{ $t('common.download') }} LDIF</NButton></a
          >
        </NCard>
      </NTabPane>
    </NTabs>
  </div>
</template>
