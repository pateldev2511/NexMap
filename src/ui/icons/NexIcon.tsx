import type { ReactNode, SVGProps } from 'react';

export type NexIconName =
  | 'new-file'
  | 'open-file'
  | 'save'
  | 'import'
  | 'export'
  | 'select'
  | 'lasso'
  | 'pan'
  | 'connect'
  | 'text'
  | 'shape'
  | 'iso'
  | 'auto-layout'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit-screen'
  | 'zoom-selection'
  | 'align-left'
  | 'align-hcenter'
  | 'align-right'
  | 'align-top'
  | 'align-vcenter'
  | 'align-bottom'
  | 'distribute-h'
  | 'distribute-v'
  | 'undo'
  | 'redo'
  | 'help'
  | 'warning'
  | 'lock'
  | 'unlock'
  | 'eye'
  | 'eye-off'
  | 'arrow-up'
  | 'arrow-down'
  | 'chevron-up'
  | 'chevron-down'
  | 'close'
  | 'check'
  | 'plus'
  | 'library'
  | 'inspector'
  | 'presentation'
  | 'pages'
  | 'rack'
  | 'settings'
  | 'theme'
  | 'group'
  | 'ungroup'
  | 'bring-forward'
  | 'send-backward'
  | 'trash';

interface NexIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: NexIconName;
  size?: number;
}

