<script setup lang="ts">
import { NCard, NTag } from 'naive-ui'
import { computed } from 'vue'
import type { MrzFields } from '@epass42/shared'

const props = defineProps<{
  mrz: MrzFields
  portraitDataUrl?: string | null
  documentType?: string
}>()

const fullName = computed(() => `${props.mrz.givenNames} ${props.mrz.surname}`.trim() || '—')
const rows = computed(() => [
  {
    key: 'emrtd.document',
    value: `${props.documentType ?? props.mrz.documentCode} ${props.mrz.documentNumber}`.trim(),
    mono: true,
  },
  { key: 'emrtd.name', value: fullName.value },
  { key: 'emrtd.nationality', value: props.mrz.nationality },
  { key: 'emrtd.dob', value: props.mrz.dateOfBirth, mono: true },
  { key: 'emrtd.sex', value: props.mrz.sex === '<' ? 'X' : props.mrz.sex },
  { key: 'emrtd.expiry', value: props.mrz.dateOfExpiry ?? '—', mono: true },
])
</script>

<template>
  <NCard :title="$t('dsc.preview')" size="small" data-testid="emrtd-preview">
    <div class="emrtd-preview">
      <div class="emrtd-photo">
        <img v-if="portraitDataUrl" :src="portraitDataUrl" :alt="$t('dsc.portrait')" />
        <span v-else class="emrtd-photo-placeholder">DG2</span>
      </div>
      <dl class="emrtd-fields">
        <template v-for="row in rows" :key="row.key">
          <dt>{{ $t(row.key) }}</dt>
          <dd :class="{ 'epass42-mono': row.mono }">{{ row.value }}</dd>
        </template>
      </dl>
    </div>
    <div class="emrtd-dgs">
      <NTag size="small">DG1</NTag>
      <NTag size="small">DG2</NTag>
    </div>
  </NCard>
</template>

<style scoped>
.emrtd-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}
.emrtd-photo {
  flex: 0 0 auto;
  width: 120px;
  height: 150px;
  background: rgba(128, 128, 128, 0.15);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.emrtd-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.emrtd-photo-placeholder {
  opacity: 0.75;
  font-size: 12px;
}
.emrtd-fields {
  flex: 1 1 220px;
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 16px;
  margin: 0;
  align-content: start;
}
dt {
  opacity: 0.8;
  font-size: 12px;
  white-space: nowrap;
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.emrtd-dgs {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}
</style>
