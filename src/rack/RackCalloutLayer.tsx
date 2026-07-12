import { memo } from 'react';
import type { TextObject } from '@/model/types';
import { calloutRowsOrPlaceholder, rowAnchor } from '@/model/callout';
import {
  DEFAULT_LEADER,
  leaderDashArray,
  leaderGeometry,
  type LeaderRect,
} from '@/model/leader';

/** Scene-space bbox of a rack device, keyed by id (from RackCanvas layout). */
export interface RackRectLookup {
  (id: string): LeaderRect | null;
}

interface RackCalloutLayerProps {
  callouts: TextObject[];
  deviceRect: RackRectLookup;
}

/**
 * Rack-scoped callouts (rackScope === this rack) drawn on the elevation: a card
 * box with the shared calloutRows text + a leader to the anchored device. Lives
 * OUTSIDE the memoized RackFocusScene so editing one callout never re-renders the
 * faceplate art. Layout matches buildRackSvg's callout pass — one look, two hosts.
 */
function RackCalloutLayerImpl({ callouts, deviceRect }: RackCalloutLayerProps) {
  return (
    <g>
      {callouts.map((o) => {
        const box: LeaderRect = { x: o.x, y: o.y, width: o.width, height: o.height };
        const target =
          o.anchor?.type === 'device'
            ? deviceRect(o.anchor.id)
            : o.anchor?.type === 'point'
              ? { x: o.anchor.x, y: o.anchor.y, width: 0, height: 0 }
              : null;
        const leader = target && leaderGeometry(box, target);
        const style = o.leader ?? DEFAULT_LEADER;
        const fs = o.fontSize ?? 13;
        const rows = calloutRowsOrPlaceholder(o.blocks, fs);
        let y = o.y;
        return (
          <g key={o.id} data-callout-id={o.id}>
            {leader && (
              <line
                data-leader-for={o.id}
                x1={leader.x1}
                y1={leader.y1}
                x2={leader.x2}
                y2={leader.y2}
                stroke={style.color}
                strokeWidth={style.width}
                strokeLinecap="round"
                strokeDasharray={leaderDashArray(style)}
                fill="none"
              />
            )}
            <rect
              x={o.x}
              y={o.y}
              width={o.width}
              height={o.height}
              rx={4}
              fill="#ffffff"
              fillOpacity={0.94}
              stroke="#cbd5e1"
              strokeWidth={1}
            />
            {rows.map((r, i) => {
              y += r.size * 1.25;
              const a = rowAnchor(r.align, o.x, o.width, 6);
              return (
                <text
                  key={i}
                  x={a.x}
                  y={y}
                  textAnchor={a.anchor}
                  fontSize={r.size}
                  fontWeight={r.weight}
                  fontFamily={r.mono ? 'monospace' : 'ui-sans-serif,system-ui,sans-serif'}
                  fill={r.muted ? '#64748b' : (o.color ?? '#1c2733')}
                >
                  {r.runs.map((run, j) => (
                    <tspan
                      key={j}
                      fontWeight={run.bold ? 700 : undefined}
                      fontStyle={run.italic ? 'italic' : undefined}
                      fontFamily={run.mono ? 'monospace' : undefined}
                    >
                      {run.text}
                    </tspan>
                  ))}
                </text>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

export const RackCalloutLayer = memo(RackCalloutLayerImpl);