const ICONS: Record<NexIconName, ReactNode> = {
  group: (
    <>
      <rect x="4" y="4" width="9" height="9" rx="1" />
      <rect x="11" y="11" width="9" height="9" rx="1" />
    </>
  ),
  ungroup: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
      <path d="M13.5 10.5l-3-3" />
    </>
  ),
  'bring-forward': (
    <>
      <rect x="9" y="4" width="11" height="11" rx="1" />
      <path d="M4 10v9a1 1 0 0 0 1 1h9" />
    </>
  ),
  'send-backward': (
    <>
      <rect x="4" y="9" width="11" height="11" rx="1" />
      <path d="M10 4h9a1 1 0 0 1 1 1v9" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  'new-file': (
    <>
      <path d="M6 3.5h8l4 4V20H6z" />
      <path d="M14 3.5V8h4" />
      <path d="M12 11v5M9.5 13.5h5" />
    </>
  ),
  'open-file': (
    <>
      <path d="M4 7.5h6l2 2h8" />
      <path d="M5 9.5h15l-2.2 9H4.2z" />
      <path d="M8 13h6" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h12l2 2v14H5z" />
      <path d="M8 4v6h8V4" />
      <path d="M8 20v-5h8v5" />
    </>
  ),
  import: (
    <>
      <path d="M4 19h16" />
      <path d="M12 4v10" />
      <path d="M8.5 10.5 12 14l3.5-3.5" />
      <path d="M6.5 6.5h-2v8h3" />
      <path d="M17.5 6.5h2v8h-3" />
    </>
  ),
  export: (
    <>
      <path d="M4 19h16" />
      <path d="M12 14V4" />
      <path d="M8.5 7.5 12 4l3.5 3.5" />
      <path d="M6.5 9.5h-2v8h3" />
      <path d="M17.5 9.5h2v8h-3" />
    </>
  ),
  select: (
    <>
      <path d="M5 4l8.5 16 1.7-6.1L21 12z" />
      <path d="M14.8 14.4 19 18.6" />
    </>
  ),
  lasso: (
    <>
      <path
        d="M5.2 10.8c0-3.6 3.6-6.3 7.9-5.7 4.1.5 6.9 3.5 6.3 6.8-.6 3.4-4.5 5.7-8.6 5.2-1.7-.2-3.1-.8-4.1-1.7"
        strokeDasharray="2.4 2.2"
      />
      <path d="M6.7 15.4 4 20" />
      <path d="M4 20h5.2" />
    </>
  ),
  pan: (
    <>
      <path d="M8 12V6.8a1.7 1.7 0 0 1 3.4 0V12" />
      <path d="M11.4 11V5.7a1.7 1.7 0 0 1 3.4 0v6" />
      <path d="M14.8 12V7.5a1.6 1.6 0 0 1 3.2 0v6.7c0 3.8-2.3 5.8-5.7 5.8H11c-2.5 0-4.3-1.2-5.5-3.3L4 14.1a1.6 1.6 0 0 1 2.8-1.5L8 14.4" />
    </>
  ),
  connect: (
    <>
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="18" cy="17" r="2.2" />
      <path d="M8.3 7h3.4c2.4 0 4.3 1.9 4.3 4.3V15" />
      <path d="M13.7 13.1 16 15.4l2.3-2.3" />
    </>
  ),
  text: (
    <>
      <path d="M5 6h14" />
      <path d="M12 6v12" />
      <path d="M9 18h6" />
      <path d="M7 6v3M17 6v3" />
    </>
  ),
  shape: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M9 9h6M9 15h6" />
    </>
  ),
  iso: (
    <>
      <path d="M12 3.5 20 8l-8 4.5L4 8z" />
      <path d="M4 8v8l8 4.5 8-4.5V8" />
      <path d="M12 12.5v8" />
    </>
  ),
  'auto-layout': (
    <>
      <rect x="4" y="4" width="5" height="5" rx="1.2" />
      <rect x="15" y="4" width="5" height="5" rx="1.2" />
      <rect x="4" y="15" width="5" height="5" rx="1.2" />
      <rect x="15" y="15" width="5" height="5" rx="1.2" />
      <path d="M9 6.5h6M6.5 9v6M17.5 9v6M9 17.5h6" />
    </>
  ),
  'zoom-in': (
    <>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M10.5 8v5M8 10.5h5" />
      <path d="M15 15 20 20" />
    </>
  ),
  'zoom-out': (
    <>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M8 10.5h5" />
      <path d="M15 15 20 20" />
    </>
  ),
  'fit-screen': (
    <>
      <path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" />
      <rect x="8" y="8" width="8" height="8" rx="1.5" />
    </>
  ),
  'zoom-selection': (
    <>
      <rect x="5" y="5" width="10" height="10" rx="1.5" strokeDasharray="2.4 2" />
      <path d="M14.5 14.5 20 20" />
      <path d="M8 10h4M10 8v4" />
    </>
  ),
  'align-left': (
    <>
      <path d="M5 5v14" />
      <rect x="9" y="7" width="9" height="4" rx="1" />
      <rect x="9" y="14" width="6" height="4" rx="1" />
    </>
  ),
  'align-hcenter': (
    <>
      <path d="M12 5v14" />
      <rect x="6" y="7" width="12" height="4" rx="1" />
      <rect x="8" y="14" width="8" height="4" rx="1" />
    </>
  ),
  'align-right': (
    <>
      <path d="M19 5v14" />
      <rect x="6" y="7" width="9" height="4" rx="1" />
      <rect x="9" y="14" width="6" height="4" rx="1" />
    </>
  ),
  'align-top': (
    <>
      <path d="M5 5h14" />
      <rect x="7" y="9" width="4" height="9" rx="1" />
      <rect x="14" y="9" width="4" height="6" rx="1" />
    </>
  ),
  'align-vcenter': (
    <>
      <path d="M5 12h14" />
      <rect x="7" y="6" width="4" height="12" rx="1" />
      <rect x="14" y="8" width="4" height="8" rx="1" />
    </>
  ),
  'align-bottom': (
    <>
      <path d="M5 19h14" />
      <rect x="7" y="6" width="4" height="9" rx="1" />
      <rect x="14" y="9" width="4" height="6" rx="1" />
    </>
  ),
  'distribute-h': (
    <>
      <path d="M4 5v14M20 5v14" />
      <rect x="7" y="8" width="3" height="8" rx="1" />
      <rect x="13.5" y="8" width="3" height="8" rx="1" />
      <path d="M10 12h3.5" />
    </>
  ),
  'distribute-v': (
    <>
      <path d="M5 4h14M5 20h14" />
      <rect x="8" y="7" width="8" height="3" rx="1" />
      <rect x="8" y="13.5" width="8" height="3" rx="1" />
      <path d="M12 10v3.5" />
    </>
  ),
  undo: (
    <>
      <path d="M9 8H5V4" />
      <path d="M5 8h8.2a5.8 5.8 0 1 1-4.1 9.9" />
    </>
  ),
  redo: (
    <>
      <path d="M15 8h4V4" />
      <path d="M19 8h-8.2a5.8 5.8 0 1 0 4.1 9.9" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.7 9.3a2.6 2.6 0 1 1 4 2.2c-.9.6-1.4 1.1-1.4 2.1" />
      <circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4 21 19H3z" />
      <path d="M12 9v4" />
      <circle cx="12" cy="16" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  lock: (
    <>
      <rect x="6.5" y="10" width="11" height="9" rx="1.8" />
      <path d="M9 10V7.6a3 3 0 0 1 6 0V10" />
      <path d="M12 13.3v2.4" />
    </>
  ),
  unlock: (
    <>
      <rect x="6.5" y="10" width="11" height="9" rx="1.8" />
      <path d="M9 10V7.6a3 3 0 0 1 5.2-2.1" />
      <path d="M12 13.3v2.4" />
    </>
  ),
  eye: (
    <>
      <path d="M3.5 12s3.2-5 8.5-5 8.5 5 8.5 5-3.2 5-8.5 5-8.5-5-8.5-5z" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4 20 20" />
      <path d="M3.5 12s3.2-5 8.5-5c1.4 0 2.7.4 3.8 1" />
      <path d="M20.5 12s-3.2 5-8.5 5c-1.4 0-2.7-.4-3.8-1" />
      <path d="M10.4 10.4a2.4 2.4 0 0 0 3.2 3.2" />
    </>
  ),
  'arrow-up': (
    <>
      <path d="M12 19V5" />
      <path d="M6.5 10.5 12 5l5.5 5.5" />
    </>
  ),
  'arrow-down': (
    <>
      <path d="M12 5v14" />
      <path d="M6.5 13.5 12 19l5.5-5.5" />
    </>
  ),
  'chevron-up': <path d="M6.5 14.5 12 9l5.5 5.5" />,
  'chevron-down': <path d="M6.5 9.5 12 15l5.5-5.5" />,
  close: (
    <>
      <path d="M7 7 17 17" />
      <path d="M17 7 7 17" />
    </>
  ),
  check: <path d="M5.5 12.5 10 17l8.5-10" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  library: (
    <>
      <rect x="4" y="5" width="7" height="6" rx="1.2" />
      <rect x="13" y="5" width="7" height="6" rx="1.2" />
      <rect x="4" y="13" width="7" height="6" rx="1.2" />
      <rect x="13" y="13" width="7" height="6" rx="1.2" />
    </>
  ),
  inspector: (
    <>
      <path d="M5 7h14M5 12h14M5 17h14" />
      <circle cx="9" cy="7" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="11" cy="17" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  presentation: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M12 16v4" />
      <path d="M8.5 20h7" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  pages: (
    <>
      <rect x="6" y="4" width="11" height="14" rx="1.5" />
      <path d="M9 8h5M9 12h5" />
      <path d="M4 7v13h10" />
    </>
  ),
  rack: (
    <>
      <rect x="6" y="4" width="12" height="16" rx="1.5" />
      <path d="M6 9h12M6 14h12" />
      <circle cx="10" cy="6.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="11.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="16.5" r=".7" fill="currentColor" stroke="none" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" />
    </>
  ),
  theme: (
    <>
      <path d="M15 4.5a7.7 7.7 0 1 0 4.5 11.7 6.2 6.2 0 0 1-8.7-8.7A7.6 7.6 0 0 1 15 4.5z" />
      <path d="M18.5 5.5h.1M20 8.5h.1" />
    </>
  ),
};

export function NexIcon({ name, size = 16, ...props }: NexIconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {ICONS[name]}
    </svg>
  );
}
