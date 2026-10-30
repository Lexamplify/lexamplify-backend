// Practice icons: the Document Hub set plus the few extra glyphs this module needs (same 24 grid, same stroke).
import { Icon as HubIcon } from '../dochub/icons.jsx';

const P = {
  home: <><path d="M4 11.2 12 4.5l8 6.7" /><path d="M6 10v9a1 1 0 0 0 1 1h3.5v-5.5h3V20H17a1 1 0 0 0 1-1v-9" /></>,
  scale: <><line x1="12" y1="4" x2="12" y2="20" /><line x1="7" y1="20" x2="17" y2="20" /><path d="M5 7.5h14" /><path d="M5 7.5 2.8 13a3 3 0 0 0 4.4 0Z" /><path d="M19 7.5 16.8 13a3 3 0 0 0 4.4 0Z" /></>,
  users: <><circle cx="9" cy="8.5" r="3.3" /><path d="M2.8 19.5a6.2 6.2 0 0 1 12.4 0" /><path d="M16 5.6a3.3 3.3 0 0 1 0 5.8" /><path d="M18.2 14.3a6 6 0 0 1 3 5.2" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><polyline points="12 7.5 12 12 15.5 14" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  chat: <><path d="M20.5 12a8 8 0 0 1-11.9 7l-4.1 1.2 1.3-3.9A8 8 0 1 1 20.5 12Z" /><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-.9.7a4 4 0 0 1-1.6-1.6l.7-.9-1-2Z" /></>,
  shield: <><path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6Z" /><polyline points="8.8 12 11 14.2 15.2 9.8" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3h0a1.6 1.6 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7v0a1.6 1.6 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
  chart: <><line x1="4" y1="20" x2="20" y2="20" /><rect x="5.5" y="11" width="3" height="9" rx=".6" /><rect x="10.5" y="6" width="3" height="14" rx=".6" /><rect x="15.5" y="13" width="3" height="7" rx=".6" /></>,
  clipboard: <><rect x="5.5" y="4.5" width="13" height="16" rx="2" /><path d="M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5" /><line x1="9" y1="11" x2="15" y2="11" /><line x1="9" y1="15" x2="13.5" y2="15" /></>,
  building: <><rect x="5" y="3.5" width="14" height="17" rx="1.5" /><line x1="9" y1="8" x2="9.1" y2="8" /><line x1="12" y1="8" x2="12.1" y2="8" /><line x1="15" y1="8" x2="15.1" y2="8" /><line x1="9" y1="12" x2="9.1" y2="12" /><line x1="12" y1="12" x2="12.1" y2="12" /><line x1="15" y1="12" x2="15.1" y2="12" /><path d="M10 20.5v-4h4v4" /></>,
  phone: <path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><polyline points="4 4 4 8.5 8.5 8.5" /><polyline points="12 8 12 12 15 13.8" /></>,
  list: <><line x1="9" y1="7" x2="20" y2="7" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="17" x2="20" y2="17" /><circle cx="5" cy="7" r=".6" /><circle cx="5" cy="12" r=".6" /><circle cx="5" cy="17" r=".6" /></>,
  flag: <><path d="M5.5 21V4" /><path d="M5.5 5h11l-2 3.5 2 3.5h-11" /></>,
  key: <><circle cx="8" cy="15" r="3.8" /><path d="m10.8 12.3 8.2-8.2" /><path d="m16 7 2.5 2.5" /><path d="m13.5 9.5 2 2" /></>,
  external: <><path d="M14 4h6v6" /><line x1="20" y1="4" x2="11" y2="13" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>,
  sun: <><circle cx="12" cy="12" r="3.6" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6" /></>,
  send: <><path d="m20.5 3.5-9 17-2.5-7.5-7.5-2.5Z" /><line x1="20.5" y1="3.5" x2="9" y2="13" /></>,
  paperclip: <path d="m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.6 17a1.6 1.6 0 0 1-2.4-2.3l7.2-7.2" />,
  dot: <circle cx="12" cy="12" r="3" />,
  archive: <><rect x="3.5" y="4.5" width="17" height="4.5" rx="1" /><path d="M5.5 9v9.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" /><line x1="10" y1="13" x2="14" y2="13" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></>,
};

export function PIcon({ name, size, className = '', title }) {
  if (!P[name]) return <HubIcon name={name} size={size} className={className} title={title} />;
  const style = size ? { width: size, height: size } : undefined;
  return (
    <svg className={`dh-i ${className}`} style={style} viewBox="0 0 24 24" aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      {P[name]}
    </svg>
  );
}
