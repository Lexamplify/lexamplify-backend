import React from 'react';

/**
 * LexLogoMark — the geometric two-tone 'L' brand mark, rendered as a clean
 * inline SVG (no raster asset). Navy blade + grey diagonal accent.
 * Shared by the app sidebar and the public landing navbar for consistency.
 */
export default function LexLogoMark({ size = 34, className = '', style = {} }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      role="img"
      aria-label="LexAmplify"
    >
      <defs>
        {/* Navy→indigo gradient keeps the deep-navy identity but stays legible
            on the near-black sidebar/navbar backgrounds. */}
        <linearGradient id="lexLogoBlade" x1="2" y1="5" x2="36" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3B5BDB" />
          <stop offset="1" stopColor="#1E3A8A" />
        </linearGradient>
      </defs>
      {/* Navy 'L' / lambda silhouette */}
      <path
        d="M16 5 L22 5 L36 35 L28 35 L19 15 L10 35 L2 35 Z"
        fill="url(#lexLogoBlade)"
      />
      {/* Grey diagonal accent — the right ascending blade */}
      <path
        d="M22 5 L36 35 L28 35 L19 15 Z"
        fill="#B4BECC"
      />
    </svg>
  );
}
