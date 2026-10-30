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

// Editor toolbar + collaboration icons
export const Undo = (p) => (<svg {...S(p)}><path d="M9 7 4 12l5 5" /><path d="M4 12h11a5 5 0 0 1 0 10h-1" /></svg>);
export const Redo = (p) => (<svg {...S(p)}><path d="m15 7 5 5-5 5" /><path d="M20 12H9a5 5 0 0 0 0 10h1" /></svg>);
export const List = (p) => (<svg {...S({ ...p, sw: 1.9 })}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>);
export const ListOrdered = (p) => (<svg {...S({ ...p, sw: 1.9 })}><path d="M10 6h11M10 12h11M10 18h11M4 4v4M3 8h2M3.5 12.5h1.5l-1.5 2H5" /></svg>);
export const Quote = (p) => (<svg {...S(p)}><path d="M7 7H4v5h3V9h-.5A1.5 1.5 0 0 1 8 7.5M17 7h-3v5h3V9h-.5A1.5 1.5 0 0 1 18 7.5" /></svg>);
export const AlignLeft = (p) => (<svg {...S({ ...p, sw: 1.9 })}><path d="M3 6h18M3 12h12M3 18h15" /></svg>);
export const AlignCenter = (p) => (<svg {...S({ ...p, sw: 1.9 })}><path d="M3 6h18M6 12h12M5 18h14" /></svg>);
export const AlignJustify = (p) => (<svg {...S({ ...p, sw: 1.9 })}><path d="M3 6h18M3 12h18M3 18h18" /></svg>);
export const Share = (p) => (<svg {...S(p)}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6" /></svg>);
export const Link = (p) => (<svg {...S(p)}><path d="M10 13a4 4 0 0 0 5.7.4l3-3a4 4 0 0 0-5.7-5.7L11 7" /><path d="M14 11a4 4 0 0 0-5.7-.4l-3 3a4 4 0 0 0 5.7 5.7L13 17" /></svg>);
export const Eye = (p) => (<svg {...S(p)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>);
export const Edit = (p) => (<svg {...S(p)}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>);
export const Copy = (p) => (<svg {...S(p)}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>);
export const Trash = (p) => (<svg {...S(p)}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14" /></svg>);
export const Globe = (p) => (<svg {...S(p)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></svg>);
export const Comment = (p) => (<svg {...S(p)}><path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /></svg>);
