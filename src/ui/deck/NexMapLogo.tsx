import { useId } from 'react';

/**
 * NexMapLogo — the brand mark + wordmark (docs/brand/README.md).
 *
 * The mark is the "routed N": the letter drawn as one network cable that runs up,
 * across and up again through two nodes, with a signal on the link between them.
 * Coordinates are the 512-unit master (docs/brand/nexmap-mark.svg) scaled to 48.
 * The cable draws in once and the signal travels the link; both animations END
 * on the static mark, so the global reduced-motion kill switch (which runs every
 * animation once, instantly) leaves exactly the logo as drawn.
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
  const tile = `nxt-${uid}`;
  const sheen = `nxs-${uid}`;
  const cable = `nxc-${uid}`;
  const glow = `nxg-${uid}`;

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
          <linearGradient id={tile} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#141d3a" />
            <stop offset="1" stopColor="#060a16" />
          </linearGradient>
          <linearGradient id={sheen} x1="24" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" stopOpacity="0.1" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={cable} x1="14" y1="36.75" x2="34" y2="11.25" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7a5cff" />
            <stop offset="0.5" stopColor="#2f6bff" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
          <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
            <stop stopColor="#ffffff" />
            <stop offset="0.4" stopColor="#8af5ff" />
            <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* App tile */}
        <rect width="48" height="48" rx="10.9" fill={`url(#${tile})`} />
        <rect width="48" height="48" rx="10.9" fill={`url(#${sheen})`} />
        <rect
          x="0.75"
          y="0.75"
          width="46.5"
          height="46.5"
          rx="10.15"
          stroke="#ffffff"
          strokeOpacity="0.1"
          strokeWidth="0.5"
        />

        {/* The N: one cable, drawn in once */}
        <path
          d="M14.25 36.375 V14.25 L33.75 33.75 V11.625"
          stroke={`url(#${cable})`}
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          style={{
            strokeDasharray: 1,
            strokeDashoffset: 1,
            animation: 'nxlogo-draw 900ms var(--ease-out, ease) forwards',
          }}
        />

        {/* The two nodes it runs through */}
        <circle cx="14.25" cy="14.25" r="3.2" fill="#060a16" stroke="#ffffff" strokeWidth="1.4" />
        <circle cx="33.75" cy="33.75" r="3.2" fill="#060a16" stroke="#ffffff" strokeWidth="1.4" />

        {/* The signal: travels the link, comes to rest at its centre */}
        <g style={{ animation: 'nxlogo-signal 4.2s ease-in-out 900ms infinite' }}>
          <circle cx="24" cy="24" r="4.1" fill={`url(#${glow})`} />
          <circle cx="24" cy="24" r="1.15" fill="#ffffff" />
        </g>

        <style>{`
          @keyframes nxlogo-draw { to { stroke-dashoffset: 0; } }
          /* From the centre to node B, reappear at node A, back to the centre,
             then rest. The rest pose (centre) is the last frame on purpose. */
          @keyframes nxlogo-signal {
            0%   { transform: translate(0, 0); opacity: 1; }
            22%  { transform: translate(7px, 7px); opacity: 0; }
            23%  { transform: translate(-7px, -7px); opacity: 0; }
            45%  { transform: translate(0, 0); opacity: 1; }
            100% { transform: translate(0, 0); opacity: 1; }
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
