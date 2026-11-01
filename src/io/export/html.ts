/**
 * Self-contained HTML export — NexMap's distribution lever. Wraps a rendered SVG in a
 * single standalone .html file with a tiny read-only pan/zoom viewer: opens in any
 * browser, no NexMap install, and stays 100% local (a strict CSP in the file itself
 * blocks any network access). Lets a `.nexmap` diagram be shared without the app.
 *
 * Pure string builder so it's unit-testable. The SVG is embedded inline verbatim.
 *
 * When the design declares rules, the file also carries them: a panel with the
 * verdict, each rule's status, and every offender with its reason. Clicking an
 * offender rings it on the diagram (devices carry data-id in the exported SVG),
 * so whoever receives the file sees what's broken without opening NexMap.
 */
import { rulesVerdict, type RuleReportEntry } from './rulesReport';

const HTML_ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESC[c]!);
}

export interface StandaloneHtmlMeta {
  projectName: string;
  deviceCount: number;
  linkCount: number;
  /** The declared rules, evaluated on the whole design; omitted or empty = no panel. */
  rules?: readonly RuleReportEntry[];
}

const STATUS_MARK: Record<RuleReportEntry['status'], string> = { met: '✓', broken: '✕', 'not checked': '?' };

function rulesPanel(rules: readonly RuleReportEntry[]): string {
  const items = rules
    .map((r) => {
      const offenders =
        r.offenders.length === 0
          ? ''
          : `<ul>${r.offenders
              .map(
                (o) =>
                  `<li><button type="button" aria-pressed="false" data-target="${escapeHtml(o.id)}">${escapeHtml(o.name)}</button> <span class="why">${escapeHtml(o.reason)}</span></li>`,
              )
              .join('')}</ul>`;
      const note =
        r.status === 'not checked'
          ? ' <span class="why">rule from a newer NexMap</span>'
          : r.detail
            ? ` <span class="why">${escapeHtml(r.detail)}</span>`
            : '';
      return `<li class="rule ${r.status === 'not checked' ? 'unchecked' : r.status}"><span class="mark" aria-hidden="true">${STATUS_MARK[r.status]}</span><span class="label">${escapeHtml(r.label)}</span><span class="sr"> — ${r.status}</span>${note}${offenders}</li>`;
    })
    .join('');
  return `<details id="nx-rules" open>
<summary>Rules · ${rulesVerdict(rules)}</summary>
<ol>${items}</ol>
<p class="why">Checked against the whole design when exported. Click a name to find it.</p>
</details>`;
}

// Minified inline viewer: wheel to zoom, drag to pan. No dependencies.
const VIEWER_SCRIPT = `(function(){var st=document.getElementById('nx-stage');if(!st)return;var g=st.querySelector('svg');if(!g)return;g.style.transformOrigin='0 0';var s=1,tx=0,ty=0,down=false,lx=0,ly=0;function a(){g.style.transform='translate('+tx+'px,'+ty+'px) scale('+s+')';}st.addEventListener('wheel',function(e){e.preventDefault();var f=e.deltaY<0?1.1:0.9;s=Math.min(8,Math.max(0.1,s*f));a();},{passive:false});st.addEventListener('pointerdown',function(e){down=true;lx=e.clientX;ly=e.clientY;st.setPointerCapture&&st.setPointerCapture(e.pointerId);});window.addEventListener('pointermove',function(e){if(!down)return;tx+=e.clientX-lx;ty+=e.clientY-ly;lx=e.clientX;ly=e.clientY;a();});window.addEventListener('pointerup',function(){down=false;});var rb=document.getElementById('nx-reset');if(rb)rb.addEventListener('click',function(){s=1;tx=0;ty=0;a();});function find(id){var n=g.querySelectorAll('[data-id]');for(var i=0;i<n.length;i++)if(n[i].getAttribute('data-id')===id)return n[i];return null;}var bs=document.querySelectorAll('#nx-rules [data-target]');for(var j=0;j<bs.length;j++)(function(b){var el=find(b.getAttribute('data-target'));if(!el){b.disabled=true;b.title='Not in this export';return;}b.addEventListener('click',function(){var on=g.querySelectorAll('.nx-hit');for(var k=0;k<on.length;k++)on[k].classList.remove('nx-hit');var was=b.getAttribute('aria-pressed')==='true';for(var m=0;m<bs.length;m++)bs[m].setAttribute('aria-pressed','false');if(!was){el.classList.add('nx-hit');b.setAttribute('aria-pressed','true');}});})(bs[j]);})();`;

