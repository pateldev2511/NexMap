import { useProjectStore } from '@/store/projectStore';
import styles from './LayersPanel.module.css';

/**
 * Layer management (Phase 5). Active layer receives new objects; eye toggles
 * visibility (hidden layers don't render); lock prevents move/delete on the layer.
 * Top of the list renders in front (higher order). Layer config is saved to
 * `.nexmap` and participates in undo/redo.
 */
export function LayersPanel() {
  useProjectStore((s) => s.rev);
  const active = useProjectStore((s) => s.activeLayerId);
  const s = useProjectStore.getState;
  // Render front-most (highest order) at the top.
  const layers = [...s().layersAll()].reverse();

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span>Layers</span>
        <button
          className={styles.add}
          onClick={() => s().addLayer()}
          title="Add layer"
          aria-label="Add layer"
        >
          +
        </button>
      </div>
      <div className={styles.list}>
        {layers.map((l, i) => {
          const visible = s().isLayerVisible(l.id);
          return (
            <div
              key={l.id}
              className={`${styles.row} ${l.id === active ? styles.active : ''}`}
              onClick={() => s().setActiveLayer(l.id)}
            >
              <button
                className={`${styles.iconBtn} ${visible ? '' : styles.off}`}
                onClick={(e) => {
                  e.stopPropagation();
                  s().setLayerVisible(l.id, !visible);
                }}
                title={visible ? 'Hide layer' : 'Show layer'}
                aria-label={visible ? 'Hide layer' : 'Show layer'}
              >
                {visible ? '👁' : '🚫'}
              </button>
              <button
                className={`${styles.iconBtn} ${l.locked ? '' : styles.off}`}
                onClick={(e) => {
                  e.stopPropagation();
                  s().setLayerLocked(l.id, !l.locked);
                }}
                title={l.locked ? 'Unlock layer' : 'Lock layer'}
                aria-label={l.locked ? 'Unlock layer' : 'Lock layer'}
              >
                {l.locked ? '🔒' : '🔓'}
              </button>
              <input
                className={styles.name}
                value={l.name}
                onChange={(e) => s().renameLayer(l.id, e.target.value)}
                onBlur={() => s().endEdit()}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                className={styles.iconBtn}
                disabled={i === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  s().moveLayer(l.id, 1);
                }}
                title="Move up (front)"
                aria-label="Move layer up"
              >
                ↑
              </button>
              <button
                className={styles.iconBtn}
                disabled={i === layers.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  s().moveLayer(l.id, -1);
                }}
                title="Move down (back)"
                aria-label="Move layer down"
              >
                ↓
              </button>
              {layers.length > 1 && (
                <button
                  className={`${styles.iconBtn} ${styles.del}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      confirm(`Delete layer "${l.name}"? Objects move to another layer.`)
                    )
                      s().deleteLayer(l.id);
                  }}
                  title="Delete layer"
                  aria-label="Delete layer"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
