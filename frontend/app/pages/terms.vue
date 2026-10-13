<script setup lang="ts">
import { NCard, NText } from 'naive-ui'

const { t } = useI18n()
usePageTitle(() => t('legal.terms.title'))

/** The sections of the terms of use, in reading order. */
const sections = [
  'scope',
  'account',
  'acceptable',
  'applications',
  'directory',
  'intellectual',
  'availability',
  'enforcement',
  'changes',
] as const
</script>

<template>
  <div class="epass42-page">
    <PageHeader :title="$t('legal.terms.title')" />
    <NCard>
      <NText depth="3">{{ $t('legal.updated') }}</NText>
      <LegalDoc ns="legal.terms" :sections="sections" />
      <LegalLinks current="terms" />
    </NCard>
  </div>
</template>
