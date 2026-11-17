import test from 'node:test'
import assert from 'node:assert/strict'
import { clearCommunityDirectoryCache, getCommunityDirectory, loadCommunityDirectory, setCommunityCacheOwner } from '../src/communityDirectoryCache.ts'

test('directory prefetch is shared, account-scoped and invalidated on account changes', async () => {
  setCommunityCacheOwner('first')
  let release
  let calls = 0
  const load = () => {
    calls += 1
    return new Promise((resolve) => { release = resolve })
  }
  const first = loadCommunityDirectory('first', 'companions', load, true)
  const second = loadCommunityDirectory('first', 'companions', load, true)
  assert.equal(calls, 1)
  const value = { companions: [], chats: [], sharedWords: [], emailsEnabled: true }
  release(value)
  assert.deepEqual(await Promise.all([first, second]), [value, value])
  assert.equal(getCommunityDirectory('first', 'companions'), value)
  assert.equal(getCommunityDirectory('other', 'companions'), null)

  const pending = loadCommunityDirectory('first', 'companions', load)
  setCommunityCacheOwner('other')
  release(value)
  await pending
  assert.equal(getCommunityDirectory('first', 'companions'), null)
  assert.equal(getCommunityDirectory('other', 'companions'), null)
  clearCommunityDirectoryCache()
  setCommunityCacheOwner(null)
})

test('a later refresh wins when an earlier request finishes last', async () => {
  setCommunityCacheOwner('first')
  let release
  const old = { companions: [], chats: [], sharedWords: [], emailsEnabled: false }
  const current = { ...old, emailsEnabled: true }
  const pending = loadCommunityDirectory('first', 'companions', () => new Promise((resolve) => { release = resolve }))
  await loadCommunityDirectory('first', 'companions', async () => current)
  release(old)
  await pending
  assert.equal(getCommunityDirectory('first', 'companions'), current)
  setCommunityCacheOwner(null)
})
