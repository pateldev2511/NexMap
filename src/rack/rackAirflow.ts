/**
 * Airflow / hot-aisle hinting (Milestone D). Data-center gear pulls cool air from the cold
 * aisle and exhausts hot air to the hot aisle. A rack should move air in ONE direction; a
 * device mounted backwards exhausts INTO its neighbours' intake — a hot-aisle violation that
 * cooks hardware. This derives those violations from an optional, additive `airflow` field.
 *
 * Pure and schema-light: `airflow` defaults to 'front-to-rear' (the overwhelming convention),
 * so existing racks read as uniform until a user marks a device otherwise. 'side' airflow
 * (some switches) is informational and never counts as a violation on its own.
 */
import type { Device } from '@/model/types';

export type Airflow = 'front-to-rear' | 'rear-to-front' | 'side';

export interface AirflowViolation {
  deviceId: string;
  airflow: Airflow;
  /** The rack's dominant direction this device fights. */
  dominant: Airflow;
}

export function airflowOf(d: Device): Airflow {
  return (d.airflow as Airflow | undefined) ?? 'front-to-rear';
}

/**
 * Devices in this set whose airflow opposes the rack's dominant front/rear direction.
 * 'side'-airflow gear is ignored (neither dominant nor a violation). When front-to-rear and
 * rear-to-front are tied, front-to-rear is treated as correct (the cold-aisle convention),
 * so the rear-to-front devices are the violations.
 */
export function airflowViolations(devices: Device[]): AirflowViolation[] {
  let f2r = 0;
  let r2f = 0;
  for (const d of devices) {
    const a = airflowOf(d);
    if (a === 'front-to-rear') f2r++;
    else if (a === 'rear-to-front') r2f++;
  }
  // No directional gear, or all one way → nothing fights anything.
  if (f2r === 0 || r2f === 0) return [];
  const dominant: Airflow = f2r >= r2f ? 'front-to-rear' : 'rear-to-front';
  const offending: Airflow = dominant === 'front-to-rear' ? 'rear-to-front' : 'front-to-rear';
  return devices
    .filter((d) => airflowOf(d) === offending)
    .map((d) => ({ deviceId: d.id, airflow: offending, dominant }));
}

export const AIRFLOW_LABEL: Record<Airflow, string> = {
  'front-to-rear': 'Front → rear (standard)',
  'rear-to-front': 'Rear → front (reversed)',
  side: 'Side / passive',
};
