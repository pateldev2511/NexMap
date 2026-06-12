/**
 * Pre-made rack template picker (schema v3). Grouped by tier (Home / Office / Enterprise);
 * clicking a card appends that template's racks to the row via store.applyRackTemplate.
 * Used in the empty state (quick-start) and as a toolbar overlay once racks exist.
 */
import { RACK_TIERS, TIER_LABEL, templatesByTier, type RackTemplate } from './rackTemplates';
import styles from './RackDesigner.module.css';

export interface RackTemplatePickerProps {
  onApply: (template: RackTemplate) => void;
  onClose?: () => void;
}

export function RackTemplatePicker({ onApply, onClose }: RackTemplatePickerProps) {
  return (
    <div className={styles.templatePanel} role="group" aria-label="Rack templates">
      <div className={styles.templateHead}>
        <span>Start from a template</span>
        {onClose && (
          <button className={styles.btn} onClick={onClose} aria-label="Close templates">✕</button>
        )}
      </div>
      {RACK_TIERS.map((tier) => (
        <div key={tier} className={styles.templateTier}>
          <div className={styles.templateTierLabel}>{TIER_LABEL[tier]}</div>
          <div className={styles.templateGrid}>
            {templatesByTier(tier).map((t) => (
              <button
                key={t.id}
                className={styles.templateCard}
                onClick={() => onApply(t)}
                title={t.hint}
              >
                <b>{t.label}</b>
                <span>{t.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
