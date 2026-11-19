# CF Live Scoreboard

An animated ICPC-style scoreboard for a Codeforces contest, with a progressive **unfreeze** (resolver-style reveal).
Built for contest **732371** (private, ICPC), but works for any contest id.

## Run it

```bash
npm install
cp .env.example .env      # fill in CF_API_KEY, CF_API_SECRET, ADMIN_PASSWORD
npm start                 # builds, then serves User (/) and Admin (/admin) on http://localhost:5173
```

- **User page** (`/`): public, read-only live scoreboard. Hidden verdicts are stripped on the server during the freeze so they cannot leak via DevTools.
- **Admin page** (`/admin`): password-protected (`ADMIN_PASSWORD_HASH`, salted `scrypt` hash generated via `npm run hash-password`) dashboard with manager view, official score cross-check, blind-time override, and progressive unfreezing controls.
- **Vercel**: [vercel.json](vercel.json) routes `/` and `/admin` to the SPA and `/api/*` to serverless functions in `api/`. Set `CF_CONTEST_ID`, `CF_API_KEY`, `CF_API_SECRET`, `CF_AS_MANAGER`, and `ADMIN_PASSWORD_HASH` in Vercel Environment Variables.
- `npm run dev` – same, with hot reload.
- `npm test` / `npm run typecheck` – engine & auth tests / type check.
- Without a key the app shows **DEMO DATA** (clearly labelled). You can also force it with `http://localhost:5173/?demo`.

### Getting API access (do this BEFORE the contest)

1. Go to <https://codeforces.com/settings/api> and create a key. Put the key and secret in `.env`.
2. The private contest requires the key's owner to see the contest. To see **hidden verdicts during the freeze**, the owner must be a **manager** of the contest/group (`CF_AS_MANAGER=true`). If the manager request is refused, the server automatically retries without it and logs a warning (you then only see what a normal participant sees).
3. The secret stays in the local server (`server/server.mjs`); it is never sent to the browser. Requests are paced to Codeforces' 1 request / 2 s limit and cached for 5 s, so many browser tabs are safe.
4. Every successful fetch is saved to `data/contest-732371.json`. If Codeforces is unreachable later, the app serves the saved copy (badge: *SAVED DATA*), so a network failure won't kill the reveal.

## How the data works

| Need | Source |
| --- | --- |
| Teams, problems, contest info (`durationSeconds`, `freezeDurationSeconds`, phase) | `contest.standings` |
| Every submission with its real verdict and time | `contest.status` |
| Official solved/penalty, to cross-check our scoring | `rows[].points` / `rows[].penalty` |

- **Freeze point** = `durationSeconds − freezeDurationSeconds` (editable in the header, "Blind … min"). Submissions with `relativeTimeSeconds ≥ freezeAt` are the hidden ones.
- **The public API does not reveal frozen verdicts to ordinary participants.** The reveal works on real verdicts, so it needs manager data, or the standard public data after the contest ends. Nothing is simulated.
- The frozen standings are never stored as a mutable copy: they are recomputed from submissions before the freeze, so Restart always returns to the identical snapshot.

## Scoring (ICPC)

Rank by solved count (desc), then penalty (asc); ties share a rank. Penalty of a solved problem = `floor(minutes of the AC) + 20 × rejected attempts before it`. Compilation errors (and judge failures) don't count; submissions after the team's AC on that problem are ignored. The header badge compares our result against the official standings for every team (`✓ matches official` / `⚠ N mismatches`). **Check it once before the contest**; if it ever shows mismatches, the rule set in `src/engine/scoring.ts` needs adjusting.

## Visual states

| State | Look |
| --- | --- |
| First accepted solve for a problem (by real time) | Dark green cell + two floating balloons (pop animation when revealed) |
| Later accepted | Normal green |
| Rejected (WA/TLE/RE/…) | Red, `−n` |
| Pending (being revealed / still judging) | Light violet, pulsing on the active row |
| Frozen / hidden | Dashed violet `?` |

## Unfreezing

1. When the contest is past the freeze point the board shows the frozen standings and *Start unfreezing* appears.
2. A cursor starts at the bottom of the frozen standings and takes the lowest team that has hidden submissions. Its submissions are revealed one by one (pending, then the real verdict, then re-rank and animate).
   - If a revealed **accepted** submission moves the team **up**, the team is *left* there and the cursor goes on to the next participant (the team now sitting at the position the cursor was on).
   - Otherwise (wrong answers, or an accepted one that doesn't change its position) it continues with the same team until it runs out of hidden submissions or gets an accepted one that moves it up.
   - A team that moved up and still has hidden submissions is **resumed when the cursor reaches its new position**.
3. **Follow** (on by default) scrolls the page to keep the current team centred, including while it climbs.
4. Controls: Pause/Resume (`Space`), Reveal next (`→` / `N`), speed 1–10×, Follow, Skip to final, Restart, progress bar, Exit.

## Layout

```
server/     sign.mjs (API signature), server.mjs (proxy + cache + static)
src/engine/ scoring.ts, reveal.ts (pure, unit-tested), codeforces.ts (API → model), demo.ts
src/        hooks.ts, App.tsx, components/ (Scoreboard, Balloons, Feed, Controls), styles.css
```
