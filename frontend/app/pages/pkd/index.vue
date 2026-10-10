<script setup lang="ts">
import {
  NButton,
  NCard,
  NDataTable,
  NDropdown,
  NFormItem,
  NInput,
  NResult,
  NSelect,
  NSpace,
  NTabPane,
  NTabs,
  NTag,
  NText,
} from 'naive-ui'
import { h, onMounted, reactive, ref } from 'vue'
import { COUNTRY_ALPHA3 } from '@epass42/shared'
import { useApiBase } from '~/composables/useApi'
import { documentTypeOptions } from '~/utils/documentTypes'
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
interface RevokedDocument {
  hash: string
  documentCode: string
  revokedAt: string | null
}

const api = useApi()
const apiBase = useApiBase()
const { t } = useI18n()

const certificates = ref<PkdCertificate[]>([])
const crls = ref<PkdCrl[]>([])
const masterlists = ref<{ id: string }[]>([])
const dscs = ref<PkdDsc[]>([])
const revoked = ref<RevokedDocument[]>([])
const loading = ref(false)

/** The MRZ fields a visitor reads from a document to check revocation. */
const lookup = reactive({
  documentCode: 'P',
  issuingState: COUNTRY_ALPHA3,
  documentNumber: '',
  dateOfBirth: '',
})
const checkResult = ref<{ hash: string; revoked: boolean } | null>(null)
const checking = ref(false)

async function checkRevoked(): Promise<void> {
  checking.value = true
  try {
    checkResult.value = await api<{ hash: string; revoked: boolean }>('/pkd/revoked/check', {
      method: 'POST',
      body: { ...lookup },
    })
  } catch {
    checkResult.value = null
  } finally {
    checking.value = false
  }
}

/** The DER/PEM download menu shown in each directory table row. */
function downloadLinks(id: string) {
  return h(
    NDropdown,
    {
      options: [
        { label: 'DER', key: 'der' },
        { label: 'PEM', key: 'pem' },
      ],
      onSelect: (key: string | number) =>
        downloadUrl(`${apiBase}/pkd/objects/${id}.${String(key)}`, `${id}.${String(key)}`),
    },
    { default: () => h(NButton, { size: 'tiny' }, { default: () => t('common.download') }) },
  )
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

const revokedColumns = [
  { title: t('pkd.hash'), key: 'hash', ellipsis: { tooltip: true } },
  { title: t('pkd.documentCode'), key: 'documentCode' },
  { title: t('pkd.revokedAt'), key: 'revokedAt' },
]

const pagination = { pageSize: 10 }

onMounted(async () => {
  loading.value = true
  try {
    certificates.value = (await api<{ items: PkdCertificate[] }>('/pkd/certificates')).items
    crls.value = (await api<{ items: PkdCrl[] }>('/pkd/crls')).items
    masterlists.value = (await api<{ items: { id: string }[] }>('/pkd/masterlists')).items
    dscs.value = (await api<{ items: PkdDsc[] }>('/pkd/dscs')).items
    revoked.value = (await api<{ items: RevokedDocument[] }>('/pkd/revoked')).items
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="epass42-page">
    <PageHeader :title="$t('pkd.title')" :subtitle="$t('pkd.subtitle')" />
    <NTabs>
      <NTabPane name="certs" :tab="$t('pkd.certificates')">
        <NCard size="small">
          <p>{{ $t('pkd.certificatesHint') }}</p>
          <NDataTable
            :columns="certColumns"
            :data="certificates"
            :loading="loading"
            :pagination="pagination"
            size="small"
          />
        </NCard>
      </NTabPane>
      <NTabPane name="crls" :tab="$t('pkd.crls')">
        <NDataTable
          :columns="crlColumns"
          :data="crls"
          :loading="loading"
          :pagination="pagination"
          size="small"
        />
      </NTabPane>
      <NTabPane name="mls" :tab="$t('pkd.masterlists')">
        <NDataTable
          :columns="mlColumns"
          :data="masterlists"
          :loading="loading"
          :pagination="pagination"
          size="small"
        />
      </NTabPane>
      <NTabPane name="dscs" :tab="$t('pkd.dscs')">
        <NCard size="small">
          <p>{{ $t('pkd.dscsHint') }}</p>
          <NDataTable
            :columns="dscColumns"
            :data="dscs"
            :loading="loading"
            :pagination="pagination"
            size="small"
          />
        </NCard>
      </NTabPane>
      <NTabPane name="revoked" :tab="$t('pkd.revoked')">
        <NCard size="small">
          <p>{{ $t('pkd.revokedHint') }}</p>
          <NSpace align="end" style="margin-bottom: 12px">
            <NFormItem :label="$t('pkd.documentCode')" style="margin-bottom: 0">
              <NSelect
                v-model:value="lookup.documentCode"
                :options="documentTypeOptions"
                style="width: 160px"
              />
            </NFormItem>
            <NFormItem :label="$t('pkd.issuingState')" style="margin-bottom: 0">
              <NText class="epass42-mono">{{ lookup.issuingState }}</NText>
            </NFormItem>
            <NFormItem :label="$t('pkd.documentNumber')" style="margin-bottom: 0">
              <NInput v-model:value="lookup.documentNumber" maxlength="9" style="width: 160px" />
            </NFormItem>
            <NFormItem :label="$t('pkd.dateOfBirth')" style="margin-bottom: 0">
              <DateField v-model="lookup.dateOfBirth" style="width: 160px" />
            </NFormItem>
            <NFormItem label=" " style="margin-bottom: 0">
              <NButton
                type="primary"
                :loading="checking"
                :disabled="!lookup.documentNumber || !lookup.dateOfBirth"
                @click="checkRevoked"
              >
                {{ $t('pkd.check') }}
              </NButton>
            </NFormItem>
          </NSpace>
          <NResult
            v-if="checkResult"
            :status="checkResult.revoked ? 'error' : 'success'"
            :title="checkResult.revoked ? $t('pkd.revokedYes') : $t('pkd.revokedNo')"
            :description="checkResult.hash"
            size="small"
            style="margin-bottom: 12px"
          />
          <NDataTable
            :columns="revokedColumns"
            :data="revoked"
            :loading="loading"
            :pagination="pagination"
            size="small"
          />
        </NCard>
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
