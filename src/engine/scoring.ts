import type { Cell, ContestData, Row, SubState, Submission } from './types'

/** ICPC rule: 20 penalty minutes per rejected attempt before the accepted one. */
export const PENALTY_PER_REJECT_MIN = 20

/** Verdicts that never count as a penalised attempt. */
const NO_PENALTY = new Set(['COMPILATION_ERROR', 'SKIPPED', 'TESTING', 'FAILED', 'CRASHED', 'REJECTED'])

export type StateOf = (s: Submission) => SubState
export type SubVisual = 'first' | 'ac' | 'wa' | 'neutral' | 'pending' | 'hidden'

export const isAccepted = (v: string | null) => v === 'OK'
export const countsPenalty = (v: string | null) => v !== null && v !== 'OK' && !NO_PENALTY.has(v)

interface Index {
  sorted: Submission[]
  byId: Map<number, Submission>
  byTeam: Map<string, Map<string, Submission[]>>
  /** problem index -> id of the earliest accepted submission among all contestants */
  first: Map<string, number>
}

const cache = new WeakMap<ContestData, Index>()

/** Build (once per data object) the lookup structures used by every scoring pass. ContestData must not be mutated. */
export function indexOf(data: ContestData): Index {
  const hit = cache.get(data)
  if (hit) return hit
  const sorted = [...data.submissions].sort((a, b) => a.timeSec - b.timeSec || a.id - b.id)
  const byId = new Map<number, Submission>()
  const byTeam = new Map<string, Map<string, Submission[]>>()
  const first = new Map<string, number>()
  for (const s of sorted) {
    byId.set(s.id, s)
    let probs = byTeam.get(s.teamId)
    if (!probs) byTeam.set(s.teamId, (probs = new Map()))
    const list = probs.get(s.problem)
    if (list) list.push(s)
    else probs.set(s.problem, [s])
    if (s.verdict === 'OK' && !first.has(s.problem)) first.set(s.problem, s.id) // sorted => earliest wins
  }
  const idx = { sorted, byId, byTeam, first }
  cache.set(data, idx)
  return idx
}

export function firstSolves(data: ContestData): Map<string, number> {
  return indexOf(data).first
}

export function emptyCell(): Cell {
  return { solved: false, solveMin: 0, rejected: 0, ignored: 0, pending: 0, hidden: 0, solvingSubId: null, firstSolve: false }
}

/** Sort rows (solved desc, penalty asc, name) and assign competition ranks (ties share a rank). */
export function rankRows(rows: Row[]): Row[] {
  const sorted = [...rows].sort(
    (a, b) => b.solved - a.solved || a.penalty - b.penalty || a.team.name.localeCompare(b.team.name) || a.team.id.localeCompare(b.team.id),
  )
  let prev: Row | null = null
  sorted.forEach((r, i) => {
    r.rank = prev && prev.solved === r.solved && prev.penalty === r.penalty ? prev.rank : i + 1
    prev = r
  })
  return sorted
}

/**
 * Compute the full ranked board for the given visibility function.
 * - 'hidden' submissions are not scored (they only increment cell.hidden)
 * - 'pending' (or verdict === null) submissions increment cell.pending
 * - 'final' submissions are scored by their verdict
 * Submissions after a team's accepted one on the same problem are ignored (ICPC rule).
 */
export function computeBoard(data: ContestData, stateOf: StateOf): Row[] {
  const idx = indexOf(data)
  const rows: Row[] = data.teams.map((team) => {
    const cells: Record<string, Cell> = {}
    for (const p of data.problems) cells[p.index] = emptyCell()
    const row: Row = { team, cells, solved: 0, penalty: 0, rank: 0 }
    const probs = idx.byTeam.get(team.id)
    if (!probs) return row
    for (const [prob, subs] of probs) {
      const cell = cells[prob]
      if (!cell) continue
      for (const s of subs) {
        const st = stateOf(s)
        if (cell.solved) continue
        if (st === 'hidden') {
          cell.hidden++
          continue
        }
        if (st === 'pending' || s.verdict === null) {
          cell.pending++
          continue
        }
        if (s.verdict === 'OK') {
          cell.solved = true
          cell.solveMin = Math.floor(s.timeSec / 60)
          cell.solvingSubId = s.id
          cell.firstSolve = idx.first.get(prob) === s.id
          row.solved++
          row.penalty += cell.solveMin + PENALTY_PER_REJECT_MIN * cell.rejected
        } else if (countsPenalty(s.verdict)) cell.rejected++
        else cell.ignored++
      }
    }
    return row
  })
  return rankRows(rows)
}

export function subVisual(s: Submission, state: SubState, first: Map<string, number>): SubVisual {
  if (state === 'hidden') return 'hidden'
  if (state === 'pending' || s.verdict === null) return 'pending'
  if (s.verdict === 'OK') return first.get(s.problem) === s.id ? 'first' : 'ac'
  return countsPenalty(s.verdict) ? 'wa' : 'neutral'
}

const LABELS: Record<string, string> = {
  OK: 'Accepted',
  WRONG_ANSWER: 'Wrong answer',
  TIME_LIMIT_EXCEEDED: 'Time limit',
  MEMORY_LIMIT_EXCEEDED: 'Memory limit',
  RUNTIME_ERROR: 'Runtime error',
  COMPILATION_ERROR: 'Compile error',
  IDLENESS_LIMIT_EXCEEDED: 'Idleness limit',
  PRESENTATION_ERROR: 'Presentation error',
}

export function verdictLabel(v: string | null): string {
  if (v === null) return 'Pending'
  return LABELS[v] ?? v.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** Compare our own scoring of all non-hidden submissions with the official standings, when available. */
export function verifyAgainstOfficial(data: ContestData): { checked: number; mismatches: string[] } | null {
  if (!data.official) return null
  const rows = computeBoard(data, () => 'final')
  const mismatches: string[] = []
  let checked = 0
  for (const r of rows) {
    const o = data.official[r.team.id]
    if (!o) continue
    checked++
    if (o.solved !== r.solved || o.penalty !== r.penalty) {
      mismatches.push(`${r.team.name}: ours ${r.solved}/${r.penalty}, official ${o.solved}/${o.penalty}`)
    }
  }
  return { checked, mismatches }
}
