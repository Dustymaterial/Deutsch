// Narrow review triggers, not a classifier of intent. Quoted vocabulary may match.
const reviewTerms = new Set([
  'fuck', 'fucking', 'motherfucker', 'cunt', 'asshole',
  'arschloch', 'arschlöcher', 'hurensohn', 'hurensöhne', 'wichser', 'fotze',
])

export const safetyNotice = 'Hidden pending review: potentially inappropriate language.'

export function groupContentSafety(text) {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('de-DE').replace(/[\u200B-\u200D\uFEFF]/g, '')
  return {
    hold: (normalized.match(/[\p{L}\p{N}]+/gu) ?? []).some((word) => reviewTerms.has(word)),
    hasLinks: /https?:\/\/|www\./i.test(normalized),
  }
}

export async function queueSafetyReport(reports, group, message, reviewAuthorId) {
  const target = reviewAuthorId ? message.corrections?.[reviewAuthorId] : message
  if (target?.hiddenBy !== 'safety-filter' || target.safetyStatus !== 'pending') return
  const messageId = reviewAuthorId ? `${message._id}:${reviewAuthorId}` : message._id.toString()
  const existing = await reports.findOne({ reporterId: 'safety-filter', messageId })
  if (existing?.createdAt && existing.createdAt >= target.hiddenAt) return
  try {
    await reports.updateOne({
      reporterId: 'safety-filter', messageId,
      $or: [{ createdAt: { $exists: false } }, { createdAt: { $lt: target.hiddenAt } }],
    }, {
      $set: {
        groupId: group._id.toString(), groupName: group.name,
        reportedUserId: reviewAuthorId ?? message.senderId,
        ...(reviewAuthorId ? { parentMessageId: message._id.toString(), reviewAuthorId } : {}),
        messageText: reviewAuthorId ? [target.text, target.note].filter(Boolean).join('\n')
          : [message.text, ...Object.values(message.card ?? {})].join('\n'),
        reason: 'inappropriate', details: 'Automatic language check. Review the context before deciding.',
        automatic: true, status: 'open', createdAt: target.hiddenAt,
      },
      $unset: { deleteAfter: '', resolvedAt: '', resolvedBy: '', resolution: '' },
    }, { upsert: true })
  } catch (error) {
    if (error?.code !== 11000) throw error
  }
}
