import { computeBoard, indexOf, subVisual, type StateOf, type SubVisual } from './scoring'
import type { ContestData, Row, SubState, Submission } from './types'

export interface RankMove {
  teamId: string
  /** 1-based board position before / after the verdict was applied. */
  from: number
  to: number
  noEffect: boolean
}

export interface RevealLog {
  subId: number
  teamId: string
  problem: string
  verdict: string | null
  visual: SubVisual
  timeSec: number
  from: number
  to: number
  noEffect: boolean
}

export interface RevealState {
  states: Map<number, SubState>
  phase: 'idle' | 'pending' | 'finished'
  curSubId: number | null
  curTeamId: string | null
  /**
   * Board position (1-based) where the next scan for a team starts. The scan walks UP the board
   * (towards rank 1) from here and takes the first team that still has hidden submissions.
   */
  cursor: number
  /** True while the current team should keep going (it has not been "left" yet). */
  stay: boolean
  /** Current submission comes after the team's accepted one on that problem (cannot change the score). */
  curNoEffect: boolean
  revealed: number
  total: number
  log: RevealLog[]
  move: RankMove | null
  /** Increments on every transition; used to restart CSS animations. */
  version: number
}

export const stateFn =
  (st: RevealState): StateOf =>
  (s) =>
    st.states.get(s.id) ?? 'final'

/**
 * Start a reveal. Every submission with timeSec >= freezeSec is hidden, except those the judge has not
 * finished yet (verdict === null): those stay pending and are not part of the reveal queue.
 */
export function initReveal(data: ContestData, freezeSec: number): RevealState {
  const states = new Map<number, SubState>()
  let total = 0
  for (const s of data.submissions) {
    if (s.timeSec < freezeSec) continue
    if (s.verdict === null) states.set(s.id, 'pending')
    else {
      states.set(s.id, 'hidden')
      total++
    }
  }
  return {
    states,
    phase: 'idle',
    curSubId: null,
    curTeamId: null,
    cursor: data.teams.length, // start at the bottom of the frozen standings
    stay: false,
    curNoEffect: false,
    revealed: 0,
    total,
    log: [],
    move: null,
    version: 0,
  }
}

const position = (rows: Row[], teamId: string) => rows.findIndex((r) => r.team.id === teamId) + 1

/**
 * Pick the next submission to reveal.
 *
 * A cursor walks up the standings from the bottom. The current team is revealed one submission at a time
 * until either (a) an accepted submission moves it UP the board, or (b) it has nothing hidden left.
 * Then we leave it and take the next team above the cursor that still has hidden submissions. A team that
 * moved up (and still has hidden submissions) is resumed when the cursor reaches its new position.
 * Within a team: problem order, then submission time.
 */
export function pickNext(data: ContestData, st: RevealState): RevealState {
  if (st.phase === 'pending') return st
  const idx = indexOf(data)
  const hiddenBy = new Map<string, Submission[]>()
  for (const s of idx.sorted) {
    if (st.states.get(s.id) !== 'hidden') continue
    const list = hiddenBy.get(s.teamId)
    if (list) list.push(s)
    else hiddenBy.set(s.teamId, [s])
  }
  if (hiddenBy.size === 0) return { ...st, phase: 'finished', curSubId: null, curTeamId: null, version: st.version + 1 }

  const board = computeBoard(data, stateFn(st))
  let teamId: string | null = st.stay && st.curTeamId && hiddenBy.has(st.curTeamId) ? st.curTeamId : null
  if (!teamId) {
    // scan upwards from the cursor; fall back to a scan from the bottom if nothing is found (safety net)
    const scan = (fromPos: number) => {
      for (let pos = Math.min(fromPos, board.length); pos >= 1; pos--) if (hiddenBy.has(board[pos - 1].team.id)) return pos
      return 0
    }
    const pos = scan(st.cursor) || scan(board.length)
    if (pos) teamId = board[pos - 1].team.id
  }
  if (!teamId) return { ...st, phase: 'finished', curSubId: null, curTeamId: null, version: st.version + 1 }

  const order = new Map(data.problems.map((p, i) => [p.index, i]))
  const subs = [...hiddenBy.get(teamId)!].sort(
    (a, b) => (order.get(a.problem) ?? 999) - (order.get(b.problem) ?? 999) || a.timeSec - b.timeSec || a.id - b.id,
  )
  const sub = subs[0]
  const row = board.find((r) => r.team.id === teamId)!
  const states = new Map(st.states)
  states.set(sub.id, 'pending')
  return { ...st, states, phase: 'pending', curSubId: sub.id, curTeamId: teamId, curNoEffect: row.cells[sub.problem]?.solved ?? false, version: st.version + 1 }
}

/** Apply the real verdict of the submission currently shown as pending. */
export function resolveCurrent(data: ContestData, st: RevealState): RevealState {
  if (st.phase !== 'pending' || st.curSubId == null) return st
  const idx = indexOf(data)
  const sub = idx.byId.get(st.curSubId)!
  const before = computeBoard(data, stateFn(st))
  const states = new Map(st.states)
  states.set(sub.id, 'final')
  const next: RevealState = { ...st, states }
  const after = computeBoard(data, stateFn(next))
  const from = position(before, sub.teamId)
  const to = position(after, sub.teamId)

  // Decide whether to stay on this team or move on to the next participant.
  let hasMore = false
  for (const list of idx.byTeam.get(sub.teamId)?.values() ?? []) {
    if (list.some((s) => next.states.get(s.id) === 'hidden')) hasMore = true
  }
  let cursor = st.cursor
  let stay = true
  if (sub.verdict === 'OK' && !st.curNoEffect && to < from) {
    // Accepted and it moved the team up: leave it. The team now sitting at `from` is the next participant.
    cursor = from
    stay = false
  } else if (!hasMore) {
    // Finished this team without it moving up: the next participant is the one above it.
    cursor = to - 1
    stay = false
  }

  const entry: RevealLog = {
    subId: sub.id,
    teamId: sub.teamId,
    problem: sub.problem,
    verdict: sub.verdict,
    visual: subVisual(sub, 'final', idx.first),
    timeSec: sub.timeSec,
    from,
    to,
    noEffect: st.curNoEffect,
  }
  return {
    ...next,
    phase: 'idle',
    curSubId: null,
    cursor,
    stay,
    revealed: st.revealed + 1,
    log: [...st.log, entry],
    move: { teamId: sub.teamId, from, to, noEffect: st.curNoEffect },
    version: st.version + 1,
  }
}

/** Jump straight to the final standings. */
export function revealAll(_data: ContestData, st: RevealState): RevealState {
  const states = new Map<number, SubState>()
  for (const [id, s] of st.states) states.set(id, s === 'hidden' ? 'final' : s)
  return { ...st, states, phase: 'finished', curSubId: null, revealed: st.total, move: null, version: st.version + 1 }
}
