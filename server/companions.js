import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

const usernameSchema = z.object({ username: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_-]+$/) })
const targetSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/) })
const actionSchema = targetSchema.extend({ action: z.enum(['accept', 'decline', 'cancel', 'remove', 'block', 'unblock']) })
const settingsSchema = z.object({ emailsEnabled: z.boolean() })
const sharedCardSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  article: z.enum(['der', 'die', 'das']).optional(),
  meaning: z.string().trim().min(1).max(1000),
  plural: z.string().max(500).optional(),
  example: z.string().trim().min(1).max(2000),
  translation: z.string().max(2000).optional(),
  category: z.enum(['noun', 'verb', 'adjective', 'adverb', 'numeral', 'phrase']),
}).refine((card) => card.category !== 'noun' || Boolean(card.article), { message: 'Nouns require an article.' })
const shareSchema = z.object({
  recipientId: z.string().regex(/^[a-f\d]{24}$/),
  card: sharedCardSchema,
  note: z.string().trim().max(240).optional(),
})
const hour = 60 * 60 * 1000
const cooldown = 24 * hour
const shareLifetime = 30 * 24 * hour

export function createCompanionRouter({ users, relationships, sharedWords, requireUser, mailer, renderAvatar }) {
  const router = Router()
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many companion requests. Please try again later.' },
  })
  router.use(requireUser, (req, res, next) => {
    if (!req.accountUser.emailVerifiedAt) return res.status(403).json({ error: 'Verify your email to use companions.' })
    next()
  }, limiter)

  const pairKey = (a, b) => [a, b].sort().join(':')
  const profile = (user) => ({ id: user._id.toString(), username: user.username, avatarSeed: user.avatarSeed })
  const unavailable = (res) => res.status(404).json({ error: 'That learner is unavailable.' })
  const changed = (res) => res.status(409).json({ error: 'This request changed. Refresh and try again.' })
  const findPair = (a, b) => relationships.findOne({ pairKey: pairKey(a, b) })
  const hidden = (pair, me) => pair?.blockedBy?.some((id) => id !== me)
  const sentNudgeAt = (userId) => `nudges.sentAt.${userId}`
  const readNudgeAt = (userId) => `nudges.readAt.${userId}`

  async function getOrCreatePair(me, them) {
    const key = pairKey(me, them)
    const current = await relationships.findOne({ pairKey: key })
    if (current) return current
    const pair = { pairKey: key, participants: [me, them].sort(), state: 'none', blockedBy: [], revision: 0 }
    try {
      await relationships.insertOne(pair)
      return pair
    } catch (error) {
      if (error?.code !== 11000) throw error
      return relationships.findOne({ pairKey: key })
    }
  }

  async function updatePair(pair, values) {
    const result = await relationships.updateOne({ pairKey: pair.pairKey, revision: pair.revision }, {
      $set: values,
      $inc: { revision: 1 },
    })
    return result.modifiedCount === 1
  }

  async function notifyByEmail(recipient, sender, kind) {
    if (!mailer.configured) return
    const now = new Date()
    const reserved = await users.updateOne({
      _id: recipient._id,
      companionEmailsEnabled: { $ne: false },
      $or: [
        { 'companionEmailHistory.4': { $exists: false } },
        { 'companionEmailHistory.4': { $lte: new Date(now.getTime() - hour) } },
      ],
    }, { $push: { companionEmailHistory: { $each: [now], $position: 0, $slice: 5 } } })
    if (!reserved.modifiedCount) return
    try {
      await mailer.sendCompanionNotice({
        email: recipient.email,
        username: recipient.username,
        senderName: sender.username,
        avatarPng: await renderAvatar(sender.avatarSeed),
        kind,
      })
    } catch {
      console.error('Companion activity email could not be sent.')
    }
  }

  async function currentConnection(me, them) {
    let pair = await findPair(me, them)
    if (!pair || pair.state !== 'connected' || pair.blockedBy.length) return null
    if (!pair.connectionId) {
      const connectionId = new ObjectId().toString()
      if (await updatePair(pair, { connectionId, updatedAt: new Date() })) pair = { ...pair, connectionId }
      else pair = await findPair(me, them)
    }
    return pair?.state === 'connected' && !pair.blockedBy.length && typeof pair.connectionId === 'string' ? pair : null
  }

  router.get('/', async (req, res) => {
    const me = req.accountUser._id.toString()
    const pairs = await relationships.find({ participants: me }).toArray()
    const items = []
    for (const pair of pairs) {
      if (hidden(pair, me) && !pair.blockedBy.includes(me)) continue
      if (pair.state === 'none' && !pair.blockedBy.includes(me)) continue
      const other = pair.participants.find((id) => id !== me)
      const user = await users.findOne({ _id: new ObjectId(other) }, { projection: { username: 1, avatarSeed: 1 } })
      if (!user) continue
      const lastNudge = pair.nudges?.sentAt?.[me]
      const receivedNudge = pair.nudges?.sentAt?.[other]
      const readNudge = pair.nudges?.readAt?.[other]
      items.push({
        ...profile(user),
        status: pair.blockedBy.includes(me) ? 'blocked' : pair.state === 'connected' ? 'connected' : pair.requestedBy === me ? 'outgoing' : 'incoming',
        ...(pair.state === 'connected' ? {
          canNudge: !lastNudge || Date.now() - new Date(lastNudge).getTime() >= cooldown,
          ...(receivedNudge && (!readNudge || new Date(receivedNudge) > new Date(readNudge))
            ? { nudgeAt: new Date(receivedNudge).toISOString() }
            : {}),
        } : {}),
      })
    }
    const incoming = await sharedWords.find({
      recipientId: me,
      state: 'pending',
      expiresAt: { $gt: new Date() },
    }, { sort: { createdAt: -1 }, limit: 50 }).toArray()
    const shares = []
    for (const share of incoming) {
      const pair = await currentConnection(me, share.senderId)
      if (!pair || pair.connectionId !== share.connectionId) continue
      const sender = await users.findOne({ _id: new ObjectId(share.senderId) }, { projection: { username: 1, avatarSeed: 1 } })
      if (sender) shares.push({
        id: share._id.toString(),
        card: share.card,
        note: share.note ?? '',
        sender: profile(sender),
        createdAt: share.createdAt.toISOString(),
      })
    }
    const account = await users.findOne({ _id: req.accountUser._id }, { projection: { companionEmailsEnabled: 1 } })
    if (!account) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
    res.json({ companions: items, sharedWords: shares, emailsEnabled: account.companionEmailsEnabled !== false })
  })

  router.post('/search', async (req, res) => {
    const result = usernameSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Enter an exact username.' })
    const user = await users.findOne({ usernameKey: result.data.username.toLowerCase(), emailVerifiedAt: { $exists: true, $ne: null } })
    const me = req.accountUser._id.toString()
    if (!user || user._id.toString() === me) return unavailable(res)
    const pair = await findPair(me, user._id.toString())
    if (pair?.blockedBy?.length) return unavailable(res)
    res.json({ user: profile(user) })
  })

  router.post('/request', async (req, res) => {
    const result = targetSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a learner first.' })
    const me = req.accountUser._id.toString()
    const them = result.data.id
    if (me === them) return unavailable(res)
    const user = await users.findOne({ _id: new ObjectId(them), emailVerifiedAt: { $exists: true, $ne: null } })
    if (!user) return unavailable(res)
    const pair = await getOrCreatePair(me, them)
    if (pair.blockedBy.length) return unavailable(res)
    if (pair.state !== 'none') return changed(res)
    const now = new Date()
    if (pair.closedAt && now - pair.closedAt < cooldown) return res.status(429).json({ error: 'Please wait a day before requesting this learner again.' })
    const throttle = await users.updateOne({
      _id: req.accountUser._id,
      $or: [
        { 'companionRequestHistory.9': { $exists: false } },
        { 'companionRequestHistory.9': { $lte: new Date(now.getTime() - hour) } },
      ],
    }, { $push: { companionRequestHistory: { $each: [now], $position: 0, $slice: 10 } } })
    if (!throttle.modifiedCount) return res.status(429).json({ error: 'You have sent several requests. Please try again later.' })
    if (!await updatePair(pair, { state: 'pending', requestedBy: me, updatedAt: now })) return changed(res)

    if (mailer.configured) {
      const reserved = await users.updateOne({
        _id: user._id,
        companionEmailsEnabled: { $ne: false },
        $or: [
          { 'companionEmailHistory.4': { $exists: false } },
          { 'companionEmailHistory.4': { $lte: new Date(now.getTime() - hour) } },
        ],
      }, { $push: { companionEmailHistory: { $each: [now], $position: 0, $slice: 5 } } })
      if (reserved.modifiedCount) {
        try {
          await mailer.sendCompanionRequest({
            email: user.email,
            username: user.username,
            senderName: req.accountUser.username,
            avatarPng: await renderAvatar(user.avatarSeed),
          })
        } catch {
          console.error('Companion request email could not be sent.')
        }
      }
    } else {
      console.error('Companion request email is not configured.')
    }
    res.status(201).json({ ok: true })
  })

  router.post('/share', async (req, res) => {
    const result = shareSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Check the word and optional note before sharing.' })
    const me = req.accountUser._id.toString()
    const recipientId = result.data.recipientId
    if (me === recipientId) return unavailable(res)
    const pair = await currentConnection(me, recipientId)
    if (!pair) return unavailable(res)
    const now = new Date()
    const throttle = await users.updateOne({
      _id: req.accountUser._id,
      $or: [
        { 'companionShareHistory.9': { $exists: false } },
        { 'companionShareHistory.9': { $lte: new Date(now.getTime() - hour) } },
      ],
    }, { $push: { companionShareHistory: { $each: [now], $position: 0, $slice: 10 } } })
    if (!throttle.modifiedCount) return res.status(429).json({ error: 'You have shared several words. Please try again later.' })
    const share = {
      senderId: me,
      recipientId,
      connectionId: pair.connectionId,
      card: result.data.card,
      ...(result.data.note ? { note: result.data.note } : {}),
      state: 'pending',
      createdAt: now,
      expiresAt: new Date(now.getTime() + shareLifetime),
    }
    const inserted = await sharedWords.insertOne(share)
    const recipient = await users.findOne({ _id: new ObjectId(recipientId) })
    if (recipient) await notifyByEmail(recipient, req.accountUser, 'share')
    res.status(201).json({ id: inserted.insertedId.toString(), ok: true })
  })

  router.post('/shares/:id/add', async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return unavailable(res)
    const share = await sharedWords.findOne({
      _id: new ObjectId(req.params.id),
      recipientId: req.accountUser._id.toString(),
      state: 'pending',
      expiresAt: { $gt: new Date() },
    })
    if (!share || !await currentConnection(share.recipientId, share.senderId)
      .then((pair) => pair?.connectionId === share.connectionId)) return unavailable(res)
    const updated = await sharedWords.updateOne({
      _id: share._id,
      recipientId: share.recipientId,
      state: 'pending',
    }, { $set: { state: 'added', resolvedAt: new Date() } })
    if (!updated.modifiedCount) return changed(res)
    res.json({ ok: true })
  })

  router.post('/shares/:id/dismiss', async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return unavailable(res)
    const share = await sharedWords.findOne({
      _id: new ObjectId(req.params.id),
      recipientId: req.accountUser._id.toString(),
      state: 'pending',
      expiresAt: { $gt: new Date() },
    })
    if (!share || !await currentConnection(share.recipientId, share.senderId)
      .then((pair) => pair?.connectionId === share.connectionId)) return unavailable(res)
    const updated = await sharedWords.updateOne({
      _id: share._id,
      recipientId: share.recipientId,
      state: 'pending',
    }, { $set: { state: 'dismissed', resolvedAt: new Date() } })
    if (!updated.modifiedCount) return changed(res)
    res.json({ ok: true })
  })

  router.post('/nudge', async (req, res) => {
    const result = targetSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a companion first.' })
    const me = req.accountUser._id.toString()
    const recipientId = result.data.id
    const pair = await currentConnection(me, recipientId)
    if (!pair) return unavailable(res)
    const now = new Date()
    const path = sentNudgeAt(me)
    const updated = await relationships.updateOne({
      pairKey: pair.pairKey,
      state: 'connected',
      revision: pair.revision,
      blockedBy: [],
      $or: [
        { [path]: { $exists: false } },
        { [path]: { $lte: new Date(now.getTime() - cooldown) } },
      ],
    }, {
      $set: { [path]: now, updatedAt: now },
      $inc: { revision: 1 },
    })
    if (!updated.modifiedCount) return res.status(429).json({ error: 'You already sent this companion a nudge in the past day.' })
    const recipient = await users.findOne({ _id: new ObjectId(recipientId) })
    if (!recipient) return unavailable(res)
    await notifyByEmail(recipient, req.accountUser, 'nudge')
    res.status(201).json({ ok: true })
  })

  router.post('/nudge/read', async (req, res) => {
    const result = targetSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a companion first.' })
    const me = req.accountUser._id.toString()
    const them = result.data.id
    const pair = await currentConnection(me, them)
    if (!pair) return unavailable(res)
    const lastNudge = pair.nudges?.sentAt?.[them]
    if (!lastNudge) return changed(res)
    const updated = await relationships.updateOne({
      pairKey: pair.pairKey,
      state: 'connected',
      revision: pair.revision,
      [sentNudgeAt(them)]: lastNudge,
    }, {
      $set: { [readNudgeAt(them)]: lastNudge },
      $inc: { revision: 1 },
    })
    if (!updated.modifiedCount) return changed(res)
    res.json({ ok: true })
  })

  router.post('/action', async (req, res) => {
    const result = actionSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a valid companion action.' })
    const me = req.accountUser._id.toString()
    const { id: them, action } = result.data
    if (me === them) return unavailable(res)
    const user = await users.findOne({ _id: new ObjectId(them) }, { projection: { _id: 1 } })
    if (!user) return unavailable(res)
    const pair = action === 'block' ? await getOrCreatePair(me, them) : await findPair(me, them)
    if (!pair) return unavailable(res)
    const blockedBy = pair.blockedBy
    let values
    if (action === 'block') {
      if (blockedBy.includes(me)) return changed(res)
      values = { state: 'none', blockedBy: [...blockedBy, me], closedAt: new Date() }
    } else if (action === 'unblock') {
      if (!blockedBy.includes(me)) return changed(res)
      values = { state: 'none', blockedBy: blockedBy.filter((id) => id !== me), closedAt: new Date() }
    } else {
      if (blockedBy.length) return unavailable(res)
      if (action === 'accept' && pair.state === 'pending' && pair.requestedBy === them) {
        values = { state: 'connected', connectionId: new ObjectId().toString() }
      } else if ((action === 'decline' && pair.state === 'pending' && pair.requestedBy === them)
        || (action === 'cancel' && pair.state === 'pending' && pair.requestedBy === me)
        || (action === 'remove' && pair.state === 'connected')) {
        values = { state: 'none', closedAt: new Date() }
      } else return changed(res)
    }
    if (!await updatePair(pair, { ...values, updatedAt: new Date() })) return changed(res)
    res.json({ ok: true })
  })

  router.post('/settings', async (req, res) => {
    const result = settingsSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a valid email setting.' })
    await users.updateOne({ _id: req.accountUser._id }, { $set: { companionEmailsEnabled: result.data.emailsEnabled } })
    res.json({ emailsEnabled: result.data.emailsEnabled })
  })
  return router
}
