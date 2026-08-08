import { Library } from './Library';
import { LayersPanel } from './LayersPanel';
import { LocationsPanel } from './LocationsPanel';

/**
 * Left sidebar: the object library on top, then the location navigator, then
 * layers. Locations sit above layers because they answer "where am I?" (physical
 * navigation) while layers answer "what shows?" (render control).
 */
export function LeftPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Library />
      </div>
      <LocationsPanel />
      <LayersPanel />
    </div>
  );
}
