<script setup lang="ts">
import {
  NButton,
  NCard,
  NDataTable,
  NInput,
  NTabPane,
  NTabs,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { errorMessageKey } from '~/composables/useApi'

interface Application {
  id: number
  subjectCn: string | null
  status: string
  asn: number | null
  keyMode: string
  createdAt: string
}

const auth = useAuthStore()
const api = useApi()
const { t } = useI18n()
const message = useMessage()

const applications = ref<Application[]>([])
const loading = ref(false)
const rejectId = ref<number | null>(null)
const rejectReason = ref('')

const isAdmin = computed(() => auth.realms.csca.me?.isAdmin ?? false)

async function load(): Promise<void> {
  loading.value = true
  try {
    applications.value = await api<Application[]>('/csca/applications')
  } catch {
    applications.value = []
  } finally {
    loading.value = false
  }
}

async function approve(id: number): Promise<void> {
  try {
    await api(`/csca/applications/${id}/approve`, { method: 'POST' })
    message.success(t('common.success'))
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

async function reject(): Promise<void> {
  if (rejectId.value === null) return
  try {
    await api(`/csca/applications/${rejectId.value}/reject`, {
      method: 'POST',
      body: { reason: rejectReason.value },
    })
    rejectId.value = null
    rejectReason.value = ''
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

const columns = [
  { title: '#', key: 'id' },
  { title: 'CN', key: 'subjectCn' },
  { title: 'AS', key: 'asn' },
  { title: 'Mode', key: 'keyMode' },
  {
    title: 'Status',
    key: 'status',
    render: (row: Application) => h(NTag, { size: 'small' }, () => row.status),
  },
  {
    title: '',
    key: 'actions',
    render: (row: Application) =>
      row.status === 'submitted' && isAdmin.value
        ? h('div', { class: 'pkd42-actions' }, [
            h(NButton, { size: 'tiny', onClick: () => approve(row.id) }, () => t('common.approve')),
            h(NButton, { size: 'tiny', onClick: () => (rejectId.value = row.id) }, () =>
              t('common.reject'),
            ),
          ])
        : null,
  },
]

onMounted(async () => {
  if (!auth.realms.csca.loaded) await auth.fetchMe('csca')
  if (isAdmin.value) await load()
})
</script>

<template>
  <div class="pkd42-page">
    <NTabs>
      <NTabPane name="apply" :tab="$t('csca.applyTitle')">
        <NuxtLink to="/csca/apply">
          <NButton type="primary">{{ $t('nav.apply') }}</NButton>
        </NuxtLink>
      </NTabPane>
      <NTabPane name="admin" :tab="$t('csca.adminTitle')">
        <template v-if="isAdmin">
          <NDataTable :columns="columns" :data="applications" :loading="loading" size="small" />
          <NCard
            v-if="rejectId !== null"
            style="margin-top: 12px"
            size="small"
            :title="$t('csca.reject')"
          >
            <NInput v-model:value="rejectReason" type="textarea" />
            <template #footer>
              <NButton size="small" @click="reject">{{ $t('common.confirm') }}</NButton>
              <NButton size="small" quaternary @click="rejectId = null">{{
                $t('common.cancel')
              }}</NButton>
            </template>
          </NCard>
        </template>
        <NText v-else depth="3">{{ $t('errors.forbidden') }}</NText>
      </NTabPane>
      <NTabPane name="certs" :tab="$t('nav.certificates')">
        <NuxtLink to="/csca/certificates">
          <NButton>{{ $t('csca.certificatesTitle') }}</NButton>
        </NuxtLink>
      </NTabPane>
    </NTabs>
  </div>
</template>
