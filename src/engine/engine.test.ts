import { describe, expect, it } from 'vitest'
import { computeBoard, firstSolves, subVisual, verifyAgainstOfficial } from './scoring'
import { initReveal, pickNext, resolveCurrent, revealAll, stateFn } from './reveal'
import { normalize } from './codeforces'
import { makeDemo } from './demo'
import type { ContestData, Submission } from './types'

let nextId = 1
const sub = (teamId: string, problem: string, min: number, verdict: string | null, sec = 0): Submission => ({
  id: nextId++,
  teamId,
  problem,
  timeSec: min * 60 + sec,
  verdict,
})

function make(subs: Submission[], teamIds = ['a', 'b', 'c']): ContestData {
  return {
    contest: { id: 1, name: 't', type: 'ICPC', phase: 'FINISHED', durationSec: 300 * 60, freezeSec: 3600, relativeSec: 300 * 60 },
    problems: [{ index: 'A', name: 'A' }, { index: 'B', name: 'B' }, { index: 'C', name: 'C' }],
    teams: teamIds.map((id) => ({ id, name: id.toUpperCase(), members: [id] })),
    submissions: subs,
    fetchedAt: 0,
    source: 'demo',
  }
}
const final = () => 'final' as const

describe('ICPC scoring', () => {
  it('penalty = floor(minutes) + 20 per rejected attempt before the AC', () => {
    const d = make([sub('a', 'A', 10, 'WRONG_ANSWER'), sub('a', 'A', 25, 'TIME_LIMIT_EXCEEDED'), sub('a', 'A', 47, 'OK', 59)])
    const [r] = computeBoard(d, final)
    expect(r.solved).toBe(1)
    expect(r.penalty).toBe(47 + 40)
    expect(r.cells.A.rejected).toBe(2)
  })
  it('compilation errors do not add penalty', () => {
    const d = make([sub('a', 'A', 5, 'COMPILATION_ERROR'), sub('a', 'A', 30, 'OK')])
    expect(computeBoard(d, final)[0].penalty).toBe(30)
  })
  it('rejected attempts on unsolved problems add nothing', () => {
    const d = make([sub('a', 'A', 5, 'WRONG_ANSWER'), sub('a', 'B', 8, 'OK')])
    const r = computeBoard(d, final)[0]
    expect(r.solved).toBe(1)
    expect(r.penalty).toBe(8)
  })
  it('submissions after the accepted one are ignored', () => {
    const d = make([sub('a', 'A', 10, 'OK'), sub('a', 'A', 20, 'WRONG_ANSWER'), sub('a', 'A', 30, 'OK')])
    const r = computeBoard(d, final)[0]
    expect(r.solved).toBe(1)
    expect(r.penalty).toBe(10)
  })
  it('ranks by solved desc then penalty asc; ties share a rank', () => {
    const d = make([sub('a', 'A', 10, 'OK'), sub('b', 'A', 20, 'OK'), sub('b', 'B', 5, 'OK'), sub('c', 'A', 10, 'OK')])
    const rows = computeBoard(d, final)
    expect(rows.map((r) => r.team.id)).toEqual(['b', 'a', 'c'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2])
  })
})

describe('first solve', () => {
  it('flags only the earliest accepted submission per problem', () => {
    const early = sub('b', 'A', 5, 'OK')
    const d = make([sub('a', 'A', 3, 'WRONG_ANSWER'), early, sub('a', 'A', 9, 'OK'), sub('a', 'B', 12, 'OK')])
    expect(firstSolves(d).get('A')).toBe(early.id)
    const rows = computeBoard(d, final)
    const a = rows.find((r) => r.team.id === 'a')!
    const b = rows.find((r) => r.team.id === 'b')!
    expect(b.cells.A.firstSolve).toBe(true)
    expect(a.cells.A.firstSolve).toBe(false)
    expect(a.cells.B.firstSolve).toBe(true)
    expect(subVisual(early, 'final', firstSolves(d))).toBe('first')
  })
  it('a hidden first solve is still the first solve by real time', () => {
    const hiddenFirst = sub('a', 'A', 250, 'OK')
    const d = make([hiddenFirst, sub('b', 'A', 270, 'OK')])
    expect(firstSolves(d).get('A')).toBe(hiddenFirst.id)
  })
})

