<script setup lang="ts">
definePageMeta({ layout: 'dsc' })

import {
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NDivider,
  NForm,
  NFormItem,
  NInput,
  NRadio,
  NRadioGroup,
  NSelect,
  NSpace,
  NText,
  useMessage,
} from 'naive-ui'
import { computed, reactive, ref } from 'vue'
import type { MrzFields, SecurityOptions } from '@pkd42/shared'
import type { EncodedFile } from '~/components/common/FileField.vue'
import type { EncodedPortrait } from '~/components/emrtd/PortraitEditor.vue'
import { errorMessageKey } from '~/composables/useApi'
import { useAuthStore } from '~/stores/auth'

const api = useApi()
const auth = useAuthStore()
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
const dg11FullName = ref('')
const dg11PlaceOfBirth = ref('')
const dg11Address = ref('')
const dg11Telephone = ref('')
const dg12IssuingAuthority = ref('')
const dg12DateOfIssue = ref('')
const dg12Endorsements = ref('')
const dg13Text = ref('')
const dg16 = ref<{ name: string; telephone: string; address: string; dateRecorded: string }[]>([])
const security = reactive<SecurityOptions>({
  paceEcdhGm3des: true,
  paceEcdhGmAes128: true,
  caEcdh3des: false,
  caEcdhAes128: false,
  caKeyId: 1,
  aa: false,
})
const dscMode = ref<'nia' | 'owned'>('nia')
const ownedDscId = ref<number | null>(null)
const ownedCerts = ref<{ id: number; label: string }[]>([])
const email = ref('')
const notes = ref('')
const submitting = ref(false)
const reference = ref<string | null>(null)

const ownedOptions = computed(() => ownedCerts.value)

function addPerson(): void {
  dg16.value.push({ name: '', telephone: '', address: '', dateRecorded: '' })
}

async function loadOwnedCerts(): Promise<void> {
  try {
    const result = await api<{
      items: { id: number; subjectDn: string; asn: number | null; status: string }[]
    }>('/csca/certificates')
    const asn = auth.realms.dsc.me?.account.asn ?? null
    ownedCerts.value = (result.items ?? [])
      .filter((cert) => cert.status === 'active' && (asn === null || cert.asn === asn))
      .map((cert) => ({ id: cert.id, label: `${cert.subjectDn}` }))
  } catch {
    ownedCerts.value = []
  }
}

