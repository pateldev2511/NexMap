import { useProjectStore } from '@/store/projectStore';
import { NexIcon } from './icons/NexIcon';
import shell from './shell/AppShell.module.css';

/**
 * Multi-view switcher (Phase 5). A view is a saved perspective — which layers are
 * visible + the camera. Switching applies it; "Save view" snapshots the current
 * state; delete removes the active view.
 */
export function ViewSwitcher() {
  useProjectStore((s) => s.rev);
  const active = useProjectStore((s) => s.activeViewId);
  const s = useProjectStore.getState;
  const views = s().viewsAll();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <select
        className={shell.topbarBtn}
        value={active ?? ''}
        onChange={(e) => {
          if (e.target.value) s().applyView(e.target.value);
        }}
        title="Switch view"
        style={{ maxWidth: 140 }}
      >
        <option value="">{views.length ? 'Views…' : 'No views'}</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      <button
        className={shell.topbarBtn}
        title="Save current layers + camera as a view"
        aria-label="Save current view"
        onClick={() => {
          const name = prompt('View name', `View ${views.length + 1}`);
          if (name) s().addView(name);
        }}
      >
        <NexIcon name="plus" />
      </button>
      {active && (
        <button
          className={shell.topbarBtn}
          title="Delete current view"
          aria-label="Delete current view"
          onClick={() => s().deleteView(active)}
        >
          <NexIcon name="close" />
        </button>
      )}
    </div>
  );
}