describe('freeze snapshot', () => {
  const frozenFn = (freeze: number) => (s: Submission) => (s.timeSec >= freeze ? ('hidden' as const) : ('final' as const))
  it('hidden submissions never change solved/penalty, only the hidden counter', () => {
    const d = make([sub('a', 'A', 30, 'OK'), sub('b', 'A', 100, 'OK'), sub('c', 'B', 70, 'OK')])
    const frozen = computeBoard(d, frozenFn(60 * 60))
    const a = frozen.find((r) => r.team.id === 'a')!
    const b = frozen.find((r) => r.team.id === 'b')!
    const c = frozen.find((r) => r.team.id === 'c')!
    expect(a.solved).toBe(1)
    expect(b.solved).toBe(0)
    expect(b.cells.A.hidden).toBe(1)
    expect(c.solved).toBe(0)
  })
})

describe('reveal', () => {
  function runAll(d: ContestData, freeze: number) {
    let st = initReveal(d, freeze)
    const snapshot = computeBoard(d, stateFn(st))
    const order: number[] = []
    for (let guard = 0; guard < 100000; guard++) {
      st = pickNext(d, st)
      if (st.phase === 'finished') break
      expect(st.phase).toBe('pending')
      order.push(st.curSubId!)
      st = resolveCurrent(d, st)
    }
    return { st, snapshot, order }
  }

  it('starts from the bottom of the frozen standings and applies real verdicts', () => {
    const d = make([
      sub('a', 'A', 10, 'OK'), // a: 1 solved (frozen leader)
      sub('b', 'B', 20, 'OK'), // b: 1 solved, worse penalty -> rank 2
      // c: nothing before freeze -> bottom
      sub('c', 'A', 70, 'WRONG_ANSWER'),
      sub('c', 'A', 80, 'OK'),
      sub('c', 'B', 90, 'OK'),
      sub('b', 'C', 100, 'OK'),
    ])
    let st = initReveal(d, 3600)
    expect(st.total).toBe(4)
    st = pickNext(d, st)
    expect(st.curTeamId).toBe('c') // bottom of frozen standings
    expect(d.submissions.find((s) => s.id === st.curSubId)!.verdict).toBe('WRONG_ANSWER')
    const before = computeBoard(d, stateFn(st))
    expect(before.find((r) => r.team.id === 'c')!.cells.A.pending).toBe(1)
    st = resolveCurrent(d, st)
    expect(computeBoard(d, stateFn(st)).find((r) => r.team.id === 'c')!.cells.A.rejected).toBe(1)
    st = pickNext(d, st)
    expect(st.curTeamId).toBe('c') // sticks to the same team until done
    st = resolveCurrent(d, st)
    // c solved A at minute 80 with one wrong attempt -> 100 penalty
    const c = computeBoard(d, stateFn(st)).find((r) => r.team.id === 'c')!
    expect(c.solved).toBe(1)
    expect(c.penalty).toBe(80 + 20)
    expect(st.move!.to).toBeLessThanOrEqual(st.move!.from)
  })

  it('leaves a team when an accepted submission moves it up, handles the next team, and resumes it later', () => {
    const d = make(
      [
        sub('a', 'A', 10, 'OK'),
        sub('b', 'A', 20, 'OK'),
        sub('c', 'A', 30, 'OK'),
        // d has nothing before the freeze -> bottom (position 4)
        sub('d', 'B', 70, 'WRONG_ANSWER'),
        sub('d', 'B', 80, 'OK'), // AC but d stays 4th (1 solved, big penalty) -> keep going with d
        sub('d', 'C', 90, 'OK'), // 2 solved -> d jumps to 1st -> leave d
        sub('d', 'C', 110, 'WRONG_ANSWER'), // d's remaining hidden submission, resumed later
        sub('c', 'B', 100, 'WRONG_ANSWER'), // next participant after d is c (now at position 4)
      ],
      ['a', 'b', 'c', 'd'],
    )
    let st = initReveal(d, 3600)
    const seq: string[] = []
    const moves: string[] = []
    for (let i = 0; i < 20; i++) {
      st = pickNext(d, st)
      if (st.phase === 'finished') break
      seq.push(st.curTeamId!)
      st = resolveCurrent(d, st)
      moves.push(`${st.move!.from}>${st.move!.to}`)
    }
    expect(seq).toEqual(['d', 'd', 'd', 'c', 'd'])
    expect(moves.slice(0, 3)).toEqual(['4>4', '4>4', '4>1'])
    expect(st.revealed).toBe(5)
  })

  it('final reveal equals the true final standings and counts every hidden submission once', () => {
    const d = makeDemoLike()
    const { st, snapshot, order } = runAll(d, 240 * 60)
    expect(order.length).toBe(st.total)
    expect(new Set(order).size).toBe(order.length)
    expect(st.revealed).toBe(st.total)
    const revealed = computeBoard(d, stateFn(st))
    const truth = computeBoard(d, final)
    expect(revealed.map((r) => [r.team.id, r.solved, r.penalty, r.rank])).toEqual(truth.map((r) => [r.team.id, r.solved, r.penalty, r.rank]))
    // snapshot is untouched by the reveal (it is a separate computed value)
    expect(snapshot.every((r) => Object.values(r.cells).every((c) => c.pending === 0))).toBe(true)
    // balloons: exactly one first-solve cell per solved problem in the final board
    for (const p of d.problems) {
      const firsts = revealed.filter((r) => r.cells[p.index].firstSolve).length
      expect(firsts).toBe(truth.some((r) => r.cells[p.index].solved) ? 1 : 0)
    }
  })

  it('revealAll matches the step-by-step result, including mid-pending reveal', () => {
    const d = makeDemoLike()
    const midPending = pickNext(d, initReveal(d, 240 * 60))
    expect(midPending.phase).toBe('pending')
    const full = revealAll(d, midPending)
    expect(full.curTeamId).toBeNull()
    expect(full.states.get(midPending.curSubId!)).toBe('final')
    const { st } = runAll(d, 240 * 60)
    expect(computeBoard(d, stateFn(full)).map((r) => [r.team.id, r.solved, r.penalty])).toEqual(
      computeBoard(d, stateFn(st)).map((r) => [r.team.id, r.solved, r.penalty]),
    )
  })

  it('submissions still being judged stay pending and are not queued', () => {
    const d = make([sub('a', 'A', 100, null), sub('a', 'B', 110, 'OK')])
    const st = initReveal(d, 3600)
    expect(st.total).toBe(1)
    expect(computeBoard(d, stateFn(st)).find((r) => r.team.id === 'a')!.cells.A.pending).toBe(1)
  })
})

