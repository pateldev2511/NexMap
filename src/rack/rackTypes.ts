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
}

export const RACK_PRESETS: readonly RackPreset[] = [
  {
    id: 'std-42u',
    label: '42U · 19" 4-post enclosed',
    ruHeight: 42,
    postType: 'four-post',
    widthIn: 19,
    hint: 'Full-height data-center cabinet',
  },
  {
    id: 'std-24u',
    label: '24U · 19" 4-post',
    ruHeight: 24,
    postType: 'four-post',
    widthIn: 19,
    hint: 'Half-height IDF cabinet',
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
    hint: 'Small office / closet',
  },
  {
    id: 'wall-6u',
    label: '6U · 19" wall-mount',
    ruHeight: 6,
    postType: 'wall',
    widthIn: 19,
    hint: 'Home lab / branch',
  },
  {
    id: 'wide-42u',
    label: '42U · 23" 4-post',
    ruHeight: 42,
    postType: 'four-post',
    widthIn: 23,
    hint: 'Wide (carrier / 23") cabinet',
  },
] as const;

export const DEFAULT_RACK_PRESET: RackPreset = RACK_PRESETS[0]!;

export function rackPresetById(id: string | undefined): RackPreset | undefined {
  return RACK_PRESETS.find((p) => p.id === id);
}

/** Build the Rack-shaped fields (name aside) for a chosen preset. */
export function rackFieldsFromPreset(preset: RackPreset): Pick<
  Rack,
  'ruHeight' | 'postType' | 'widthIn' | 'presetId'
> {
  return {
    ruHeight: preset.ruHeight,
    postType: preset.postType,
    widthIn: preset.widthIn,
    presetId: preset.id,
  };
}
