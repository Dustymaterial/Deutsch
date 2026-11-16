import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

const usernameSchema = z.object({ username: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_-]+$/) })
const targetSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/) })
const actionSchema = targetSchema.extend({ action: z.enum(['accept', 'decline', 'cancel', 'remove', 'block', 'unblock']) })
const settingsSchema = z.object({ emailsEnabled: z.boolean() })
const reportSchema = z.object({
  reason: z.enum(['spam', 'harassment', 'inappropriate', 'other']),
  details: z.string().trim().max(500).optional(),
})
const sharedCardSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  article: z.enum(['der', 'die', 'das']).optional(),
  meaning: z.string().trim().min(1).max(1000),
  plural: z.string().max(500).optional(),
  example: z.string().trim().min(1).max(2000),
  translation: z.string().max(2000).optional(),
  category: z.enum(['noun', 'verb', 'adjective', 'adverb', 'numeral', 'phrase']),
}).refine((card) => card.category !== 'noun' || Boolean(card.article), { message: 'Nouns require an article.' })
const reactionEmojis = ['👍', '🎉', '💡', '❤️', '👏']
const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/)
const chatMessageSchema = z.object({
  text: z.string().trim().min(1).max(2000).optional(),
  card: sharedCardSchema.optional(),
  replyToId: objectIdSchema.optional(),
}).refine((message) => Boolean(message.text) !== Boolean(message.card))
const reactionSchema = z.object({ emoji: z.enum(reactionEmojis).nullable() })
const shareSchema = z.object({
  recipientId: z.string().regex(/^[a-f\d]{24}$/),
  card: sharedCardSchema,
  note: z.string().trim().max(240).optional(),
})
const hour = 60 * 60 * 1000
const cooldown = 24 * hour
const shareLifetime = 30 * 24 * hour

