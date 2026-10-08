<script setup lang="ts">
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
}

const api = useApi()
const auth = useAuthStore()
const { t } = useI18n()
const message = useMessage()
const certificates = ref<Certificate[]>([])

const isCscaAdmin = computed(() => auth.realms.csca.me?.isAdmin ?? false)

async function load(): Promise<void> {
  certificates.value = await api<Certificate[]>('/csca/certificates?includeRevoked=true')
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
