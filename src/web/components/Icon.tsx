import type { SVGProps } from 'react';

export type IconName = 'home' | 'process' | 'review' | 'invoice' | 'supplier' | 'bank' | 'metrics' | 'history' | 'settings' | 'search' | 'check' | 'warning' | 'error' | 'mail' | 'file' | 'archive' | 'arrow' | 'menu' | 'close' | 'download' | 'plus' | 'edit' | 'eye' | 'shield' | 'refresh' | 'chevron';

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></>,
  process: <><path d="M4 4h16v5H4z"/><path d="M4 15h16v5H4z"/><path d="M8 9v6M16 9v6"/></>,
  review: <><path d="M9 11 11 13 15 9"/><path d="M5 3h14v18H5z"/><path d="M8 6h8M8 17h8"/></>,
  invoice: <><path d="M6 2h9l4 4v16H6z"/><path d="M15 2v5h5M9 12h6M9 16h6"/></>,
  supplier: <><circle cx="12" cy="7" r="4"/><path d="M4 22c0-5 3-8 8-8s8 3 8 8"/></>,
  bank: <><path d="m3 9 9-6 9 6"/><path d="M5 10h14M6 10v8M10 10v8M14 10v8M18 10v8M3 21h18"/></>,
  metrics: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  check: <path d="m5 12 4 4L19 6"/>, warning: <><path d="M12 3 2 21h20z"/><path d="M12 9v5M12 18h.01"/></>, error: <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>, file: <><path d="M6 2h9l4 4v16H6z"/><path d="M15 2v5h5"/></>, archive: <><path d="M3 6h18v4H3zM5 10v10h14V10M9 14h6"/></>, arrow: <path d="M5 12h14M14 7l5 5-5 5"/>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>, close: <path d="m6 6 12 12M18 6 6 18"/>, download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 20h16"/></>, plus: <path d="M12 5v14M5 12h14"/>, edit: <><path d="m4 20 4-.8L19 8.2 15.8 5 4.8 16z"/><path d="m14 6 4 4"/></>, eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>, shield: <><path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-5"/></>, refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"/></>, chevron: <path d="m9 6 6 6-6 6"/>,
};

export function Icon({ name, size = 20, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{paths[name]}</svg>;
}