export function createCompanionRouter({
  users, relationships, sharedWords, conversations, companionMessages, companionReports,
  requireUser, mailer, renderAvatar,
}) {
  const router = Router()
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    keyGenerator: (req) => req.accountUser._id.toString(),
    skip: (req) => req.method === 'GET',
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many companion actions. Please try again later.' },
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
  const previewText = (message) => message.text.slice(0, 140)
  const summarizeReactions = (reactions, me) => reactionEmojis.flatMap((emoji) => {
    const users = Object.entries(reactions ?? {}).filter(([, value]) => value === emoji).map(([id]) => id)
    return users.length ? [{ emoji, count: users.length, mine: users.includes(me) }] : []
  })
  const serializeMessage = (message, me) => ({
    id: message._id.toString(),
    senderId: message.senderId,
    isMine: message.senderId === me,
    kind: message.card ? 'word' : 'text',
    text: message.text,
    ...(message.card ? { card: message.card } : {}),
    ...(message.replyTo ? {
      replyTo: { id: message.replyTo.id, isMine: message.replyTo.senderId === me, text: message.replyTo.text },
    } : {}),
    reactions: summarizeReactions(message.reactions, me),
    createdAt: message.createdAt.toISOString(),
    reported: message.reporterIds?.includes(me) ?? false,
  })

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

  async function getOrCreateConversation(pair) {
    const filter = { pairKey: pair.pairKey, connectionId: pair.connectionId }
    const current = await conversations.findOne(filter)
    if (current) return current
    const conversation = {
      ...filter,
      participants: pair.participants,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    try {
      const { insertedId } = await conversations.insertOne(conversation)
      return { ...conversation, _id: insertedId }
    } catch (error) {
      if (error?.code !== 11000) throw error
      return conversations.findOne(filter)
    }
  }

  async function activeConversation(me, id) {
    if (!ObjectId.isValid(id)) return null
    const conversation = await conversations.findOne({
      _id: new ObjectId(id),
      participants: me,
    })
    if (!conversation) return null
    const them = conversation.participants.find((participant) => participant !== me)
    const pair = await currentConnection(me, them)
    if (!pair || pair.connectionId !== conversation.connectionId) return null
    return { conversation, pair, them }
  }

  router.get('/chats', async (req, res) => {
    const me = req.accountUser._id.toString()
    const pairs = await relationships.find({
      participants: me,
      state: 'connected',
      blockedBy: [],
    }).toArray()
    const chats = []
    for (const pair of pairs) {
      const them = pair.participants.find((participant) => participant !== me)
      const connection = await currentConnection(me, them)
      if (!connection) continue
      const conversation = await getOrCreateConversation(connection)
      if (!conversation) continue
      const conversationId = conversation._id.toString()
      const lastMessage = await companionMessages.findOne(
        { conversationId },
        { sort: { createdAt: -1 } },
      )
      const hiddenAt = conversation.hiddenAt?.[me]
      if (hiddenAt && (!lastMessage || lastMessage.createdAt <= hiddenAt)) continue
      const companion = await users.findOne(
        { _id: new ObjectId(them) },
        { projection: { username: 1, avatarSeed: 1 } },
      )
      if (!companion) continue
      chats.push({
        id: conversationId,
        companion: profile(companion),
        lastMessage: lastMessage ? {
          text: lastMessage.text,
          isMine: lastMessage.senderId === me,
          createdAt: lastMessage.createdAt.toISOString(),
        } : null,
        unread: Boolean(lastMessage && lastMessage.senderId !== me
          && (!conversation.readAt?.[me] || lastMessage.createdAt > conversation.readAt[me])),
        updatedAt: conversation.updatedAt.toISOString(),
      })
    }
    chats.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    res.json({ chats })
  })

  router.post('/chats/open', async (req, res) => {
    const result = targetSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a connected companion first.' })
    const me = req.accountUser._id.toString()
    const them = result.data.id
    const pair = await currentConnection(me, them)
    if (!pair) return unavailable(res)
    const conversation = await getOrCreateConversation(pair)
    const companion = await users.findOne(
      { _id: new ObjectId(them) },
      { projection: { username: 1, avatarSeed: 1 } },
    )
    if (!conversation || !companion) return unavailable(res)
    res.json({ id: conversation._id.toString(), companion: profile(companion) })
  })

  router.get('/chats/:id/messages', async (req, res) => {
    const me = req.accountUser._id.toString()
    const active = await activeConversation(me, req.params.id)
    if (!active) return unavailable(res)
    const conversationId = active.conversation._id.toString()
    const hiddenAt = active.conversation.hiddenAt?.[me]
    const before = req.query.before ? new Date(String(req.query.before)) : null
    if (before && !Number.isFinite(before.getTime())) return res.status(400).json({ error: 'Choose a valid message time.' })
    const createdAt = {
      ...(hiddenAt ? { $gt: hiddenAt } : {}),
      ...(before ? { $lt: before } : {}),
    }
    const filter = {
      conversationId,
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    }
    const found = await companionMessages.find(
      filter,
      { sort: { createdAt: -1 }, limit: 50 },
    ).toArray()
    if (!before && found[0]) {
      await conversations.updateOne({ _id: active.conversation._id }, {
        $set: { [`readAt.${me}`]: found[0].createdAt },
      })
    }
    const messages = found.reverse()
    res.json({
      hasMore: messages.length === 50,
      messages: messages.map((message) => serializeMessage(message, me)),
    })
  })

  router.post('/chats/:id/messages', async (req, res) => {
    const result = chatMessageSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Write a message up to 2,000 characters.' })
    const me = req.accountUser._id.toString()
    const active = await activeConversation(me, req.params.id)
    if (!active) return unavailable(res)
    const conversationId = active.conversation._id.toString()
    let replyTo
    if (result.data.replyToId) {
      const target = await companionMessages.findOne({ _id: new ObjectId(result.data.replyToId), conversationId })
      const hiddenAt = active.conversation.hiddenAt?.[me]
      if (!target || (hiddenAt && target.createdAt <= hiddenAt)) {
        return res.status(400).json({ error: 'That message is no longer available to reply to.' })
      }
      replyTo = { id: target._id.toString(), senderId: target.senderId, text: previewText(target) }
    }
    const now = new Date()
    const throttle = await users.updateOne({
      _id: req.accountUser._id,
      $or: [
        { 'companionMessageHistory.59': { $exists: false } },
        { 'companionMessageHistory.59': { $lte: new Date(now.getTime() - hour) } },
      ],
    }, { $push: { companionMessageHistory: { $each: [now], $position: 0, $slice: 60 } } })
    if (!throttle.modifiedCount) return res.status(429).json({ error: 'You have sent several messages. Please try again later.' })
    const message = {
      conversationId,
      senderId: me,
      text: result.data.card ? `Shared a word: ${result.data.card.prompt}` : result.data.text,
      ...(result.data.card ? { card: result.data.card } : {}),
      ...(replyTo ? { replyTo } : {}),
      createdAt: now,
    }
    const { insertedId } = await companionMessages.insertOne(message)
    await conversations.updateOne({ _id: active.conversation._id }, {
      $set: {
        updatedAt: now,
        lastMessageAt: now,
        [`readAt.${me}`]: now,
      },
    })
    res.status(201).json({ message: serializeMessage({ ...message, _id: insertedId }, me) })
  })

  router.post('/chats/:id/delete', async (req, res) => {
    const me = req.accountUser._id.toString()
    const active = await activeConversation(me, req.params.id)
    if (!active) return unavailable(res)
    await conversations.updateOne({ _id: active.conversation._id }, {
      $set: { [`hiddenAt.${me}`]: new Date() },
    })
    res.json({ ok: true })
  })

  router.post('/messages/:id/reaction', async (req, res) => {
    const result = reactionSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose one of the available reactions.' })
    if (!ObjectId.isValid(req.params.id)) return unavailable(res)
    const me = req.accountUser._id.toString()
    const message = await companionMessages.findOne({ _id: new ObjectId(req.params.id) })
    if (!message) return unavailable(res)
    const active = await activeConversation(me, message.conversationId)
    const hiddenAt = active?.conversation.hiddenAt?.[me]
    if (!active || (hiddenAt && message.createdAt <= hiddenAt)) return unavailable(res)
    const path = `reactions.${me}`
    const { emoji } = result.data
    await companionMessages.updateOne({ _id: message._id }, emoji ? { $set: { [path]: emoji } } : { $unset: { [path]: '' } })
    const reactions = { ...message.reactions }
    if (emoji) reactions[me] = emoji
    else delete reactions[me]
    res.json({ reactions: summarizeReactions(reactions, me) })
  })

  router.post('/messages/:id/report', async (req, res) => {
    const result = reportSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a reason and keep details under 500 characters.' })
    if (!ObjectId.isValid(req.params.id)) return unavailable(res)
    const me = req.accountUser._id.toString()
    const message = await companionMessages.findOne({ _id: new ObjectId(req.params.id) })
    if (!message || message.senderId === me) return unavailable(res)
    const conversation = await conversations.findOne({
      _id: new ObjectId(message.conversationId),
      participants: me,
    })
    if (!conversation) return unavailable(res)
    try {
      await companionReports.insertOne({
        conversationId: message.conversationId,
        messageId: message._id.toString(),
        reporterId: me,
        reportedUserId: message.senderId,
        messageText: message.text,
        reason: result.data.reason,
        ...(result.data.details ? { details: result.data.details } : {}),
        createdAt: new Date(),
      })
    } catch (error) {
      if (error?.code !== 11000) throw error
      return res.status(409).json({ error: 'You have already reported this message.' })
    }
    await companionMessages.updateOne({ _id: message._id }, { $addToSet: { reporterIds: me } })
    res.status(201).json({ ok: true })
  })

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
