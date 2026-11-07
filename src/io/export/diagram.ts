/**
 * The one diagram render every network export shares: the Export dialog's live
 * preview, the SVG/PNG/JPG/PDF/HTML files, and the ZIP package's diagram.svg/.png/
 * .pdf. One builder and one option set, so what the preview shows is what each
 * file contains (projection, style, labels, risk tint, title block).
 */
import type { StrokeHealth } from '@/canvas/connector';
import type { CanvasObject, Device, Link } from '@/model/types';
import { buildSvg } from './buildSvg';

export interface DiagramScene {
  devices: Device[];
  links: Link[];
  objects: CanvasObject[];
  /** Lettered in the blueprint title block. */
  projectName: string;
}

export interface DiagramRenderOptions {
  background: string | null; // null = transparent (png/svg)
  includeLabels: boolean;
  /** Render the isometric projection, or the blueprint sheet, instead of the flat scene. */
  projection?: 'flat' | 'iso' | 'blueprint';
  /** Topology-health context to tint risky links (null = no tint). */
  health?: StrokeHealth | null;
  /** Modern styling (dot-grid, rounded zone cards, node chips, callout cards). */
  modern?: boolean;
}

/** Today as YYYY-MM-DD in the user's own time zone — the blueprint title block's date. */
export function localDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function buildDiagramSvg(
  scene: DiagramScene,
  opts: DiagramRenderOptions,
  date: string = localDate(),
): string {
  return buildSvg(scene.devices, scene.links, {
    background: opts.background,
    includeLabels: opts.includeLabels,
    objects: scene.objects,
    projection: opts.projection,
    health: opts.health,
    modern: opts.modern,
    title: scene.projectName,
    date,
  });
}
