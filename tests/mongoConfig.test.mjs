import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMongoConnectionString } from '../server/mongoConfig.js'

const validConfiguration = {
  MONGODB_URI: 'mongodb+srv://cluster.example.com/deutsch?retryWrites=true&w=majority',
  MONGODB_USERNAME: 'learner@example.com',
  MONGODB_PASSWORD: 'pass:word@123',
}

test('builds a MongoDB URI and safely encodes separate credentials', () => {
  const result = new URL(buildMongoConnectionString(validConfiguration))

  assert.equal(result.protocol, 'mongodb+srv:')
  assert.equal(result.pathname, '/deutsch')
  assert.equal(decodeURIComponent(result.username), validConfiguration.MONGODB_USERNAME)
  assert.equal(decodeURIComponent(result.password), validConfiguration.MONGODB_PASSWORD)
  assert.equal(result.searchParams.get('retryWrites'), 'true')
})

test('returns null when no MongoDB settings are configured', () => {
  assert.equal(buildMongoConnectionString({}), null)
})

test('rejects incomplete MongoDB settings', () => {
  assert.throws(
    () => buildMongoConnectionString({ MONGODB_URI: validConfiguration.MONGODB_URI }),
    /must all be configured/,
  )
})

test('requires a credential-free URI targeting the deutsch database', () => {
  assert.throws(
    () => buildMongoConnectionString({
      ...validConfiguration,
      MONGODB_URI: 'mongodb+srv://cluster.example.com/other',
    }),
    /target the deutsch database/,
  )
  assert.throws(
    () => buildMongoConnectionString({
      ...validConfiguration,
      MONGODB_URI: 'mongodb+srv://user:password@cluster.example.com/deutsch',
    }),
    /Keep credentials out of MONGODB_URI/,
  )
})

test('rejects an extra question mark before query options', () => {
  assert.throws(
    () => buildMongoConnectionString({
      ...validConfiguration,
      MONGODB_URI: 'mongodb+srv://cluster.example.com/deutsch??retryWrites=true',
    }),
    /extra question mark/,
  )
})
