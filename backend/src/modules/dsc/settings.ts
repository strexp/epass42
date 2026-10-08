/**
 * DSC settings (M8): the issuing defaults and the system delivery mode.
 */
import { desc, eq } from 'drizzle-orm'

import type { SecurityOptions } from '@epass42/shared'

import { issuingProfile, systemSetting } from '../../db/schema'
import { nowIso } from '../../util/time'
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import type { IssuingDefaults } from './build'

/** A partial update to the issuing defaults (nested objects may be partial). */
export type IssuingDefaultsUpdate = Partial<Omit<IssuingDefaults, 'security' | 'lds2'>> & {
  security?: Partial<SecurityOptions>
  lds2?: { enabled?: boolean; roles?: IssuingDefaults['lds2']['roles']; caKeyId?: number }
}

/** Issuing defaults and delivery-mode settings. */
export class DscSettingsService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  /** The current issuing defaults (config overlaid by the DB profile row). */
  issuingDefaults(overrides: IssuingDefaultsUpdate = {}): IssuingDefaults {
    const row = this.db.select().from(issuingProfile).orderBy(desc(issuingProfile.id)).get()
    const extra = row?.defaultsJson
      ? (JSON.parse(row.defaultsJson) as Partial<IssuingDefaults>)
      : {}
    return {
      issuingState: overrides.issuingState ?? row?.issuingState ?? this.config.issuing.issuingState,
      issuingAuthority:
        overrides.issuingAuthority ?? row?.issuingAuthority ?? this.config.issuing.issuingAuthority,
      personalizationDevice:
        overrides.personalizationDevice ??
        row?.personalizationDevice ??
        this.config.issuing.personalizationDevice,
      dg13Policy: overrides.dg13Policy ?? row?.dg13Policy ?? this.config.issuing.dg13Policy,
      validityYears:
        overrides.validityYears ??
        (extra.validityYears as number | undefined) ??
        this.config.issuing.validityYears,
      dg2MaxBytes:
        overrides.dg2MaxBytes ??
        (extra.dg2MaxBytes as number | undefined) ??
        this.config.issuing.dg2MaxBytes,
      lds2: {
        enabled:
          overrides.lds2?.enabled ??
          (extra.lds2 as { enabled?: boolean } | undefined)?.enabled ??
          this.config.issuing.lds2.enabled,
        roles:
          overrides.lds2?.roles ??
          (extra.lds2 as { roles?: IssuingDefaults['lds2']['roles'] } | undefined)?.roles ??
          this.config.issuing.lds2.roles,
        caKeyId:
          overrides.lds2?.caKeyId ??
          (extra.lds2 as { caKeyId?: number } | undefined)?.caKeyId ??
          this.config.issuing.lds2.caKeyId,
      },
      endorsements: overrides.endorsements ?? row?.endorsementsJson ?? extra.endorsements,
      security: {
        ...this.config.issuing.security,
        ...(extra.security ?? {}),
        ...(overrides.security ?? {}),
      },
    }
  }

  /** The system delivery mode. */
  getDeliveryMode(): 'applicant' | 'reviewer' {
    const row = this.db
      .select()
      .from(systemSetting)
      .where(eq(systemSetting.key, 'dsc.delivery_mode'))
      .get()
    return row?.value === 'reviewer' ? 'reviewer' : 'applicant'
  }

  /** Updates the system delivery mode. */
  setDeliveryMode(value: 'applicant' | 'reviewer', actorAccountId: number | null): void {
    this.db
      .insert(systemSetting)
      .values({ key: 'dsc.delivery_mode', value, updatedBy: actorAccountId, updatedAt: nowIso() })
      .onConflictDoUpdate({
        target: systemSetting.key,
        set: { value, updatedBy: actorAccountId, updatedAt: nowIso() },
      })
      .run()
  }

  /** Updates the issuing profile defaults. */
  updateIssuingProfile(
    values: IssuingDefaultsUpdate,
    actorAccountId: number | null,
  ): IssuingDefaults {
    const merged = this.issuingDefaults(values)
    const row = this.db.select().from(issuingProfile).orderBy(desc(issuingProfile.id)).get()
    const record = {
      issuingState: merged.issuingState,
      issuingAuthority: merged.issuingAuthority,
      personalizationDevice: merged.personalizationDevice,
      dg13Policy: merged.dg13Policy,
      endorsementsJson: merged.endorsements ?? null,
      defaultsJson: JSON.stringify(merged),
      updatedBy: actorAccountId,
      updatedAt: nowIso(),
    }
    if (row) {
      this.db.update(issuingProfile).set(record).where(eq(issuingProfile.id, row.id)).run()
    } else {
      this.db.insert(issuingProfile).values(record).run()
    }
    return merged
  }
}
