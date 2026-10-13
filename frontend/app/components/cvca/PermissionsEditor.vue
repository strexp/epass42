<script setup lang="ts">
/**
 * CHAT authorization editor: the LDS1 ePassport DG3/DG4 read bits plus the
 * LDS2 read/write authorization per application.  Used by the DV/terminal
 * forms and the reviewer's approval panel; read-only in listings.
 */
import { NCheckbox } from 'naive-ui'
import { LDS2_ROLES, type DvPermissions, type Lds2Role } from '@epass42/shared'

const props = defineProps<{ modelValue: DvPermissions; readonly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [DvPermissions] }>()

const labelKey: Record<Lds2Role, string> = {
  travel: 'cvca.permissionTravel',
  visa: 'cvca.permissionVisa',
  biometrics: 'cvca.permissionBiometrics',
}

function set(role: Lds2Role, field: 'read' | 'write', value: boolean): void {
  emit('update:modelValue', {
    ...props.modelValue,
    [role]: { ...props.modelValue[role], [field]: value },
  })
}

function setEpassport(field: 'dg3' | 'dg4', value: boolean): void {
  emit('update:modelValue', {
    ...props.modelValue,
    epassport: { ...props.modelValue.epassport, [field]: value },
  })
}
</script>

<template>
  <div>
    <div class="epass42-permissions-epassport">
      <span class="epass42-permissions-title">{{ $t('cvca.permissionEpassport') }}</span>
      <NCheckbox
        :checked="modelValue.epassport.dg3"
        :disabled="readonly"
        @update:checked="(value: boolean) => setEpassport('dg3', value)"
      >
        {{ $t('cvca.permissionDg3') }}
      </NCheckbox>
      <NCheckbox
        :checked="modelValue.epassport.dg4"
        :disabled="readonly"
        @update:checked="(value: boolean) => setEpassport('dg4', value)"
      >
        {{ $t('cvca.permissionDg4') }}
      </NCheckbox>
    </div>
    <table class="epass42-permissions">
      <thead>
        <tr>
          <th scope="col"></th>
          <th scope="col">{{ $t('cvca.permissionRead') }}</th>
          <th scope="col">{{ $t('cvca.permissionWrite') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="role in LDS2_ROLES" :key="role">
          <th scope="row">{{ $t(labelKey[role]) }}</th>
          <td>
            <NCheckbox
              :checked="modelValue[role].read"
              :disabled="readonly"
              :aria-label="`${$t(labelKey[role])}: ${$t('cvca.permissionRead')}`"
              @update:checked="(value: boolean) => set(role, 'read', value)"
            />
          </td>
          <td>
            <NCheckbox
              :checked="modelValue[role].write"
              :disabled="readonly"
              :aria-label="`${$t(labelKey[role])}: ${$t('cvca.permissionWrite')}`"
              @update:checked="(value: boolean) => set(role, 'write', value)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.epass42-permissions-epassport {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  margin-bottom: 6px;
}
.epass42-permissions-title {
  font-size: 12px;
  opacity: 0.75;
}
.epass42-permissions {
  border-collapse: collapse;
}
.epass42-permissions th,
.epass42-permissions td {
  padding: 4px 12px 4px 0;
  text-align: left;
  font-weight: inherit;
}
.epass42-permissions thead th {
  font-size: 12px;
  opacity: 0.75;
}
</style>
