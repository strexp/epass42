<script setup lang="ts">
import {
  NAlert,
  NButton,
  NDivider,
  NIcon,
  NSpace,
  NTabPane,
  NTabs,
  NTag,
  NText,
  NThing,
  NTimeline,
  NTimelineItem,
} from 'naive-ui'
import type { Component } from 'vue'
import {
  BadgeCheck,
  CreditCard,
  FileBadge,
  FilePlus2,
  FolderTree,
  Globe,
  IdCard,
  ListChecks,
  ScanLine,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  UserCheck,
} from '@lucide/vue'
import { ref } from 'vue'

/** Whether a workflow step happens in this application or with external tooling. */
type StepTag = 'system' | 'external'

interface HelpStep {
  titleKey: string
  bodyKey: string
  tag: StepTag
  /** An optional command, path or endpoint shown under the step. */
  code?: string
}

interface HelpLink {
  to: string
  labelKey: string
  icon: Component
}

interface Flow {
  steps: HelpStep[]
  links: HelpLink[]
}

interface Role {
  key: string
  icon: Component
  flow: Flow
}

/**
 * Builds a role's steps from its i18n keys.  The text lives under
 * `help.flows.<role>.steps.s<n>`; only the structure and tags live here.
 */
function buildSteps(role: string, tags: StepTag[], codes: (string | undefined)[] = []): HelpStep[] {
  return tags.map((tag, index) => ({
    titleKey: `help.flows.${role}.steps.s${index + 1}.title`,
    bodyKey: `help.flows.${role}.steps.s${index + 1}.body`,
    tag,
    code: codes[index],
  }))
}

const roles: Role[] = [
  {
    key: 'applicant',
    icon: IdCard,
    flow: {
      steps: buildSteps('applicant', ['system', 'system', 'system', 'system', 'system', 'system']),
      links: [
        { to: '/dsc/apply', labelKey: 'help.links.applicant.apply', icon: FilePlus2 },
        { to: '/dsc', labelKey: 'help.links.applicant.mine', icon: ListChecks },
      ],
    },
  },
  {
    key: 'reviewer',
    icon: UserCheck,
    flow: {
      steps: buildSteps('reviewer', ['system', 'system', 'system', 'system', 'system']),
      links: [{ to: '/dsc/admin', labelKey: 'help.links.reviewer.queue', icon: ListChecks }],
    },
  },
  {
    key: 'certApplicant',
    icon: FileBadge,
    flow: {
      steps: buildSteps('certApplicant', [
        'system',
        'system',
        'system',
        'system',
        'external',
        'system',
      ]),
      links: [
        { to: '/csca/apply', labelKey: 'help.links.certApplicant.apply', icon: FilePlus2 },
        { to: '/csca', labelKey: 'help.links.certApplicant.mine', icon: ListChecks },
      ],
    },
  },
  {
    key: 'certAdmin',
    icon: ShieldCheck,
    flow: {
      steps: buildSteps('certAdmin', ['system', 'system', 'system', 'system', 'system', 'system']),
      links: [
        {
          to: '/csca/certificates',
          labelKey: 'help.links.certAdmin.certificates',
          icon: BadgeCheck,
        },
        { to: '/csca/audit', labelKey: 'help.links.certAdmin.audit', icon: ScrollText },
      ],
    },
  },
  {
    key: 'selfHosted',
    icon: Server,
    flow: {
      steps: buildSteps(
        'selfHosted',
        ['system', 'external', 'external', 'system', 'system'],
        [undefined, 'roles = ["dsc"]'],
      ),
      links: [
        { to: '/csca/apply', labelKey: 'help.links.selfHosted.certApply', icon: FilePlus2 },
        { to: '/dsc/settings', labelKey: 'help.links.selfHosted.settings', icon: Settings },
      ],
    },
  },
  {
    key: 'personalization',
    icon: CreditCard,
    flow: {
      steps: buildSteps(
        'personalization',
        ['external', 'external', 'system', 'external', 'external', 'external'],
        [
          'make card-emrtd',
          'make card-emrtd-install',
          undefined,
          'gp --personalize <AID> --store-data <DGI sequence>',
          'java -jar card42-emrtd-cli.jar terminal emrtd read -host=pcsc -doc=… -dob=… -doe=…',
          undefined,
        ],
      ),
      links: [{ to: '/pkd', labelKey: 'help.links.personalization.directory', icon: FolderTree }],
    },
  },
  {
    key: 'verifier',
    icon: ScanLine,
    flow: {
      steps: buildSteps(
        'verifier',
        ['system', 'external', 'external', 'external', 'external', 'system'],
        [
          'GET /pkd/masterlists · GET /pkd/objects/:id.der',
          undefined,
          'terminal emrtd read -pace -can=<6 digits>',
          undefined,
          undefined,
          undefined,
        ],
      ),
      links: [{ to: '/pkd', labelKey: 'help.links.verifier.directory', icon: FolderTree }],
    },
  },
  {
    key: 'public',
    icon: Globe,
    flow: {
      steps: buildSteps('public', ['system', 'external', 'external', 'system']),
      links: [{ to: '/pkd', labelKey: 'help.links.public.directory', icon: FolderTree }],
    },
  },
]

