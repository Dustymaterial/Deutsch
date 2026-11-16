import { useState } from 'react'

export function inputError(input: HTMLInputElement): string | undefined {
  const validity = input.validity
  if (validity.valueMissing || (input.required && !input.value.trim())) return 'Please fill out this field.'
  if (validity.typeMismatch && input.type === 'email') return 'Enter a valid email address.'
  if (validity.tooShort) return `Use at least ${input.minLength} characters.`
  if (validity.tooLong) return `Use no more than ${input.maxLength} characters.`
  if (validity.patternMismatch) return input.name === 'username'
    ? 'Username can use only letters, numbers, underscores, or hyphens; it cannot be an email address.'
    : 'Use letters, numbers, underscores, or hyphens.'
  if (!validity.valid) return 'Please check this field.'
  return undefined
}

export function useFormValidation() {
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = (form: HTMLFormElement) => {
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[name]'))
    const next: Record<string, string> = {}
    let firstInvalid: HTMLInputElement | undefined
    for (const input of inputs) {
      const error = inputError(input)
      if (error) {
        next[input.name] = error
        firstInvalid ??= input
      }
    }
    setErrors(next)
    if (firstInvalid) requestAnimationFrame(() => firstInvalid.focus())
    return !firstInvalid
  }

  const handleInput = (event: React.FormEvent<HTMLFormElement>) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement) || !input.name) return
    setErrors((current) => {
      if (!(input.name in current)) return current
      const next = { ...current }
      const error = inputError(input)
      if (error) next[input.name] = error
      else delete next[input.name]
      return next
    })
  }

  return { errors, validate, handleInput, clearErrors: () => setErrors({}) }
}
