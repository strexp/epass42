<script setup lang="ts">
import {
  NConfigProvider,
  NDialogProvider,
  NGlobalStyle,
  NMessageProvider,
  NNotificationProvider,
  darkTheme,
  dateEnUS,
  dateZhCN,
  enUS,
  lightTheme,
  zhCN,
} from 'naive-ui'

const colorMode = useColorMode()
const theme = computed(() => (colorMode.value === 'dark' ? darkTheme : lightTheme))

// Naive UI's own strings and date formats follow the selected locale.
const { locale, t } = useI18n()
const naiveLocale = computed(() => (locale.value === 'zh' ? zhCN : enUS))
const naiveDateLocale = computed(() => (locale.value === 'zh' ? dateZhCN : dateEnUS))

// The document language and description follow the selected locale.
useHead({
  htmlAttrs: { lang: () => (locale.value === 'zh' ? 'zh-CN' : 'en') },
  meta: [{ name: 'description', content: () => t('app.description') }],
})
</script>

<template>
  <NConfigProvider :theme="theme" :locale="naiveLocale" :date-locale="naiveDateLocale">
    <NGlobalStyle />
    <NMessageProvider>
      <NNotificationProvider placement="bottom-right" :max="3">
        <NDialogProvider>
          <NuxtLayout>
            <NuxtPage />
          </NuxtLayout>
        </NDialogProvider>
      </NNotificationProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
