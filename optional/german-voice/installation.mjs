// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2026 Deutsch Daily Deck contributors
// This optional package is outside the MIT application bundle.

const prefix = 'deutsch-optional-voice-'
const requiredRoles = ['model', 'config', 'runtime', 'runtime-wasm', 'phonemizer', 'phonemizer-wasm', 'phonemizer-data', 'notices', 'source', 'build-recipe', 'model-card']
const reviewKeys = ['correspondingSource', 'licenses', 'coldStartOffline', 'ios', 'android']
const maximumBytes = 200 * 1024 * 1024
const markerPath = '/optional-voice/installation-complete'

export function validateRelease(release, origin) {
  if (release?.schema !== 1 || release.id !== 'thorsten-medium' || release.enabled !== true ||
    !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(release.version) || release.version === 'unreleased' ||
    reviewKeys.some((key) => release.review?.[key] !== true)) {
    throw new Error('This voice release is not ready for installation.')
  }
  if (!Array.isArray(release.assets) || release.assets.length !== requiredRoles.length) throw new Error('Incomplete voice release.')
  const roles = new Set()
  const paths = new Set()
  let bytes = 0
  const root = `/optional-voice/releases/${release.version}/`
  for (const asset of release.assets) {
    const url = new URL(asset.path, origin)
    if (!requiredRoles.includes(asset.role) || roles.has(asset.role) || paths.has(url.href) ||
      url.origin !== new URL(origin).origin || !url.pathname.startsWith(root) || url.search || url.hash ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error('Invalid voice asset manifest.')
    }
    roles.add(asset.role)
    paths.add(url.href)
    bytes += asset.bytes
  }
  if (bytes > maximumBytes) throw new Error('Voice release exceeds the download limit.')
  return { bytes, cacheName: `${prefix}${release.id}-${release.version}` }
}

export function checkDevice(environment = globalThis) {
  const missing = ['caches', 'crypto', 'WebAssembly', 'Worker', 'AudioContext'].filter((key) => !environment[key])
  if (!environment.isSecureContext) missing.push('secure-context')
  if (!environment.crypto?.subtle) missing.push('integrity-check')
  if (!environment.navigator?.locks?.request) missing.push('installation-lock')
  if (!environment.AbortSignal?.timeout || !environment.AbortSignal?.any) missing.push('download-cancellation')
  return { supported: missing.length === 0, missing }
}

const digest = async (bytes, crypto) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')

// No download, persistence prompt or speech request happens when this object is created.
export function createVoiceInstallation({ release, origin, environment = globalThis }) {
  let installing = false
  const marker = new URL(markerPath, origin).href
  const validate = () => validateRelease(release, origin)
  return {
    async status() {
      const { cacheName } = validate()
      if (!await environment.caches.has(cacheName)) return 'absent'
      const cache = await environment.caches.open(cacheName)
      const saved = await cache.match(marker)
      if (!saved || await saved.text() !== JSON.stringify(release)) return 'incomplete'
      for (const asset of release.assets) {
        if (!await cache.match(new URL(asset.path, origin).href)) return 'incomplete'
      }
      return 'installed'
    },
    async install({ consent = false, signal, onProgress = () => {} } = {}) {
      if (!consent) throw new Error('Confirm the voice download first.')
      const { cacheName, bytes } = validate()
      if (!checkDevice(environment).supported) throw new Error('Offline speech is unavailable on this device.')
      if (installing) throw new Error('A voice download is already running.')
      installing = true
      let started = false
      try {
        return await environment.navigator.locks.request(prefix, { mode: 'exclusive', signal }, async () => {
          try {
            if (await this.status() === 'installed') return
            const estimate = await environment.navigator?.storage?.estimate?.()
            // Approximate temporary space for the download, hash buffer and final cache.
            if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < bytes * 2) throw new Error('Not enough storage for the voice download.')
            signal?.throwIfAborted()
            await environment.caches.delete(cacheName)
            started = true
            const cache = await environment.caches.open(cacheName)
            let downloaded = 0
            for (const asset of release.assets) {
              signal?.throwIfAborted()
              const timeout = AbortSignal.timeout(120_000)
              const response = await environment.fetch(new URL(asset.path, origin).href, {
                credentials: 'omit', cache: 'no-store', redirect: 'error',
                signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
              })
              if (!response.ok || !response.body) throw new Error('Voice download failed. Try again.')
              // Stream with an explicit byte cap: reject an oversized response before buffering it.
              const reader = response.body.getReader()
              const chunks = []
              let received = 0
              try {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  received += value.byteLength
                  if (received > asset.bytes) throw new Error('Voice download size did not match.')
                  chunks.push(value)
                  onProgress({ received: downloaded + received, total: bytes })
                }
              } finally { await reader.cancel().catch(() => {}) }
              if (received !== asset.bytes) throw new Error('Voice download was interrupted.')
              const body = new Uint8Array(received)
              let offset = 0
              for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
              if (await digest(body, environment.crypto) !== asset.sha256) throw new Error('Voice integrity check failed.')
              signal?.throwIfAborted()
              await cache.put(new URL(asset.path, origin).href, new Response(body))
              downloaded += received
            }
            signal?.throwIfAborted()
            await cache.put(marker, new Response(JSON.stringify(release)))
          } catch (error) {
            if (started) await environment.caches.delete(cacheName)
            throw error
          }
        })
      } finally { installing = false }
    },
    async readAsset(role) {
      if (await this.status() !== 'installed') throw new Error('Download the voice again to use offline speech.')
      const asset = release.assets.find((item) => item.role === role)
      if (!asset) throw new Error('Unknown voice asset.')
      const cache = await environment.caches.open(validate().cacheName)
      const response = await cache.match(new URL(asset.path, origin).href)
      if (!response) throw new Error('Download the voice again to use offline speech.')
      const body = await response.arrayBuffer()
      if (await digest(body, environment.crypto) !== asset.sha256) throw new Error('Stored voice integrity check failed.')
      return body
    },
    async remove() {
      if (installing) throw new Error('Cancel the voice download before removing it.')
      await environment.navigator.locks.request(prefix, { mode: 'exclusive' }, async () => {
        const names = await environment.caches.keys()
        await Promise.all(names.filter((name) => name.startsWith(prefix)).map((name) => environment.caches.delete(name)))
      })
    },
  }
}
