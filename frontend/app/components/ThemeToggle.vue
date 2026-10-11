<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui'
import { Moon, Sun } from '@lucide/vue'

const colorMode = useColorMode()

function toggle(): void {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <NButton
    quaternary
    circle
    :aria-label="$t('common.theme')"
    :aria-pressed="colorMode.value === 'dark'"
    @click="toggle"
  >
    <template #icon>
      <NIcon><Moon v-if="colorMode.value === 'dark'" /><Sun v-else /></NIcon>
    </template>
  </NButton>
</template>
