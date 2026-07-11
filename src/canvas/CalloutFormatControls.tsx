import { useProjectStore } from '@/store/projectStore';
import { NexIcon } from '@/ui/icons/NexIcon';
import { ToolbarSep } from '@/ui/SelectionToolbar';
import {
  bodyKind,
  calloutAlign,
  hasMark,
  setBodyKind,
  setCalloutAlign,
  toggleMark,
  type BodyKind,
} from '@/model/callout';
import { DEFAULT_LEADER } from '@/model/leader';
import type { BlockAlign, CalloutBlock, LeaderStyle, RichMark, TextObject } from '@/model/types';

/**
 * Rich-callout formatting, shown in the floating selection toolbar when exactly
 * one text object is selected. Block-granular v1: marks / alignment / list-kind
 * apply to the whole callout; leader color + dash set the pointer style. Each
 * click is one undo entry (updateObject + endEdit).
 */
export function CalloutFormatControls({
  id,
  anchoring,
  onBeginAttach,
  onDetach,
}: {
  id: string;
  anchoring: boolean;
  onBeginAttach: () => void;
  onDetach: () => void;
}) {
  const store = useProjectStore.getState;
  const o = store().getObject(id);
  if (!o || o.kind !== 'text') return null;
  const callout = o as TextObject;
  const blocks = callout.blocks;
  const anchored = !!callout.anchor;

  const applyBlocks = (fn: (b: CalloutBlock[]) => CalloutBlock[]) => {
    store().updateObject(id, { blocks: callout.blocks }, { blocks: fn(callout.blocks) });
    store().endEdit();
  };
  const setLeader = (patch: Partial<LeaderStyle>) => {
    const cur = callout.leader ?? DEFAULT_LEADER;
    store().updateObject(id, { leader: callout.leader }, { leader: { ...cur, ...patch } });
    store().endEdit();
  };

  const mark = (label: string, m: RichMark, extra?: React.CSSProperties) => (
    <button
      title={`${label} (whole callout)`}
      aria-label={label}
      aria-pressed={hasMark(blocks, m)}
      onClick={() => applyBlocks((b) => toggleMark(b, m))}
      style={extra}
    >
      {label === 'Code' ? '</>' : label[0]}
    </button>
  );

  const curKind = bodyKind(blocks);
  const listBtn = (label: string, kind: BodyKind, glyph: string) => (
    <button
      title={label}
      aria-label={label}
      aria-pressed={curKind === kind}
      onClick={() => applyBlocks((b) => setBodyKind(b, curKind === kind ? 'paragraph' : kind))}
    >
      {glyph}
    </button>
  );

  const curAlign = calloutAlign(blocks) ?? 'left';
  const alignBtn = (a: BlockAlign, icon: Parameters<typeof NexIcon>[0]['name'], label: string) => (
    <button
      title={label}
      aria-label={label}
      aria-pressed={curAlign === a}
      onClick={() => applyBlocks((b) => setCalloutAlign(b, a))}
    >
      <NexIcon name={icon} />
    </button>
  );

  const leader = callout.leader ?? DEFAULT_LEADER;
  return (
    <>
      {mark('Bold', 'bold', { fontWeight: 700 })}
      {mark('Italic', 'italic', { fontStyle: 'italic' })}
      {mark('Code', 'code')}
      <ToolbarSep />
      {listBtn('Bulleted list', 'bullets', '•')}
      {listBtn('Numbered list', 'numbers', '1.')}
      {listBtn('Code block', 'code', '{ }')}
      <ToolbarSep />
      {alignBtn('left', 'align-left', 'Align left')}
      {alignBtn('center', 'align-hcenter', 'Align center')}
      {alignBtn('right', 'align-right', 'Align right')}
      <ToolbarSep />
      <input
        type="color"
        aria-label="Leader color"
        title="Leader color"
        value={leader.color}
        onChange={(e) => setLeader({ color: e.target.value })}
      />
      <select
        aria-label="Leader style"
        title="Leader line style"
        value={leader.dash}
        onChange={(e) => setLeader({ dash: e.target.value as LeaderStyle['dash'] })}
      >
        <option value="dotted">Dotted</option>
        <option value="dashed">Dashed</option>
        <option value="solid">Solid</option>
      </select>
      <button
        title={anchoring ? 'Click a device to attach…' : 'Attach leader to a device'}
        aria-label="Attach leader"
        aria-pressed={anchoring}
        onClick={onBeginAttach}
      >
        ⇢
      </button>
      {anchored && (
        <button title="Detach leader" aria-label="Detach leader" onClick={onDetach}>
          ⇠
        </button>
      )}
    </>
  );
}
