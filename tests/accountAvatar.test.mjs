import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { accountAvatarPng } from '../server/accountAvatar.js'
import { avatarSvg } from '../src/pixelAvatar.mjs'

test('email avatars use the same rendered pixels as the account avatar', async () => {
  for (const seed of ['pixel-lime', 'pixel-violet', 'legacy-seed']) {
    const png = await accountAvatarPng(seed)
    const expected = await sharp(Buffer.from(avatarSvg(seed))).png().toBuffer()
    assert.deepEqual(png, expected)
    assert.equal((await sharp(png).metadata()).format, 'png')
  }
})
