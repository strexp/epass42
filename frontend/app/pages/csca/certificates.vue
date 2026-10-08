<script setup lang="ts">
definePageMeta({ layout: 'csca' })

import { NButton, NCard, NDataTable, NTag, useMessage } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { errorMessageKey } from '~/composables/useApi'

interface Certificate {
  id: number
  serial: string
  subjectDn: string
  status: string
  source: string
  asn: number | null
  fingerprintSha256: string
  hasPrivateKey: boolean
}

const api = useApi()
const auth = useAuthStore()
const { t } = useI18n()
const message = useMessage()
const config = useRuntimeConfig()
const certificates = ref<Certificate[]>([])

const apiBase = (config.public.apiBase as string) || ''
const isCscaAdmin = computed(() => auth.realms.csca.me?.isAdmin ?? false)
const myAsn = computed(() => auth.realms.csca.me?.account.asn ?? null)

/** Whether the current user may download this certificate's private key. */
function canDownloadKey(row: Certificate): boolean {
  if (!row.hasPrivateKey || auth.realms.csca.me === null) return false
  return isCscaAdmin.value || (row.asn !== null && row.asn === myAsn.value)
}

function keyUrl(id: number): string {
  return `${apiBase}/csca/certificates/${id}/private-key`
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
  { title: 'AS', key: 'asn' },
  {
    title: 'Status',
    key: 'status',
    render: (row: Certificate) => h(NTag, { size: 'small' }, () => row.status),
  },
  { title: 'SHA-256', key: 'fingerprintSha256', ellipsis: { tooltip: true } },
  {
    title: '',
    key: 'download',
    render: (row: Certificate) =>
      h('div', { class: 'pkd42-actions' }, [
        h('a', { href: `/csca/certificates/${row.id}.pem` }, () => 'PEM'),
        h('a', { href: `/csca/certificates/${row.id}.der` }, () => 'DER'),
        canDownloadKey(row)
          ? h('a', { href: keyUrl(row.id), download: `dsc-${row.id}.key` }, () =>
              t('csca.privateKey'),
            )
          : null,
        isCscaAdmin.value && row.status === 'active'
          ? h(NButton, { size: 'tiny', onClick: () => revoke(row.id) }, () => t('common.revoke'))
          : null,
      ]),
  },
])

onMounted(async () => {
  if (!auth.realms.csca.loaded) await auth.fetchMe('csca')
  await load()
})
</script>

<template>
  <div class="pkd42-page">
    <NCard :title="$t('csca.certificatesTitle')">
      <template #header-extra>
        <a href="/csca/crl.pem">{{ $t('csca.crl') }} (PEM)</a>
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
