import { useContext } from 'react'
import { ExternalLink } from 'lucide-react'
import { WordLookupContext } from './wordLookupContext'
import { getNounFormInfo, type NounWord } from './nounForms'

export function NounPlural({ card, allowSave = false }: { card: NounWord; allowSave?: boolean }) {
  const { cards, onSavePlural } = useContext(WordLookupContext)
  const info = getNounFormInfo(card)
  if (!info) return null
  const canSave = allowSave && !card.plural && info.plural && card.id && cards.some((item) => item.id === card.id)
  return <div className="noun-plural">
    <span className="label">Plural</span>
    <strong lang={info.plural ? 'de' : undefined}>{info.plural ?? (info.status === 'usually-singular' ? 'Usually singular' : info.status === 'usually-plural' ? 'Usually plural' : 'Not recorded')}</strong>
    {!card.plural && info.plural && <small>Dictionary form{info.note ? ` · ${info.note}` : ''}</small>}
    {info.source && <a className="noun-form-source" href={info.source} target="_blank" rel="noreferrer" aria-label="Noun form source: Wiktionary"><ExternalLink size={14} aria-hidden="true" /></a>}
    {canSave && <button type="button" className="quiet-button" onClick={() => onSavePlural(card.id!, info.plural!)}>Use plural</button>}
  </div>
}
