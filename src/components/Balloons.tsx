const COLORS = ['#e5484d', '#f5a524', '#3e63dd', '#30a46c', '#ab4aba', '#12a594', '#e93d82', '#f76b15']

function Balloon({ color, delay }: { color: string; delay: number }) {
  return (
    <svg className="balloon" width="13" height="20" viewBox="0 0 13 20" style={{ animationDelay: `${delay}s` }} aria-hidden="true">
      <path d="M6.5 0C2.9 0 0 2.8 0 6.4 0 10.3 3.4 13.4 6.5 14.4 9.6 13.4 13 10.3 13 6.4 13 2.8 10.1 0 6.5 0Z" fill={color} />
      <path d="M3.2 3.2C3.9 2.2 5 1.7 6 1.8" stroke="#fff" strokeOpacity=".55" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <path d="M5.6 14.4h1.8l-.9 1.3z" fill={color} />
      <path d="M6.5 15.7c-1 1.4 1 2.6 0 4.2" stroke="currentColor" strokeOpacity=".7" strokeWidth=".8" fill="none" />
    </svg>
  )
}

/** Two balloons, shown next to the first accepted solve of a problem. `pop` plays the entrance burst. */
export function Balloons({ problem, pop }: { problem: string; pop: boolean }) {
  const i = (problem.charCodeAt(0) || 0) % COLORS.length
  return (
    <span className={`balloons${pop ? ' pop' : ''}`} title="First solve!">
      <Balloon color={COLORS[i]} delay={0} />
      <Balloon color={COLORS[(i + 3) % COLORS.length]} delay={0.6} />
    </span>
  )
}
