import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { foldText, searchResultLimit, searchScanLimit } from './messageSearch.js'
import { reactionSchema, summarizeReactions } from './chatReactions.js'
import { sharedCardSchema } from './sharedCard.js'
import { correctionResponseSchema, correctionSchema } from './chatReviews.js'
import { mapInBatches } from './mapInBatches.js'
import { setTyping, typingFilter, typingRateLimit, typingSchema } from './chatTyping.js'
import { liveSessionValid } from './chatLive.js'
import { findSentMessage, insertChatMessage, sendIdentity } from './chatSend.js'
import { acknowledgeMessages, receiptRateLimit, receiptStatus } from './chatReceipts.js'

const usernameSchema = z.object({ username: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_-]+$/) })
const targetSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/) })
const actionSchema = targetSchema.extend({ action: z.enum(['accept', 'decline', 'cancel', 'remove', 'block', 'unblock']) })
const settingsSchema = z.object({ emailsEnabled: z.boolean() })
const reportSchema = z.object({
  reason: z.enum(['spam', 'harassment', 'inappropriate', 'other']),
  details: z.string().trim().max(500).optional(),
})
const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/)
const receiptSchema = targetSchema.extend({ ids: z.array(objectIdSchema).max(50).optional() })
const chatMessageSchema = z.object({
  text: z.string().trim().min(1).max(2000).optional(),
  card: sharedCardSchema.optional(),
  replyToId: objectIdSchema.optional(),
  clientId: objectIdSchema.optional(),
}).refine((message) => Boolean(message.text) !== Boolean(message.card))
const messageEditSchema = z.object({ text: z.string().trim().min(1).max(2000) })
const shareSchema = z.object({
  recipientId: z.string().regex(/^[a-f\d]{24}$/),
  card: sharedCardSchema,
  note: z.string().trim().max(240).optional(),
})
const practiceStartSchema = z.object({ tag: z.string().trim().min(1).max(100).optional() })
const practiceAnswerSchema = z.object({ answer: z.string().trim().min(1).max(1000) })
const practiceDecisionSchema = z.object({ decision: z.enum(['accept', 'decline', 'end', 'try-again', 'correct', 'reveal', 'retry', 'next']) })
const practiceCategories = new Set(['noun', 'verb', 'adjective', 'adverb', 'numeral', 'phrase'])
const hour = 60 * 60 * 1000
const searchableFields = (message) => [
  ...(message.card ? [] : [message.text]),
  ...(message.card ? [message.card.prompt, message.card.meaning, message.card.example, message.card.translation] : []),
  ...(message.correction ? [message.correction.text, message.correction.note] : []),
].filter(Boolean)
const editWindow = 10 * 60 * 1000
const unsentText = 'Message unsent'
const cooldown = 24 * hour
const shareLifetime = 30 * 24 * hour
const practiceLifetime = 24 * hour

