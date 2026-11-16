import { useEffect, useMemo, useRef, useState } from 'react'
import { activityDates, activityDayKey, type DayActivity } from './activity'

type Props = { days: Map<string, DayActivity>; today: Date }
const empty = { added: 0, reviewed: 0, total: 0 }
const dateLabel = (date: Date) => date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const words = (count: number) => `${count} ${count === 1 ? 'word' : 'words'}`
const shade = (total: number) => total === 0 ? 0 : total < 3 ? 1 : total < 6 ? 2 : total < 10 ? 3 : 4

function calendarDates(today: Date, weeks: number) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const weekday = (end.getDay() + 6) % 7
  end.setDate(end.getDate() + 6 - weekday)
  return activityDates(end, weeks * 7)
}

function Calendar({ days, today, weeks, interactive, selected, onSelect }: Props & {
  weeks: number
  interactive?: boolean
  selected?: string
  onSelect?: (day: string) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const dates = useMemo(() => calendarDates(today, weeks), [today, weeks])
  const todayKey = activityDayKey(today)
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth
  }, [weeks])
  const keepVisible = (button: HTMLButtonElement) => {
    const container = scroller.current
    if (!container) return
    const bounds = container.getBoundingClientRect()
    const cell = button.getBoundingClientRect()
    if (cell.left < bounds.left + 5) container.scrollLeft += cell.left - bounds.left - 5
    else if (cell.right > bounds.right - 5) container.scrollLeft += cell.right - bounds.right + 5
  }
  const move = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offsets: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }
    const offset = offsets[event.key]
    if (!offset) return
    const next = dates[index + offset]
    if (!next || activityDayKey(next) > todayKey) return
    event.preventDefault()
    const key = activityDayKey(next)
    onSelect?.(key)
    scroller.current?.querySelector<HTMLButtonElement>(`[data-day="${key}"]`)?.focus()
  }
  return (
    <>
    <div className="activity-calendar" ref={scroller}>
      <div className="activity-calendar-inner" style={{ '--activity-weeks': weeks } as React.CSSProperties}>
        <div className="activity-months" aria-hidden="true">
          {Array.from({ length: weeks }, (_, week) => {
            const slice = dates.slice(week * 7, week * 7 + 7)
            const first = slice.find((date) => date.getDate() === 1)
            return <span key={week}>{(first ?? (week === 0 ? slice[0] : null))?.toLocaleDateString(undefined, { month: 'short' })}</span>
          })}
        </div>
        <div className="activity-grid" role={interactive ? 'group' : undefined}
          aria-label={interactive ? 'Choose a day; use arrow keys to move through the calendar' : undefined}
          aria-hidden={interactive ? undefined : true}>
          {dates.map((date, index) => {
            const key = activityDayKey(date)
            if (key > todayKey) return <span className="activity-future" key={key} />
            const count = days.get(key)?.total ?? 0
            const label = `${dateLabel(date)}: ${words(count)}`
            return interactive
              ? <button type="button" className={`activity-cell shade-${shade(count)}`} key={key}
                data-day={key} aria-label={label} aria-pressed={selected === key} tabIndex={selected === key ? 0 : -1}
                title={label} onClick={() => onSelect?.(key)} onFocus={(event) => keepVisible(event.currentTarget)}
                onKeyDown={(event) => move(event, index)} />
              : <span className={`activity-cell shade-${shade(count)}`} key={key} />
          })}
        </div>
      </div>
    </div>
    {interactive && <div className="activity-navigation">
        <span>Scroll or use arrow keys to explore</span>
        <div>
          <button type="button" aria-label="Scroll to earlier weeks" onClick={() => scroller.current?.scrollBy({ left: -204, behavior: 'auto' })}>‹</button>
          <button type="button" aria-label="Scroll to later weeks" onClick={() => scroller.current?.scrollBy({ left: 204, behavior: 'auto' })}>›</button>
        </div>
    </div>}
    </>
  )
}

export function ActivityPreview({ days, today, onOpen }: Props & { onOpen: () => void }) {
  return (
    <section className="activity-preview" aria-label="Recent activity">
      <div className="activity-preview-heading"><div><h2>Your activity</h2><p>A little progress, day by day.</p></div>
        <button type="button" className="quiet-button" onClick={onOpen}>See all</button></div>
      <Calendar days={days} today={today} weeks={12} />
      <p className="activity-preview-note">The last 12 weeks · select See all for details</p>
    </section>
  )
}

export function ActivityPanel({ days, today }: Props) {
  const [selected, setSelected] = useState(() => activityDayKey(today))
  const activity = days.get(selected) ?? empty
  const [year, month, day] = selected.split('-').map(Number)
  const start = activityDayKey(calendarDates(today, 53)[0])
  const total = [...days.entries()].filter(([key]) => key >= start && key <= activityDayKey(today))
    .reduce((sum, [, value]) => sum + value.total, 0)
  return (
    <>
      <p className="activity-intro">Every word you show up for has a place here.</p>
      <p className="activity-total"><strong>{total.toLocaleString()}</strong> word-days in the past 53 weeks</p>
      <Calendar days={days} today={today} weeks={53} interactive selected={selected} onSelect={setSelected} />
      <div className="activity-legend" aria-hidden="true"><span>Less</span>{[0, 1, 2, 3, 4].map((n) => <span className={`activity-cell shade-${n}`} key={n} />)}<span>More</span></div>
      <div className="activity-detail" aria-live="polite">
        <strong>{dateLabel(new Date(year, month - 1, day))}</strong>
        <span>{words(activity.total)} · {activity.added} added to reviews · {activity.reviewed} reviewed</span>
      </div>
      <p className="activity-footnote">Each word counts once per day, even if both added and reviewed. Earlier history may be incomplete.</p>
    </>
  )
}
