import { memo, useEffect, useRef, type CSSProperties } from 'react'
import type { RankMove } from '../engine/reveal'
import type { Cell, Problem, Row } from '../engine/types'
import { Balloons } from './Balloons'

export const ROW_H = 58

interface CellProps {
  cell: Cell
  problem: string
  /** Changes when this cell was just updated so the highlight / balloon-pop animation restarts. */
  flashKey: number | null
  active: boolean
}

function CellView({ cell, problem, flashKey, active }: CellProps) {
  let cls = 'cell'
  let body: React.ReactNode = null
  const minus = cell.rejected > 0 ? <small>−{cell.rejected}</small> : null
  if (cell.solved) {
    cls += cell.firstSolve ? ' first' : ' ac'
    body = (
      <>
        <b>{cell.solveMin}</b>
        {cell.rejected > 0 && <small>+{cell.rejected}</small>}
        {cell.firstSolve && <Balloons problem={problem} pop={flashKey !== null} />}
      </>
    )
  } else if (cell.pending > 0) {
    cls += ' pending' + (active ? ' live' : '')
    body = (
      <>
        <b>?{cell.pending > 1 ? cell.pending : ''}</b>
        {minus}
      </>
    )
  } else if (cell.hidden > 0) {
    cls += ' frozen'
    body = (
      <>
        <b>?{cell.hidden > 1 ? cell.hidden : ''}</b>
        {minus}
      </>
    )
  } else if (cell.rejected > 0) {
    cls += ' wa'
    body = <b>−{cell.rejected}</b>
  } else if (cell.ignored > 0) {
    cls += ' neutral'
    body = <b>·</b>
  }
  return (
    <div className="cellwrap">
      <div key={flashKey ?? 'static'} className={cls + (flashKey !== null ? ' flash' : '')}>
        {body}
      </div>
    </div>
  )
}

interface RowProps {
  row: Row
  index: number
  problems: Problem[]
  isCurrent: boolean
  curProblem: string | null
  version: number
  move: RankMove | null
}

const RowView = memo(function RowView({ row, index, problems, isCurrent, curProblem, version, move }: RowProps) {
  const delta = move && move.teamId === row.team.id && move.from !== move.to ? move.from - move.to : 0
  return (
    <div className={`row grid${isCurrent ? ' current' : ''}`} style={{ transform: `translateY(${index * ROW_H}px)` }}>
      <div className="rank">{row.rank}</div>
      <div className="team">
        <span className="tname" title={row.team.members.join(', ')}>{row.team.name}</span>
        {delta !== 0 && (
          <span key={version} className={`delta ${delta > 0 ? 'up' : 'down'}`}>
            {delta > 0 ? '▲' : '▼'}
            {Math.abs(delta)}
          </span>
        )}
        <span className="members">{row.team.members.join(', ')}</span>
      </div>
      <div className="solved">{row.solved}</div>
      <div className="penalty">{row.penalty}</div>
      {problems.map((p) => {
        const cell = row.cells[p.index]
        const flashing = isCurrent && curProblem === p.index
        return <CellView key={p.index} cell={cell} problem={p.index} flashKey={flashing ? version : null} active={isCurrent} />
      })}
    </div>
  )
}, areEqualRow)

function areEqualRow(a: RowProps, b: RowProps) {
  // Re-render only when this row's data, position or highlight state could differ.
  return a.row === b.row && a.index === b.index && a.isCurrent === b.isCurrent && a.curProblem === b.curProblem && (a.isCurrent ? a.version === b.version : true) && a.move?.teamId === b.move?.teamId && a.problems === b.problems
}

interface Props {
  rows: Row[]
  problems: Problem[]
  curTeamId: string | null
  curProblem: string | null
  version: number
  move: RankMove | null
  moveMs: number
  /** Scroll the page so the current team stays in view. */
  follow: boolean
}

export function Scoreboard({ rows, problems, curTeamId, curProblem, version, move, moveMs, follow }: Props) {
  const np = problems.length
  const rowsRef = useRef<HTMLDivElement>(null)
  const curIndex = curTeamId ? rows.findIndex((r) => r.team.id === curTeamId) : -1

  // Auto-focus: centre the current team in the visible area (below the sticky control bar).
  // Runs when the team changes and again when its position changes, so the view follows it as it climbs.
  useEffect(() => {
    if (!follow || curIndex < 0 || !rowsRef.current) return
    const rowCenter = rowsRef.current.getBoundingClientRect().top + window.scrollY + curIndex * ROW_H + ROW_H / 2
    const barH = document.querySelector<HTMLElement>('.controls')?.offsetHeight ?? 0
    window.scrollTo({ top: Math.max(0, rowCenter - (window.innerHeight + barH) / 2), behavior: 'smooth' })
  }, [follow, curTeamId, curIndex])
  const style = { '--np': np, '--rowh': `${ROW_H}px`, '--move': `${moveMs}ms`, minWidth: 52 + 190 + 54 + 70 + np * 66 } as CSSProperties
  return (
    <div className="boardscroll">
      <div className="board" style={style}>
        <div className="head grid">
          <div className="rank">#</div>
          <div className="team">Team</div>
          <div className="solved">Solved</div>
          <div className="penalty">Penalty</div>
          {problems.map((p) => (
            <div key={p.index} className="ph" title={p.name}>
              {p.index}
            </div>
          ))}
        </div>
        <div className="rows" ref={rowsRef} style={{ height: rows.length * ROW_H }}>
          {rows.map((r, i) => (
            <RowView
              key={r.team.id}
              row={r}
              index={i}
              problems={problems}
              isCurrent={r.team.id === curTeamId}
              curProblem={curProblem}
              version={version}
              move={move}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
