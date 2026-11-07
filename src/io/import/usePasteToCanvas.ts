import { useEffect } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { isTextTarget } from '@/input/router';
import { importPastedCsv, looksLikeCsv } from './clipboardImport';
import { pasteSource, writeMarkerOnEvent } from './canvasClipboard';

const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * The network canvases that are mounted, newest last, each saying whether it is
 * read-only (presentation). Canvas registers itself (registerPasteCanvas); paste
 * reads the newest at event time and again when an async image import lands.
 */
const canvases: { readOnly: boolean }[] = [];

/** Register a mounted network canvas as the paste target. Returns the unregister. */
export function registerPasteCanvas(target: { readOnly: boolean }): () => void {
  canvases.push(target);
  return () => {
    const i = canvases.lastIndexOf(target);
    if (i >= 0) canvases.splice(i, 1);
  };
}

const activeCanvas = () => canvases[canvases.length - 1] ?? null;
/**
 * No paste of any kind on a read-only canvas (presentation, #35) or in a view-only
 * tab, where another tab is the writer (#24).
 */
const pasteLocked = () =>
  (activeCanvas()?.readOnly ?? false) || useProjectStore.getState().readOnly;

/**
 * Paste-to-canvas (Stage 2). The ONE place keyboard paste is decided (#52) — the
 * canvas's ⌘V keydown no longer preventDefaults, so the browser's paste event
 * always arrives here carrying the system clipboard:
 *  - the canvas's own copy marker → internal device paste (store.paste)
 *  - clipboard image              → raster background underlay (size-clamped by store.addImage)
 *  - clipboard CSV                → devices/links/subnets/vlans via the shared CSV model
 *  - nothing importable           → the internal clipboard, if there is one
 * (see canvasClipboard for why the marker tells "copied here" from "copied elsewhere since").
 *
 * Normal paste inside form fields is left alone, and a read-only canvas ignores
 * paste entirely — including an image import still decoding when presenting began.
 * All applies are single, undoable transactions.
 */
export function usePasteToCanvas(): void {
  useEffect(() => {
    function pasteInternal(e: ClipboardEvent) {
      e.preventDefault();
      const store = useProjectStore.getState();
      store.paste();
      store.runValidation();
    }

    function onPaste(e: ClipboardEvent) {
      if (isTextTarget(e.target)) return; // let the field handle its own paste
      if (pasteLocked()) return; // presenting, or a view-only tab
      const store = useProjectStore.getState();
      // The internal clipboard pastes onto a mounted network canvas only.
      const internal = !!activeCanvas() && store.hasClipboard();
      const src = pasteSource(e.clipboardData, internal);
      if (src.kind === 'none') return;
      if (src.kind === 'internal') {
        pasteInternal(e);
        return;
      }

      // 1) Image → underlay.
      if (src.kind === 'image') {
        const file = src.file;
        if (file && file.size > 0 && file.size <= IMAGE_MAX_BYTES) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = () => {
            const href = reader.result as string;
            const img = new Image();
            // Decoding is async: re-check, presentation may have begun meanwhile.
            const add = (w: number, h: number) => {
              if (!pasteLocked()) useProjectStore.getState().addImage(href, w, h);
            };
            img.onload = () => add(img.naturalWidth || 400, img.naturalHeight || 300);
            img.onerror = () => add(400, 300);
            img.src = href;
          };
          reader.readAsDataURL(file);
        }
        return;
      }

      // 2) CSV text → model objects via the shared CSV path.
      const res = looksLikeCsv(src.text)
        ? importPastedCsv(src.text, store.defaultLayerId(), store.devicesAll())
        : null;
      if (!res) {
        if (internal) pasteInternal(e); // plain text isn't an import: paste the canvas copy
        return;
      }
      e.preventDefault();
      if (res.devices.length || res.links.length) store.importObjects(res.devices, res.links);
      if (res.subnets.length || res.vlans.length) store.importSemantics(res.subnets, res.vlans);
      if (res.devices.length) store.select(res.devices.map((d) => d.id));
      store.runValidation();
    }

    // The native copy/cut that follows a canvas ⌘C/⌘X writes the marker.
    function onCopyOrCut(e: ClipboardEvent) {
      if (isTextTarget(e.target)) return; // field copy is native
      if (!activeCanvas() || !useProjectStore.getState().hasClipboard()) return;
      writeMarkerOnEvent(e);
    }

    window.addEventListener('paste', onPaste);
    window.addEventListener('copy', onCopyOrCut);
    window.addEventListener('cut', onCopyOrCut);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('copy', onCopyOrCut);
      window.removeEventListener('cut', onCopyOrCut);
    };
  }, []);
}
