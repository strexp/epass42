<script setup lang="ts">
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NInputNumber,
  NResult,
  NSelect,
  NSpace,
  NStep,
  NSteps,
  NText,
  useMessage,
} from 'naive-ui'
import type { FormInst, FormRules } from 'naive-ui'
import { LogIn, Save } from '@lucide/vue'
import type { DvClass, DvPermissions } from '@epass42/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import PermissionsEditor from '~/components/cvca/PermissionsEditor.vue'

definePageMeta({ layout: 'realm' })

const api = useApi()
const { auth, state, ensureLoaded } = useRealm('cvca')
const { t } = useI18n()
usePageTitle(() => t('cvca.applyTitle'))
const message = useMessage()
const notify = useNotify()

const signedIn = computed(() => state.value.me !== null)

const form = reactive({
  keyMode: 'remote_generated' as 'remote_generated' | 'user_uploaded',
  subjectCn: '',
  holderMnemonic: '',
  dvClass: 'domestic' as DvClass,
  csrPem: '',
  publicKeyPem: '',
  permissions: {
    epassport: { dg3: true, dg4: true },
    travel: { read: true, write: false },
    visa: { read: true, write: false },
    biometrics: { read: true, write: false },
  } as DvPermissions,
  validityDays: 90,
  applicationUrl: '',
  notes: '',
})
const submitting = ref(false)

const keyModeOptions = computed(() => [
  { label: t('cvca.keyModeNia'), value: 'remote_generated' },
  { label: t('cvca.keyModeUpload'), value: 'user_uploaded' },
])

const dvClassOptions = computed(() => [
  { label: t('cvca.dvClassDomestic'), value: 'domestic' },
  { label: t('cvca.dvClassForeign'), value: 'foreign' },
])

function login(): void {
  auth.login('cvca', '/cvca/apply')
}

/** Wizard: 0 application, 1 review. */
const LAST_STEP = 1
const step = ref(0)
const formRef = ref<FormInst | null>(null)

