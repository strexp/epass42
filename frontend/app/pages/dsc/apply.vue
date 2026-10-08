<script setup lang="ts">
import {
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NDivider,
  NForm,
  NFormItem,
  NGrid,
  NIcon,
  NInput,
  NSelect,
  NSpace,
  NText,
  useMessage,
} from 'naive-ui'
import { Send } from '@lucide/vue'
import { computed, reactive, ref } from 'vue'
import type { MrzFields } from '@pkd42/shared'
import type { EncodedFile } from '~/components/common/FileField.vue'
import type { EncodedPortrait } from '~/components/emrtd/PortraitEditor.vue'
import { errorMessageKey } from '~/composables/useApi'

definePageMeta({ layout: 'dsc' })

const api = useApi()
const { t } = useI18n()
const message = useMessage()

const mrz = reactive<MrzFields>({
  documentCode: 'P',
  issuingState: 'UDN',
  surname: '',
  givenNames: '',
  documentNumber: '',
  nationality: 'UDN',
  dateOfBirth: '',
  sex: '<',
  dateOfExpiry: '',
  personalNumber: '',
  optionalData: '',
})

const portrait = ref<EncodedPortrait | null>(null)
const dg5 = ref<EncodedFile | null>(null)
const dg7 = ref<EncodedFile | null>(null)
const dg3 = ref<EncodedFile | null>(null)
const dg4 = ref<EncodedFile | null>(null)
const fullName = ref('')
const placeOfBirth = ref('')
const address = ref('')
const telephone = ref('')
const issuingAuthority = ref('')
const dateOfIssue = ref('')
const endorsements = ref('')
const customNotes = ref('')
const people = ref<{ name: string; telephone: string; address: string; dateRecorded: string }[]>([])
const email = ref('')
const notes = ref('')
const submitting = ref(false)
const reference = ref<string | null>(null)

const sexOptions = [
  { label: 'Female', value: 'F' },
  { label: 'Male', value: 'M' },
  { label: 'Unspecified', value: '<' },
]
const documentTypeOptions = [
  { label: 'Passport', value: 'P' },
  { label: 'Identity card', value: 'ID' },
]

const canSubmit = computed(
  () =>
    mrz.surname !== '' &&
    mrz.documentNumber !== '' &&
    mrz.dateOfBirth !== '' &&
    mrz.dateOfExpiry !== '',
)

function addPerson(): void {
  people.value.push({ name: '', telephone: '', address: '', dateRecorded: '' })
}

