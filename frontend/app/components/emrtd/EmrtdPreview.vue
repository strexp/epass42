<script setup lang="ts">
import { NCard, NGrid, NTag } from 'naive-ui'
import { computed } from 'vue'
import type { MrzFields } from '@pkd42/shared'

const props = defineProps<{
  mrz: MrzFields
  portraitDataUrl?: string | null
  documentType?: string
}>()

const fullName = computed(() => `${props.mrz.givenNames} ${props.mrz.surname}`.trim() || '—')
</script>

<template>
  <NCard :title="$t('dsc.pve')" size="small" data-testid="emrtd-preview">
    <div class="emrtd-preview">
      <div class="emrtd-photo">
        <img v-if="portraitDataUrl" :src="portraitDataUrl" alt="" />
        <div v-else class="emrtd-photo-placeholder">DG2</div>
      </div>
      <dl>
        <dt>{{ documentType ?? mrz.documentCode }}</dt>
        <dd class="pkd42-mono">{{ mrz.documentNumber }}</dd>
        <dt>Name</dt>
        <dd>{{ fullName }}</dd>
        <dt>Nationality</dt>
        <dd>{{ mrz.nationality }}</dd>
        <dt>Date of birth</dt>
        <dd>{{ mrz.dateOfBirth }}</dd>
        <dt>Expiry</dt>
        <dd>{{ mrz.dateOfExpiry }}</dd>
      </dl>
      <NGrid>
        <NTag size="small">DG1</NTag>
        <NTag size="small">DG2</NTag>
      </NGrid>
    </div>
  </NCard>
</template>

<style scoped>
.emrtd-preview {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.emrtd-photo {
  width: 120px;
  height: 150px;
  background: #eee;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 4px;
}
.emrtd-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.emrtd-photo-placeholder {
  color: #999;
  font-size: 12px;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
}
dt {
  opacity: 0.6;
  font-size: 12px;
}
dd {
  margin: 0;
}
</style>
