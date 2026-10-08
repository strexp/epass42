<script setup lang="ts">
import { NTag } from 'naive-ui'
import { computed } from 'vue'

/** A status pill shared by the CSCA and DSC tables. */
const props = defineProps<{ status: string }>()

const type = computed(() =>
  props.status === 'approved' ? 'success' : props.status === 'rejected' ? 'error' : 'default',
)
</script>

<template>
  <NTag size="small" :type="type">{{ status }}</NTag>
</template>
