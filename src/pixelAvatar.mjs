import { createAvatar } from '@dicebear/core'

export const avatarOptions = [
  { seed: 'pixel-lime', label: 'Neon lime', palette: 0, pattern: 0 },
  { seed: 'pixel-red', label: 'Arcade red', palette: 1, pattern: 1 },
  { seed: 'pixel-violet', label: 'Bright violet', palette: 2, pattern: 2 },
  { seed: 'pixel-yellow', label: 'Electric yellow', palette: 3, pattern: 3 },
  { seed: 'pixel-red-gold', label: 'Red and gold', palette: 4, pattern: 4 },
  { seed: 'pixel-green-violet', label: 'Green and violet', palette: 5, pattern: 5 },
  { seed: 'pixel-purple-gold', label: 'Purple and gold', palette: 6, pattern: 6 },
  { seed: 'pixel-black-lime', label: 'Black and lime', palette: 7, pattern: 7 },
]

const inBlock = (x, y, left, top, right, bottom) =>
  x >= left && x <= right && y >= top && y <= bottom

const avatarPatterns = [
  (x, y) => {
    if (y === 0 && (x === 4 || x === 11)) return 'accent'
    if (inBlock(x, y, 3, 1, 4, 2) || inBlock(x, y, 11, 1, 12, 2)) return 'body'
    if (y === 4 && (inBlock(x, y, 5, 4, 6, 4) || inBlock(x, y, 9, 4, 10, 4))) return 'detail'
    if (y === 6 && inBlock(x, y, 6, 6, 9, 6)) return 'accent'
    if (inBlock(x, y, 3, 3, 12, 7)) return 'body'
    if (inBlock(x, y, 1, 5, 2, 8) || inBlock(x, y, 13, 5, 14, 8)) return 'body'
    if (inBlock(x, y, 3, 8, 5, 10) || inBlock(x, y, 10, 8, 12, 10)) return 'body'
    if (inBlock(x, y, 7, 9, 8, 11)) return 'accent'
    return null
  },
  (x, y) => {
    if (inBlock(x, y, 7, 0, 8, 1)) return 'accent'
    if (y === 4 && (inBlock(x, y, 5, 4, 6, 4) || inBlock(x, y, 9, 4, 10, 4))) return 'detail'
    if (y === 6 && inBlock(x, y, 6, 6, 9, 6)) return 'accent'
    if (inBlock(x, y, 4, 2, 11, 6) || inBlock(x, y, 2, 4, 13, 7)) return 'body'
    if (inBlock(x, y, 3, 8, 4, 11) || inBlock(x, y, 7, 8, 8, 12) || inBlock(x, y, 11, 8, 12, 11)) {
      return y % 2 === 0 ? 'body' : 'accent'
    }
    return null
  },
  (x, y) => {
    if (y === 1 && (x === 2 || x === 13)) return 'accent'
    if (y === 4 && (inBlock(x, y, 6, 4, 7, 4) || inBlock(x, y, 9, 4, 10, 4))) return 'detail'
    if (inBlock(x, y, 4, 2, 11, 8)) return y === 7 ? 'accent' : 'body'
    if (inBlock(x, y, 2, 3, 3, 6) || inBlock(x, y, 12, 3, 13, 6)) return 'body'
    if (inBlock(x, y, 0, 4, 1, 5) || inBlock(x, y, 14, 4, 15, 5)) return 'accent'
    if (inBlock(x, y, 3, 9, 5, 11) || inBlock(x, y, 10, 9, 12, 11)) return 'body'
    return null
  },
  (x, y) => {
    if (y === 0 && (x === 5 || x === 10)) return 'accent'
    if (y === 4 && (inBlock(x, y, 4, 4, 5, 4) || inBlock(x, y, 10, 4, 11, 4))) return 'detail'
    if (inBlock(x, y, 5, 1, 10, 8) || inBlock(x, y, 3, 3, 12, 7)) return 'body'
    if (inBlock(x, y, 1, 4, 2, 6) || inBlock(x, y, 13, 4, 14, 6)) return 'accent'
    if (inBlock(x, y, 4, 9, 5, 11) || inBlock(x, y, 10, 9, 11, 11)) return 'body'
    if (inBlock(x, y, 2, 10, 3, 11) || inBlock(x, y, 12, 10, 13, 11)) return 'accent'
    return null
  },
  (x, y) => {
    if (y === 2 && (x === 4 || x === 11)) return 'accent'
    if (y === 5 && (inBlock(x, y, 5, 5, 6, 5) || inBlock(x, y, 9, 5, 10, 5))) return 'detail'
    if (inBlock(x, y, 3, 3, 12, 8)) return y === 8 ? 'accent' : 'body'
    if (inBlock(x, y, 1, 5, 2, 7) || inBlock(x, y, 13, 5, 14, 7)) return 'body'
    if (inBlock(x, y, 4, 9, 6, 12) || inBlock(x, y, 9, 9, 11, 12)) return 'body'
    if (inBlock(x, y, 7, 10, 8, 12)) return 'accent'
    return null
  },
  (x, y) => {
    if (y === 0 && (x === 6 || x === 9)) return 'accent'
    if (y === 5 && (x === 5 || x === 10)) return 'detail'
    if (inBlock(x, y, 4, 2, 11, 8)) return 'body'
    if (inBlock(x, y, 2, 4, 3, 7) || inBlock(x, y, 12, 4, 13, 7)) return 'accent'
    if (inBlock(x, y, 5, 9, 6, 11) || inBlock(x, y, 9, 9, 10, 11)) return 'body'
    if (inBlock(x, y, 3, 11, 4, 12) || inBlock(x, y, 11, 11, 12, 12)) return 'accent'
    return null
  },
  (x, y) => {
    if (y === 2 && (x === 3 || x === 12)) return 'accent'
    if (y === 4 && (inBlock(x, y, 5, 4, 6, 4) || inBlock(x, y, 9, 4, 10, 4))) return 'detail'
    if (inBlock(x, y, 4, 3, 11, 7) || inBlock(x, y, 2, 5, 13, 8)) return 'body'
    if (inBlock(x, y, 0, 6, 1, 7) || inBlock(x, y, 14, 6, 15, 7)) return 'accent'
    if (inBlock(x, y, 3, 9, 5, 10) || inBlock(x, y, 10, 9, 12, 10)) return 'body'
    if (inBlock(x, y, 6, 9, 9, 10)) return 'accent'
    return null
  },
  (x, y) => {
    if (y === 1 && (x === 5 || x === 10)) return 'accent'
    if (y === 5 && (inBlock(x, y, 5, 5, 6, 5) || inBlock(x, y, 9, 5, 10, 5))) return 'detail'
    if (inBlock(x, y, 3, 3, 12, 8)) return (x + y) % 4 === 0 ? 'accent' : 'body'
    if (inBlock(x, y, 1, 5, 2, 7) || inBlock(x, y, 13, 5, 14, 7)) return 'body'
    if (inBlock(x, y, 4, 10, 5, 12) || inBlock(x, y, 10, 10, 11, 12)) return 'accent'
    return null
  },
]

