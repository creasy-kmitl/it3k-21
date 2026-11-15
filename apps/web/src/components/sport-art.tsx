import type { SportIcon } from "@it3k/db/sport-rules";
import { cn } from "@it3k/ui/lib/utils";
import { type ReactNode, useId, useState } from "react";

// Line drawings in a 100×100 box centred on 0,0, stroked in white over the
// theme's red ramp. They stand in for a thumbnail until someone sets one.
const GLYPHS: Record<SportIcon, ReactNode> = {
  football: (
    <>
      <circle r="40" />
      <path d="M0,-14 L13.3,-4.3 L8.2,11.3 L-8.2,11.3 L-13.3,-4.3 Z" fill="white" />
      <path d="M0,-14 V-40 M13.3,-4.3 L37,-12 M8.2,11.3 L23,32 M-8.2,11.3 L-23,32 M-13.3,-4.3 L-37,-12" />
    </>
  ),
  athletics: (
    <>
      <rect x="-48" y="-32" width="96" height="64" rx="32" />
      <rect x="-34" y="-18" width="68" height="36" rx="18" />
      <path d="M10,-32 V-18 M10,18 V32" />
      <path d="M-20,0 H20" strokeDasharray="6 8" strokeWidth="4" />
    </>
  ),
  basketball: (
    <>
      <circle r="40" />
      <path d="M0,-40 V40 M-40,0 H40" />
      <path d="M-28,-28 Q-6,0 -28,28 M28,-28 Q6,0 28,28" />
    </>
  ),
  "table-tennis": (
    <>
      <path d="M6,6 L27,27" strokeWidth="17" />
      <circle cx="-8" cy="-8" r="28" fill="white" stroke="none" />
      <circle cx="32" cy="-30" r="7" fill="white" />
    </>
  ),
  chairball: (
    <>
      <path d="M-34,-18 V40 M-34,10 H4 V40 M-34,-18 H-26" />
      <circle cx="18" cy="-22" r="16" />
      <path d="M5,-31 Q18,-22 31,-31 M5,-13 Q18,-22 31,-13" strokeWidth="3" />
    </>
  ),
  badminton: (
    <>
      <path d="M-11,28 A11,11 0 0 0 11,28 Z" fill="white" />
      <path d="M-11,28 L-26,-36 H26 L11,28 M-4,28 L-9,-36 M4,28 L9,-36 M-20,-10 H20" />
    </>
  ),
  petanque: (
    <>
      <circle cx="-20" cy="12" r="20" />
      <circle cx="22" cy="18" r="16" />
      <path d="M-38,4 Q-20,14 -2,4 M8,10 Q22,18 36,10" strokeWidth="3" />
      <circle cx="4" cy="-28" r="7" fill="white" />
    </>
  ),
  folk: (
    <>
      <path d="M-48,8 C-32,-6 -16,22 0,8 S32,-6 48,8" />
      <path d="M0,8 V-30 L20,-22 L0,-14" />
    </>
  ),
  esports: (
    <>
      <rect x="-46" y="-24" width="92" height="48" rx="24" />
      <path d="M-28,0 H-10 M-19,-9 V9" />
      <circle cx="18" cy="-6" r="4.5" fill="white" />
      <circle cx="30" cy="6" r="4.5" fill="white" />
    </>
  ),
  general: (
    <>
      <path d="M-22,-36 H22 V-20 A22,22 0 0 1 -22,-20 Z" />
      <path d="M-22,-30 H-34 V-22 A12,12 0 0 0 -22,-12 M22,-30 H34 V-22 A12,12 0 0 1 22,-12" />
      <path d="M0,2 V22 M-18,32 H18 M-12,22 H12 V32 H-12 Z" />
    </>
  ),
};

// Pairs from the theme's red ramp (packages/ui globals.css).
const GRADIENTS = [
  ["--chart-3", "--chart-5"],
  ["--chart-2", "--chart-4"],
  ["--chart-4", "--chart-5"],
  ["--primary", "--chart-5"],
] as const;

/** FNV-1a: the same seed always draws the same picture. */
export function seedHash(seed: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function SportArt({
  icon,
  seed,
  label,
  className,
}: {
  icon: SportIcon;
  /** Usually the row's id, so each sport or event keeps its own background. */
  seed: string;
  label: string;
  className?: string;
}) {
  const id = useId();
  const hash = seedHash(seed);
  const [from, to] = GRADIENTS[hash % GRADIENTS.length] ?? GRADIENTS[0];
  // A few soft rings and dots placed from the hash.
  const shapes = Array.from({ length: 4 }, (_, i) => {
    const bits = (hash >>> (i * 7)) & 0x7f;
    return { cx: (bits * 37 + i * 83) % 320, cy: (bits * 19 + i * 47) % 180, r: 12 + (bits % 5) * 14 };
  });

  return (
    <svg
      viewBox="0 0 320 180"
      role="img"
      aria-label={label}
      className={cn("block aspect-video w-full", className)}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: `var(${from})` }} />
          <stop offset="1" style={{ stopColor: `var(${to})` }} />
        </linearGradient>
        <pattern id={`${id}-lines`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <path d="M0,0 V14" stroke="white" strokeOpacity="0.08" strokeWidth="5" />
        </pattern>
      </defs>
      <rect width="320" height="180" fill={`url(#${id}-bg)`} />
      <rect width="320" height="180" fill={`url(#${id}-lines)`} />
      {shapes.map((shape, i) => (
        <circle
          key={i}
          {...shape}
          fill={i % 2 ? "white" : "none"}
          fillOpacity="0.07"
          stroke="white"
          strokeOpacity={i % 2 ? 0 : 0.15}
          strokeWidth="3"
        />
      ))}
      <g
        transform="translate(160 90) scale(1.25)"
        fill="none"
        stroke="white"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPHS[icon]}
      </g>
    </svg>
  );
}

/** The set thumbnail, or the illustration when there is none or it fails to load. */
export function SportThumbnail({
  src,
  icon,
  seed,
  label,
  className,
}: {
  src: string | null;
  icon: SportIcon;
  seed: string;
  label: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt={label}
        loading="lazy"
        className={cn("block aspect-video w-full object-cover", className)}
        onError={() => setFailed(src)}
      />
    );
  }
  return <SportArt icon={icon} seed={seed} label={label} className={className} />;
}
