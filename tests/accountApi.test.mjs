import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('account API enforces verification, recovery and session invalidation', () => {
  const fixture = fileURLToPath(new URL('./fixtures/accountApi.mjs', import.meta.url))
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', fixture], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, NODE_ENV: 'test' },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)
  assert.match(result.stdout, /Account API integration passed/)
})
