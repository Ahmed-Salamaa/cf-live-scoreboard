import type { ContestData, Submission, Team } from './types'

/**
 * DEMO DATA ONLY — used when no Codeforces API key is configured (or with ?demo in the URL)
 * so the UI can be tried out. Real contests always use the real verdicts from the API.
 */
function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES = [
  'Cairo Coders', 'Nile Hackers', 'Delta Debuggers', 'Sinai Stack', 'Pharaoh Pointers', 'Giza Graphs', 'Alex Algos', 'Suez Segfaults',
  'Luxor Loops', 'Aswan Arrays', 'Red Sea Recursion', 'Ismailia Integers', 'Sphinx Solvers', 'Memphis Matrices', 'Karnak Kernels', 'Tanta Trees',
  'Mansoura Maps', 'Fayoum Flows', 'Siwa Sorters', 'Damietta DP', 'Port Said Primes', 'Hurghada Heaps', 'Zagazig Zeta', 'Minya Modulo',
  'Asyut Automata', 'Sohag Sets', 'Qena Queues', 'Beni Binary', 'Dahab Divisors', 'Rosetta Regex',
]

export function makeDemo(seed = 7): ContestData {
  const rnd = mulberry32(seed)
  const problems = 'ABCDEFGH'.split('').map((index, i) => ({ index, name: `Problem ${index}`, d: 0.05 + i * 0.1 }))
  const durationSec = 300 * 60
  const teams: Team[] = NAMES.map((name, i) => ({ id: `t${i + 1}`, name, members: [`member${i + 1}a`, `member${i + 1}b`, `member${i + 1}c`] }))
  const raw: Omit<Submission, 'id'>[] = []
  const rejects = ['WRONG_ANSWER', 'WRONG_ANSWER', 'WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'RUNTIME_ERROR', 'COMPILATION_ERROR']
  const sec = (min: number) => Math.min(durationSec - 1, Math.floor(min * 60 + rnd() * 59))

  teams.forEach((team, ti) => {
    const skill = 0.25 + rnd() * 0.7
    const closer = ti % 4 === 0
    problems.forEach((p) => {
      const solves = rnd() < Math.min(0.97, skill * 1.2 - p.d * 0.55)
      if (solves) {
        let tAc = 8 + rnd() * rnd() * 280 + p.d * 60
        if (closer && rnd() < 0.5) tAc = 241 + rnd() * 57
        tAc = Math.min(tAc, 298)
        const wrong = Math.floor(rnd() * rnd() * 4)
        for (let k = 0; k < wrong; k++) {
          const t = Math.max(1, tAc - (wrong - k) * (4 + rnd() * 20))
          raw.push({ teamId: team.id, problem: p.index, timeSec: sec(t), verdict: rejects[Math.floor(rnd() * rejects.length)] })
        }
        raw.push({ teamId: team.id, problem: p.index, timeSec: sec(tAc), verdict: 'OK' })
        if (rnd() < 0.06) raw.push({ teamId: team.id, problem: p.index, timeSec: sec(Math.min(299, tAc + 5 + rnd() * 20)), verdict: 'OK' })
      } else if (rnd() < 0.4) {
        const n = 1 + Math.floor(rnd() * 3)
        for (let k = 0; k < n; k++) {
          const t = closer && rnd() < 0.6 ? 241 + rnd() * 57 : 20 + rnd() * 270
          raw.push({ teamId: team.id, problem: p.index, timeSec: sec(t), verdict: rejects[Math.floor(rnd() * rejects.length)] })
        }
      }
    })
  })
  raw.sort((a, b) => a.timeSec - b.timeSec)
  const submissions: Submission[] = raw.map((s, i) => ({ ...s, id: 1000 + i }))
  return {
    contest: { id: 0, name: 'DEMO CONTEST (sample data)', type: 'ICPC', phase: 'FINISHED', durationSec, freezeSec: 3600, relativeSec: durationSec },
    problems: problems.map(({ index, name }) => ({ index, name })),
    teams,
    submissions,
    fetchedAt: Date.now(),
    source: 'demo',
  }
}
