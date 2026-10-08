/**
 * Mail delivery (M3 skeleton; SPF/DKIM/DMARC and template work lands in M8).
 *
 * When no SMTP URL is configured the mailer logs the message instead of
 * failing, so development and tests need no mail server.
 */
import nodemailer, { type Transporter } from 'nodemailer'

import type { AppConfig } from '../config'

/** A message to deliver. */
export interface MailMessage {
  to: string
  subject: string
  text: string
  /** Optional HTML body. */
  html?: string
}

/** The mailer interface so callers can be tested with a fake. */
export interface Mailer {
  send(message: MailMessage): Promise<void>
}

/** Creates a mailer from configuration. */
export function createMailer(config: AppConfig, log: (message: string) => void): Mailer {
  const url = config.smtp.url
  if (!url) {
    return {
      async send(message) {
        log(`mail (disabled) to=${message.to} subject=${message.subject}`)
      },
    }
  }
  const transport: Transporter = nodemailer.createTransport(url)
  return {
    async send(message) {
      await transport.sendMail({
        from: config.smtp.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      })
    },
  }
}
