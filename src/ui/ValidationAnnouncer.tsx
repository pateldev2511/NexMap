import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { ANNOUNCE_EVENT } from './announce';

/**
 * Screen-reader announcer for validation. The canvas is visual; this gives
 * non-sighted users the same "your diagram has N errors / M warnings" feedback
 * via a polite live region (visually hidden, announced on change). It also
 * voices transient canvas feedback routed through announce() — e.g. a
 * rejected rack drop's reason, which must outlive its 2.4s visual flash.
 */
export function ValidationAnnouncer() {
  const issues = useProjectStore((s) => s.issues);
  const [transient, setTransient] = useState<string | null>(null);

  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text === 'string' && text) setTransient(text);
    };
    window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
    return () => window.removeEventListener(ANNOUNCE_EVENT, onAnnounce);
  }, []);

  const message = useMemo(() => {
    const errors = issues.filter(
      (i) => i.severity === 'error' || i.severity === 'critical',
    ).length;
    const warnings = issues.filter((i) => i.severity === 'warn').length;
    if (errors === 0 && warnings === 0) return 'Diagram valid: no issues.';
    const parts: string[] = [];
    if (errors) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
    if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
    return `Validation: ${parts.join(', ')}.`;
  }, [issues]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {transient ? `${transient} — ${message}` : message}
    </div>
  );
}
