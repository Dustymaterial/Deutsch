import { OTP_LIFETIME_MS } from './accountOtp.js'

const mailjetUrl = 'https://api.mailjet.com/v3.1/send'
const expiryNotice = `This code expires in ${OTP_LIFETIME_MS / 60000} minutes. If you did not request it, you can ignore this email.`

const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character])

const content = {
  verify: {
    subject: 'Verify your Deutsch Deck email',
    heading: 'Let’s confirm it’s you.',
    message: 'Enter this code in Deutsch Deck to verify your email address.',
  },
  reset: {
    subject: 'Reset your Deutsch Deck password',
    heading: 'Let’s get you back in.',
    message: 'Enter this code in Deutsch Deck to reset your password.',
  },
}

export function createAccountMailer(configuration, fetchImpl = fetch) {
  const { MAILJET_API_KEY: apiKey, MAILJET_SECRET_KEY: secret, SENDER_EMAIL: sender } = configuration
  const configured = Boolean(apiKey && secret && sender)

  return {
    configured,
    async sendCode({ email, username, code, purpose, avatarPng }) {
      if (!configured) throw new Error('Account email is not configured.')
      if (!Object.hasOwn(content, purpose) || !/^\d{6}$/.test(code) || !Buffer.isBuffer(avatarPng) || avatarPng.length === 0) {
        throw new Error('Invalid account email.')
      }

      const { subject, heading, message } = content[purpose]
      const safeName = escapeHtml(username)
      const text = `Deutsch Deck\n\nHi ${username},\n\n${message}\n\n${code}\n\n${expiryNotice}`
      const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px 12px;background:#f5f4ee;color:#292a2d;font-family:Arial,sans-serif">
<table role="presentation" style="width:100%;max-width:480px;margin:auto;border-collapse:collapse"><tr><td>
<p style="font-size:16px;font-weight:700;letter-spacing:-0.4px">deutsch deck</p>
<div style="padding:28px;background:#fffdf6;border:1px solid #e3e1da;border-radius:20px">
<img src="cid:avatar" width="56" height="56" alt="" style="display:block;border-radius:8px;background:#f7e7bd">
<p style="margin:18px 0 8px;color:#625b65;font-size:14px">Hi ${safeName},</p>
<h1 style="margin:0;font-size:23px;line-height:1.3">${heading}</h1>
<p style="font-size:14px;line-height:1.6">${message}</p>
<p style="padding:16px;border-radius:12px;background:#dcebdd;font-size:28px;font-weight:700;letter-spacing:6px;text-align:center">${code}</p>
<p style="color:#625b65;font-size:13px;line-height:1.6">${expiryNotice}</p>
</div><p style="color:#77717b;font-size:12px">A little practice, one word at a time.</p>
</td></tr></table></body></html>`

      const response = await fetchImpl(mailjetUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:${secret}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Messages: [{
            From: { Email: sender, Name: 'Deutsch Deck' },
            To: [{ Email: email }],
            Subject: subject,
            TextPart: text,
            HTMLPart: html,
            InlinedAttachments: [{
              ContentType: 'image/png',
              Filename: 'avatar.png',
              ContentID: 'avatar',
              Base64Content: avatarPng.toString('base64'),
            }],
          }],
        }),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error('Account email delivery failed.')
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error('Account email delivery returned an invalid response.')
      }
      if (!Array.isArray(body?.Messages) || body.Messages.length !== 1 || body.Messages[0]?.Status !== 'success') {
        throw new Error('Account email delivery failed.')
      }
    },
  }
}
