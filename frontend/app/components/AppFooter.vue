<script setup lang="ts">
import { NText } from 'naive-ui'

const config = useRuntimeConfig()
const year = new Date().getFullYear()
const version = config.public.appVersion as string
const builtAt = config.public.builtAt as string
</script>

<template>
  <footer class="epass42-footer">
    <div class="epass42-footer-inner">
      <div>
        <NText strong>{{ $t('app.name') }}</NText>
        <NText depth="3"> · {{ $t('footer.authority') }}</NText>
      </div>
      <NText depth="3">
        {{ $t('common.official') }} · {{ $t('footer.identifier') }} ·
        {{ $t('footer.version', { version }) }} · {{ $t('footer.updated', { date: builtAt }) }}
      </NText>
      <NText depth="3">{{ $t('footer.copyright', { year }) }}</NText>
    </div>
  </footer>
</template>

<style scoped>
.epass42-footer {
  border-top: 1px solid rgba(128, 128, 128, 0.18);
  padding: 16px;
}
.epass42-footer-inner {
  max-width: var(--epass42-max-width);
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  justify-content: space-between;
}
</style>
