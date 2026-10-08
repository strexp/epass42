<script setup lang="ts">
import { computed } from 'vue'
import type { Realm } from '@pkd42/shared'

/** A realm-aware layout shared by the CSCA and DSC pages. */
const route = useRoute()
const realm = computed<Realm>(() => (route.path.startsWith('/csca') ? 'csca' : 'dsc'))
</script>

<template>
  <div>
    <AppHeader />
    <RealmSession :realm="realm" />
    <main>
      <slot />
    </main>
  </div>
</template>