/** The selected role key; the personalization applicant is the common entry point. */
const role = ref('applicant')
</script>

<template>
  <div class="epass42-page">
    <PageHeader :title="$t('help.title')" :subtitle="$t('help.subtitle')" />

    <NAlert type="info" :show-icon="false" style="margin-bottom: 16px">
      {{ $t('help.intro') }}
    </NAlert>

    <NTabs v-model:value="role" type="line" animated>
      <NTabPane v-for="item in roles" :key="item.key" :name="item.key">
        <template #tab>
          <NSpace align="center" :size="6">
            <NIcon :size="18"><component :is="item.icon" /></NIcon>
            {{ $t(`help.roles.${item.key}.name`) }}
          </NSpace>
        </template>

        <NSpace vertical size="large">
          <NThing :title="$t(`help.roles.${item.key}.name`)">
            <template #avatar>
              <NIcon :size="30"><component :is="item.icon" /></NIcon>
            </template>
            <template #description>{{ $t(`help.roles.${item.key}.tagline`) }}</template>
          </NThing>

          <NText depth="2">{{ $t(`help.flows.${item.key}.summary`) }}</NText>

          <NTimeline>
            <NTimelineItem
              v-for="(step, index) in item.flow.steps"
              :key="index"
              :type="index === item.flow.steps.length - 1 ? 'success' : 'info'"
            >
              <template #header>
                <NSpace align="center" :size="8">
                  <NText strong>{{ $t(step.titleKey) }}</NText>
                  <NTag
                    size="tiny"
                    round
                    :type="step.tag === 'system' ? 'info' : 'warning'"
                    :bordered="false"
                  >
                    {{ step.tag === 'system' ? $t('help.tag.system') : $t('help.tag.external') }}
                  </NTag>
                </NSpace>
              </template>
              <NSpace vertical size="small">
                <NText depth="2">{{ $t(step.bodyKey) }}</NText>
                <div v-if="step.code">
                  <NText code class="epass42-mono">{{ step.code }}</NText>
                </div>
              </NSpace>
            </NTimelineItem>
          </NTimeline>

          <template v-if="item.flow.links.length">
            <NDivider style="margin: 0" />
            <NSpace align="center" :size="8">
              <NText depth="3">{{ $t('help.related') }}</NText>
              <NuxtLink v-for="link in item.flow.links" :key="link.to" :to="link.to">
                <NButton size="small" type="primary" ghost>
                  <template #icon>
                    <NIcon><component :is="link.icon" /></NIcon>
                  </template>
                  {{ $t(link.labelKey) }}
                </NButton>
              </NuxtLink>
            </NSpace>
          </template>
        </NSpace>
      </NTabPane>
    </NTabs>

    <NAlert type="default" :title="$t('help.notSureTitle')" style="margin-top: 24px">
      {{ $t('help.notSureBody') }}
    </NAlert>
  </div>
</template>
