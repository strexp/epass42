<script setup lang="ts">
import { NAlert, NButton, NModal, NSpace, NText } from 'naive-ui'

/**
 * The prominent development-environment warning.  The header owns the
 * visibility state so it can also reopen this dialog from the warning icon
 * after the operator has dismissed it.
 */
const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()

function onUpdateShow(value: boolean): void {
  emit('update:show', value)
}

function close(): void {
  emit('update:show', false)
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    :title="$t('devWarning.title')"
    style="max-width: 600px"
    @update:show="onUpdateShow"
  >
    <NAlert type="warning" :title="$t('devWarning.headline')" :show-icon="true">
      <NSpace vertical :size="12">
        <NText>{{ $t('devWarning.intro') }}</NText>
        <ul class="epass42-dev-warning-list">
          <li>{{ $t('devWarning.dataPersistence') }}</li>
          <li>{{ $t('devWarning.dataLoss') }}</li>
          <li>{{ $t('devWarning.security') }}</li>
        </ul>
        <NText depth="3" style="font-size: 12px">{{ $t('devWarning.reopenHint') }}</NText>
      </NSpace>
    </NAlert>

    <template #footer>
      <NSpace justify="end">
        <NButton type="warning" @click="close">{{ $t('devWarning.acknowledge') }}</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.epass42-dev-warning-list {
  margin: 0;
  padding-left: 20px;
  line-height: 1.8;
}
</style>
