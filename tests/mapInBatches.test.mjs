import assert from 'node:assert/strict'
import test from 'node:test'
import { mapInBatches } from '../server/mapInBatches.js'

test('batch mapping runs work concurrently while bounding concurrency and preserving order', async () => {
  let active = 0
  let peak = 0
  const result = await mapInBatches([0, 1, 2, 3, 4], async (value) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active -= 1
    return value * 2
  }, 2)
  assert.equal(peak, 2)
  assert.deepEqual(result, [0, 2, 4, 6, 8])
})

test('batch mapping propagates failures', async () => {
  await assert.rejects(mapInBatches([1], async () => { throw new Error('query failed') }), /query failed/)
})