async function submit(): Promise<void> {
  if (!portrait.value) {
    message.error(t('dsc.portraitHint'))
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
      security,
      dscSelection:
        dscMode.value === 'owned'
          ? { mode: 'owned', dscCertId: ownedDscId.value }
          : { mode: 'nia' },
    }
    if (dg3.value) body.dg3 = { bytes: dg3.value.base64 }
    if (dg4.value) body.dg4 = { bytes: dg4.value.base64 }
    if (dg5.value) body.dg5 = { jpeg: dg5.value.base64 }
    if (dg7.value) body.dg7 = { jpeg: dg7.value.base64 }
    if (dg11FullName.value || dg11PlaceOfBirth.value || dg11Address.value || dg11Telephone.value) {
      body.dg11 = {
        fullName: dg11FullName.value || undefined,
        placeOfBirth: dg11PlaceOfBirth.value || undefined,
        address: dg11Address.value || undefined,
        telephone: dg11Telephone.value || undefined,
      }
    }
    if (dg12IssuingAuthority.value || dg12DateOfIssue.value || dg12Endorsements.value) {
      body.dg12 = {
        issuingAuthority: dg12IssuingAuthority.value || undefined,
        dateOfIssue: dg12DateOfIssue.value || undefined,
        endorsements: dg12Endorsements.value || undefined,
      }
    }
    if (dg13Text.value) body.dg13 = { text: dg13Text.value }
    if (dg16.value.length) body.dg16 = { persons: dg16.value }
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

onMounted(async () => {
  if (!auth.realms.dsc.loaded) await auth.fetchMe('dsc')
  await loadOwnedCerts()
})
</script>

<template>
  <div class="pkd42-page">
    <NCard :title="$t('dsc.applyTitle')">
      <MrzEditor v-model="mrz" />
      <EmrtdPreview
        :mrz="mrz"
        :portrait-data-url="portrait?.previewDataUrl ?? null"
        style="margin-top: 12px"
      />

      <NDivider />
      <PortraitEditor v-model="portrait" />
      <NSpace style="margin-top: 12px">
        <FileField v-model="dg5" accept="image/*" :label="$t('dsc.displayImage')" />
        <FileField v-model="dg7" accept="image/*" :label="$t('dsc.signatureImage')" />
      </NSpace>

      <NCollapse style="margin-top: 12px">
        <NCollapseItem :title="$t('dsc.fingerprints')" name="dg3">
          <FileField v-model="dg3" accept=".bin,*" :label="$t('dsc.fingerprints')" />
        </NCollapseItem>
        <NCollapseItem :title="$t('dsc.iris')" name="dg4">
          <FileField v-model="dg4" accept=".bin,*" :label="$t('dsc.iris')" />
        </NCollapseItem>
        <NCollapseItem :title="$t('dsc.additional11')" name="dg11">
          <NForm label-placement="top">
            <NFormItem label="Full name"
              ><NInput v-model:value="dg11FullName" maxlength="70"
            /></NFormItem>
            <NFormItem label="Place of birth"
              ><NInput v-model:value="dg11PlaceOfBirth" maxlength="35"
            /></NFormItem>
            <NFormItem label="Address"
              ><NInput v-model:value="dg11Address" maxlength="70"
            /></NFormItem>
            <NFormItem label="Telephone"
              ><NInput v-model:value="dg11Telephone" maxlength="35"
            /></NFormItem>
          </NForm>
        </NCollapseItem>
        <NCollapseItem :title="$t('dsc.additional12')" name="dg12">
          <NForm label-placement="top">
            <NFormItem :label="$t('dsc.issuanceAuthority')">
              <NInput v-model:value="dg12IssuingAuthority" maxlength="35" />
            </NFormItem>
            <NFormItem label="Date of issue (CCYYMMDD)">
              <NInput v-model:value="dg12DateOfIssue" maxlength="8" />
            </NFormItem>
            <NFormItem label="Endorsements"
              ><NInput v-model:value="dg12Endorsements" maxlength="70"
            /></NFormItem>
          </NForm>
        </NCollapseItem>
        <NCollapseItem :title="$t('dsc.custom13')" name="dg13">
          <NInput v-model:value="dg13Text" type="textarea" maxlength="2048" />
        </NCollapseItem>
        <NCollapseItem :title="$t('dsc.notify16')" name="dg16">
          <div v-for="(person, index) in dg16" :key="index" class="pkd42-grid">
            <NInput v-model:value="person.name" placeholder="Name" />
            <NInput v-model:value="person.telephone" placeholder="Telephone" />
            <NInput v-model:value="person.address" placeholder="Address" />
            <NInput v-model:value="person.dateRecorded" placeholder="CCYYMMDD" />
          </div>
          <NButton size="small" style="margin-top: 8px" @click="addPerson">{{
            $t('dsc.addPerson')
          }}</NButton>
        </NCollapseItem>
      </NCollapse>

      <NDivider>{{ $t('dsc.security') }}</NDivider>
      <SecurityOptions v-model="security" />

      <NDivider>{{ $t('dsc.dscSelection') }}</NDivider>
      <NRadioGroup v-model:value="dscMode">
        <NRadio value="nia">{{ $t('dsc.dscNia') }}</NRadio>
        <NRadio value="owned">{{ $t('dsc.dscOwned') }}</NRadio>
      </NRadioGroup>
      <NSelect
        v-if="dscMode === 'owned'"
        v-model:value="ownedDscId"
        :options="ownedOptions"
        :placeholder="$t('dsc.dscOwned')"
        style="max-width: 360px; margin-top: 8px"
      />

      <NForm label-placement="top" style="margin-top: 12px">
        <NFormItem :label="$t('dsc.email')"><NInput v-model:value="email" /></NFormItem>
        <NFormItem :label="$t('dsc.notes')"
          ><NInput v-model:value="notes" type="textarea"
        /></NFormItem>
      </NForm>

      <template #footer>
        <NSpace vertical>
          <NButton type="primary" :loading="submitting" @click="submit">{{
            $t('common.submit')
          }}</NButton>
          <NCard v-if="reference" size="small" :title="$t('dsc.statusTitle')">
            <NText class="pkd42-mono" data-testid="reference">{{ reference }}</NText>
            <template #footer>
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
