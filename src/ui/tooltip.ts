/**
 * Dependency-free tooltip singleton (W7). ONE absolutely-positioned element on
 * document.body, populated + positioned by pointerenter/focusin on any element
 * carrying `data-tip` (or a native `title`, which we migrate on first hover). Being
 * on the body it is immune to ancestor overflow clipping — the exact bug class that
 * ate the More menu — unlike `::after` tooltips. Flips at the viewport edge, ~300ms
 * delay, and stays out of the way on touch (`pointer: coarse`). `aria-label` is kept
 * in sync so screen readers still announce, and the native `title` is removed so the
 * browser's own tooltip never double-shows.
 */
const DELAY_MS = 300;

export function installTooltips(): () => void {
  // Touch devices get no hover tooltips (they'd stick); also bail in non-DOM tests.
  if (typeof document === 'undefined') return () => {};
  if (window.matchMedia?.('(pointer: coarse)').matches) return () => {};

  const tip = document.createElement('div');
  tip.id = 'nex-tooltip';
  tip.setAttribute('role', 'tooltip');
  Object.assign(tip.style, {
    position: 'fixed',
    zIndex: '2147483000',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 90ms ease',
    maxWidth: '260px',
    padding: '4px 8px',
    borderRadius: '6px',
    background: '#0f172a',
    color: '#f8fafc',
    font: '500 12px ui-sans-serif, system-ui, sans-serif',
    lineHeight: '1.35',
    boxShadow: '0 4px 14px rgba(2,6,23,0.35)',
    whiteSpace: 'normal',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(tip);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: HTMLElement | null = null;

  const position = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let top = r.bottom + 6; // below by default
    if (top + t.height > window.innerHeight - 4) top = r.top - t.height - 6; // flip above
    if (top < 4) top = 4;
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - t.width - 4));
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
  };

  const show = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text) return;
    tip.textContent = text;
    tip.style.opacity = '1';
    position(el);
  };

  const hide = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    tip.style.opacity = '0';
    current = null;
  };

  const enter = (e: Event) => {
    const start = e.target as Element | null;
    const el = start?.closest?.('[data-tip],[title]') as HTMLElement | null;
    if (!el || el === current) return;
    // Migrate a native title once: keep the name for a11y, kill the native tooltip.
    if (el.hasAttribute('title')) {
      const t = el.getAttribute('title') ?? '';
      if (t) {
        el.dataset.tip = t;
        // Only supply an accessible name when the control has none of its own —
        // adding aria-label to a text button would HIJACK its name to the title.
        if (!el.getAttribute('aria-label') && !el.textContent?.trim()) {
          el.setAttribute('aria-label', t);
        }
      }
      el.removeAttribute('title');
    }
    if (!el.dataset.tip) return;
    current = el;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => show(el), DELAY_MS);
  };

  const leave = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.('[data-tip]');
    if (el === current) hide();
  };

  document.addEventListener('pointerover', enter, true);
  document.addEventListener('focusin', enter, true);
  document.addEventListener('pointerout', leave, true);
  document.addEventListener('focusout', hide, true);
  document.addEventListener('pointerdown', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);

  return () => {
    document.removeEventListener('pointerover', enter, true);
    document.removeEventListener('focusin', enter, true);
    document.removeEventListener('pointerout', leave, true);
    document.removeEventListener('focusout', hide, true);
    document.removeEventListener('pointerdown', hide, true);
    window.removeEventListener('scroll', hide, true);
    window.removeEventListener('blur', hide);
    tip.remove();
  };
}
