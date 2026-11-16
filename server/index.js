import bcrypt from 'bcryptjs'
import MongoStore from 'connect-mongo'
import dotenv from 'dotenv'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { MongoClient, ObjectId } from 'mongodb'
import session from 'express-session'
import { z } from 'zod'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMongoConnectionString } from './mongoConfig.js'

const isLocalDevelopment = process.argv.includes('--local')
const envFile = dotenv.config()
const configuration = isLocalDevelopment ? envFile.parsed ?? {} : process.env
const mongoConnectionString = buildMongoConnectionString(configuration)

const app = express()
const port = Number(configuration.PORT ?? 3001)
const databaseName = 'deutsch'
const sessionCookieName = 'deutsch.sid'
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000
const secureCookies = process.env.NODE_ENV === 'production' && !isLocalDevelopment
const rootPath = resolve(dirname(fileURLToPath(import.meta.url)), '..')

app.disable('x-powered-by')
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false)
app.use(helmet({ contentSecurityPolicy: false }))
app.use(express.json({ limit: '20mb' }))

const isoDate = z.string().refine((value) => Number.isFinite(Date.parse(value)))
const reviewSchema = z.object({
  at: isoDate,
  rating: z.enum(['again', 'hard', 'good', 'easy']),
  intervalDays: z.number().finite(),
  easeFactor: z.number().finite(),
  mode: z.enum(['recall', 'choice', 'production']).optional(),
  answerCorrect: z.boolean().optional(),
  struggledWith: z.array(z.enum(['article', 'plural', 'meaning', 'context'])).optional(),
}).passthrough()

const cardSchema = z.object({
  id: z.string().min(1).max(200),
  prompt: z.string().max(500),
  article: z.string().max(50).optional(),
  meaning: z.string().max(1000),
  plural: z.string().max(500).optional(),
  example: z.string().max(2000),
  translation: z.string().max(2000).optional(),
  category: z.string().min(1).max(50),
  tags: z.array(z.string().max(100)).max(100),
  status: z.enum(['active', 'archived']),
  dueAt: isoDate,
  intervalDays: z.number().finite(),
  repetitions: z.number().finite(),
  easeFactor: z.number().finite(),
  lapses: z.number().finite(),
  lastReviewedAt: isoDate.nullable(),
  lastRating: z.enum(['again', 'hard', 'good', 'easy']).nullable(),
  correctCount: z.number().finite(),
  incorrectCount: z.number().finite(),
  reviewHistory: z.array(reviewSchema).max(10000),
  learning: z.object({ saved: z.boolean(), updatedAt: isoDate }).optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).passthrough()

const studyPlanSchema = z.object({
  currentLevel: z.enum(['unknown', 'A0', 'A1', 'A2', 'B1']),
  targetLevel: z.enum(['A1', 'A2', 'B1', 'B2']),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  }),
  intensity: z.enum(['steady', 'focused', 'intensive']),
})

const progressSchema = z.object({
  cards: z.array(cardSchema).max(10000),
  studyPlan: studyPlanSchema,
  studyPlanUpdatedAt: isoDate.optional(),
  expectedRevision: z.number().int().nonnegative(),
})

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
})

const registrationSchema = credentialsSchema.extend({
  username: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_-]+$/),
  avatarSeed: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
})

const profileSchema = z.object({
  username: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_-]+$/),
  avatarSeed: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
})

const publicUser = (user) => ({
  username: user.username,
  email: user.email,
  avatarSeed: user.avatarSeed,
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
})

let client
let users
let progress

const requireDatabase = (_req, res, next) => {
  if (!users || !progress) {
    return res.status(503).json({ error: 'Account storage is not configured. Set the MongoDB settings in .env.' })
  }
  next()
}

const regenerateSession = (req) =>
  new Promise((resolvePromise, rejectPromise) => {
    req.session.regenerate((error) => error ? rejectPromise(error) : resolvePromise())
  })

const saveSession = (req) =>
  new Promise((resolvePromise, rejectPromise) => {
    req.session.save((error) => error ? rejectPromise(error) : resolvePromise())
  })

const requireUser = async (req, res, next) => {
  if (!ObjectId.isValid(req.session?.userId ?? '')) {
    return res.status(401).json({ error: 'Sign in to continue.' })
  }

  const user = await users.findOne(
    { _id: new ObjectId(req.session.userId) },
    { projection: { email: 1, username: 1, avatarSeed: 1 } },
  )
  if (!user) {
    req.session.destroy(() => {})
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }

  req.accountUser = user
  next()
}

const sendValidationError = (res, result) =>
  res.status(400).json({ error: result.error.issues[0]?.message ?? 'Check the submitted details.' })

app.get('/api/health', (_req, res) => {
  res.json({ accountStorageConfigured: Boolean(users && progress) })
})

app.use('/api', requireDatabase)