function isUrl(value: string): boolean {
  if (value.trim() === '') return true
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

/** Field rules; Naive UI renders the inline feedback under each field. */
const rules = computed<FormRules>(() => ({
  subjectCn: {
    required: true,
    message: t('errors.required'),
    trigger: ['input', 'blur'],
  },
  applicationUrl: {
    validator: (_rule: unknown, value: string) => isUrl(value),
    message: t('errors.invalid_url'),
    trigger: ['input', 'blur'],
  },
  csrPem: {
    validator: () =>
      form.keyMode !== 'user_uploaded' ||
      form.csrPem.trim() !== '' ||
      form.publicKeyPem.trim() !== '',
    message: t('cvca.uploadHint'),
    trigger: ['input', 'blur'],
  },
}))

async function nextStep(): Promise<void> {
  if (step.value === 0) {
    try {
      await formRef.value?.validate()
    } catch {
      return
    }
  }
  if (step.value < LAST_STEP) step.value += 1
}

function prevStep(): void {
  if (step.value > 0) step.value -= 1
}

async function submit(): Promise<void> {
  try {
    await formRef.value?.validate()
  } catch {
    step.value = 0
    return
  }
  submitting.value = true
  try {
    await api('/cvca/applications', {
      method: 'POST',
      body: {
        keyMode: form.keyMode,
        subjectCn: form.subjectCn,
        holderMnemonic: form.holderMnemonic || undefined,
        csrPem: form.csrPem || undefined,
        publicKeyPem: form.publicKeyPem || undefined,
        dvClass: form.dvClass,
        permissions: form.permissions,
        validityDays: form.validityDays,
        applicationUrl: form.applicationUrl || undefined,
        notes: form.notes || undefined,
      },
    })
    notify.success(t('common.success'))
    await navigateTo('/cvca')
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await ensureLoaded()
})
</script>

<template>
  <div class="epass42-page">
    <PageHeader
      :title="$t('cvca.applyTitle')"
      :breadcrumbs="[{ label: $t('nav.cvca'), to: '/cvca' }, { label: $t('nav.apply') }]"
    />
    <NCard v-if="signedIn">
      <NSteps :current="step + 1" size="small" style="margin-bottom: 16px">
        <NStep :title="$t('cvca.stepApplication')" />
        <NStep :title="$t('cvca.stepReview')" />
      </NSteps>

      <template v-if="step === 0">
        <NText depth="3">{{ $t('auth.signedInTo', { realm: 'CVCA' }) }}</NText>
        <NForm
          ref="formRef"
          :model="form"
          :rules="rules"
          label-placement="top"
          style="margin-top: 12px"
        >
          <NFormItem :label="$t('cvca.keyMode')">
            <NSelect v-model:value="form.keyMode" :options="keyModeOptions" />
          </NFormItem>
          <NFormItem path="subjectCn" :label="$t('cvca.subjectCn')" required>
            <NInput v-model:value="form.subjectCn" maxlength="64" />
          </NFormItem>
          <NFormItem :label="$t('cvca.holderMnemonic')">
            <NInput v-model:value="form.holderMnemonic" maxlength="9" />
          </NFormItem>
          <NText depth="3" style="display: block; font-size: 12px; margin-bottom: 12px">
            {{ $t('cvca.holderMnemonicHint') }}
          </NText>
          <NFormItem :label="$t('cvca.dvClass')">
            <NSelect v-model:value="form.dvClass" :options="dvClassOptions" />
          </NFormItem>
          <NText depth="3" style="display: block; font-size: 12px; margin-bottom: 12px">
            {{ $t('cvca.dvClassHint') }}
          </NText>
          <NFormItem v-if="form.keyMode === 'user_uploaded'" path="csrPem" :label="$t('cvca.csr')">
            <NInput v-model:value="form.csrPem" type="textarea" :rows="6" />
          </NFormItem>
          <NFormItem v-if="form.keyMode === 'user_uploaded'" :label="$t('cvca.publicKey')">
            <NInput v-model:value="form.publicKeyPem" type="textarea" :rows="4" />
          </NFormItem>
          <NText
            v-if="form.keyMode === 'user_uploaded'"
            depth="3"
            style="display: block; font-size: 12px; margin-bottom: 12px"
          >
            {{ $t('cvca.uploadHint') }}
          </NText>
          <NFormItem :label="$t('cvca.permissionsTitle')">
            <NSpace vertical size="small">
              <NText depth="3" style="font-size: 12px">{{ $t('cvca.permissionsHint') }}</NText>
              <PermissionsEditor v-model="form.permissions" />
            </NSpace>
          </NFormItem>
          <NFormItem :label="$t('cvca.validityDays')">
            <NInputNumber v-model:value="form.validityDays" :min="1" :max="92" />
          </NFormItem>
          <NFormItem path="applicationUrl" :label="$t('cvca.applicationUrl')">
            <NInput v-model:value="form.applicationUrl" placeholder="https://" />
          </NFormItem>
          <NFormItem :label="$t('cvca.notes')">
            <NInput v-model:value="form.notes" type="textarea" />
          </NFormItem>
        </NForm>
      </template>

      <template v-else>
        <NText depth="3">{{ $t('cvca.reviewSummary') }}</NText>
        <NDescriptions :column="2" size="small" style="margin-top: 12px">
          <NDescriptionsItem :label="$t('cvca.keyMode')">
            {{
              form.keyMode === 'remote_generated' ? $t('cvca.keyModeNia') : $t('cvca.keyModeUpload')
            }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.subjectCn')">
            {{ form.subjectCn }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.holderMnemonic')">
            {{ form.holderMnemonic || '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.dvClass')">
            {{
              form.dvClass === 'foreign' ? $t('cvca.dvClassForeign') : $t('cvca.dvClassDomestic')
            }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.validityDays')">
            {{ form.validityDays }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.applicationUrl')">
            {{ form.applicationUrl || '—' }}
          </NDescriptionsItem>
        </NDescriptions>
        <div style="margin-top: 12px">
          <NText strong>{{ $t('cvca.permissionsTitle') }}</NText>
          <PermissionsEditor :model-value="form.permissions" readonly style="margin-top: 8px" />
        </div>
      </template>

      <template #action>
        <NSpace justify="space-between" style="width: 100%">
          <div>
            <NButton v-if="step > 0" @click="prevStep">{{ $t('common.previous') }}</NButton>
          </div>
          <div>
            <NButton v-if="step < LAST_STEP" type="primary" @click="nextStep">
              {{ $t('common.next') }}
            </NButton>
            <NButton v-else type="primary" :loading="submitting" @click="submit">
              <template #icon
                ><NIcon><Save /></NIcon
              ></template>
              {{ $t('common.submit') }}
            </NButton>
          </div>
        </NSpace>
      </template>
    </NCard>

    <NCard v-else>
      <NResult status="info" :title="$t('auth.signInTo', { realm: 'CVCA' })">
        <template #footer>
          <NButton type="primary" @click="login">
            <template #icon
              ><NIcon><LogIn /></NIcon
            ></template>
            {{ $t('common.login') }}
          </NButton>
        </template>
      </NResult>
    </NCard>
  </div>
</template>
