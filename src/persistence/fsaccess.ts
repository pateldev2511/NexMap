/**
 * `.nexmap` save/open via the File System Access API, with a first-class download/
 * upload fallback (eng review DA-E5).
 *
 * The fallback cliff is real: without FS Access (Firefox/Safari today), Save can't
 * write back to the original file — every save is a new download. We expose that
 * truthfully via `canWriteBack` so the UI can set expectations rather than pretend.
 */
import type { NexMapDocument } from '@/model/types';

// Minimal typing for the not-everywhere File System Access API.
interface FsWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  createWritable(): Promise<FsWritable>;
  getFile(): Promise<File>;
  name: string;
}
interface FsWindow {
  showSaveFilePicker?: (opts?: unknown) => Promise<FsFileHandle>;
  showOpenFilePicker?: (opts?: unknown) => Promise<FsFileHandle[]>;
}

const fsWin = window as unknown as FsWindow;

export const canWriteBack = typeof fsWin.showSaveFilePicker === 'function';
export const canOpenPicker = typeof fsWin.showOpenFilePicker === 'function';

function serialize(doc: NexMapDocument): string {
  return JSON.stringify(doc, null, 2);
}

function safeFileName(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'project';
  return `${base}.nexmap`;
}

export interface SavedFile {
  handle: FsFileHandle | null;
  fileName: string;
}

const PICKER_OPTS = {
  suggestedName: '',
  types: [{ description: 'NexMap project', accept: { 'application/json': ['.nexmap'] } }],
};

/**
 * Save to disk. If `handle` is given and writable, writes back to that file
 * (true Save). Otherwise opens a picker (FS Access) or downloads a file.
 */
export async function saveDocument(
  doc: NexMapDocument,
  handle: FsFileHandle | null,
): Promise<SavedFile> {
  const data = serialize(doc);
  const fileName = safeFileName(doc.project.name);

  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    return { handle, fileName: handle.name };
  }

  if (fsWin.showSaveFilePicker) {
    const picked = await fsWin.showSaveFilePicker({ ...PICKER_OPTS, suggestedName: fileName });
    const writable = await picked.createWritable();
    await writable.write(data);
    await writable.close();
    return { handle: picked, fileName: picked.name };
  }

  // Fallback: trigger a download.
  downloadText(data, fileName);
  return { handle: null, fileName };
}

export interface OpenedFile {
  text: string;
  handle: FsFileHandle | null;
  fileName: string;
}

/** Open via FS Access picker if available; otherwise the caller uses a file input. */
export async function openWithPicker(): Promise<OpenedFile | null> {
  if (!fsWin.showOpenFilePicker) return null;
  const [handle] = await fsWin.showOpenFilePicker(PICKER_OPTS);
  if (!handle) return null;
  const file = await handle.getFile();
  return { text: await file.text(), handle, fileName: handle.name };
}

function downloadText(data: string, fileName: string): void {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type { FsFileHandle };
