/**
 * Shared typing for the dev/e2e debug store hook exposed on `window.__nexmap`.
 * Loosely but non-`any` typed — just the methods the specs drive.
 */
export interface NexTestStore {
  addText(x: number, y: number): string;
  addDeviceAt(type: string, x: number, y: number): string;
  updateObject(id: string, before: unknown, after: unknown): void;
  getObject(id: string): { blocks: unknown[]; anchor?: unknown } & Record<string, unknown>;
  endEdit?(): void;
  select(ids: string[]): void;
  devicesAll(): { id: string }[];
  objectsAll(): { id: string; kind: string; rackScope?: string }[];
  annotateRack(rackId: string, side?: 'front' | 'rear'): number;
  newProject?(iso: string): void;
}

export interface NexWindow {
  __nexmap: { getState(): NexTestStore };
}
