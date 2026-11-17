import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

export const maxGroupsPerOwner = 3
const maxMembers = 100
const maxJoinedGroups = 20
const maxLinks = 2
const pageSize = 50
const hour = 60 * 60 * 1000
const day = 24 * hour
const postSpacing = 2000
const duplicateWindow = 60 * 1000
const autoHideReports = 3
const resolvedReportRetention = 90 * day
const groupMessageRetention = 365 * day

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/)
const createSchema = z.object({
  name: z.string().trim().min(3).max(40),
  description: z.string().trim().max(200).optional(),
})
const messageSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  replyToId: objectIdSchema.optional(),
})
const stateSchema = z.object({ state: z.enum(['open', 'closed']) })
const memberSchema = z.object({ id: objectIdSchema })
const reportSchema = z.object({
  reason: z.enum(['spam', 'harassment', 'inappropriate', 'other']),
  details: z.string().trim().max(500).optional(),
})
const resolveSchema = z.object({
  action: z.enum(['dismiss', 'hide', 'suspend']),
  days: z.number().int().min(1).max(90).optional(),
}).refine((value) => value.action !== 'suspend' || Boolean(value.days))

const nameKeyFor = (name) => name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de-DE')
const profile = (user) => ({ id: user._id.toString(), username: user.username, avatarSeed: user.avatarSeed })
const previewText = (text) => text.slice(0, 140)
const linkCount = (text) => (text.match(/https?:\/\/|www\./gi) ?? []).length

export const groupRetention = { groupMessageRetention, resolvedReportRetention }

export function createModeratorCheck(moderatorUsernames) {
  const names = new Set(moderatorUsernames.map((name) => name.trim().toLowerCase()).filter(Boolean))
  return (user) => names.has(String(user.username ?? '').toLowerCase())
}

function guard({ requireUser, limiter }) {
  return [requireUser, (req, res, next) => {
    if (!req.accountUser.emailVerifiedAt) return res.status(403).json({ error: 'Verify your email to use groups.' })
    next()
  }, ...(limiter ? [limiter] : [])]
}

const createLimiter = () => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  keyGenerator: (req) => req.accountUser._id.toString(),
  skip: (req) => req.method === 'GET',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many group actions. Please try again later.' },
})

