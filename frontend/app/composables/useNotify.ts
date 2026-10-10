import { useNotification } from 'naive-ui'

/**
 * Formal, consistent notifications for important outcomes (submission,
 * approval, claim).  Lightweight feedback keeps using `useMessage`.
 */
export function useNotify() {
  const notification = useNotification()
  return {
    success: (content: string, meta?: string) =>
      notification.success({ content, meta, duration: 4000 }),
    error: (content: string, meta?: string) =>
      notification.error({ content, meta, duration: 5000 }),
  }
}
