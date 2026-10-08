<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import { NButton, NCard, NDataTable, useDialog, useMessage } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
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
const { state, ensureLoaded } = useRealm('csca')
const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()
const config = useRuntimeConfig()
const certificates = ref<Certificate[]>([])

const apiBase = (config.public.apiBase as string) || ''
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
      const link = document.createElement('a')
      link.href = keyUrl(row.id)
      link.download = `dsc-${row.id}.key`
      document.body.appendChild(link)
      link.click()
      link.remove()
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
      h('div', { class: 'pkd42-actions' }, [
        h('a', { href: `/csca/certificates/${row.id}.pem` }, () => 'PEM'),
        h('a', { href: `/csca/certificates/${row.id}.der` }, () => 'DER'),
        canDownloadKey(row)
          ? h(NButton, { size: 'tiny', onClick: () => downloadKey(row) }, () =>
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
  await ensureLoaded()
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
