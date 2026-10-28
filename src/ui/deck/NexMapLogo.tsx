import { useId } from 'react';

/**
 * NexMapLogo — bespoke brand mark + wordmark, drawn from scratch as SVG.
 *
 * The mark is a stylized network: a bright core node linked to three satellites
 * inside a rounded "app tile", echoing NexMap's domain (nodes + links on a fabric).
 * Links animate a one-shot draw-in; the core breathes. All motion is CSS and is
 * neutralised by the global reduced-motion kill switch.
 */
export function NexMapLogo({
  size = 40,
  showWordmark = true,
  className,
}: {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const g1 = `nxg-${uid}`;
  const g2 = `nxc-${uid}`;
  const gl = `nxl-${uid}`;

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3 }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        role="img"
        aria-label="NexMap"
        style={{ flex: 'none' }}
      >
        <defs>
          <linearGradient id={g1} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--accent-3)" />
            <stop offset="0.5" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
          <linearGradient id={gl} x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--accent-2)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
          <radialGradient id={g2} cx="0.5" cy="0.4" r="0.7">
            <stop stopColor="#ffffff" />
            <stop offset="0.5" stopColor="var(--accent-2)" />
            <stop offset="1" stopColor="var(--accent)" />
          </radialGradient>
        </defs>

        {/* App tile */}
        <rect x="2" y="2" width="44" height="44" rx="12" fill={`url(#${g1})`} />
        <rect
          x="2.75"
          y="2.75"
          width="42.5"
          height="42.5"
          rx="11.25"
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="1.5"
        />

        {/* Links (satellites → core), one-shot draw-in */}
        <g
          stroke="rgba(255,255,255,0.9)"
          strokeWidth="2"
          strokeLinecap="round"
          style={{
            strokeDasharray: 40,
            strokeDashoffset: 40,
            animation: 'nxlogo-draw 900ms var(--ease-out, ease) forwards',
          }}
        >
          <line x1="24" y1="24" x2="13" y2="14" />
          <line x1="24" y1="24" x2="35" y2="16" />
          <line x1="24" y1="24" x2="24" y2="36" />
        </g>

        {/* Satellite nodes */}
        <g fill="#ffffff">
          <circle cx="13" cy="14" r="3" />
          <circle cx="35" cy="16" r="3" />
          <circle cx="24" cy="36" r="3" />
        </g>

        {/* Core node (breathing glow) */}
        <circle
          cx="24"
          cy="24"
          r="6.5"
          fill={`url(#${g2})`}
          style={{ transformOrigin: '24px 24px', animation: 'nxlogo-pulse 3s ease-in-out infinite' }}
        />
        <circle cx="24" cy="24" r="6.5" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />

        <style>{`
          @keyframes nxlogo-draw { to { stroke-dashoffset: 0; } }
          @keyframes nxlogo-pulse {
            0%,100% { transform: scale(1); filter: drop-shadow(0 0 2px rgba(255,255,255,0.4)); }
            50% { transform: scale(1.08); filter: drop-shadow(0 0 6px rgba(255,255,255,0.7)); }
          }
        `}</style>
      </svg>

      {showWordmark && (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: size * 0.62,
            letterSpacing: '-0.02em',
            lineHeight: 1,
            color: 'var(--deck-fg, var(--chrome-fg))',
          }}
        >
          Nex
          <span
            style={{
              background: 'var(--brand-grad)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            Map
          </span>
        </span>
      )}
    </span>
  );
}
