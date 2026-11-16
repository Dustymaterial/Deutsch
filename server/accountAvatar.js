import sharp from 'sharp'
import { avatarSvg } from '../src/pixelAvatar.mjs'

export async function accountAvatarPng(seed) {
  return sharp(Buffer.from(avatarSvg(seed))).png().toBuffer()
}