/** Build a complete, self-contained HTML document embedding `svg` with a pan/zoom viewer. */
export function buildStandaloneHtml(svg: string, meta: StandaloneHtmlMeta): string {
  const title = escapeHtml(meta.projectName || 'NexMap diagram');
  const rules = meta.rules && meta.rules.length > 0 ? rulesPanel(meta.rules) : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${title} — NexMap</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
  body { display: flex; flex-direction: column; background: #f4f5f7; color: #1f2430; }
  @media (prefers-color-scheme: dark) { body { background: #14161c; color: #e6e8ee; } }
  header { display: flex; align-items: baseline; gap: 12px; padding: 10px 16px; border-bottom: 1px solid rgba(128,128,128,0.3); }
  header h1 { margin: 0; font-size: 15px; }
  header .meta { font-size: 12px; opacity: 0.7; }
  header .spacer { flex: 1; }
  header button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(128,128,128,0.4); background: transparent; color: inherit; cursor: pointer; }
  #nx-stage { flex: 1; overflow: hidden; touch-action: none; cursor: grab; display: grid; place-items: center; }
  #nx-stage:active { cursor: grabbing; }
  #nx-stage svg { max-width: 100%; max-height: 100%; }
  #nx-stage svg .nx-hit { filter: drop-shadow(0 0 3px #f5a524) drop-shadow(0 0 8px #f5a524); }
  .nx-body { flex: 1; display: flex; min-height: 0; }
  #nx-rules { flex: 0 0 340px; overflow: auto; font-size: 12px; border-left: 1px solid rgba(128,128,128,0.3); }
  #nx-rules:not([open]) { flex-basis: auto; }
  @media (max-width: 700px) { .nx-body { flex-direction: column; } #nx-rules { flex: 0 0 auto; max-height: 45%; border-left: 0; border-top: 1px solid rgba(128,128,128,0.3); } }
  #nx-rules summary { padding: 8px 12px; font-weight: 600; cursor: pointer; }
  #nx-rules ol { margin: 0; padding: 0 12px 4px; list-style: none; }
  #nx-rules .rule { padding: 6px 0; border-top: 1px solid rgba(128,128,128,0.2); }
  #nx-rules .mark { display: inline-block; width: 16px; font-weight: 700; }
  #nx-rules .met .mark { color: #2e9e5b; }
  #nx-rules .broken .mark { color: #d4483b; }
  #nx-rules .unchecked .mark { opacity: 0.6; }
  #nx-rules ul { margin: 4px 0 0 16px; padding: 0; list-style: none; }
  #nx-rules li li { padding: 2px 0; }
  #nx-rules button { font: inherit; padding: 0 4px; border: 0; border-radius: 4px; background: transparent; color: inherit; text-decoration: underline; cursor: pointer; }
  #nx-rules button[aria-pressed="true"] { background: rgba(245,165,36,0.3); }
  #nx-rules button:disabled { text-decoration: none; cursor: default; }
  #nx-rules .why { opacity: 0.7; }
  #nx-rules p { margin: 0; padding: 6px 12px 10px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  footer { padding: 6px 16px; font-size: 11px; opacity: 0.6; border-top: 1px solid rgba(128,128,128,0.3); }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <span class="meta">${meta.deviceCount} device${meta.deviceCount === 1 ? '' : 's'} · ${meta.linkCount} link${meta.linkCount === 1 ? '' : 's'}</span>
  <span class="spacer"></span>
  <button id="nx-reset" type="button">Reset view</button>
</header>
<div class="nx-body">
<main id="nx-stage">
${svg}
</main>
${rules}
</div>
<footer>Scroll to zoom, drag to pan · Self-contained NexMap export — 100% local, no network.</footer>
<script>${VIEWER_SCRIPT}</script>
</body>
</html>`;
}
