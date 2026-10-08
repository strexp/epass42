<script setup lang="ts">
import { NCard, NForm, NFormItem, NGrid, NInput, NSelect, NTag, NText } from 'naive-ui'
import { computed } from 'vue'
import type { MrzFields } from '@pkd42/shared'
import { buildMrzLines, validMrzLines } from '~/utils/mrz'

const model = defineModel<MrzFields>({ required: true })

const lines = computed(() => buildMrzLines(model.value))
const valid = computed(() => validMrzLines(lines.value))
const sexOptions = [
  { label: 'F', value: 'F' },
  { label: 'M', value: 'M' },
  { label: '<', value: '<' },
]
</script>

<template>
  <NCard :title="$t('dsc.mrz')" size="small">
    <NForm label-placement="top" size="small">
      <NGrid :cols="2" :x-gap="12">
        <NFormItem :label="$t('dsc.documentation') + ' code'">
          <NInput v-model:value="model.documentCode" maxlength="2" />
        </NFormItem>
        <NFormItem label="Issuing state">
          <NInput v-model:value="model.issuingState" maxlength="3" disabled />
        </NFormItem>
        <NFormItem label="Surname">
          <NInput v-model:value="model.surname" maxlength="39" />
        </NFormItem>
        <NFormItem label="Given names">
          <NInput v-model:value="model.givenNames" maxlength="39" />
        </NFormItem>
        <NFormItem label="Document number">
          <NInput v-model:value="model.documentNumber" maxlength="9" />
        </NFormItem>
        <NFormItem label="Nationality">
          <NInput v-model:value="model.nationality" maxlength="3" />
        </NFormItem>
        <NFormItem label="Date of birth (YYMMDD)">
          <NInput v-model:value="model.dateOfBirth" maxlength="6" placeholder="900101" />
        </NFormItem>
        <NFormItem label="Sex">
          <NSelect v-model:value="model.sex" :options="sexOptions" />
        </NFormItem>
        <NFormItem label="Date of expiry (YYMMDD)">
          <NInput v-model:value="model.dateOfExpiry" maxlength="6" placeholder="300101" />
        </NFormItem>
        <NFormItem label="Personal number">
          <NInput v-model:value="model.personalNumber" maxlength="14" />
        </NFormItem>
      </NGrid>
    </NForm>
    <template #footer>
      <NTag :type="valid ? 'success' : 'warning'" size="small">
        {{ valid ? 'MRZ OK' : 'MRZ incomplete' }}
      </NTag>
      <div class="pkd42-mono" data-testid="mrz-line1">{{ lines.line1 }}</div>
      <div class="pkd42-mono" data-testid="mrz-line2">{{ lines.line2 }}</div>
      <NText depth="3" style="font-size: 12px">7-3-1 check digits</NText>
    </template>
  </NCard>
</template>
