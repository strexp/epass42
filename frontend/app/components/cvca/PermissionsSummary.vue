<script setup lang="ts">
/**
 * Compact CHAT authorization summary for certificate/application lists: a short
 * one-line overview with the full breakdown on hover (the editable control lives
 * in the application form, not in tables).
 */
import { NTooltip } from 'naive-ui'
import { computed } from 'vue'
import { LDS2_ROLES, type DvPermissions, type Lds2Role } from '@epass42/shared'

const props = defineProps<{
  permissions: DvPermissions
  /**
   * Optional cap for the one-line summary.  Set a value (e.g. `180px`) inside
   * table cells so the text ellipsizes instead of widening its column.
   */
  maxWidth?: string
}>()
const { t } = useI18n()

const shortLabel: Record<Lds2Role, string> = {
  travel: 'cvca.permissionTravelShort',
  visa: 'cvca.permissionVisaShort',
  biometrics: 'cvca.permissionBiometricsShort',
}
const longLabel: Record<Lds2Role, string> = {
  travel: 'cvca.permissionTravel',
  visa: 'cvca.permissionVisa',
  biometrics: 'cvca.permissionBiometrics',
}

const epassport = computed(() => {
  const out: string[] = []
  if (props.permissions.epassport.dg3) out.push('DG3')
  if (props.permissions.epassport.dg4) out.push('DG4')
  return out
})

const lds2 = computed(() =>
  LDS2_ROLES.map((role) => ({ role, access: props.permissions[role] })).filter(
    ({ access }) => access.read || access.write,
  ),
)

const empty = computed(() => epassport.value.length === 0 && lds2.value.length === 0)

function shortFlags(access: { read: boolean; write: boolean }): string {
  return [
    access.read ? t('cvca.permissionReadShort') : null,
    access.write ? t('cvca.permissionWriteShort') : null,
  ]
    .filter((value): value is string => value !== null)
    .join('/')
}

function longFlags(access: { read: boolean; write: boolean }): string {
  return [
    access.read ? t('cvca.permissionRead') : null,
    access.write ? t('cvca.permissionWrite') : null,
  ]
    .filter((value): value is string => value !== null)
    .join(', ')
}

const short = computed(() => {
  const parts: string[] = []
  if (epassport.value.length > 0) {
    parts.push(`${t('cvca.permissionEpassportShort')} ${epassport.value.join('/')}`)
  }
  for (const item of lds2.value)
    parts.push(`${t(shortLabel[item.role])} ${shortFlags(item.access)}`)
  return parts.join(' · ')
})
</script>

<template>
  <NTooltip trigger="hover" :disabled="empty">
    <template #trigger>
      <span class="epass42-perm-summary" :style="maxWidth ? { maxWidth } : undefined">
        {{ empty ? $t('cvca.permissionNone') : short }}
      </span>
    </template>
    <div>
      <div v-if="epassport.length > 0">
        {{ $t('cvca.permissionEpassport') }}: {{ epassport.join(', ') }}
      </div>
      <div v-for="item in lds2" :key="item.role">
        {{ $t(longLabel[item.role]) }}: {{ longFlags(item.access) }}
      </div>
    </div>
  </NTooltip>
</template>

<style scoped>
.epass42-perm-summary {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
</style>
