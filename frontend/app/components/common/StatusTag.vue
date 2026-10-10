<script setup lang="ts">
import { NTag } from 'naive-ui'
import { computed } from 'vue'

/** A status pill shared by the certificate and personalization tables. */
const props = defineProps<{ status: string }>()
const { t, te } = useI18n()

const type = computed(() =>
  props.status === 'approved' || props.status === 'active'
    ? 'success'
    : props.status === 'rejected' || props.status === 'revoked' || props.status === 'inactive'
      ? 'error'
      : props.status === 'submitted'
        ? 'info'
        : 'default',
)

const label = computed(() =>
  te(`status.${props.status}.label`) ? t(`status.${props.status}.label`) : props.status,
)
</script>

<template>
  <NTag size="small" :type="type">{{ label }}</NTag>
</template>
