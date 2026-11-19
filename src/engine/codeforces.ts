import type { ContestData, OfficialRow, Submission, Team } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Stable key for a Codeforces "party" (team or single participant). */
export function partyKey(p: any): string {
  if (p.teamId != null) return `t${p.teamId}`
  return (p.members ?? []).map((m: any) => m.handle).join('+')
}

export function partyName(p: any): string {
  return p.teamName ?? (p.members ?? []).map((m: any) => m.handle).join(', ')
}

export interface RawContestPayload {
  standings: any // result of contest.standings
  submissions: any[] // result of contest.status
  fetchedAt?: number
  source?: 'live' | 'cache'
  managerView?: boolean
}

/**
 * Convert raw Codeforces API results into our model.
 * Only teams that appear in the (official) standings are kept; submissions made after the contest
 * duration (practice / upsolving) are dropped.
 */
export function normalize(raw: RawContestPayload): ContestData {
  const c = raw.standings.contest
  const durationSec: number = c.durationSeconds
  const teams: Team[] = []
  const official: Record<string, OfficialRow> = {}
  const known = new Set<string>()
  for (const row of raw.standings.rows) {
    const id = partyKey(row.party)
    if (known.has(id)) continue
    known.add(id)
    teams.push({ id, name: partyName(row.party), members: (row.party.members ?? []).map((m: any) => m.handle) })
    official[id] = { solved: Math.round(row.points), penalty: row.penalty ?? 0 }
  }
  const submissions: Submission[] = []
  for (const s of raw.submissions) {
    if (s.author?.participantType && s.author.participantType !== 'CONTESTANT') continue
    const teamId = partyKey(s.author)
    if (!known.has(teamId)) continue
    if (s.relativeTimeSeconds < 0 || s.relativeTimeSeconds > durationSec) continue
    const verdict = s.verdict && s.verdict !== 'TESTING' ? s.verdict : null
    submissions.push({ id: s.id, teamId, problem: s.problem.index, timeSec: s.relativeTimeSeconds, verdict })
  }
  return {
    contest: {
      id: c.id,
      name: c.name,
      type: c.type,
      phase: c.phase,
      durationSec,
      freezeSec: c.freezeDurationSeconds ?? null,
      relativeSec: c.relativeTimeSeconds ?? null,
    },
    problems: raw.standings.problems.map((p: any) => ({ index: p.index, name: p.name })),
    teams,
    submissions,
    official,
    fetchedAt: raw.fetchedAt ?? Date.now(),
    source: raw.source ?? 'live',
    managerView: raw.managerView,
  }
}
