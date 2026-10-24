<script setup lang="ts">
import { NButton, NCard, NGi, NGrid, NIcon, NSpace, NTag, NText } from 'naive-ui'
import type { Component } from 'vue'
import {
  BadgeCheck,
  CircleHelp,
  CreditCard,
  ExternalLink,
  FileBadge,
  FileCheck,
  FolderTree,
  ScanLine,
  ShieldCheck,
} from '@lucide/vue'

const { t } = useI18n()
usePageTitle(() => t('nav.home'))

interface HomeCard {
  key: string
  to: string
  icon: Component
  title: string
  body: string
  cta: string
  public: boolean
  external?: boolean
}

/** The public site catalogue: one card per service, plus the role guide. */
const cards: HomeCard[] = [
  {
    key: 'csca',
    to: '/csca',
    icon: ShieldCheck,
    title: 'nav.csca',
    body: 'home.cscaCard',
    cta: 'home.ctaApply',
    public: false,
  },
  {
    key: 'cvca',
    to: '/cvca',
    icon: BadgeCheck,
    title: 'nav.cvca',
    body: 'home.cvcaCard',
    cta: 'home.ctaApply',
    public: false,
  },
  {
    key: 'dv',
    to: '/dv',
    icon: ScanLine,
    title: 'nav.dv',
    body: 'home.dvCard',
    cta: 'home.ctaApply',
    public: false,
  },
  {
    key: 'dsc',
    to: '/dsc',
    icon: FileBadge,
    title: 'nav.dsc',
    body: 'home.dscCard',
    cta: 'home.ctaApply',
    public: false,
  },
  {
    key: 'ml',
    to: '/ml',
    icon: FileCheck,
    title: 'nav.ml',
    body: 'home.mlCard',
    cta: 'home.ctaBrowse',
    public: false,
  },
  {
    key: 'pkd',
    to: '/pkd',
    icon: FolderTree,
    title: 'nav.pkd',
    body: 'home.pkdCard',
    cta: 'home.ctaBrowse',
    public: true,
  },
  {
    key: 'passcard',
    to: 'https://passcard.nia.gov.dn42',
    icon: CreditCard,
    title: 'nav.passcard',
    body: 'home.passcardCard',
    cta: 'home.ctaOpen',
    public: true,
    external: true,
  },
  {
    key: 'help',
    to: '/help',
    icon: CircleHelp,
    title: 'nav.help',
    body: 'home.helpCard',
    cta: 'home.ctaHelp',
    public: true,
  },
] as const
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <PageHeader :title="$t('home.intro')" />
      <NGrid
        :cols="3"
        :x-gap="16"
        :y-gap="16"
        item-responsive
        responsive="screen"
        class="epass42-cards"
      >
        <NGi v-for="card in cards" :key="card.key" span="3 s:3 m:1">
          <NuxtLink
            :to="card.to"
            :target="card.external ? '_blank' : undefined"
            :rel="card.external ? 'noopener noreferrer' : undefined"
            class="epass42-card-link"
          >
            <NCard hoverable class="epass42-card">
              <NSpace vertical size="small" align="start">
                <NIcon size="28"><component :is="card.icon" /></NIcon>
                <NText strong style="font-size: 16px">{{ $t(card.title) }}</NText>
                <NTag size="small" :type="card.public ? 'success' : 'info'">
                  {{ card.public ? $t('home.public') : $t('home.requiresSignIn') }}
                </NTag>
                <NText depth="2">{{ $t(card.body) }}</NText>
              </NSpace>
              <template #action>
                <NButton text type="primary">
                  {{ $t(card.cta) }}
                  <NIcon v-if="card.external" size="14" class="epass42-external-icon">
                    <ExternalLink />
                  </NIcon>
                  <span v-if="card.external" class="epass42-sr-only">
                    ({{ $t('common.opensInNewTab') }})
                  </span>
                </NButton>
              </template>
            </NCard>
          </NuxtLink>
        </NGi>
      </NGrid>
    </NSpace>
  </div>
</template>

<style scoped>
.epass42-card-link {
  display: block;
  height: 100%;
}
.epass42-card {
  height: 100%;
}
.epass42-external-icon {
  margin-left: 4px;
}
:deep(.n-grid-item) {
  display: flex;
}
</style>