export function createGroupsRouter({
  users, groups, groupMembers, groupMessages, groupReports,
  requireUser, isModerator, minAccountAgeHours,
}) {
  const router = Router()
  router.use(...guard({ requireUser, limiter: createLimiter() }))

  const loadGroup = async (id) => ObjectId.isValid(id) ? groups.findOne({ _id: new ObjectId(id) }) : null
  const notFound = (res) => res.status(404).json({ error: 'That group is unavailable.' })
  const canModerate = (group, req) => group.ownerId === req.accountUser._id.toString() || isModerator(req.accountUser)
  const activeMember = (groupId, userId) => groupMembers.findOne({ groupId, userId, state: 'active' })

  // Blocks creating, joining and posting until the learner accepts the rules, and while suspended or too new.
  async function requireGroupAccess(req, res) {
    const account = await users.findOne({ _id: req.accountUser._id }, {
      projection: { createdAt: 1, groupRulesAcceptedAt: 1, groupsSuspendedUntil: 1 },
    })
    if (!account) {
      res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
      return false
    }
    if (account.groupsSuspendedUntil && account.groupsSuspendedUntil > new Date()) {
      res.status(403).json({
        error: `Your group access is paused until ${account.groupsSuspendedUntil.toISOString().slice(0, 10)}.`,
        code: 'suspended',
      })
      return false
    }
    if (!account.groupRulesAcceptedAt) {
      res.status(403).json({ error: 'Read and accept the group rules first.', code: 'rules' })
      return false
    }
    if (minAccountAgeHours > 0 && account.createdAt
      && Date.now() - new Date(account.createdAt).getTime() < minAccountAgeHours * hour) {
      res.status(403).json({
        error: `Groups open ${minAccountAgeHours} hours after you create your account.`,
        code: 'new-account',
      })
      return false
    }
    return true
  }

  const profileCache = () => {
    const cache = new Map()
    return async (id) => {
      if (!cache.has(id)) {
        cache.set(id, ObjectId.isValid(id)
          ? await users.findOne({ _id: new ObjectId(id) }, { projection: { username: 1, avatarSeed: 1 } })
          : null)
      }
      const user = cache.get(id)
      return user ? profile(user) : null
    }
  }

  const serializeGroup = (group, me, owner, membership) => ({
    id: group._id.toString(),
    name: group.name,
    description: group.description ?? '',
    state: group.state,
    memberCount: group.memberCount,
    owner,
    isOwner: group.ownerId === me,
    joined: membership?.state === 'active',
    removed: membership?.state === 'removed',
    createdAt: group.createdAt.toISOString(),
    lastActivityAt: (group.lastActivityAt ?? group.createdAt).toISOString(),
  })

  const serializeMessage = (message, me, sender, moderating) => {
    const base = {
      id: message._id.toString(),
      sender,
      isMine: message.senderId === me,
      createdAt: message.createdAt.toISOString(),
      canHide: moderating,
    }
    if (message.unsentAt) return { ...base, kind: 'unsent', text: 'Message unsent', reported: false }
    if (message.hiddenAt) return { ...base, kind: 'hidden', text: 'Hidden by a moderator', reported: false }
    return {
      ...base,
      kind: 'text',
      text: message.text,
      ...(message.replyTo ? {
        replyTo: { id: message.replyTo.id, isMine: message.replyTo.senderId === me, text: message.replyTo.text },
      } : {}),
      reported: message.reporterIds?.includes(me) ?? false,
    }
  }

  const redactQuotes = (messageId, text) => groupMessages.updateMany(
    { 'replyTo.id': messageId },
    { $set: { 'replyTo.text': text } },
  )

  router.get('/', async (req, res) => {
    const me = req.accountUser._id.toString()
    const [found, mine, account] = await Promise.all([
      groups.find({}, { sort: { lastActivityAt: -1 }, limit: 100 }).toArray(),
      groupMembers.find({ userId: me }).toArray(),
      users.findOne({ _id: req.accountUser._id }, { projection: { groupRulesAcceptedAt: 1, groupsSuspendedUntil: 1 } }),
    ])
    const memberships = new Map(mine.map((item) => [item.groupId, item]))
    const lookup = profileCache()
    const items = []
    for (const group of found) {
      const owner = await lookup(group.ownerId)
      if (owner) items.push(serializeGroup(group, me, owner, memberships.get(group._id.toString())))
    }
    const owned = await groups.find({ ownerId: me }).toArray()
    res.json({
      groups: items,
      ownedCount: owned.length,
      ownedLimit: maxGroupsPerOwner,
      rulesAccepted: Boolean(account?.groupRulesAcceptedAt),
      canModerate: isModerator(req.accountUser),
      ...(account?.groupsSuspendedUntil && account.groupsSuspendedUntil > new Date()
        ? { suspendedUntil: account.groupsSuspendedUntil.toISOString() }
        : {}),
    })
  })

  router.post('/rules', async (req, res) => {
    await users.updateOne({ _id: req.accountUser._id }, { $set: { groupRulesAcceptedAt: new Date() } })
    res.json({ ok: true })
  })

  router.post('/', async (req, res) => {
    const result = createSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Name the group with 3 to 40 characters and keep the description under 200.' })
    if (!await requireGroupAccess(req, res)) return undefined
    const me = req.accountUser._id.toString()
    const owned = await groups.find({ ownerId: me }).toArray()
    if (owned.length >= maxGroupsPerOwner) {
      return res.status(409).json({ error: `You can run up to ${maxGroupsPerOwner} groups. Delete one to create another.` })
    }
    const now = new Date()
    const group = {
      name: result.data.name.replace(/\s+/g, ' '),
      nameKey: nameKeyFor(result.data.name),
      description: result.data.description ?? '',
      ownerId: me,
      state: 'open',
      memberCount: 1,
      createdAt: now,
      lastActivityAt: now,
    }
    let insertedId
    try {
      ({ insertedId } = await groups.insertOne(group))
    } catch (error) {
      if (error?.code !== 11000) throw error
      return res.status(409).json({ error: 'A group with that name already exists.' })
    }
    await groupMembers.insertOne({ groupId: insertedId.toString(), userId: me, state: 'active', role: 'owner', joinedAt: now })
    const owner = profile(req.accountUser)
    res.status(201).json({
      group: serializeGroup({ ...group, _id: insertedId }, me, owner, { state: 'active' }),
    })
  })

  router.post('/:id/join', async (req, res) => {
    const group = await loadGroup(req.params.id)
    if (!group) return notFound(res)
    if (!await requireGroupAccess(req, res)) return undefined
    const me = req.accountUser._id.toString()
    const groupId = group._id.toString()
    const existing = await groupMembers.findOne({ groupId, userId: me })
    if (existing?.state === 'active') return res.json({ ok: true })
    if (existing?.state === 'removed') return res.status(403).json({ error: 'You cannot join this group.' })
    if (group.state !== 'open') return res.status(409).json({ error: 'This group is closed to new members.' })
    const joined = await groupMembers.find({ userId: me, state: 'active' }).toArray()
    if (joined.length >= maxJoinedGroups) return res.status(409).json({ error: `You can be in up to ${maxJoinedGroups} groups. Leave one first.` })
    const reserved = await groups.updateOne({ _id: group._id, state: 'open', memberCount: { $lt: maxMembers } }, { $inc: { memberCount: 1 } })
    if (reserved.modifiedCount !== 1) return res.status(409).json({ error: 'This group is full or closed.' })
    try {
      await groupMembers.insertOne({ groupId, userId: me, state: 'active', role: 'member', joinedAt: new Date() })
    } catch (error) {
      await groups.updateOne({ _id: group._id }, { $inc: { memberCount: -1 } })
      if (error?.code !== 11000) throw error
    }
    res.json({ ok: true })
  })

  router.post('/:id/leave', async (req, res) => {
    const group = await loadGroup(req.params.id)
    if (!group) return notFound(res)
    const me = req.accountUser._id.toString()
    if (group.ownerId === me) return res.status(409).json({ error: 'You run this group. Delete it instead of leaving.' })
    const groupId = group._id.toString()
    const membership = await activeMember(groupId, me)
    if (!membership) return res.json({ ok: true })
    await groupMembers.deleteOne({ groupId, userId: me, state: 'active' })
    await groups.updateOne({ _id: group._id }, { $inc: { memberCount: -1 } })
    res.json({ ok: true })
  })

  router.post('/:id/state', async (req, res) => {
    const result = stateSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose open or closed.' })
    const group = await loadGroup(req.params.id)
    if (!group || !canModerate(group, req)) return notFound(res)
    await groups.updateOne({ _id: group._id }, { $set: { state: result.data.state } })
    res.json({ state: result.data.state })
  })

  router.post('/:id/delete', async (req, res) => {
    const group = await loadGroup(req.params.id)
    if (!group || !canModerate(group, req)) return notFound(res)
    const groupId = group._id.toString()
    await groupMessages.deleteMany({ groupId })
    await groupMembers.deleteMany({ groupId })
    await groups.deleteOne({ _id: group._id })
    res.json({ ok: true })
  })

  router.get('/:id/members', async (req, res) => {
    const group = await loadGroup(req.params.id)
    if (!group) return notFound(res)
    const me = req.accountUser._id.toString()
    const groupId = group._id.toString()
    if (!await activeMember(groupId, me) && !canModerate(group, req)) return notFound(res)
    const members = await groupMembers.find({ groupId, state: 'active' }, { sort: { joinedAt: 1 }, limit: maxMembers }).toArray()
    const lookup = profileCache()
    const items = []
    for (const member of members) {
      const user = await lookup(member.userId)
      if (user) items.push({ ...user, role: member.role })
    }
    res.json({ members: items, canRemove: canModerate(group, req) })
  })

  router.post('/:id/members/remove', async (req, res) => {
    const result = memberSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a member.' })
    const group = await loadGroup(req.params.id)
    if (!group || !canModerate(group, req)) return notFound(res)
    const groupId = group._id.toString()
    if (result.data.id === group.ownerId) return res.status(409).json({ error: 'The owner cannot be removed.' })
    const membership = await activeMember(groupId, result.data.id)
    if (!membership) return notFound(res)
    await groupMembers.updateOne({ groupId, userId: result.data.id }, { $set: { state: 'removed', removedAt: new Date() } })
    await groups.updateOne({ _id: group._id }, { $inc: { memberCount: -1 } })
    res.json({ ok: true })
  })

  async function readableGroup(req, res) {
    const group = await loadGroup(req.params.id)
    if (!group) { notFound(res); return null }
    const me = req.accountUser._id.toString()
    if (!await activeMember(group._id.toString(), me)) { notFound(res); return null }
    return group
  }

  router.get('/:id/messages', async (req, res) => {
    const group = await readableGroup(req, res)
    if (!group) return undefined
    const me = req.accountUser._id.toString()
    const before = req.query.before ? new Date(String(req.query.before)) : null
    if (before && !Number.isFinite(before.getTime())) return res.status(400).json({ error: 'Choose a valid message time.' })
    const found = await groupMessages.find({
      groupId: group._id.toString(),
      ...(before ? { createdAt: { $lt: before } } : {}),
    }, { sort: { createdAt: -1 }, limit: pageSize }).toArray()
    const lookup = profileCache()
    const moderating = canModerate(group, req)
    const messages = []
    for (const message of found.reverse()) {
      messages.push(serializeMessage(message, me, await lookup(message.senderId), moderating))
    }
    res.json({ hasMore: found.length === pageSize, messages, group: serializeGroup(group, me, await lookup(group.ownerId), { state: 'active' }) })
  })

  router.post('/:id/messages', async (req, res) => {
    const result = messageSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Write a message of up to 1,000 characters.' })
    if (linkCount(result.data.text) > maxLinks) return res.status(400).json({ error: `Share at most ${maxLinks} links in one message.` })
    const group = await readableGroup(req, res)
    if (!group) return undefined
    if (!await requireGroupAccess(req, res)) return undefined
    const me = req.accountUser._id.toString()
    const groupId = group._id.toString()
    const now = new Date()
    const last = await groupMessages.findOne({ groupId, senderId: me }, { sort: { createdAt: -1 } })
    if (last && !last.unsentAt && last.text === result.data.text && now - last.createdAt < duplicateWindow) {
      return res.status(429).json({ error: 'You just sent that message.' })
    }
    const spaced = await users.updateOne({
      _id: req.accountUser._id,
      $or: [
        { lastGroupPostAt: { $exists: false } },
        { lastGroupPostAt: { $lte: new Date(now.getTime() - postSpacing) } },
      ],
    }, { $set: { lastGroupPostAt: now } })
    if (spaced.modifiedCount !== 1) return res.status(429).json({ error: 'Please wait a moment before sending again.' })
    const hourly = await users.updateOne({
      _id: req.accountUser._id,
      $or: [
        { 'groupMessageHistory.59': { $exists: false } },
        { 'groupMessageHistory.59': { $lte: new Date(now.getTime() - hour) } },
      ],
    }, { $push: { groupMessageHistory: { $each: [now], $position: 0, $slice: 60 } } })
    if (hourly.modifiedCount !== 1) return res.status(429).json({ error: 'You have sent several messages. Please try again later.' })
    let replyTo
    if (result.data.replyToId) {
      const target = await groupMessages.findOne({ _id: new ObjectId(result.data.replyToId), groupId })
      if (!target || target.unsentAt || target.hiddenAt) return res.status(404).json({ error: 'That message is no longer available.' })
      replyTo = { id: target._id.toString(), senderId: target.senderId, text: previewText(target.text) }
    }
    const message = {
      groupId,
      senderId: me,
      text: result.data.text,
      ...(replyTo ? { replyTo } : {}),
      createdAt: now,
    }
    const { insertedId } = await groupMessages.insertOne(message)
    await groups.updateOne({ _id: group._id }, { $set: { lastActivityAt: now } })
    res.status(201).json({
      message: serializeMessage({ ...message, _id: insertedId }, me, profile(req.accountUser), canModerate(group, req)),
    })
  })

  async function ownMessage(req, res) {
    const group = await readableGroup(req, res)
    if (!group) return {}
    const message = ObjectId.isValid(req.params.mid)
      ? await groupMessages.findOne({ _id: new ObjectId(req.params.mid), groupId: group._id.toString() })
      : null
    if (!message) { notFound(res); return {} }
    return { group, message }
  }

  router.post('/:id/messages/:mid/unsend', async (req, res) => {
    const { group, message } = await ownMessage(req, res)
    if (!group) return undefined
    if (message.senderId !== req.accountUser._id.toString() || message.unsentAt) return notFound(res)
    await groupMessages.updateOne({ _id: message._id }, { $set: { unsentAt: new Date() } })
    await redactQuotes(message._id.toString(), 'Message unsent')
    res.json({ ok: true })
  })

  router.post('/:id/messages/:mid/hide', async (req, res) => {
    const { group, message } = await ownMessage(req, res)
    if (!group) return undefined
    if (!canModerate(group, req) || message.hiddenAt) return notFound(res)
    await groupMessages.updateOne({ _id: message._id }, {
      $set: { hiddenAt: new Date(), hiddenBy: req.accountUser._id.toString() },
    })
    await redactQuotes(message._id.toString(), 'Hidden by a moderator')
    res.json({ ok: true })
  })

  router.post('/:id/messages/:mid/report', async (req, res) => {
    const result = reportSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose a reason and keep details under 500 characters.' })
    const { group, message } = await ownMessage(req, res)
    if (!group) return undefined
    const me = req.accountUser._id.toString()
    if (message.senderId === me || message.unsentAt || message.hiddenAt) return notFound(res)
    const messageId = message._id.toString()
    try {
      await groupReports.insertOne({
        groupId: group._id.toString(),
        groupName: group.name,
        messageId,
        reporterId: me,
        reportedUserId: message.senderId,
        messageText: message.text,
        reason: result.data.reason,
        ...(result.data.details ? { details: result.data.details } : {}),
        status: 'open',
        createdAt: new Date(),
      })
    } catch (error) {
      if (error?.code !== 11000) throw error
      return res.status(409).json({ error: 'You have already reported this message.' })
    }
    await groupMessages.updateOne({ _id: message._id }, { $addToSet: { reporterIds: me } })
    const reports = await groupReports.find({ messageId }).toArray()
    if (reports.length >= autoHideReports) {
      await groupMessages.updateOne({ _id: message._id }, { $set: { hiddenAt: new Date(), hiddenBy: 'reports' } })
      await redactQuotes(messageId, 'Hidden by a moderator')
    }
    res.status(201).json({ ok: true })
  })

  return router
}