const avatarPalettes = [
  { body: '#57F287', accent: '#F6F24A', detail: '#10121C' },
  { body: '#FF4D5A', accent: '#FFD447', detail: '#10121C' },
  { body: '#C45BFF', accent: '#4CF4E8', detail: '#10121C' },
  { body: '#E8C426', accent: '#FF5E78', detail: '#10121C' },
  { body: '#FF4D5A', accent: '#E7BD36', detail: '#090A10' },
  { body: '#57F287', accent: '#C45BFF', detail: '#090A10' },
  { body: '#B966FF', accent: '#E7BD36', detail: '#090A10' },
  { body: '#82D622', accent: '#303030', detail: '#090A10' },
]

const pixelAvatar = {
  create: ({ prng }) => {
    const option = avatarOptions.find((item) => item.seed === prng.seed)
    const palette = avatarPalettes[option?.palette ?? prng.integer(0, avatarPalettes.length - 1)]
    const pattern = avatarPatterns[option?.pattern ?? prng.integer(0, avatarPatterns.length - 1)]
    const pixels = Array.from({ length: 16 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) => {
        const tone = pattern(x, y)
        const fill = tone ? palette[tone] : null
        return fill ? [`<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${fill}"/>`] : []
      }),
    ).flat(2)
    return {
      attributes: { viewBox: '0 0 18 18', 'shape-rendering': 'crispEdges' },
      body: pixels.join(''),
    }
  },
}

const avatarCache = new Map()
export const avatarDataUri = (seed) => {
  const key = seed ?? defaultAvatarSeed
  if (avatarCache.has(key)) return avatarCache.get(key)
  const uri = createAvatar(pixelAvatar, { seed: key, size: 72 }).toDataUri()
  avatarCache.set(key, uri)
  if (avatarCache.size > 200) avatarCache.delete(avatarCache.keys().next().value)
  return uri
}

export const defaultAvatarSeed = avatarOptions[0].seed


export const avatarSvg = (seed) => createAvatar(pixelAvatar, { seed, size: 72 }).toString()
