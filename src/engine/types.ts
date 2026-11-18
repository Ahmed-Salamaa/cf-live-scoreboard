export interface Team {
  id: string
  name: string
  members: string[]
}

export interface Problem {
  index: string
  name: string
}

export interface Submission {
  id: number
  teamId: string
  problem: string
  /** Seconds since contest start (Codeforces relativeTimeSeconds). */
  timeSec: number
  /** Codeforces verdict string ("OK", "WRONG_ANSWER", ...) or null while still being judged. */
  verdict: string | null
}

export interface ContestInfo {
  id: number
  name: string
  type: string
  phase: string
  durationSec: number
  /** Contest.freezeDurationSeconds when the API provides it. */
  freezeSec: number | null
  /** Seconds since start at the moment the data was fetched. */
  relativeSec: number | null
}

export interface OfficialRow {
  solved: number
  penalty: number
}

export interface ContestData {
  contest: ContestInfo
  problems: Problem[]
  teams: Team[]
  submissions: Submission[]
  /** Official standings (solved / penalty) used to cross-check our own scoring. */
  official?: Record<string, OfficialRow>
  fetchedAt: number
  source: 'live' | 'cache' | 'demo'
  managerView?: boolean
}

/** hidden = inside the blind period and not yet revealed; pending = being revealed; final = verdict applies */
export type SubState = 'hidden' | 'pending' | 'final'

export interface Cell {
  solved: boolean
  /** Minute of the accepted submission (floored), valid when solved. */
  solveMin: number
  /** Rejected attempts that count toward penalty (before the accepted one). */
  rejected: number
  /** Rejected attempts that do not count (e.g. compilation error). */
  ignored: number
  /** Submissions currently shown as pending. */
  pending: number
  /** Submissions still hidden by the freeze. */
  hidden: number
  solvingSubId: number | null
  firstSolve: boolean
}

export interface Row {
  team: Team
  cells: Record<string, Cell>
  solved: number
  penalty: number
  /** Competition rank (ties share a rank). */
  rank: number
}
