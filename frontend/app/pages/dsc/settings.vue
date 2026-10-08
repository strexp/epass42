<script setup lang="ts">
import {
  NButton,
  NCard,
  NFormItem,
  NIcon,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NText,
  useMessage,
} from 'naive-ui'
import { Save } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { errorMessageKey } from '~/composables/useApi'

definePageMeta({ layout: 'dsc' })

const auth = useAuthStore()
const api = useApi()
const { t } = useI18n()
const message = useMessage()

const deliveryMode = ref<'applicant' | 'reviewer'>('applicant')
const profile = ref({
  issuingAuthority: '',
  personalizationDevice: '',
  dg13Policy: '',
  validityYears: 10,
  security: {
    paceEcdhGm3des: true,
    paceEcdhGmAes128: true,
    caEcdh3des: false,
    caEcdhAes128: false,
    caKeyId: 1,
    aa: false,
  },
})

const isAdmin = computed(() => auth.realms.dsc.me?.isAdmin ?? false)

const deliveryOptions = computed(() => [
  { label: t('dsc.deliveryApplicant'), value: 'applicant' },
  { label: t('dsc.deliveryReviewer'), value: 'reviewer' },
])

async function load(): Promise<void> {
  if (!isAdmin.value) return
  try {
    deliveryMode.value = (
      await api<{ deliveryMode: 'applicant' | 'reviewer' }>('/dsc/settings/delivery-mode')
    ).deliveryMode
  } catch {
    /* ignore */
  }
  try {
    profile.value = await api('/dsc/settings/issuing-profile')
  } catch {
    /* ignore */
  }
}

async function saveDeliveryMode(value: string): Promise<void> {
  const mode = value === 'reviewer' ? 'reviewer' : 'applicant'
  try {
    await api('/dsc/settings/delivery-mode', { method: 'PUT', body: { deliveryMode: mode } })
    deliveryMode.value = mode
    message.success(t('common.success'))
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

async function saveProfile(): Promise<void> {
  try {
    await api('/dsc/settings/issuing-profile', { method: 'PUT', body: profile.value })
    message.success(t('common.success'))
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

onMounted(async () => {
  if (!auth.realms.dsc.loaded) await auth.fetchMe('dsc')
  await load()
})
</script>

<template>
  <div class="pkd42-page">
    <NSpace vertical size="large">
      <div>
        <h1 style="margin: 0">{{ $t('dsc.settingsTitle') }}</h1>
        <NText depth="2">{{ $t('dsc.settingsHint') }}</NText>
      </div>

      <NCard v-if="!isAdmin" :title="$t('dsc.settingsTitle')" size="small">
        <NText depth="3">{{ $t('errors.forbidden') }}</NText>
      </NCard>

      <template v-else>
        <NCard :title="$t('dsc.deliveryMode')" size="small">
          <NText depth="3">{{ $t('dsc.deliveryModeHint') }}</NText>
          <NSelect
            :value="deliveryMode"
            :options="deliveryOptions"
            style="max-width: 360px; margin-top: 8px"
            @update:value="saveDeliveryMode"
          />
        </NCard>

        <NCard :title="$t('dsc.issuingProfile')" size="small">
          <NFormItem :label="$t('dsc.issuanceAuthority')">
            <NInput v-model:value="profile.issuingAuthority" />
          </NFormItem>
          <NFormItem :label="$t('dsc.personalizationDevice')">
            <NInput v-model:value="profile.personalizationDevice" />
          </NFormItem>
          <NFormItem :label="$t('dsc.dg13Policy')">
            <NInput v-model:value="profile.dg13Policy" />
          </NFormItem>
          <NFormItem :label="$t('dsc.validityYears')">
            <NInputNumber v-model:value="profile.validityYears" :min="1" :max="30" />
          </NFormItem>
        </NCard>

        <NCard :title="$t('dsc.securityDefaults')" size="small">
          <NText depth="3">{{ $t('dsc.securityDefaultsHint') }}</NText>
          <SecurityOptions v-model="profile.security" style="margin-top: 12px" />
        </NCard>

        <NSpace>
          <NButton type="primary" @click="saveProfile">
            <template #icon
              ><NIcon><Save /></NIcon
            ></template>
            {{ $t('common.save') }}
          </NButton>
          <NuxtLink to="/dsc">
            <NButton quaternary>{{ $t('common.back') }}</NButton>
          </NuxtLink>
        </NSpace>
      </template>
    </NSpace>
  </div>
</template>
