/** localStorage key recording that the operator acknowledged the dev warning. */
export const DEV_WARNING_STORAGE_KEY = 'epass42-dev-warning-seen'

/** True when a development deployment should show the warning on this visit. */
export function shouldShowDevWarning(
  env: string | null | undefined,
  acknowledged: boolean,
): boolean {
  return env === 'development' && !acknowledged
}
