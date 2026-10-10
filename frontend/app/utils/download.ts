/**
 * Client-side artifact download.
 *
 * The one-time perso hand-off is a `text/plain` script; it is written straight
 * to a local file instead of being rendered in the page (browser-only).
 */
export function downloadText(filename: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * Triggers a browser download from a URL (used for certificate/CRL/ML/LDIF
 * exports served by the API, which may live on another origin).
 */
export function downloadUrl(url: string, filename?: string): void {
  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  if (filename) link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}
