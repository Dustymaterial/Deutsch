import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationEntryState, isConversationEntry } from '../src/conversationHistory.ts'

test('Back leaves a new private chat even when the previous workspace has a stale chat marker', () => {
  const previous = { __deutschCompanionWorkspace: 'workspace', __deutschCompanionChat: true }
  const current = conversationEntryState(previous, 'private', 'new-chat')
  assert.equal(isConversationEntry(current, 'new-chat'), true)
  assert.equal(isConversationEntry({ ...current, nestedMenu: true }, 'new-chat'), true)
  assert.equal(isConversationEntry(previous, 'new-chat'), false)
  assert.equal(previous.__deutschCompanionChat, true)
})

test('group and private entries do not inherit another conversation marker', () => {
  const group = conversationEntryState({ __deutschCompanionChat: 'old', other: 1 }, 'group', 'group')
  assert.equal(isConversationEntry(group, 'old'), false)
  assert.equal(isConversationEntry(group, 'group'), true)
  assert.equal(group.other, 1)
  const privateChat = conversationEntryState(group, 'private', 'private')
  assert.equal(isConversationEntry(privateChat, 'group'), false)
  assert.equal(isConversationEntry(privateChat, 'private'), true)
  assert.equal(isConversationEntry(null, 'private'), false)
})