async function submit(): Promise<void> {
  if (!portrait.value) {
    message.error(t('dsc.portraitHint'))
    return
  }
  if (!canSubmit.value) {
    message.error(t('errors.validation_failed'))
    return
  }
  submitting.value = true
  try {
    const body: Record<string, unknown> = {
      mrz,
      dg2: {
        jpeg: portrait.value.jpegBase64,
        width: portrait.value.width,
        height: portrait.value.height,
      },
    }
    if (dg3.value) body.dg3 = { bytes: dg3.value.base64 }
    if (dg4.value) body.dg4 = { bytes: dg4.value.base64 }
    if (dg5.value) body.dg5 = { jpeg: dg5.value.base64 }
    if (dg7.value) body.dg7 = { jpeg: dg7.value.base64 }
    if (fullName.value || placeOfBirth.value || address.value || telephone.value) {
      body.dg11 = {
        fullName: fullName.value || undefined,
        placeOfBirth: placeOfBirth.value || undefined,
        address: address.value || undefined,
        telephone: telephone.value || undefined,
      }
    }
    if (issuingAuthority.value || dateOfIssue.value || endorsements.value) {
      body.dg12 = {
        issuingAuthority: issuingAuthority.value || undefined,
        dateOfIssue: dateOfIssue.value || undefined,
        endorsements: endorsements.value || undefined,
      }
    }
    if (customNotes.value) body.dg13 = { text: customNotes.value }
    if (people.value.length) body.dg16 = { persons: people.value }
    if (email.value) body.email = email.value
    if (notes.value) body.notes = notes.value

    const result = await api<{ reference: string }>('/dsc/requests', { method: 'POST', body })
    reference.value = result.reference
    message.success(t('common.success'))
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="pkd42-page">
    <NCard :title="$t('dsc.applyTitle')">
      <NText depth="3">{{ $t('dsc.submitHint') }}</NText>

      <NDivider>{{ $t('dsc.personalDetails') }}</NDivider>
      <NForm label-placement="top">
        <NGrid :cols="2" :x-gap="12">
          <NFormItem :label="$t('dsc.documentation')">
            <NSelect v-model:value="mrz.documentCode" :options="documentTypeOptions" />
          </NFormItem>
          <NFormItem label="Document number">
            <NInput v-model:value="mrz.documentNumber" maxlength="9" />
          </NFormItem>
          <NFormItem label="Surname">
            <NInput v-model:value="mrz.surname" maxlength="39" />
          </NFormItem>
          <NFormItem label="Given names">
            <NInput v-model:value="mrz.givenNames" maxlength="39" />
          </NFormItem>
          <NFormItem label="Date of birth (YYMMDD)">
            <NInput v-model:value="mrz.dateOfBirth" maxlength="6" placeholder="900101" />
          </NFormItem>
          <NFormItem label="Sex">
            <NSelect v-model:value="mrz.sex" :options="sexOptions" />
          </NFormItem>
          <NFormItem label="Date of expiry (YYMMDD)">
            <NInput v-model:value="mrz.dateOfExpiry" maxlength="6" placeholder="300101" />
          </NFormItem>
          <NFormItem label="Nationality">
            <NInput v-model:value="mrz.nationality" maxlength="3" />
          </NFormItem>
        </NGrid>
      </NForm>

      <NDivider>{{ $t('dsc.photoSection') }}</NDivider>
      <PortraitEditor v-model="portrait" />
      <EmrtdPreview
        :mrz="mrz"
        :portrait-data-url="portrait?.previewDataUrl ?? null"
        style="margin-top: 12px"
      />

      <NDivider>{{ $t('dsc.optionalInfo') }}</NDivider>
      <NCollapse>
        <NCollapseItem :title="$t('dsc.contactSection')" name="contact">
          <NForm label-placement="top">
            <NFormItem label="Full name"
              ><NInput v-model:value="fullName" maxlength="70"
            /></NFormItem>
            <NFormItem label="Place of birth"
              ><NInput v-model:value="placeOfBirth" maxlength="35"
            /></NFormItem>
            <NFormItem label="Address"><NInput v-model:value="address" maxlength="70" /></NFormItem>
            <NFormItem label="Telephone"
              ><NInput v-model:value="telephone" maxlength="35"
            /></NFormItem>
          </NForm>
        </NCollapseItem>
        <NCollapseItem :title="$t('dsc.documentSection')" name="document">
          <NForm label-placement="top">
            <NFormItem :label="$t('dsc.issuanceAuthority')">
              <NInput v-model:value="issuingAuthority" maxlength="35" />
            </NFormItem>
            <NFormItem label="Date of issue (CCYYMMDD)">
              <NInput v-model:value="dateOfIssue" maxlength="8" />
            </NFormItem>
            <NFormItem label="Endorsements"
              ><NInput v-model:value="endorsements" maxlength="70"
            /></NFormItem>
          </NForm>
        </NCollapseItem>
        <NCollapseItem :title="$t('dsc.notesSection')" name="notes13">
          <NInput v-model:value="customNotes" type="textarea" maxlength="2048" />
        </NCollapseItem>
        <NCollapseItem :title="$t('dsc.notifySection')" name="notify">
          <div v-for="(person, index) in people" :key="index" class="pkd42-grid">
            <NInput v-model:value="person.name" placeholder="Name" />
            <NInput v-model:value="person.telephone" placeholder="Telephone" />
            <NInput v-model:value="person.address" placeholder="Address" />
            <NInput v-model:value="person.dateRecorded" placeholder="CCYYMMDD" />
          </div>
          <NButton size="small" style="margin-top: 8px" @click="addPerson">{{
            $t('dsc.addPerson')
          }}</NButton>
        </NCollapseItem>
        <NCollapseItem :title="$t('dsc.imagesSection')" name="images">
          <NSpace>
            <FileField v-model="dg5" accept="image/*" :label="$t('dsc.displayPhoto')" />
            <FileField v-model="dg7" accept="image/*" :label="$t('dsc.signatureImageOptional')" />
          </NSpace>
          <NSpace style="margin-top: 8px">
            <FileField v-model="dg3" accept=".bin,*" :label="$t('dsc.fingerprints')" />
            <FileField v-model="dg4" accept=".bin,*" :label="$t('dsc.iris')" />
          </NSpace>
        </NCollapseItem>
      </NCollapse>

      <NDivider />
      <NForm label-placement="top">
        <NFormItem :label="$t('dsc.email')"><NInput v-model:value="email" /></NFormItem>
        <NFormItem :label="$t('dsc.notes')"
          ><NInput v-model:value="notes" type="textarea"
        /></NFormItem>
      </NForm>

      <template #action>
        <NSpace vertical>
          <NButton type="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">
            <template #icon
              ><NIcon><Send /></NIcon
            ></template>
            {{ $t('common.submit') }}
          </NButton>
          <NCard v-if="reference" size="small" :title="$t('dsc.statusTitle')">
            <NText class="pkd42-mono" data-testid="reference">{{ reference }}</NText>
            <template #action>
              <NuxtLink :to="`/dsc/status?reference=${reference}`">
                <NButton size="small">{{ $t('dsc.query') }}</NButton>
              </NuxtLink>
            </template>
          </NCard>
        </NSpace>
      </template>
    </NCard>
  </div>
</template>
