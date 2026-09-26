export type IconName =
  | 'town'
  | 'people'
  | 'chart'
  | 'mind'
  | 'sliders'
  | 'arrow'
  | 'close'
  | 'plus'
  | 'minus'
  | 'focus'
  | 'sun'
  | 'moon'
  | 'cloud'
  | 'search'
  | 'refresh'
  | 'leaf'
  | 'pin'
  | 'walk'
  | 'play'
  | 'pause'
  | 'key';
const paths: Record<IconName, string> = {
  town: 'M3 21V9l5-4 5 4v12M13 21V3h7v18M1 21h22M6 12h3m-3 4h3m7-9h1m-1 4h1m-1 4h1',
  people:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  chart: 'M3 3v18h18M7 14l4-4 4 3 6-8',
  mind: 'M12 18v4M8 18h8M8 15a7 7 0 1 1 8 0v3H8zM10 8l2 3 2-3',
  sliders: 'M4 3v7m0 4v7M12 3v11m0 4v3M20 3v2m0 4v12M1 10h6m2 8h6m2-13h6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  close: 'm6 6 12 12M6 18 18 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  focus: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10',
  cloud: 'M6 18h12a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0-1 10',
  search: 'm16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  refresh: 'M20 7a9 9 0 1 0 1 8M20 2v5h-5',
  leaf: 'M20 3C8 1 1 9 5 16s18 4 15-13ZM5 20 16 8',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  walk: 'M14 3h.01M8 21l3-7 3 3v4M7 12l2-5 4 1 3 4h4M11 8l-1 6',
  play: 'm7 4 14 8-14 8z',
  pause: 'M8 4v16M16 4v16',
  key: 'M8 15a6 6 0 1 1 5-9l9-4v5h-3v3h-4l-2 2M5 8h.01',
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span className={`avatar avatar-${hash % 6}${small ? ' avatar-small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <path d="M9 40v-8c0-8 22-8 22 0v8" fill="currentColor" />
        <rect x="14" y="12" width="12" height="15" rx="5" fill="#dfb58f" />
        <path d="M13 17v-5c0-9 15-9 15 0v7h-3v-7c-4 3-8 0-8 4v3h-4" fill="#4b4d40" />
      </svg>
    </span>
  );
}
