import { useEffect } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { importPastedCsv, looksLikeCsv } from './clipboardImport';

const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Paste-to-canvas (Stage 2). A global paste listener:
 *  - clipboard image  → raster background underlay (size-clamped by store.addImage)
 *  - clipboard CSV    → devices/links/subnets/vlans via the shared CSV model
 *
 * It defers to the internal device clipboard (Cmd+V of copied devices) and to normal
 * paste inside form fields, so it never hijacks expected behavior. All applies are
 * single, undoable transactions.
 */
export function usePasteToCanvas(): void {
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
      ) {
        return; // let the field handle its own paste
      }
      const store = useProjectStore.getState();
      if (store.hasClipboard()) return; // internal copied-devices paste wins (Cmd+V)

      const dt = e.clipboardData;
      if (!dt) return;

      // 1) Image → underlay.
      const imageItem = Array.from(dt.items).find((it) => it.kind === 'file' && it.type.startsWith('image/'));
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file && file.size > 0 && file.size <= IMAGE_MAX_BYTES) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = () => {
            const href = reader.result as string;
            const img = new Image();
            img.onload = () => store.addImage(href, img.naturalWidth || 400, img.naturalHeight || 300);
            img.onerror = () => store.addImage(href, 400, 300);
            img.src = href;
          };
          reader.readAsDataURL(file);
        }
        return;
      }

      // 2) CSV text → model objects via the shared CSV path.
      const text = dt.getData('text/plain');
      if (!text || !looksLikeCsv(text)) return;
      const res = importPastedCsv(text, store.defaultLayerId(), store.devicesAll());
      if (!res) return;
      e.preventDefault();
      if (res.devices.length || res.links.length) store.importObjects(res.devices, res.links);
      if (res.subnets.length || res.vlans.length) store.importSemantics(res.subnets, res.vlans);
      if (res.devices.length) store.select(res.devices.map((d) => d.id));
      store.runValidation();
    }

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
}
