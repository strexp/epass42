<script setup lang="ts">
import { computed } from 'vue'
import type { Realm } from '@epass42/shared'

/** A realm-aware layout shared by the certificate and personalization pages. */
const route = useRoute()
const realm = computed<Realm>(() => {
  if (route.path.startsWith('/dv')) return 'dv'
  if (route.path.startsWith('/cvca')) return 'cvca'
  return route.path.startsWith('/csca') ? 'csca' : 'dsc'
})
</script>

<template>
  <div class="epass42-shell">
    <a class="epass42-skip-link" href="#epass42-main">{{ $t('common.skipToContent') }}</a>
    <AppHeader />
    <RealmSession :realm="realm" />
    <main id="epass42-main" class="epass42-main" tabindex="-1">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>