if (mongoConnectionString) {
  if (!configuration.SESSION_SECRET || configuration.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters when MongoDB is configured.')
  }

  client = new MongoClient(mongoConnectionString)
  try {
    await client.connect()
  } catch {
    throw new Error('MongoDB connection failed. Check the MongoDB settings and Atlas network access.')
  }

  const db = client.db(databaseName)
  users = db.collection('users')
  progress = db.collection('progress')
  await Promise.all([
    users.createIndex({ emailKey: 1 }, { unique: true }),
    users.createIndex({ usernameKey: 1 }, { unique: true }),
    progress.createIndex({ userId: 1 }, { unique: true }),
  ])

  app.use(session({
    name: sessionCookieName,
    secret: configuration.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      client,
      dbName: databaseName,
      collectionName: 'sessions',
      ttl: sessionLifetimeMs / 1000,
    }),
    cookie: {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      maxAge: sessionLifetimeMs,
      path: '/',
    },
  }))
} else {
  console.warn('MongoDB settings are empty; account endpoints will return a configuration error.')
}

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const result = registrationSchema.safeParse(req.body)
  if (!result.success) return sendValidationError(res, result)

  if (Buffer.byteLength(result.data.password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password must be 72 bytes or less.' })
  }

  const email = result.data.email.toLowerCase()
  const username = result.data.username
  const timestamp = new Date()
  const user = {
    email,
    emailKey: email,
    username,
    usernameKey: username.toLowerCase(),
    passwordHash: await bcrypt.hash(result.data.password, 12),
    avatarSeed: result.data.avatarSeed ?? username,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  try {
    const inserted = await users.insertOne(user)
    await regenerateSession(req)
    req.session.userId = inserted.insertedId.toString()
    await saveSession(req)
    res.status(201).json({ user: publicUser(user) })
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'That email or username is already in use.' })
    }
    throw error
  }
})

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const result = credentialsSchema.safeParse(req.body)
  if (!result.success) return sendValidationError(res, result)
  if (Buffer.byteLength(result.data.password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Email or password is incorrect.' })
  }

  const user = await users.findOne({ emailKey: result.data.email.toLowerCase() })
  if (!user || !(await bcrypt.compare(result.data.password, user.passwordHash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' })
  }

  await regenerateSession(req)
  req.session.userId = user._id.toString()
  await saveSession(req)
  res.json({ user: publicUser(user) })
})

app.get('/api/auth/me', async (req, res) => {
  if (!ObjectId.isValid(req.session?.userId ?? '')) return res.status(401).json({ error: 'Not signed in.' })
  const user = await users.findOne(
    { _id: new ObjectId(req.session.userId) },
    { projection: { email: 1, username: 1, avatarSeed: 1 } },
  )
  if (!user) return res.status(401).json({ error: 'Not signed in.' })
  res.json({ user: publicUser(user) })
})

app.post('/api/auth/logout', async (req, res) => {
  if (req.session) {
    await new Promise((resolvePromise, rejectPromise) => {
      req.session.destroy((error) => error ? rejectPromise(error) : resolvePromise())
    })
  }
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
  })
  res.json({ ok: true })
})

app.patch('/api/auth/profile', requireUser, async (req, res) => {
  const result = profileSchema.safeParse(req.body)
  if (!result.success) return sendValidationError(res, result)

  const username = result.data.username
  try {
    await users.updateOne(
      { _id: req.accountUser._id },
      {
        $set: {
          username,
          usernameKey: username.toLowerCase(),
          avatarSeed: result.data.avatarSeed,
          updatedAt: new Date(),
        },
      },
    )
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'That username is already in use.' })
    }
    throw error
  }

  res.json({
    user: publicUser({ ...req.accountUser, ...result.data, username }),
  })
})

app.get('/api/progress', requireUser, async (req, res) => {
  const saved = await progress.findOne({ userId: req.accountUser._id.toString() })
  res.json({
    revision: saved?.revision ?? 0,
    progress: saved
      ? {
          cards: saved.cards,
          studyPlan: saved.studyPlan,
          updatedAt: saved.updatedAt,
          studyPlanUpdatedAt: saved.studyPlanUpdatedAt,
        }
      : null,
  })
})

app.put('/api/progress', requireUser, async (req, res) => {
  const result = progressSchema.safeParse(req.body)
  if (!result.success) return sendValidationError(res, result)

  const updatedAt = new Date()
  const expectedRevision = result.data.expectedRevision
  const filter = {
    userId: req.accountUser._id.toString(),
    ...(expectedRevision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: expectedRevision }),
  }
  try {
    const update = await progress.updateOne(
      filter,
      {
        $set: {
          cards: result.data.cards,
          studyPlan: result.data.studyPlan,
          studyPlanUpdatedAt: result.data.studyPlanUpdatedAt ?? updatedAt,
          updatedAt,
        },
        $setOnInsert: { createdAt: updatedAt },
        $inc: { revision: 1 },
      },
      { upsert: expectedRevision === 0 },
    )
    if (update.matchedCount === 0 && update.upsertedCount === 0) {
      return res.status(409).json({ error: 'Progress changed on another device. Merging the latest copy.' })
    }
    res.json({ revision: expectedRevision + 1, updatedAt: updatedAt.toISOString() })
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'Progress changed on another device. Merging the latest copy.' })
    }
    throw error
  }
})

app.use((error, _req, res, _next) => {
  console.error('Request failed.')
  if (!res.headersSent) res.status(500).json({ error: 'The request could not be completed.' })
})

app.use(express.static(resolve(rootPath, 'dist')))
app.get(/^(?!\/api\/).*/, (_req, res, next) => {
  res.sendFile(resolve(rootPath, 'dist/index.html'), (error) => {
    if (error) next(error)
  })
})

app.listen(port, isLocalDevelopment ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(`Deutsch account API listening on port ${port}`)
})
