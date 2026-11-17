import test from 'node:test'
import assert from 'node:assert/strict'
import { splitMessageLinks } from '../src/messageLinks.ts'

test('links preserve surrounding text and exclude punctuation', () => {
  const text = 'See https://example.com/a_(b), then www.example.org!'
  const parts = splitMessageLinks(text)
  assert.equal(parts.map((part) => part.text).join(''), text)
  assert.deepEqual(parts.filter((part) => part.href).map((part) => part.href), [
    'https://example.com/a_(b)', 'https://www.example.org/',
  ])
})

test('unsafe and malformed addresses are not turned into links', () => {
  const text = 'javascript:alert(1) https://user:pass@example.org http://'
  assert.equal(splitMessageLinks(text).some((part) => part.href), false)
  assert.equal(splitMessageLinks(text).map((part) => part.text).join(''), text)
})
