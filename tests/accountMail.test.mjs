import test from 'node:test'
import assert from 'node:assert/strict'
import { createAccountMailer } from '../server/accountMail.js'

const configuration = {
  MAILJET_API_KEY: 'test-key',
  MAILJET_SECRET_KEY: 'test-secret',
  SENDER_EMAIL: 'sender@example.test',
}
const message = {
  email: 'learner@example.test',
  username: '<Learner>',
  code: '012345',
  purpose: 'verify',
  avatarPng: Buffer.from('test-avatar'),
}

test('sends an escaped, branded verification email with an inline avatar', async () => {
  let request
  const mailer = createAccountMailer(configuration, async (url, options) => {
    request = { url, options }
    return { ok: true, json: async () => ({ Messages: [{ Status: 'success' }] }) }
  })
  await mailer.sendCode(message)
  assert.equal(request.url, 'https://api.mailjet.com/v3.1/send')
  const [email] = JSON.parse(request.options.body).Messages
  assert.equal(email.To[0].Email, message.email)
  assert.match(email.TextPart, /012345/)
  assert.match(email.HTMLPart, /&lt;Learner&gt;/)
  assert.doesNotMatch(email.HTMLPart, /<Learner>/)
  assert.equal(email.InlinedAttachments[0].ContentID, 'avatar')
  assert.equal(email.InlinedAttachments[0].Base64Content, message.avatarPng.toString('base64'))
})

test('uses password recovery copy for reset codes', async () => {
  let email
  const mailer = createAccountMailer(configuration, async (_url, options) => {
    email = JSON.parse(options.body).Messages[0]
    return { ok: true, json: async () => ({ Messages: [{ Status: 'success' }] }) }
  })

  await mailer.sendCode({ ...message, purpose: 'reset' })
  assert.match(email.Subject, /Reset/)
  assert.match(email.TextPart, /reset your password/)
})

test('sends an escaped companion request with the recipient avatar and opt-out guidance', async () => {
  let email
  const mailer = createAccountMailer(configuration, async (_url, options) => {
    email = JSON.parse(options.body).Messages[0]
    return { ok: true, json: async () => ({ Messages: [{ Status: 'success' }] }) }
  })
  await mailer.sendCompanionRequest({ ...message, senderName: '<Friend>' })
  assert.match(email.TextPart, /<Friend> would like/)
  assert.match(email.TextPart, /turn off companion emails/)
  assert.match(email.HTMLPart, /&lt;Friend&gt;/)
  assert.doesNotMatch(email.HTMLPart, /<Friend>/)
  assert.equal(email.InlinedAttachments[0].ContentID, 'avatar')
})

test('sends generic companion activity emails with the sender avatar and no shared word content', async () => {
  let email
  const mailer = createAccountMailer(configuration, async (_url, options) => {
    email = JSON.parse(options.body).Messages[0]
    return { ok: true, json: async () => ({ Messages: [{ Status: 'success' }] }) }
  })
  await mailer.sendCompanionNotice({
    email: message.email, username: 'learner', senderName: '<Friend>',
    avatarPng: message.avatarPng, kind: 'share',
  })
  assert.match(email.Subject, /German word/)
  assert.match(email.HTMLPart, /&lt;Friend&gt;/)
  assert.doesNotMatch(email.HTMLPart, /<Friend>/)
  assert.doesNotMatch(email.HTMLPart, /Sprachkurs|useful word/)
  assert.match(email.TextPart, /preview it and decide whether to add/)
  assert.match(email.TextPart, /turn off companion emails/)
  assert.equal(email.InlinedAttachments[0].Base64Content, message.avatarPng.toString('base64'))
  await mailer.sendCompanionNotice({
    email: message.email, username: 'learner', senderName: 'Friend',
    avatarPng: message.avatarPng, kind: 'nudge',
  })
  assert.match(email.Subject, /gentle/)
  assert.match(email.TextPart, /whenever you feel ready/)
})

test('reports configuration, provider and malformed-response failures', async () => {
  const unconfigured = createAccountMailer({}, async () => assert.fail('must not send'))
  await assert.rejects(() => unconfigured.sendCode(message), /not configured/)
  for (const response of [
    { ok: false },
    { ok: true, json: async () => ({ Messages: [{ Status: 'error' }] }) },
    { ok: true, json: async () => { throw new Error('invalid') } },
  ]) {
    const mailer = createAccountMailer(configuration, async () => response)
    await assert.rejects(() => mailer.sendCode(message), /delivery/)
  }
})

test('rejects invalid codes and missing avatar before contacting the provider', async () => {
  const mailer = createAccountMailer(configuration, async () => assert.fail('must not send'))
  await assert.rejects(() => mailer.sendCode({ ...message, code: '12345' }), /Invalid/)
  await assert.rejects(() => mailer.sendCode({ ...message, avatarPng: null }), /Invalid/)
  await assert.rejects(() => mailer.sendCode({ ...message, purpose: 'other' }), /Invalid/)
})
