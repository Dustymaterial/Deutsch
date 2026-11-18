import { useCallback, useEffect, useState } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import { avatarDataUri } from './pixelAvatar.mjs'
import { useConfirm } from './confirmContext'
import { errorMessage, groupsRequest, type Profile } from './groupsApi'
import './Groups.css'

type Report = {
  id: string
  kind: 'group' | 'private'
  reason: string
  details: string
  messageText: string
  group: string | null
  reported: Profile | null
  reporter: string | null
  createdAt: string
  automatic?: boolean
}

const reasonLabels: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  inappropriate: 'Inappropriate',
  other: 'Other',
}
const suspensionDays = [1, 3, 7, 30]

export function ModerationQueue({ onNotify }: { onNotify: (message: string) => void }) {
  const confirmDialog = useConfirm()
  const [reports, setReports] = useState<Report[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [days, setDays] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    try {
      const data = await groupsRequest<{ reports: Report[] }>('/reports', undefined, '/api/moderation')
      setReports(data.reports)
      setError(null)
    } catch (failure) {
      setError(errorMessage(failure, 'Could not load reports.'))
    }
  }, [])

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(first)
  }, [load])

  const resolve = async (report: Report, action: 'dismiss' | 'hide' | 'suspend' | 'approve') => {
    const length = days[report.id] ?? 3
    if (action !== 'dismiss') {
      const name = report.reported?.username ?? 'this learner'
      const ok = await confirmDialog(action === 'approve'
        ? { title: 'Show this content?', message: 'Group members will be able to read it. The language-check report will be closed.', confirmLabel: 'Show content' }
        : action === 'hide'
        ? { title: 'Hide this message?', message: 'It is hidden from everyone in the group and the report is closed.', confirmLabel: 'Hide message', tone: 'danger' }
        : { title: `Suspend ${name}?`, message: `${name} cannot create, join or post in groups for ${length} ${length === 1 ? 'day' : 'days'}. A group message is also hidden. The report is closed.`, confirmLabel: 'Suspend', tone: 'danger' })
      if (!ok) return
    }
    setBusy(true)
    try {
      await groupsRequest(`/reports/${report.kind}/${report.id}/resolve`, { action, ...(action === 'approve' ? { expectedAt: report.createdAt } : {}), ...(action === 'suspend' ? { days: length } : {}) }, '/api/moderation')
      onNotify(action === 'approve' ? 'Content restored.' : action === 'dismiss' ? 'Report dismissed.' : action === 'hide' ? 'Message hidden.' : 'Learner suspended from groups.')
      await load()
    } catch (failure) {
      setError(errorMessage(failure, 'Could not resolve that report.'))
    } finally {
      setBusy(false)
    }
  }

  return <section className="companion-list-section" aria-labelledby="moderation-heading">
    <h2 id="moderation-heading">Open reports <span>{reports?.length ?? 0}</span></h2>
    {error && <p className="companion-alert" role="alert">{error}</p>}
    <button className="moderation-refresh" type="button" disabled={busy} onClick={() => void load()}><RefreshCw size={12} aria-hidden="true" />Refresh</button>
    {!reports ? <p className="companion-empty-note">Loading reports…</p> : reports.length === 0
      ? <p className="companion-empty-note"><Check size={12} aria-hidden="true" /> Nothing needs review.</p>
      : reports.map((report) => <article className="moderation-card" key={`${report.kind}-${report.id}`}>
        <div className="moderation-card-heading">
          <span className="companion-status-tag outgoing">{report.kind === 'group' ? report.group ?? 'Group' : 'Private chat'}</span>
          <span className="companion-status-tag blocked">{reasonLabels[report.reason] ?? report.reason}</span>
        </div>
        {report.reported && <div className="companion-person"><img src={avatarDataUri(report.reported.avatarSeed)} alt="" /><div><strong>{report.reported.username}</strong><span>{report.automatic ? 'Automatic language check' : `Reported by ${report.reporter ?? 'a learner'}`}</span></div></div>}
        <blockquote>{report.messageText}</blockquote>
        {report.details && <p className="moderation-details">“{report.details}”</p>}
        <time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleString()}</time>
        <div className="companion-card-actions">
          {report.automatic ? <button type="button" disabled={busy} onClick={() => void resolve(report, 'approve')}>Show content</button> : <button type="button" disabled={busy} onClick={() => void resolve(report, 'dismiss')}>Dismiss</button>}
          {report.kind === 'group' && <button type="button" disabled={busy} onClick={() => void resolve(report, 'hide')}>{report.automatic ? 'Keep hidden' : 'Hide message'}</button>}
          <select aria-label="Suspension length" value={days[report.id] ?? 3} onChange={(event) => setDays({ ...days, [report.id]: Number(event.target.value) })}>
            {suspensionDays.map((value) => <option key={value} value={value}>{value} {value === 1 ? 'day' : 'days'}</option>)}
          </select>
          <button className="danger" type="button" disabled={busy} onClick={() => void resolve(report, 'suspend')}>Suspend</button>
        </div>
      </article>)}
  </section>
}
