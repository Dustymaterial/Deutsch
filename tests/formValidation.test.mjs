import test from 'node:test'
import assert from 'node:assert/strict'
import { inputError } from '../src/formValidation.ts'

const input = (overrides = {}, validity = {}) => ({
  value: 'value',
  required: true,
  type: 'text',
  minLength: 3,
  maxLength: 20,
  ...overrides,
  validity: { valid: true, ...validity },
})

test('required fields reject empty and whitespace-only input', () => {
  assert.equal(inputError(input({ value: '' }, { valid: false, valueMissing: true })), 'Please fill out this field.')
  assert.equal(inputError(input({ value: '  ' })), 'Please fill out this field.')
})

test('invalid email and short passwords have specific guidance', () => {
  assert.equal(inputError(input({ type: 'email' }, { valid: false, typeMismatch: true })), 'Enter a valid email address.')
  assert.equal(inputError(input({ minLength: 10 }, { valid: false, tooShort: true })), 'Use at least 10 characters.')
})

test('valid and optional empty fields have no error', () => {
  assert.equal(inputError(input()), undefined)
  assert.equal(inputError(input({ required: false, value: '' })), undefined)
})
