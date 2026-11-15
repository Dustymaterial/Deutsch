import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMongoConnectionString } from '../server/mongoConfig.js'

const validConfiguration = {
  MONGODB_URI: 'mongodb+srv://learner%40example.com:pass%3Aword%40123@cluster.example.com/deutsch?retryWrites=true&w=majority',
}

test('accepts a full URI with encoded credentials and the deutsch database', () => {
  const result = new URL(buildMongoConnectionString(validConfiguration))

  assert.equal(result.protocol, 'mongodb+srv:')
  assert.equal(result.pathname, '/deutsch')
  assert.equal(decodeURIComponent(result.username), 'learner@example.com')
  assert.equal(decodeURIComponent(result.password), 'pass:word@123')
  assert.equal(result.searchParams.get('retryWrites'), 'true')
})

test('returns null when no MongoDB settings are configured', () => {
  assert.equal(buildMongoConnectionString({}), null)
})

test('rejects a URI without credentials', () => {
  assert.throws(
    () => buildMongoConnectionString({
      MONGODB_URI: 'mongodb+srv://cluster.example.com/deutsch',
    }),
    /must include the MongoDB username and password/,
  )
})

test('requires a URI targeting the deutsch database', () => {
  assert.throws(
    () => buildMongoConnectionString({
      ...validConfiguration,
      MONGODB_URI: 'mongodb+srv://user:password@cluster.example.com/other',
    }),
    /target the deutsch database/,
  )
})

test('rejects an extra question mark before query options', () => {
  assert.throws(
    () => buildMongoConnectionString({
      ...validConfiguration,
      MONGODB_URI: 'mongodb+srv://user:password@cluster.example.com/deutsch??retryWrites=true',
    }),
    /extra question mark/,
  )
})
