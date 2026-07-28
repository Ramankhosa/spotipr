// The PatentNest mark for the /home-v2 chrome: three nested arcs (the nest) over
// a single filled seed (the invention). Geometric so it holds at 28px.

export default function NestMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="PatentNest">
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M4 17c0 6.2 5.4 11 12 11s12-4.8 12-11" strokeWidth="2.1" />
        <path d="M8 16.5c0 4.1 3.6 7.3 8 7.3s8-3.2 8-7.3" strokeWidth="1.6" opacity=".62" />
        <path d="M12 16c0 2.1 1.8 3.7 4 3.7s4-1.6 4-3.7" strokeWidth="1.4" opacity=".38" />
        <path d="M16 12.6V4.4M16 8.4l4.4-3M16 8.4l-4.4-3" strokeWidth="1.7" />
      </g>
      <circle cx="16" cy="14.4" r="1.9" fill="currentColor" />
    </svg>
  )
}
