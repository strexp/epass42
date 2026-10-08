<script setup lang="ts">
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NText,
  useMessage,
} from 'naive-ui'
import { reactive, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'

const api = useApi()
const { t } = useI18n()
const message = useMessage()

const form = reactive({
  keyMode: 'nia_generated' as 'nia_generated' | 'user_uploaded',
  subjectCn: '',
  csrPem: '',
  publicKeyPem: '',
  documentType: 'P',
  validityDays: 3650,
  issuancePolicy: '',
  applicationUrl: '',
  notes: '',
})
const submitting = ref(false)

const keyModeOptions = [
  { label: t('csca.keyModeNia'), value: 'nia_generated' },
  { label: t('csca.keyModeUpload'), value: 'user_uploaded' },
]

async function submit(): Promise<void> {
  submitting.value = true
  try {
    await api('/csca/applications', {
      method: 'POST',
      body: {
        keyMode: form.keyMode,
        subjectCn: form.subjectCn,
        csrPem: form.csrPem || undefined,
        publicKeyPem: form.publicKeyPem || undefined,
        documentType: form.documentType,
        validityDays: form.validityDays,
        issuancePolicy: form.issuancePolicy || undefined,
        applicationUrl: form.applicationUrl || undefined,
        notes: form.notes || undefined,
      },
    })
    message.success(t('common.success'))
    await navigateTo('/csca')
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="pkd42-page">
    <NCard :title="$t('csca.applyTitle')">
      <NText depth="3">{{ $t('auth.signedInTo', { realm: 'CSCA' }) }}</NText>
      <NForm label-placement="top">
        <NFormItem :label="$t('csca.keyMode')">
          <NSelect v-model:value="form.keyMode" :options="keyModeOptions" />
        </NFormItem>
        <NFormItem :label="$t('csca.subjectCn')">
          <NInput v-model:value="form.subjectCn" maxlength="64" />
        </NFormItem>
        <NFormItem v-if="form.keyMode === 'user_uploaded'" :label="$t('csca.csr')">
          <NInput v-model:value="form.csrPem" type="textarea" :rows="6" />
        </NFormItem>
        <NFormItem v-if="form.keyMode === 'user_uploaded'" :label="$t('csca.publicKey')">
          <NInput v-model:value="form.publicKeyPem" type="textarea" :rows="4" />
        </NFormItem>
        <NFormItem :label="$t('csca.documentType')">
          <NInput v-model:value="form.documentType" maxlength="2" />
        </NFormItem>
        <NFormItem :label="$t('csca.validityDays')">
          <NInputNumber v-model:value="form.validityDays" :min="1" :max="7300" />
        </NFormItem>
        <NFormItem :label="$t('csca.issuancePolicy')">
          <NInput v-model:value="form.issuancePolicy" />
        </NFormItem>
        <NFormItem :label="$t('csca.applicationUrl')">
          <NInput v-model:value="form.applicationUrl" placeholder="https://" />
        </NFormItem>
        <NFormItem :label="$t('csca.notes')">
          <NInput v-model:value="form.notes" type="textarea" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NButton type="primary" :loading="submitting" @click="submit">{{
          $t('common.submit')
        }}</NButton>
      </template>
    </NCard>
  </div>
</template>