export function createModerationRouter({
  users, groupMessages, groupReports, companionReports, requireUser, isModerator,
}) {
  const router = Router()
  router.use(...guard({ requireUser, limiter: createLimiter() }), (req, res, next) => {
    if (!isModerator(req.accountUser)) return res.status(404).json({ error: 'Not found.' })
    next()
  })

  const collections = { group: groupReports, private: companionReports }

  router.get('/reports', async (req, res) => {
    const items = []
    const cache = new Map()
    const lookup = async (id) => {
      if (!cache.has(id)) {
        cache.set(id, ObjectId.isValid(id)
          ? await users.findOne({ _id: new ObjectId(id) }, { projection: { username: 1, avatarSeed: 1 } })
          : null)
      }
      return cache.get(id)
    }
    for (const [kind, collection] of Object.entries(collections)) {
      const open = await collection.find({ status: { $ne: 'resolved' } }, { sort: { createdAt: -1 }, limit: 50 }).toArray()
      for (const report of open) {
        const [reported, reporter] = await Promise.all([lookup(report.reportedUserId), lookup(report.reporterId)])
        items.push({
          id: report._id.toString(),
          kind,
          reason: report.reason,
          details: report.details ?? '',
          messageText: report.messageText ?? '',
          group: report.groupName ?? null,
          reported: reported ? profile(reported) : null,
          reporter: reporter ? reporter.username : null,
          createdAt: report.createdAt.toISOString(),
        })
      }
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    res.json({ reports: items.slice(0, 50) })
  })

  router.post('/reports/:kind/:id/resolve', async (req, res) => {
    const result = resolveSchema.safeParse(req.body)
    if (!result.success) return res.status(400).json({ error: 'Choose dismiss, hide or suspend, with 1 to 90 days for a suspension.' })
    const collection = collections[req.params.kind]
    if (!collection || !ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'That report is unavailable.' })
    const report = await collection.findOne({ _id: new ObjectId(req.params.id) })
    if (!report || report.status === 'resolved') return res.status(404).json({ error: 'That report is unavailable.' })
    const { action, days } = result.data
    if (action === 'hide' && req.params.kind !== 'group') {
      return res.status(400).json({ error: 'Private messages cannot be hidden. Suspend the learner or dismiss the report.' })
    }
    const now = new Date()
    if (action === 'hide' || (action === 'suspend' && req.params.kind === 'group')) {
      const message = await groupMessages.findOne({ _id: new ObjectId(report.messageId) })
      if (message && !message.hiddenAt) {
        await groupMessages.updateOne({ _id: message._id }, { $set: { hiddenAt: now, hiddenBy: req.accountUser._id.toString() } })
        await groupMessages.updateMany({ 'replyTo.id': report.messageId }, { $set: { 'replyTo.text': 'Hidden by a moderator' } })
      }
    }
    if (action === 'suspend' && ObjectId.isValid(report.reportedUserId)) {
      await users.updateOne({ _id: new ObjectId(report.reportedUserId) }, {
        $set: { groupsSuspendedUntil: new Date(now.getTime() + days * day) },
        $inc: { moderationStrikes: 1 },
      })
    }
    await collection.updateMany({ messageId: report.messageId, status: { $ne: 'resolved' } }, {
      $set: {
        status: 'resolved',
        resolvedAt: now,
        resolvedBy: req.accountUser._id.toString(),
        resolution: action,
        deleteAfter: new Date(now.getTime() + resolvedReportRetention),
      },
    })
    res.json({ ok: true })
  })

  return router
}