export function createCompanionRouter({
  users, progress, relationships, sharedWords, conversations, companionMessages, companionReports, practiceSessions,
  requireUser, mailer, renderAvatar, chatTyping, chatLive, chatReplay, groups, groupMembers,
}) {
  const router = Router()
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    keyGenerator: (req) => req.accountUser._id.toString(),
    skip: (req) => req.method === 'GET' || (req.method === 'POST' && /^\/chats\/[^/]+\/(?:read|delivered|typing)$/.test(req.path)),
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
  const findPair = (a, b) => relationships.findOne({ pairKey: pairKey(a, b) }, { readConcern: { level: 'majority' }, readPreference: 'primary' })
  const hidden = (pair, me) => pair?.blockedBy?.some((id) => id !== me)
  const sentNudgeAt = (userId) => `nudges.sentAt.${userId}`
  const readNudgeAt = (userId) => `nudges.readAt.${userId}`
  const previewText = (message) => message.text.slice(0, 140)
  const serializeMessage = (message, me) => {
    const base = {
      id: message._id.toString(),
      senderId: message.senderId,
      isMine: message.senderId === me,
      createdAt: message.createdAt.toISOString(),
      ...(message.senderId === me ? { receipt: receiptStatus(message) } : {}),
    }
    if (message.unsentAt) return { ...base, kind: 'unsent', text: unsentText, reactions: [], reported: false }
    return {
      ...base,
      kind: message.card ? 'word' : 'text',
      text: message.text,
      ...(message.card ? { card: message.card } : {}),
      ...(message.replyTo ? {
        replyTo: { id: message.replyTo.id, isMine: message.replyTo.senderId === me, text: message.replyTo.text },
      } : {}),
      ...(message.editedAt ? { editedAt: message.editedAt.toISOString() } : {}),
      ...(message.senderId === me ? { editableUntil: new Date(message.createdAt.getTime() + editWindow).toISOString() } : {}),
      ...(message.correction ? {
        correction: {
          ...(message.correction.text ? { text: message.correction.text } : {}),
          ...(message.correction.approved ? { approved: true } : {}),
          ...(message.correction.tags?.length ? { tags: message.correction.tags } : {}),
          ...(message.correction.note ? { note: message.correction.note } : {}),
          byMe: message.correction.authorId === me,
          createdAt: message.correction.createdAt.toISOString(),
          ...(message.correction.response ? { response: message.correction.response } : {}),
        },
      } : {}),
      reactions: summarizeReactions(message.reactions, me),
      reported: message.reporterIds?.includes(me) ?? false,
    }
  }

  const serializePractice = (session, me) => {
    const helper = session.helperId === me
    const active = session.status === 'active'
    const card = active ? session.cards[session.cardIndex] : null
    const feedback = session.round?.feedback
    return {
      id: session._id.toString(),
      role: helper ? 'helper' : 'learner',
      status: session.status,
      total: session.total,
      ...(active ? { position: session.cardIndex + 1 } : {}),
      ...(card ? {
        card: helper
          ? card
          : {
              prompt: card.prompt,
              ...(card.article ? { article: card.article } : {}),
              category: card.category,
              ...(feedback === 'reveal' ? { meaning: card.meaning, ...(card.plural ? { plural: card.plural } : {}) } : {}),
            },
        ...(session.round?.answer ? { answer: session.round.answer } : {}),
        ...(feedback ? { feedback } : {}),
      } : {}),
    }
  }

  async function reserveMessageSlot(user, now) {
    const throttle = await users.updateOne({
      _id: user._id,
      $or: [
        { 'companionMessageHistory.59': { $exists: false } },
        { 'companionMessageHistory.59': { $lte: new Date(now.getTime() - hour) } },
      ],
    }, { $push: { companionMessageHistory: { $each: [now], $position: 0, $slice: 60 } } })
    return throttle.modifiedCount === 1
  }

  async function visibleMessage(me, id) {
    if (!ObjectId.isValid(id)) return null
    const message = await companionMessages.findOne({ _id: new ObjectId(id) })
    if (!message || message.unsentAt) return null
    const active = await activeConversation(me, message.conversationId)
    const hiddenAt = active?.conversation.hiddenAt?.[me]
    if (!active || (hiddenAt && message.createdAt <= hiddenAt)) return null
    return { message, active }
  }

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
    }, { readConcern: { level: 'majority' }, readPreference: 'primary' })
    if (!conversation) return null
    const them = conversation.participants.find((participant) => participant !== me)
    const pair = await currentConnection(me, them)
    if (!pair || pair.connectionId !== conversation.connectionId) return null
    return { conversation, pair, them }
  }

  router.get('/chats/:id/live', async (req, res) => {
    const me = req.accountUser._id.toString()
    if (!await activeConversation(me, req.params.id)) return unavailable(res)
    return chatLive.subscribe(req, res, 'private', req.params.id, async () =>
      await liveSessionValid(req, users) && Boolean(await activeConversation(me, req.params.id)))
  })

  router.get('/message-sounds/live', async (req, res) => {
    const me = req.accountUser._id.toString()
    return chatLive.subscribeNotifications(req, res, me, async (event) => {
      if (!await liveSessionValid(req, users)) return { session: false, allowed: false }
      if (event.kind === 'private') {
        const active = await activeConversation(me, event.chatId)
        const hiddenAt = active?.conversation.hiddenAt?.[me]
        return { session: true, allowed: Boolean(active && (!hiddenAt || hiddenAt < event.createdAt)) }
      }
      const account = await users.findOne({ _id: req.accountUser._id }, {
        projection: { groupRulesAcceptedAt: 1, groupsSuspendedUntil: 1 },
      })
      if (!account?.groupRulesAcceptedAt || (account.groupsSuspendedUntil && account.groupsSuspendedUntil > new Date())) {
        return { session: true, allowed: false }
      }
      const [group, member] = await Promise.all([
        groups.findOne({ _id: new ObjectId(event.chatId) }),
        groupMembers.findOne({ groupId: event.chatId, userId: me, state: 'active', joinedAt: { $lte: event.createdAt } }),
      ])
      return { session: true, allowed: Boolean(group && member) }
    })
  })

  const unreadLimit = 99
  const unreadCountFor = async (conversation, me) => {
    const readThrough = conversation.readThrough?.[me]
    const readAt = conversation.readAt?.[me]
    const hiddenAt = conversation.hiddenAt?.[me]
    const cursorTime = readThrough ? new Date(readThrough.slice(0, 24)) : null
    const since = [hiddenAt, ...(!cursorTime || (readAt && readAt > cursorTime) ? [readAt] : [])]
      .filter(Boolean).sort((a, b) => b - a)[0]
    const found = await companionMessages.find({
      conversationId: conversation._id.toString(),
      senderId: { $ne: me },
      ...(since ? { createdAt: { $gt: since } } : {}),
      ...(readThrough ? {
        $or: [
          { createdAt: { $gt: new Date(readThrough.slice(0, 24)) } },
          { createdAt: new Date(readThrough.slice(0, 24)), _id: { $gt: new ObjectId(readThrough.slice(25)) } },
        ],
      } : {}),
    }, { limit: unreadLimit }).toArray()
    return found.filter((message) => !message.unsentAt).length
  }

  router.get('/unread', async (req, res) => {
    const me = req.accountUser._id.toString()
    const pairs = await relationships.find({ participants: me, state: 'connected', blockedBy: [] }).toArray()
    const counts = await mapInBatches(pairs, async (pair) => {
      const them = pair.participants.find((participant) => participant !== me)
      const connection = await currentConnection(me, them)
      if (!connection) return 0
      const conversation = await getOrCreateConversation(connection)
      return conversation ? unreadCountFor(conversation, me) : 0
    })
    const count = counts.reduce((total, item) => total + item, 0)
    res.json({ count })
  })

  router.get('/chats', async (req, res) => {
    const me = req.accountUser._id.toString()
    const pairs = await relationships.find({
      participants: me,
      state: 'connected',
      blockedBy: [],
    }).toArray()
    const chats = (await mapInBatches(pairs, async (pair) => {
      const them = pair.participants.find((participant) => participant !== me)
      const connection = await currentConnection(me, them)
      if (!connection) return null
      const conversation = await getOrCreateConversation(connection)
      if (!conversation) return null
      const conversationId = conversation._id.toString()
      const [lastMessage, companion, unreadCount] = await Promise.all([
        companionMessages.findOne({ conversationId }, { sort: { createdAt: -1, _id: -1 } }),
        users.findOne({ _id: new ObjectId(them) }, { projection: { username: 1, avatarSeed: 1 } }),
        unreadCountFor(conversation, me),
      ])
      const hiddenAt = conversation.hiddenAt?.[me]
      if (hiddenAt && (!lastMessage || lastMessage.createdAt <= hiddenAt)) return null
      if (!companion) return null
      return {
        id: conversationId,
        companion: profile(companion),
        lastMessage: lastMessage ? {
          id: lastMessage._id.toString(),
          text: lastMessage.unsentAt ? unsentText : lastMessage.text,
          isMine: lastMessage.senderId === me,
          createdAt: lastMessage.createdAt.toISOString(),
        } : null,
        unread: unreadCount > 0,
        unreadCount,
        updatedAt: conversation.updatedAt.toISOString(),
      }
    })).filter(Boolean)
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

  async function activePractice(me, chatId) {
    const active = await activeConversation(me, chatId)
    if (!active) return null
    const session = await practiceSessions.findOne({
      conversationId: active.conversation._id.toString(),
      participants: me,
      status: { $in: ['pending', 'active'] },
      expiresAt: { $gt: new Date() },
    }, { sort: { updatedAt: -1 } })
    return { active, session }
  }

  router.get('/chats/:id/practice', async (req, res) => {
    const me = req.accountUser._id.toString()
    const found = await activePractice(me, req.params.id)
    if (!found) return unavailable(res)
    res.json({ practice: found.session ? serializePractice(found.session, me) : null })
  })

  router.post('/chats/:id/practice', async (req, res) => {
    const result = practiceStartSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a valid lesson or topic.' })
    const me = req.accountUser._id.toString()
    const found = await activePractice(me, req.params.id)
    if (!found) return unavailable(res)
    if (found.session) return res.status(409).json({ error: 'Finish the current practice session before starting another.' })
    const now = new Date()
    const saved = await progress.findOne({ userId: me }, { projection: { cards: 1 } })
    const reviewed = (saved?.cards ?? []).filter((card) => card.status === 'active'
      && practiceCategories.has(card.category)
      && (card.category !== 'noun' || ['der', 'die', 'das'].includes(card.article))
      && ((Array.isArray(card.reviewHistory) && card.reviewHistory.length > 0) || card.lastReviewedAt))
    const scoped = result.data.tag ? reviewed.filter((card) => card.tags?.includes(result.data.tag)) : reviewed
    const olderThanTenMinutes = scoped.filter((card) => !card.lastReviewedAt || new Date(card.lastReviewedAt).getTime() <= now.getTime() - 10 * 60 * 1000)
    const eligible = olderThanTenMinutes.length >= 5 ? olderThanTenMinutes : scoped
    if (eligible.length < 5) {
      return res.status(409).json({ error: result.data.tag
        ? `Review at least five active words in ${result.data.tag} before practising that topic together.`
        : 'Review at least five active words before starting surprise practice.' })
    }
    const cards = [...eligible]
    for (let index = cards.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1))
      ;[cards[index], cards[swap]] = [cards[swap], cards[index]]
    }
    const selected = cards.slice(0, 5).map((card) => ({
      cardId: card.id,
      prompt: card.prompt,
      ...(card.article ? { article: card.article } : {}),
      meaning: card.meaning,
      ...(card.plural ? { plural: card.plural } : {}),
      example: card.example,
      ...(card.translation ? { translation: card.translation } : {}),
      category: card.category,
    }))
    if (!await reserveMessageSlot(req.accountUser, now)) {
      return res.status(429).json({ error: 'You have sent several messages. Please try again later.' })
    }
    const session = {
      conversationId: found.active.conversation._id.toString(),
      participants: found.active.conversation.participants,
      learnerId: me,
      helperId: found.active.them,
      status: 'pending',
      cards: selected,
      total: selected.length,
      cardIndex: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + practiceLifetime),
    }
    const inserted = await practiceSessions.insertOne(session)
    await companionMessages.insertOne({
      conversationId: found.active.conversation._id.toString(),
      senderId: me,
      text: `Asked for help with a surprise practice of ${session.total} reviewed words.`,
      createdAt: now,
    })
    await conversations.updateOne({ _id: found.active.conversation._id }, { $set: { updatedAt: now } })
    res.status(201).json({ practice: serializePractice({ ...session, _id: inserted.insertedId }, me) })
  })

  router.post('/chats/:id/practice/:practiceId/answer', async (req, res) => {
    const result = practiceAnswerSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Write an answer up to 1,000 characters.' })
    const me = req.accountUser._id.toString()
    const found = await activePractice(me, req.params.id)
    if (!found?.session || found.session._id.toString() !== req.params.practiceId || found.session.learnerId !== me || found.session.status !== 'active') return unavailable(res)
    if (found.session.round?.answer || found.session.round?.feedback) return changed(res)
    if ((found.session.attempts ?? 0) >= 5) return res.status(400).json({ error: 'Five answers have been tried. Ask your companion to reveal the answer or mark it correct.' })
    const now = new Date()
    const updated = await practiceSessions.updateOne({ _id: found.session._id, status: 'active', 'round.answer': { $exists: false } }, {
      $set: { round: { answer: result.data.answer }, attempts: (found.session.attempts ?? 0) + 1, updatedAt: now },
    })
    if (!updated.modifiedCount) return changed(res)
    const practice = { ...found.session, round: { answer: result.data.answer }, attempts: (found.session.attempts ?? 0) + 1, updatedAt: now }
    res.json({ practice: serializePractice(practice, me) })
  })

  router.post('/chats/:id/practice/:practiceId/decision', async (req, res) => {
    const result = practiceDecisionSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a valid practice action.' })
    const me = req.accountUser._id.toString()
    const found = await activePractice(me, req.params.id)
    if (!found?.session || found.session._id.toString() !== req.params.practiceId) return unavailable(res)
    const session = found.session
    const { decision } = result.data
    const isLearner = session.learnerId === me
    const isHelper = session.helperId === me
    if (!isLearner && !isHelper) return unavailable(res)
    const now = new Date()

    if (decision === 'accept' || decision === 'decline') {
      if (!isHelper || session.status !== 'pending') return changed(res)
      const status = decision === 'accept' ? 'active' : 'declined'
      const values = { status, updatedAt: now, ...(status === 'declined' ? { cards: [], round: null } : {}) }
      const updated = await practiceSessions.updateOne({ _id: session._id, status: 'pending' }, { $set: values })
      if (!updated.modifiedCount) return changed(res)
      return res.json({ practice: serializePractice({ ...session, ...values }, me) })
    }

    if (decision === 'end') {
      const values = { status: 'ended', cards: [], round: null, updatedAt: now, expiresAt: now }
      await practiceSessions.updateOne({ _id: session._id }, { $set: values })
      return res.json({ practice: serializePractice({ ...session, ...values }, me) })
    }

    if (session.status !== 'active') return changed(res)
    if (decision === 'retry') {
      if (!isLearner || session.round?.feedback !== 'try-again') return changed(res)
      const updated = await practiceSessions.updateOne({ _id: session._id, status: 'active', 'round.feedback': 'try-again' }, { $unset: { round: '' }, $set: { updatedAt: now } })
      if (!updated.modifiedCount) return changed(res)
      return res.json({ practice: serializePractice({ ...session, round: undefined, updatedAt: now }, me) })
    }

    if (decision === 'next') {
      if (!isLearner || !['correct', 'reveal'].includes(session.round?.feedback)) return changed(res)
      const complete = session.cardIndex + 1 >= session.total
      const values = complete
        ? { status: 'completed', cards: [], round: null, updatedAt: now, expiresAt: now }
        : { cardIndex: session.cardIndex + 1, round: null, attempts: 0, updatedAt: now }
      const updated = await practiceSessions.updateOne({ _id: session._id, status: 'active', 'round.feedback': session.round.feedback }, { $set: values })
      if (!updated.modifiedCount) return changed(res)
      return res.json({ practice: serializePractice({ ...session, ...values }, me) })
    }

    if (!isHelper || !session.round?.answer || session.round.feedback) return changed(res)
    const feedback = decision
    if (!['try-again', 'correct', 'reveal'].includes(feedback)) return changed(res)
    const updated = await practiceSessions.updateOne({ _id: session._id, status: 'active', 'round.answer': session.round.answer, 'round.feedback': { $exists: false } }, {
      $set: { 'round.feedback': feedback, updatedAt: now },
    })
    if (!updated.modifiedCount) return changed(res)
    res.json({ practice: serializePractice({ ...session, round: { ...session.round, feedback }, updatedAt: now }, me) })
  })

  router.get('/chats/:id/messages', async (req, res) => {
    const me = req.accountUser._id.toString()
    let active = await activeConversation(me, req.params.id)
    if (!active) return unavailable(res)
    const conversationId = active.conversation._id.toString()
    const cursor = !req.query.before && chatReplay
      ? await chatReplay.snapshotCursor({ kind: 'private', chatId: conversationId, userId: me }) : null
    if (cursor) {
      active = await activeConversation(me, req.params.id)
      if (!active) return unavailable(res)
    }
    const hiddenAt = active.conversation.hiddenAt?.[me]
    const before = req.query.before ? new Date(String(req.query.before)) : null
    if (before && !Number.isFinite(before.getTime())) return res.status(400).json({ error: 'Choose a valid message time.' })
    const beforeId = req.query.beforeId
    if (beforeId !== undefined && (!before || typeof beforeId !== 'string' || !objectIdSchema.safeParse(beforeId).success)) {
      return res.status(400).json({ error: 'Choose a valid message cursor.' })
    }
    const createdAt = {
      ...(hiddenAt ? { $gt: hiddenAt } : {}),
      ...(before && !beforeId ? { $lt: before } : {}),
    }
    const filter = {
      conversationId,
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(before && beforeId ? {
        $or: [{ createdAt: { $lt: before } }, { createdAt: before, _id: { $lt: new ObjectId(beforeId) } }],
      } : {}),
    }
    const found = await companionMessages.find(
      filter,
      { sort: { createdAt: -1, _id: -1 }, limit: 51, readConcern: { level: 'majority' }, readPreference: 'primary' },
    ).toArray()
    if (!before && req.query.read !== '0' && found[0]) {
      await conversations.updateOne({ _id: active.conversation._id }, {
        $max: {
          [`readAt.${me}`]: found[0].createdAt,
          [`readThrough.${me}`]: `${found[0].createdAt.toISOString()}/${found[0]._id.toString()}`,
        },
      })
    }
    const messages = found.slice(0, 50).reverse()
    const typing = !before && Boolean(await chatTyping.findOne(typingFilter('private', conversationId, me)))
    res.json({
      hasMore: found.length > 50,
      messages: messages.map((message) => serializeMessage(message, me)),
      typing,
      cursor,
    })
  })

  router.get('/chats/:id/sync', async (req, res) => {
    const me = req.accountUser._id.toString()
    const active = await activeConversation(me, req.params.id)
    if (!active) return unavailable(res)
    if (!chatReplay) return res.status(503).json({ error: 'Chat replay requires a MongoDB replica set.' })
    const conversationId = active.conversation._id.toString()
    const result = await chatReplay.replay({ kind: 'private', chatId: conversationId, userId: me }, req.query.cursor)
    if (result.reset) return res.json({ reset: true })
    const current = await activeConversation(me, conversationId)
    if (!current) return unavailable(res)
    if (current.conversation.hiddenAt?.[me]?.getTime() !== active.conversation.hiddenAt?.[me]?.getTime()) {
      return res.json({ reset: true })
    }
    const hiddenAt = current.conversation.hiddenAt?.[me]
    const messages = await companionMessages.find({
      conversationId,
      _id: { $in: result.ids.map((id) => new ObjectId(id)) },
      ...(hiddenAt ? { createdAt: { $gt: hiddenAt } } : {}),
    }, { readConcern: { level: 'majority' }, readPreference: 'primary' }).toArray()
    if (messages.length !== result.ids.length) return res.json({ reset: true })
    const typing = Boolean(await chatTyping.findOne(typingFilter('private', conversationId, me)))
    res.json({ reset: false, messages: messages.map((message) => serializeMessage(message, me)), typing, cursor: result.cursor })
  })

  router.post('/chats/:id/typing', typingRateLimit(), async (req, res) => {
    const result = typingSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a valid typing status.' })
    const me = req.accountUser._id.toString()
    const active = await activeConversation(me, req.params.id)
    if (!active) return unavailable(res)
    await setTyping(chatTyping, 'private', active.conversation._id.toString(), me, result.data.typing)
    res.json({ ok: true })
  })

  router.post('/chats/:id/delivered', receiptRateLimit(), async (req, res) => {
    const result = receiptSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a valid message.' })
    const me = req.accountUser._id.toString()
    const active = await activeConversation(me, req.params.id)
    if (!active) return unavailable(res)
    const conversationId = active.conversation._id.toString()
    const message = await companionMessages.findOne({ _id: new ObjectId(result.data.id), conversationId })
    const hiddenAt = active.conversation.hiddenAt?.[me]
    if (!message || message.senderId === me || (hiddenAt && message.createdAt <= hiddenAt)) return unavailable(res)
    await acknowledgeMessages(companionMessages, { conversationId }, me, message, result.data.ids ?? [result.data.id], false, hiddenAt)
    res.json({ ok: true })
  })

  router.post('/chats/:id/read', receiptRateLimit(), async (req, res) => {
    const result = receiptSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a valid message.' })
    const me = req.accountUser._id.toString()
    const active = await activeConversation(me, req.params.id)
    if (!active) return unavailable(res)
    const message = await companionMessages.findOne({ _id: new ObjectId(result.data.id), conversationId: active.conversation._id.toString() })
    const hiddenAt = active.conversation.hiddenAt?.[me]
    if (!message || (hiddenAt && message.createdAt <= hiddenAt)) return unavailable(res)
    await conversations.updateOne({ _id: active.conversation._id }, {
      $max: {
        [`readAt.${me}`]: message.createdAt,
        [`readThrough.${me}`]: `${message.createdAt.toISOString()}/${message._id.toString()}`,
      },
    })
    await acknowledgeMessages(companionMessages, { conversationId: active.conversation._id.toString() }, me, message, result.data.ids ?? [result.data.id], true, hiddenAt)
    res.json({ ok: true })
  })

  router.get('/chats/:id/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (query.length < 2 || query.length > 100) return res.status(400).json({ error: 'Search for 2 to 100 characters.' })
    const me = req.accountUser._id.toString()
    const active = await activeConversation(me, req.params.id)
    if (!active) return unavailable(res)
    const hiddenAt = active.conversation.hiddenAt?.[me]
    const recent = await companionMessages.find({
      conversationId: active.conversation._id.toString(),
      ...(hiddenAt ? { createdAt: { $gt: hiddenAt } } : {}),
    }, { sort: { createdAt: -1 }, limit: searchScanLimit }).toArray()
    const needle = foldText(query)
    const matching = recent.filter((message) => !message.unsentAt
      && searchableFields(message).some((value) => foldText(value).includes(needle)))
    res.json({
      hasMore: matching.length > searchResultLimit,
      messages: matching.slice(0, searchResultLimit).map((message) => serializeMessage(message, me)),
    })
  })

  router.post('/chats/:id/messages', async (req, res) => {
    const result = chatMessageSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Write a message up to 2,000 characters.' })
    const me = req.accountUser._id.toString()
    const active = await activeConversation(me, req.params.id)
    if (!active) return unavailable(res)
    const conversationId = active.conversation._id.toString()
    const identity = sendIdentity(result.data, conversationId, me)
    const existing = await findSentMessage(companionMessages, identity)
    if (existing === false) return res.status(409).json({ error: 'This message identifier is already in use.' })
    if (existing) {
      const hiddenAt = active.conversation.hiddenAt?.[me]
      if (hiddenAt && existing.createdAt <= hiddenAt) return unavailable(res)
      return res.status(200).json({ message: serializeMessage(existing, me) })
    }
    let replyTo
    if (result.data.replyToId) {
      const target = await companionMessages.findOne({ _id: new ObjectId(result.data.replyToId), conversationId })
      const hiddenAt = active.conversation.hiddenAt?.[me]
      if (!target || target.unsentAt || (hiddenAt && target.createdAt <= hiddenAt)) {
        return res.status(400).json({ error: 'That message is no longer available to reply to.' })
      }
      replyTo = { id: target._id.toString(), senderId: target.senderId, text: previewText(target) }
    }
    const now = new Date()
    if (!await reserveMessageSlot(req.accountUser, now)) {
      return res.status(429).json({ error: 'You have sent several messages. Please try again later.' })
    }
    const message = {
      conversationId,
      senderId: me,
      text: result.data.card ? `Shared a word: ${result.data.card.prompt}` : result.data.text,
      ...(result.data.card ? { card: result.data.card } : {}),
      ...(replyTo ? { replyTo } : {}),
      createdAt: now,
    }
    const inserted = await insertChatMessage(companionMessages, message, identity)
    if (!inserted) return res.status(409).json({ error: 'This message identifier is already in use.' })
    const insertedId = inserted._id
    await conversations.updateOne({ _id: active.conversation._id }, {
      $max: {
        updatedAt: inserted.createdAt,
        lastMessageAt: inserted.createdAt,
        [`readAt.${me}`]: inserted.createdAt,
        [`readThrough.${me}`]: `${inserted.createdAt.toISOString()}/${insertedId.toString()}`,
      },
    })
    res.status(201).json({ message: serializeMessage(inserted, me) })
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
    const me = req.accountUser._id.toString()
    const found = await visibleMessage(me, req.params.id)
    if (!found) return unavailable(res)
    const { message } = found
    const path = `reactions.${me}`
    const { emoji } = result.data
    await companionMessages.updateOne({ _id: message._id }, emoji ? { $set: { [path]: emoji } } : { $unset: { [path]: '' } })
    const reactions = { ...message.reactions }
    if (emoji) reactions[me] = emoji
    else delete reactions[me]
    res.json({ reactions: summarizeReactions(reactions, me) })
  })

  router.post('/messages/:id/correction', async (req, res) => {
    const result = correctionSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Write the corrected sentence, or mark the message as looking good. Notes can be up to 200 characters.' })
    const me = req.accountUser._id.toString()
    const found = await visibleMessage(me, req.params.id)
    if (!found || found.message.senderId === me || found.message.card) return unavailable(res)
    const { message, active } = found
    if (message.correction) return res.status(409).json({ error: 'This message has already been reviewed.' })
    if (!result.data.approve && result.data.text === message.text) {
      return res.status(400).json({ error: 'Change something in the sentence to suggest a correction.' })
    }
    const now = new Date()
    if (!await reserveMessageSlot(req.accountUser, now)) {
      return res.status(429).json({ error: 'You have sent several messages. Please try again later.' })
    }
    const tags = [...new Set(result.data.tags ?? [])]
    const correction = {
      authorId: me,
      ...(result.data.approve ? { approved: true } : { text: result.data.text }),
      ...(tags.length ? { tags } : {}),
      ...(result.data.note ? { note: result.data.note } : {}),
      createdAt: now,
    }
    await companionMessages.updateOne({ _id: message._id }, { $set: { correction } })
    await conversations.updateOne({ _id: active.conversation._id }, { $set: { updatedAt: now } })
    res.status(201).json({ message: serializeMessage({ ...message, correction }, me) })
  })

  router.post('/messages/:id/correction/respond', async (req, res) => {
    const result = correctionResponseSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose how you want to respond.' })
    const me = req.accountUser._id.toString()
    const found = await visibleMessage(me, req.params.id)
    if (!found || found.message.senderId !== me || !found.message.correction) return unavailable(res)
    const { message } = found
    if (message.correction.approved && result.data.response === 'saved') {
      return res.status(400).json({ error: 'There is no corrected sentence to save.' })
    }
    if (message.correction.response === 'saved' || message.correction.response === result.data.response) {
      return res.json({ message: serializeMessage(message, me) })
    }
    const correction = { ...message.correction, response: result.data.response, respondedAt: new Date() }
    await companionMessages.updateOne({ _id: message._id }, { $set: { correction } })
    res.json({ message: serializeMessage({ ...message, correction }, me) })
  })

  router.post('/messages/:id/edit', async (req, res) => {
    const result = messageEditSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Write a message up to 2,000 characters.' })
    const me = req.accountUser._id.toString()
    const found = await visibleMessage(me, req.params.id)
    if (!found || found.message.senderId !== me || found.message.card) return unavailable(res)
    const { message } = found
    if (Date.now() - message.createdAt.getTime() > editWindow) {
      return res.status(403).json({ error: 'Messages can be edited for 10 minutes after sending.' })
    }
    if (message.correction) return res.status(409).json({ error: 'This message has been reviewed, so it can no longer be edited.' })
    if (result.data.text === message.text) return res.json({ message: serializeMessage(message, me) })
    const editedAt = new Date()
    await companionMessages.updateOne({ _id: message._id }, { $set: { text: result.data.text, editedAt } })
    res.json({ message: serializeMessage({ ...message, text: result.data.text, editedAt }, me) })
  })

  router.post('/messages/:id/unsend', async (req, res) => {
    const me = req.accountUser._id.toString()
    const found = await visibleMessage(me, req.params.id)
    if (!found || found.message.senderId !== me) return unavailable(res)
    const { message } = found
    if (Date.now() - message.createdAt.getTime() > editWindow) {
      return res.status(403).json({ error: 'Messages can be unsent for 10 minutes after sending.' })
    }
    const unsentAt = new Date()
    await companionMessages.updateOne({ _id: message._id }, {
      $set: { unsentAt, text: '' },
      $unset: { card: '', replyTo: '', reactions: '', correction: '', editedAt: '' },
    })
    await companionMessages.updateMany(
      { conversationId: message.conversationId, 'replyTo.id': message._id.toString() },
      { $set: { 'replyTo.text': unsentText } },
    )
    res.json({ message: serializeMessage({ ...message, unsentAt, text: '' }, me) })
  })

  router.post('/messages/:id/report', async (req, res) => {
    const result = reportSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a reason and keep details under 500 characters.' })
    if (!ObjectId.isValid(req.params.id)) return unavailable(res)
    const me = req.accountUser._id.toString()
    const message = await companionMessages.findOne({ _id: new ObjectId(req.params.id) })
    if (!message || message.unsentAt || message.senderId === me) return unavailable(res)
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
