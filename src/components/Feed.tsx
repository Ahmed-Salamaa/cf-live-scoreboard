import type { SubVisual } from '../engine/scoring'
import { verdictLabel } from '../engine/scoring'

export interface FeedItem {
  key: string
  team: string
  problem: string
  verdict: string | null
  visual: SubVisual
  timeSec: number
  extra?: string
}

const ICON: Record<SubVisual, string> = { first: '🎈🎈', ac: '✔', wa: '✘', neutral: '•', pending: '…', hidden: '🔒' }

const fmt = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`

export function Feed({ items, title }: { items: FeedItem[]; title: string }) {
  return (
    <aside className="feed">
      <h3>{title}</h3>
      {items.length === 0 && <p className="muted">Nothing yet.</p>}
      <ul>
        {items.map((it) => (
          <li key={it.key} className={`item v-${it.visual}`}>
            <span className="ico">{ICON[it.visual]}</span>
            <span className="who">
              <b>{it.team}</b>
              <span className="muted"> · {it.problem} · {fmt(it.timeSec)}</span>
            </span>
            <span className="vd">{it.visual === 'first' ? 'First solve' : verdictLabel(it.verdict)}</span>
            {it.extra && <span className="ex">{it.extra}</span>}
          </li>
        ))}
      </ul>
    </aside>
  )
}
