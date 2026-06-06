/**
 * Self-contained HTML export — NexMap's distribution lever. Wraps a rendered SVG in a
 * single standalone .html file with a tiny read-only pan/zoom viewer: opens in any
 * browser, no NexMap install, and stays 100% local (a strict CSP in the file itself
 * blocks any network access). Lets a `.nexmap` diagram be shared without the app.
 *
 * Pure string builder so it's unit-testable. The SVG is embedded inline verbatim.
 */

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
}

// Minified inline viewer: wheel to zoom, drag to pan. No dependencies.
const VIEWER_SCRIPT = `(function(){var st=document.getElementById('nx-stage');if(!st)return;var g=st.querySelector('svg');if(!g)return;g.style.transformOrigin='0 0';var s=1,tx=0,ty=0,down=false,lx=0,ly=0;function a(){g.style.transform='translate('+tx+'px,'+ty+'px) scale('+s+')';}st.addEventListener('wheel',function(e){e.preventDefault();var f=e.deltaY<0?1.1:0.9;s=Math.min(8,Math.max(0.1,s*f));a();},{passive:false});st.addEventListener('pointerdown',function(e){down=true;lx=e.clientX;ly=e.clientY;st.setPointerCapture&&st.setPointerCapture(e.pointerId);});window.addEventListener('pointermove',function(e){if(!down)return;tx+=e.clientX-lx;ty+=e.clientY-ly;lx=e.clientX;ly=e.clientY;a();});window.addEventListener('pointerup',function(){down=false;});var rb=document.getElementById('nx-reset');if(rb)rb.addEventListener('click',function(){s=1;tx=0;ty=0;a();});})();`;

/** Build a complete, self-contained HTML document embedding `svg` with a pan/zoom viewer. */
export function buildStandaloneHtml(svg: string, meta: StandaloneHtmlMeta): string {
  const title = escapeHtml(meta.projectName || 'NexMap diagram');
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
<main id="nx-stage">
${svg}
</main>
<footer>Scroll to zoom, drag to pan · Self-contained NexMap export — 100% local, no network.</footer>
<script>${VIEWER_SCRIPT}</script>
</body>
</html>`;
}
