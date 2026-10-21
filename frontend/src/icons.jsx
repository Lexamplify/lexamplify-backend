// Clean 24px stroke icons — one consistent set for the whole app.
const S = (p) => ({ width: p.size || 20, height: p.size || 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: p.sw || 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', ...p });

export const Today = (p) => (<svg {...S(p)}><path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M9.5 20v-6h5v6" /></svg>);
export const Matters = (p) => (<svg {...S(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>);
export const Draft = (p) => (<svg {...S(p)}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>);
export const Research = (p) => (<svg {...S(p)}><circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.3-4.3" /></svg>);
export const Contracts = (p) => (<svg {...S(p)}><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /><path d="m9 15 2 2 4-4" /></svg>);
export const Calendar = (p) => (<svg {...S(p)}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>);
export const Library = (p) => (<svg {...S(p)}><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13z" /></svg>);
export const Settings = (p) => (<svg {...S(p)}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6h.1A1.6 1.6 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.1.9z" /></svg>);

export const Search = (p) => (<svg {...S(p)}><circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.3-4.3" /></svg>);
export const Plus = (p) => (<svg {...S({ ...p, sw: p.sw || 2.2 })}><path d="M12 5v14M5 12h14" /></svg>);
export const Arrow = (p) => (<svg {...S({ ...p, sw: p.sw || 2 })}><path d="M5 12h14M13 6l6 6-6 6" /></svg>);
export const Sparkle = (p) => (<svg {...S(p)}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>);
export const Clock = (p) => (<svg {...S(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>);
export const Gavel = (p) => (<svg {...S(p)}><path d="m14.5 12.5-8 8a2.1 2.1 0 0 1-3-3l8-8" /><path d="m16 16 6-6M8 8l6-6M9 7l8 8" /></svg>);
export const Scale = (p) => (<svg {...S(p)}><path d="M12 3v18" /><path d="M5 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6M19 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6M5 7h14M9 21h6" /></svg>);
export const Doc = (p) => (<svg {...S(p)}><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /></svg>);
export const Bell = (p) => (<svg {...S(p)}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>);
export const Menu = (p) => (<svg {...S({ ...p, sw: 2 })}><path d="M4 6h16M4 12h16M4 18h16" /></svg>);
export const Chevron = (p) => (<svg {...S({ ...p, sw: 2 })}><path d="m9 6 6 6-6 6" /></svg>);
export const Check = (p) => (<svg {...S({ ...p, sw: 2 })}><path d="M20 6 9 17l-5-5" /></svg>);
export const Upload = (p) => (<svg {...S(p)}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>);
export const Users = (p) => (<svg {...S(p)}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 20a5.5 5.5 0 0 0-3-4.9" /></svg>);
export const Shield = (p) => (<svg {...S(p)}><path d="M12 3l7 3v5c0 4.5-3 8.2-7 9.5C8 19.2 5 15.5 5 11V6z" /><path d="m9.5 12 1.8 1.8L15 10" /></svg>);
export const Filter = (p) => (<svg {...S({ ...p, sw: 2 })}><path d="M3 5h18l-7 8v5l-4 2v-7z" /></svg>);
export const Palette = (p) => (<svg {...S(p)}><path d="M12 3a9 9 0 1 0 0 18c1 0 1.7-.8 1.7-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7Z" /><circle cx="7.5" cy="10.5" r="1" /><circle cx="12" cy="7.5" r="1" /><circle cx="16.5" cy="10.5" r="1" /></svg>);
export const X = (p) => (<svg {...S({ ...p, sw: 2 })}><path d="M18 6 6 18M6 6l12 12" /></svg>);
export const Sliders = (p) => (<svg {...S({ ...p, sw: 1.9 })}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>);
