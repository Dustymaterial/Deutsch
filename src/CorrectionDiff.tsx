import { diffSentences } from './sentenceDiff'

// The suggested sentence with only the changed words highlighted: new words in green, replaced words faint.
export function CorrectionDiff({ original, corrected }: { original: string; corrected: string }) {
  return (
    <p className="companion-correction-diff" lang="de">
      {diffSentences(original, corrected).map((part, index) => {
        const space = part.spaceBefore ? ' ' : ''
        if (part.kind === 'added') return <span key={index}>{space}<ins>{part.text}</ins></span>
        if (part.kind === 'removed') return <span key={index}>{space}<del>{part.text}</del></span>
        return <span key={index}>{space}{part.text}</span>
      })}
    </p>
  )
}
