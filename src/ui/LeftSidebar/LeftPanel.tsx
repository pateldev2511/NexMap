import { Library } from './Library';
import { LayersPanel } from './LayersPanel';

/** Left sidebar: the object library on top, the layers panel docked below. */
export function LeftPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Library />
      </div>
      <LayersPanel />
    </div>
  );
}
