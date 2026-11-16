import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

const usernameSchema = z.object({ username: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_-]+$/) })
const targetSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/) })
const actionSchema = targetSchema.extend({ action: z.enum(['accept', 'decline', 'cancel', 'remove', 'block', 'unblock']) })
const settingsSchema = z.object({ emailsEnabled: z.boolean() })
const hour = 60 * 60 * 1000
const cooldown = 24 * hour

export function createCompanionRouter({ users, relationships, requireUser, mailer, renderAvatar }) {
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
      items.push({
        ...profile(user),
        status: pair.blockedBy.includes(me) ? 'blocked' : pair.state === 'connected' ? 'connected' : pair.requestedBy === me ? 'outgoing' : 'incoming',
      })
    }
    const account = await users.findOne({ _id: req.accountUser._id }, { projection: { companionEmailsEnabled: 1 } })
    if (!account) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
    res.json({ companions: items, emailsEnabled: account.companionEmailsEnabled !== false })
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
        values = { state: 'connected' }
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
