<script setup lang="ts">
import { computed } from 'vue'
import type { Realm } from '@epass42/shared'

/** A realm-aware layout shared by the certificate and personalization pages. */
const route = useRoute()
const realm = computed<Realm>(() => (route.path.startsWith('/csca') ? 'csca' : 'dsc'))
</script>

<template>
  <div class="epass42-shell">
    <AppHeader />
    <RealmSession :realm="realm" />
    <main class="epass42-main">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>
