/** The data group numbers a signing request produces (for metadata/preview). */
import type { SignRequest } from '@epass42/shared'

export function dataGroupList(
  payload: SignRequest,
  security: SignRequest['security'] = payload.security,
): number[] {
  const groups = [1, 2, 12, 14]
  if (payload.dg3) groups.push(3)
  if (payload.dg4) groups.push(4)
  if (payload.dg5) groups.push(5)
  if (payload.dg7) groups.push(7)
  if (payload.dg11) groups.push(11)
  if (payload.dg13) groups.push(13)
  if (payload.dg16) groups.push(16)
  if (security?.aa.enabled) groups.push(15)
  return [...new Set(groups)].sort((a, b) => a - b)
}
