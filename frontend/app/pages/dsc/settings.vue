<script setup lang="ts">
import {
  NButton,
  NCard,
  NFormItem,
  NIcon,
  NInput,
  NInputNumber,
  NRadio,
  NRadioGroup,
  NSelect,
  NSpace,
  NSwitch,
  NText,
  useMessage,
} from 'naive-ui'
import { Save } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'

definePageMeta({ layout: 'realm' })

const { state, ensureLoaded } = useRealm('dsc')
const api = useApi()
const { t } = useI18n()
usePageTitle(() => t('dsc.settingsTitle'))
const message = useMessage()

const deliveryMode = ref<'applicant' | 'reviewer'>('applicant')
const profile = ref({
  issuingAuthority: '',
  personalizationDevice: '',
  dg13Policy: '',
  validityYears: 10,
  dg2MaxBytes: 16384,
  lds2: { enabled: false, roles: ['travel', 'visa', 'biometrics'] as string[] },
  security: {
    pace: { ecdhGm3des: true, ecdhGmAes128: true },
    aa: { enabled: false, algorithm: 'rsaSha1' as const },
    ca: { enabled: false, keyId: 1 },
    ta: { enabled: false },
  },
})

const isAdmin = computed(() => state.value.me?.isAdmin ?? false)
const signedIn = computed(() => state.value.me !== null)

const deliveryOptions = computed(() => [
  { label: t('dsc.deliveryApplicant'), value: 'applicant' },
  { label: t('dsc.deliveryReviewer'), value: 'reviewer' },
])

const lds2Options = computed(() => [
  { label: t('dsc.lds2Travel'), value: 'travel' },
  { label: t('dsc.lds2Visa'), value: 'visa' },
  { label: t('dsc.lds2Biometrics'), value: 'biometrics' },
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

/** `NRadioGroup` emits a wider union than the delivery mode accepts. */
function setDeliveryMode(value: string | number | boolean): void {
  void saveDeliveryMode(String(value))
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
  await ensureLoaded()
  await load()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <PageHeader
        :title="$t('dsc.settingsTitle')"
        :subtitle="$t('dsc.settingsHint')"
        :breadcrumbs="[{ label: $t('nav.dsc'), to: '/dsc' }, { label: $t('dsc.settingsTitle') }]"
      />

      <NCard v-if="!signedIn" :title="$t('dsc.settingsTitle')" size="small">
        <NText depth="3">{{ $t('auth.signInTo', { realm: 'DSC' }) }}</NText>
      </NCard>

      <NCard v-else-if="!isAdmin" :title="$t('dsc.settingsTitle')" size="small">
        <NText depth="3">{{ $t('errors.forbidden') }}</NText>
      </NCard>

      <template v-else>
        <NCard :title="$t('dsc.deliveryMode')" size="small">
          <NText depth="3">{{ $t('dsc.deliveryModeHint') }}</NText>
          <NRadioGroup
            :value="deliveryMode"
            role="radiogroup"
            :aria-label="$t('dsc.deliveryMode')"
            style="display: block; margin-top: 8px"
            @update:value="setDeliveryMode"
          >
            <NSpace>
              <NRadio
                v-for="option in deliveryOptions"
                :key="String(option.value)"
                :value="option.value"
              >
                {{ option.label }}
              </NRadio>
            </NSpace>
          </NRadioGroup>
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
          <NFormItem :label="$t('dsc.dg2MaxBytes')">
            <NInputNumber v-model:value="profile.dg2MaxBytes" :min="1024" :step="1024" />
          </NFormItem>
        </NCard>

        <NCard :title="$t('dsc.securityDefaults')" size="small">
          <NText depth="3">{{ $t('dsc.securityDefaultsHint') }}</NText>
          <SecurityOptions
            v-model="profile.security"
            :lds2-enabled="profile.lds2.enabled"
            style="margin-top: 12px"
          />
        </NCard>

        <NCard :title="$t('dsc.lds2Title')" size="small">
          <NText depth="3">{{ $t('dsc.lds2Hint') }}</NText>
          <div style="margin-top: 8px">
            <NSwitch
              v-model:value="profile.lds2.enabled"
              :aria-label="$t('dsc.lds2Title')"
              :disabled="!profile.security.ca.enabled && !profile.lds2.enabled"
            />
          </div>
          <NSelect
            v-if="profile.lds2.enabled"
            v-model:value="profile.lds2.roles"
            multiple
            :options="lds2Options"
            :input-props="{ 'aria-label': $t('dsc.lds2Title') }"
            style="max-width: 460px; margin-top: 8px"
          />
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