function makeDemoLike(): ContestData {
  return makeDemo(11)
}

describe('demo contest produces rank movement', () => {
  it('has hidden submissions and at least one team that climbs during the reveal', () => {
    const d = makeDemo(7)
    let st = initReveal(d, 240 * 60)
    expect(st.total).toBeGreaterThan(10)
    let climbed = 0
    for (let i = 0; i < 100000; i++) {
      st = pickNext(d, st)
      if (st.phase === 'finished') break
      st = resolveCurrent(d, st)
      if (st.move!.to < st.move!.from) climbed++
    }
    expect(climbed).toBeGreaterThan(0)
  })
})

describe('normalize (Codeforces API shape)', () => {
  it('maps standings + status, drops non-roster and post-contest submissions, handles teams', () => {
    const party = (handle: string, teamId?: number, teamName?: string) => ({ teamId, teamName, members: [{ handle }] })
    const raw = {
      standings: {
        contest: { id: 732371, name: 'X', type: 'ICPC', phase: 'FINISHED', durationSeconds: 18000, freezeDurationSeconds: 3600, relativeTimeSeconds: 18000 },
        problems: [{ index: 'A', name: 'a' }],
        rows: [
          { party: party('alice', 5, 'Team Five'), points: 1, penalty: 33 },
          { party: party('bob'), points: 0, penalty: 0 },
        ],
      },
      submissions: [
        { id: 3, author: { ...party('alice', 5, 'Team Five'), participantType: 'CONTESTANT' }, problem: { index: 'A' }, relativeTimeSeconds: 1980, verdict: 'OK' },
        { id: 2, author: { ...party('bob'), participantType: 'CONTESTANT' }, problem: { index: 'A' }, relativeTimeSeconds: 100, verdict: 'TESTING' },
        { id: 1, author: party('ghost'), problem: { index: 'A' }, relativeTimeSeconds: 50, verdict: 'OK' }, // not in roster
        { id: 4, author: party('bob'), problem: { index: 'A' }, relativeTimeSeconds: 99999, verdict: 'OK' }, // upsolving
        { id: 5, author: { ...party('bob'), participantType: 'VIRTUAL' }, problem: { index: 'A' }, relativeTimeSeconds: 120, verdict: 'OK' }, // virtual
        { id: 6, author: { ...party('bob'), participantType: 'CONTESTANT' }, problem: { index: 'A' }, relativeTimeSeconds: -10, verdict: 'OK' }, // negative time
      ],
    }
    const d = normalize(raw)
    expect(d.contest.freezeSec).toBe(3600)
    expect(d.teams.map((t) => t.name)).toEqual(['Team Five', 'bob'])
    expect(d.submissions.map((s) => s.id).sort()).toEqual([2, 3])
    expect(d.submissions.find((s) => s.id === 2)!.verdict).toBeNull()
    const v = verifyAgainstOfficial(d)!
    expect(v.mismatches).toEqual([])
    expect(v.checked).toBe(2)
  })
})
