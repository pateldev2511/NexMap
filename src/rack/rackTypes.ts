/**
 * Rack form-factor presets (rack designer, schema v3).
 *
 * These live in CODE, not the .nexmap document — only a rack's CHOSEN preset id +
 * resolved fields persist per-rack. The library "rack type" picker is built from this
 * list. Keep them realistic and few; users can still set a custom ruHeight.
 */
import type { Rack } from '@/model/types';

export interface RackPreset {
  id: string;
  label: string;
  ruHeight: number;
  postType: NonNullable<Rack['postType']>;
  widthIn: NonNullable<Rack['widthIn']>;
  /** One-line description for the picker. */
  hint: string;
  /**
   * Typical usable mounting depth (mm) for this kind of rack — a starting point the
   * user can change per rack. Absent for open two-post racks: no depth limit there.
   */
  depthMm?: number;
}

export const RACK_PRESETS: readonly RackPreset[] = [
  {
    id: 'std-42u',
    label: '42U · 19" 4-post enclosed',
    ruHeight: 42,
    postType: 'four-post',
    widthIn: 19,
    hint: 'Full-height data-center cabinet · ~900 mm usable',
    depthMm: 900,
  },
  {
    id: 'std-24u',
    label: '24U · 19" 4-post',
    ruHeight: 24,
    postType: 'four-post',
    widthIn: 19,
    hint: 'Half-height IDF cabinet · ~550 mm usable',
    depthMm: 550,
  },
  {
    id: 'std-24u-deep',
    label: '24U · 19" 4-post server',
    ruHeight: 24,
    postType: 'four-post',
    widthIn: 19,
    hint: 'Half-height server cabinet · ~915 mm usable',
    depthMm: 915,
  },
  {
    id: 'open-42u',
    label: '42U · 19" open 2-post',
    ruHeight: 42,
    postType: 'two-post',
    widthIn: 19,
    hint: 'Open relay rack (telco / patching)',
  },
  {
    id: 'wall-12u',
    label: '12U · 19" wall-mount',
    ruHeight: 12,
    postType: 'wall',
    widthIn: 19,
    hint: 'Small office / closet · ~400 mm usable',
    depthMm: 400,
  },
  {
    id: 'wall-6u',
    label: '6U · 19" wall-mount',
    ruHeight: 6,
    postType: 'wall',
    widthIn: 19,
    hint: 'Home lab / branch · ~300 mm usable',
    depthMm: 300,
  },
  {
    id: 'wide-42u',
    label: '42U · 23" 4-post',
    ruHeight: 42,
    postType: 'four-post',
    widthIn: 23,
    hint: 'Wide (carrier / 23") cabinet · ~900 mm usable',
    depthMm: 900,
  },
] as const;

export const DEFAULT_RACK_PRESET: RackPreset = RACK_PRESETS[0]!;

export function rackPresetById(id: string | undefined): RackPreset | undefined {
  return RACK_PRESETS.find((p) => p.id === id);
}

/** Build the Rack-shaped fields (name aside) for a chosen preset. */
export function rackFieldsFromPreset(preset: RackPreset): Pick<
  Rack,
  'ruHeight' | 'postType' | 'widthIn' | 'presetId' | 'depthMm'
> {
  return {
    ruHeight: preset.ruHeight,
    postType: preset.postType,
    widthIn: preset.widthIn,
    presetId: preset.id,
    // A preset's depth replaces the rack's (an open two-post clears it: no limit).
    depthMm: preset.depthMm,
  };
}
