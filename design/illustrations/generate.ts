/**
 * IT·3·Kings illustration kit.
 *
 * Writes every illustration as SVG into ./svg, then renders PNGs into ./png
 * with rsvg-convert. Run from the repo root:
 *
 *   bun design/illustrations/generate.ts
 *
 * Palette follows packages/ui/src/styles/tokens.css: brand red #c10007
 * (oklch 0.505 0.213 27.5) with its chart reds, on zinc neutrals.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const OUT = import.meta.dir;
mkdirSync(join(OUT, "svg"), { recursive: true });
mkdirSync(join(OUT, "png"), { recursive: true });

// ── palette ────────────────────────────────────────────────────────────────
const C = {
  r900: "#82181a",
  r800: "#9f0712",
  r700: "#c10007",
  r600: "#e7000b",
  r500: "#fb2c36",
  r300: "#ffa2a2",
  r200: "#ffc9c9",
  r100: "#ffe2e2",
  r50: "#fef2f2",
  z950: "#09090b",
  z900: "#18181b",
  z800: "#27272a",
  z700: "#3f3f46",
  z500: "#71717a",
  z300: "#d4d4d8",
  z200: "#e4e4e7",
  z100: "#f4f4f5",
  w: "#ffffff",
};

/** Colours an element may use. A "line" palette sets every fill to none. */
type Pal = {
  ink: string; // outlines and dark details
  red: string;
  redL: string;
  redD: string;
  paper: string;
  shade: string;
  metal: string;
  body: string;
  screen: string;
  glyph: string; // accent strokes that must survive line mode
  sw: number;
};

const FULL: Pal = {
  ink: C.z900,
  red: C.r700,
  redL: C.r500,
  redD: C.r800,
  paper: C.w,
  shade: C.z200,
  metal: C.z300,
  body: C.z800,
  screen: C.z950,
  glyph: C.r500,
  sw: 6,
};

const line = (ink: string, sw = 6): Pal => ({
  ink,
  red: "none",
  redL: "none",
  redD: "none",
  paper: "none",
  shade: "none",
  metal: "none",
  body: "none",
  screen: "none",
  glyph: ink,
  sw,
});

/** The brand mark inverted: a white crown for red grounds. */
const ON_RED: Pal = { ...FULL, red: C.w, redD: C.z100, redL: C.r100 };

let idn = 0;
const uid = (p: string) => `${p}${++idn}`;

const st = (p: Pal, k = 1) =>
  `stroke="${p.ink}" stroke-width="${+(p.sw * k).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"`;

const g = (body: string, x = 0, y = 0, s = 1, r = 0, extra = "") =>
  `<g transform="translate(${x} ${y})${r ? ` rotate(${r})` : ""}${s !== 1 ? ` scale(${s})` : ""}"${extra}>${body}</g>`;

const poly = (cx: number, cy: number, R: number, n: number, rot: number) =>
  Array.from({ length: n }, (_, i) => {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    return `${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

const star = (cx: number, cy: number, R: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = ((-90 + 36 * i) * Math.PI) / 180;
    const rr = i % 2 ? r : R;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

/** Seeded RNG so every run draws the same picture. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ── elements (each drawn around 0,0 inside roughly ±100) ──────────────────

function crown(p: Pal, { tips = true, gem = C.r700 } = {}) {
  const gemFill = p.paper === "none" ? "none" : gem;
  return [
    `<path d="M-84 34 L-96 -46 L-46 -4 L0 -70 L46 -4 L96 -46 L84 34 Z" fill="${p.red}" ${st(p)}/>`,
    p.redL !== "none"
      ? `<path d="M0 -44 L24 -6 L0 14 L-24 -6 Z" fill="${p.redL}" opacity=".9"/>`
      : `<path d="M0 -44 L24 -6 L0 14 L-24 -6 Z" fill="none" ${st(p, 0.6)}/>`,
    tips
      ? [
          `<circle cx="-96" cy="-52" r="12" fill="${p.paper}" ${st(p, 0.8)}/>`,
          `<circle cx="0" cy="-80" r="14" fill="${p.paper}" ${st(p, 0.8)}/>`,
          `<circle cx="96" cy="-52" r="12" fill="${p.paper}" ${st(p, 0.8)}/>`,
        ].join("")
      : "",
    `<rect x="-90" y="28" width="180" height="36" rx="9" fill="${p.redD}" ${st(p)}/>`,
    `<circle cx="-52" cy="46" r="7" fill="${gemFill}" ${st(p, 0.5)}/>`,
    `<path d="M0 34 L11 46 L0 58 L-11 46 Z" fill="${gemFill}" ${st(p, 0.5)}/>`,
    `<circle cx="52" cy="46" r="7" fill="${gemFill}" ${st(p, 0.5)}/>`,
  ].join("");
}

function football(p: Pal) {
  const id = uid("fb");
  const R = 88;
  const parts: string[] = [];
  parts.push(`<polygon points="${poly(0, 0, 30, 5, -90)}" fill="${p.ink}"/>`);
  for (let k = 0; k < 5; k++) {
    const a = -90 + 72 * k;
    const rad = (a * Math.PI) / 180;
    const cx = 88 * Math.cos(rad);
    const cy = 88 * Math.sin(rad);
    parts.push(`<polygon points="${poly(cx, cy, 30, 5, a + 180)}" fill="${p.ink}"/>`);
    const x1 = 30 * Math.cos(rad);
    const y1 = 30 * Math.sin(rad);
    const x2 = 58 * Math.cos(rad);
    const y2 = 58 * Math.sin(rad);
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ${st(p, 0.6)}/>`,
    );
    // hexagon edge between this patch and the next one
    const side = (deg: number) => {
      const r2 = (deg * Math.PI) / 180;
      return [cx + 30 * Math.cos(r2), cy + 30 * Math.sin(r2)];
    };
    const [sx, sy] = side(a + 180 - 72);
    const na = a + 72;
    const nr = (na * Math.PI) / 180;
    const nx = 88 * Math.cos(nr) + 30 * Math.cos(((na + 180 + 72) * Math.PI) / 180);
    const ny = 88 * Math.sin(nr) + 30 * Math.sin(((na + 180 + 72) * Math.PI) / 180);
    parts.push(
      `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" ${st(p, 0.6)}/>`,
    );
  }
  return [
    `<clipPath id="${id}"><circle r="${R}"/></clipPath>`,
    `<circle r="${R}" fill="${p.paper}"/>`,
    p.shade !== "none"
      ? `<path d="M${R} 0 A${R} ${R} 0 0 1 -62 62 A${R * 0.9} ${R * 0.9} 0 0 0 ${R} 0 Z" fill="${p.shade}" clip-path="url(#${id})"/>`
      : "",
    `<g clip-path="url(#${id})">${parts.join("")}</g>`,
    `<circle r="${R}" fill="none" ${st(p)}/>`,
  ].join("");
}

function basketball(p: Pal) {
  const id = uid("bb");
  const R = 88;
  return [
    `<clipPath id="${id}"><circle r="${R}"/></clipPath>`,
    `<circle r="${R}" fill="${p.redL}"/>`,
    p.redD !== "none"
      ? `<path d="M${R} 0 A${R} ${R} 0 0 1 -62 62 A${R * 0.92} ${R * 0.92} 0 0 0 ${R} 0 Z" fill="${p.red}" opacity=".55" clip-path="url(#${id})"/>`
      : "",
    p.paper !== "none"
      ? `<path d="M-58 -40 A70 70 0 0 1 -20 -66" fill="none" stroke="${C.w}" stroke-width="9" stroke-linecap="round" opacity=".55"/>`
      : "",
    `<g clip-path="url(#${id})" fill="none" ${st(p, 0.75)}>`,
    `<path d="M0 -${R} V${R}"/><path d="M-${R} 0 H${R}"/>`,
    `<path d="M-52 -74 C-14 -34 -14 34 -52 74"/><path d="M52 -74 C14 -34 14 34 52 74"/>`,
    `</g>`,
    `<circle r="${R}" fill="none" ${st(p)}/>`,
  ].join("");
}

function shuttlecock(p: Pal) {
  const feathers = [-16, 0, 16]
    .map((x) => `<line x1="${x}" y1="32" x2="${(x * 2.6).toFixed(1)}" y2="-84" ${st(p, 0.55)}/>`)
    .join("");
  return [
    `<path d="M-32 34 L-68 -78 Q-51 -94 -34 -82 Q-17 -96 0 -84 Q17 -96 34 -82 Q51 -94 68 -78 L32 34 Z" fill="${p.paper}" ${st(p)}/>`,
    p.shade !== "none" ? `<path d="M10 30 L46 -82 Q56 -88 66 -78 L32 34 Z" fill="${p.shade}"/>` : "",
    feathers,
    `<path d="M-50 -26 Q0 -14 50 -26" fill="none" ${st(p, 0.55)}/>`,
    `<path d="M-32 46 A32 32 0 0 0 32 46 Z" fill="${p.paper}" ${st(p)}/>`,
    `<rect x="-35" y="28" width="70" height="18" rx="5" fill="${p.red}" ${st(p)}/>`,
    `<path d="M-32 34 L-68 -78 Q-51 -94 -34 -82 Q-17 -96 0 -84 Q17 -96 34 -82 Q51 -94 68 -78 L32 34" fill="none" ${st(p)}/>`,
  ].join("");
}

function paddle(p: Pal) {
  return [
    `<rect x="-15" y="24" width="30" height="80" rx="13" fill="${p.body}" ${st(p)}/>`,
    `<rect x="-15" y="44" width="30" height="10" fill="${p.redL}"/>`,
    `<circle cx="0" cy="-32" r="68" fill="${p.red}" ${st(p)}/>`,
    p.redD !== "none"
      ? `<path d="M-48 -64 A58 58 0 0 1 10 -89" fill="none" stroke="${C.w}" stroke-width="9" stroke-linecap="round" opacity=".45"/>`
      : `<circle cx="0" cy="-32" r="54" fill="none" ${st(p, 0.5)}/>`,
    `<circle cx="66" cy="58" r="18" fill="${p.paper}" ${st(p, 0.85)}/>`,
  ].join("");
}

function gamepad(p: Pal) {
  return [
    `<path d="M-90 -10 C-90 -45 -60 -50 -40 -50 L40 -50 C60 -50 90 -45 90 -10 L96 42 C98 68 72 76 58 60 L40 36 L-40 36 L-58 60 C-72 76 -98 68 -96 42 Z" fill="${p.body}" ${st(p)}/>`,
    `<path d="M-54 -26 h12 v12 h12 v12 h-12 v12 h-12 v-12 h-12 v-12 h12 Z" fill="${p.paper}" ${st(p, 0.5)}/>`,
    `<circle cx="50" cy="-26" r="8" fill="${p.redL}" ${st(p, 0.5)}/>`,
    `<circle cx="68" cy="-10" r="8" fill="${p.red}" ${st(p, 0.5)}/>`,
    `<circle cx="32" cy="-10" r="8" fill="${p.redL}" ${st(p, 0.5)}/>`,
    `<circle cx="50" cy="6" r="8" fill="${p.red}" ${st(p, 0.5)}/>`,
    `<circle cx="-24" cy="16" r="12" fill="${p.metal}" ${st(p, 0.5)}/>`,
    `<circle cx="24" cy="16" r="12" fill="${p.metal}" ${st(p, 0.5)}/>`,
    `<rect x="-16" y="-30" width="11" height="6" rx="3" fill="${p.glyph}"/>`,
    `<rect x="5" y="-30" width="11" height="6" rx="3" fill="${p.glyph}"/>`,
  ].join("");
}

function petanque(p: Pal) {
  const id = uid("pt");
  return [
    `<clipPath id="${id}"><circle cx="-8" cy="-6" r="78"/></clipPath>`,
    `<circle cx="-8" cy="-6" r="78" fill="${p.metal}"/>`,
    p.shade !== "none"
      ? `<path d="M70 -6 A78 78 0 0 1 -66 46 A70 70 0 0 0 70 -6 Z" fill="${C.z500}" opacity=".35" clip-path="url(#${id})"/>`
      : "",
    `<g clip-path="url(#${id})" fill="none" ${st(p, 0.5)}>`,
    `<path d="M-90 -40 Q-8 -8 74 -48"/><path d="M-90 -20 Q-8 12 74 -28"/><path d="M-90 26 Q-8 58 74 18"/>`,
    `</g>`,
    p.paper !== "none"
      ? `<ellipse cx="-38" cy="-42" rx="20" ry="11" transform="rotate(-32 -38 -42)" fill="${C.w}" opacity=".8"/>`
      : "",
    `<circle cx="-8" cy="-6" r="78" fill="none" ${st(p)}/>`,
    `<circle cx="72" cy="66" r="17" fill="${p.redL}" ${st(p, 0.85)}/>`,
  ].join("");
}

function stopwatch(p: Pal) {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = ((i * 30 - 90) * Math.PI) / 180;
    const r1 = i % 3 ? 52 : 46;
    return `<line x1="${(r1 * Math.cos(a)).toFixed(1)}" y1="${(16 + r1 * Math.sin(a)).toFixed(1)}" x2="${(58 * Math.cos(a)).toFixed(1)}" y2="${(16 + 58 * Math.sin(a)).toFixed(1)}" ${st(p, i % 3 ? 0.4 : 0.6)}/>`;
  }).join("");
  const hx = 42 * Math.cos((-40 * Math.PI) / 180);
  const hy = 16 + 42 * Math.sin((-40 * Math.PI) / 180);
  return [
    `<rect x="-7" y="-68" width="14" height="14" fill="${p.body}" ${st(p, 0.6)}/>`,
    `<rect x="-18" y="-86" width="36" height="18" rx="5" fill="${p.red}" ${st(p)}/>`,
    `<g transform="rotate(45 0 16)"><rect x="-8" y="-72" width="16" height="18" rx="4" fill="${p.body}" ${st(p, 0.7)}/></g>`,
    `<circle cx="0" cy="16" r="74" fill="${p.paper}" ${st(p)}/>`,
    p.redL !== "none"
      ? `<path d="M0 16 L0 -42 A58 58 0 0 1 ${(58 * Math.cos((-40 * Math.PI) / 180)).toFixed(1)} ${(16 + 58 * Math.sin((-40 * Math.PI) / 180)).toFixed(1)} Z" fill="${C.r100}"/>`
      : "",
    ticks,
    `<line x1="0" y1="16" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="${p.glyph}" stroke-width="${p.sw * 1.1}" stroke-linecap="round"/>`,
    `<circle cx="0" cy="16" r="7" fill="${p.ink}"/>`,
  ].join("");
}

function trophy(p: Pal) {
  return [
    `<path d="M-52 -54 C-98 -56 -96 8 -42 4" fill="none" ${st(p, 1.6)}/>`,
    `<path d="M52 -54 C98 -56 96 8 42 4" fill="none" ${st(p, 1.6)}/>`,
    p.red !== "none"
      ? `<path d="M-52 -54 C-98 -56 -96 8 -42 4 M52 -54 C98 -56 96 8 42 4" fill="none" stroke="${p.red}" stroke-width="${p.sw * 0.6}" stroke-linecap="round"/>`
      : "",
    `<path d="M-60 -76 L60 -76 L56 -22 C52 22 26 40 0 40 C-26 40 -52 22 -56 -22 Z" fill="${p.red}" ${st(p)}/>`,
    p.paper !== "none"
      ? `<path d="M-42 -62 L-40 -24 C-38 0 -28 12 -18 20" fill="none" stroke="${C.w}" stroke-width="8" stroke-linecap="round" opacity=".45"/>`
      : "",
    `<polygon points="${star(4, -24, 20, 8.5)}" fill="${p.paper}" ${st(p, 0.5)}/>`,
    `<rect x="-13" y="38" width="26" height="24" fill="${p.redD}" ${st(p)}/>`,
    `<rect x="-50" y="60" width="100" height="36" rx="7" fill="${p.body}" ${st(p)}/>`,
    `<rect x="-26" y="71" width="52" height="14" rx="3" fill="${p.metal}"/>`,
  ].join("");
}

function medal(p: Pal) {
  return [
    `<path d="M58 -100 L24 -100 L-14 -10 L20 -10 Z" fill="${p.redL}" ${st(p)}/>`,
    `<path d="M-58 -100 L-24 -100 L14 -10 L-20 -10 Z" fill="${p.red}" ${st(p)}/>`,
    `<circle cx="0" cy="40" r="60" fill="${p.paper}" ${st(p)}/>`,
    `<circle cx="0" cy="40" r="46" fill="none" stroke="${p.red === "none" ? p.ink : p.redL}" stroke-width="${p.sw * 0.7}" stroke-dasharray="2 9" stroke-linecap="round"/>`,
    g(crown(p, { tips: true, gem: C.w }), 0, 44, 0.34),
  ].join("");
}

function qr(x: number, y: number, size: number, ink: string, seed: number) {
  const n = 11;
  const m = size / n;
  const r = rng(seed);
  const cells: string[] = [];
  const finder = (i: number, j: number) => {
    const inBox = (a: number, b: number) => i >= a && i < a + 3 && j >= b && j < b + 3;
    return inBox(0, 0) || inBox(n - 3, 0) || inBox(0, n - 3);
  };
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (finder(i, j)) continue;
      if (r() > 0.52)
        cells.push(
          `<rect x="${(x + i * m).toFixed(2)}" y="${(y + j * m).toFixed(2)}" width="${m.toFixed(2)}" height="${m.toFixed(2)}"/>`,
        );
    }
  for (const [i, j] of [
    [0, 0],
    [n - 3, 0],
    [0, n - 3],
  ]) {
    const fx = x + i * m;
    const fy = y + j * m;
    cells.push(
      `<rect x="${fx + m * 0.5}" y="${fy + m * 0.5}" width="${m * 2}" height="${m * 2}" fill="none" stroke="${ink}" stroke-width="${m}"/>`,
    );
    cells.push(`<rect x="${fx + m}" y="${fy + m}" width="${m}" height="${m}"/>`);
  }
  return `<g fill="${ink}">${cells.join("")}</g>`;
}

function ticket(p: Pal) {
  const shape =
    "M-100 -45 Q-100 -55 -90 -55 L28 -55 A12 12 0 0 0 52 -55 L90 -55 Q100 -55 100 -45 L100 45 Q100 55 90 55 L52 55 A12 12 0 0 0 28 55 L-90 55 Q-100 55 -100 45 Z";
  const left =
    "M-100 -45 Q-100 -55 -90 -55 L28 -55 A12 12 0 0 0 40 -43 L40 43 A12 12 0 0 0 28 55 L-90 55 Q-100 55 -100 45 Z";
  const lineMode = p.paper === "none";
  return [
    `<path d="${shape}" fill="${p.paper}"/>`,
    `<path d="${left}" fill="${p.red}"/>`,
    lineMode
      ? ""
      : `<circle cx="-74" cy="-28" r="6" fill="${C.w}"/><circle cx="-56" cy="-28" r="6" fill="${C.w}"/><circle cx="-38" cy="-28" r="6" fill="${C.w}"/>`,
    `<rect x="-80" y="-4" width="92" height="11" rx="5.5" fill="${lineMode ? p.ink : C.w}"/>`,
    `<rect x="-80" y="17" width="60" height="11" rx="5.5" fill="${lineMode ? p.ink : C.w}" opacity="${lineMode ? 1 : 0.6}"/>`,
    `<line x1="40" y1="-36" x2="40" y2="36" stroke="${p.ink}" stroke-width="3.5" stroke-dasharray="5 7" stroke-linecap="round"/>`,
    qr(50, -21, 42, p.ink, 7),
    `<path d="${shape}" fill="none" ${st(p)}/>`,
  ].join("");
}

function laptop(p: Pal) {
  return [
    `<rect x="-82" y="-82" width="164" height="110" rx="11" fill="${p.body}" ${st(p)}/>`,
    `<rect x="-68" y="-68" width="136" height="82" rx="4" fill="${p.screen}"/>`,
    `<g fill="none" stroke="${p.glyph}" stroke-width="${p.sw * 1.2}" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="M-30 -48 L-48 -30 L-30 -12"/><path d="M-7 -4 L9 -56"/><path d="M30 -48 L48 -30 L30 -12"/>`,
    `</g>`,
    `<path d="M-104 30 L104 30 L94 52 Q91 58 84 58 L-84 58 Q-91 58 -94 52 Z" fill="${p.metal}" ${st(p)}/>`,
    `<rect x="-22" y="30" width="44" height="8" rx="4" fill="${p.ink}" opacity="${p.paper === "none" ? 1 : 0.25}"/>`,
  ].join("");
}

/**
 * A thick outlined stroke (rope, cable, boom). In line mode it becomes a
 * hollow outline through a mask, so it never turns into a solid bar.
 */
function tube(d: string, width: number, fill: string, p: Pal) {
  if (fill === "none") {
    const m = uid("tube");
    return `<defs><mask id="${m}" maskUnits="userSpaceOnUse" x="-200" y="-200" width="400" height="400"><path d="${d}" fill="none" stroke="#fff" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#000" stroke-width="${width - 2 * p.sw}" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><path d="${d}" fill="none" stroke="${p.ink}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" mask="url(#${m})"/>`;
  }
  return `<path d="${d}" fill="none" stroke="${p.ink}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${fill}" stroke-width="${width - 2 * p.sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

type Pt = [number, number];
const bez = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
  const u = 1 - t;
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
  ];
};

function volleyball(p: Pal) {
  const id = uid("vb");
  const R = 88;
  const band =
    "M0 0 C30 -18 52 -54 48 -100 L82 -86 C86 -44 62 -6 22 14 Z";
  const bands = [0, 120, 240]
    .map((r) => `<path d="${band}" transform="rotate(${r})" fill="${p.redL}" ${st(p, 0.7)}/>`)
    .join("");
  return [
    `<clipPath id="${id}"><circle r="${R}"/></clipPath>`,
    `<circle r="${R}" fill="${p.paper}"/>`,
    `<g clip-path="url(#${id})">${bands}</g>`,
    p.paper !== "none"
      ? `<path d="M-60 -36 A70 70 0 0 1 -30 -62" fill="none" stroke="${C.w}" stroke-width="8" stroke-linecap="round" opacity=".6"/>`
      : "",
    `<circle r="${R}" fill="none" ${st(p)}/>`,
  ].join("");
}

function tugOfWar(p: Pal) {
  const A: Pt = [-92, 18];
  const B: Pt = [-40, -22];
  const Cc: Pt = [40, 34];
  const D: Pt = [92, -8];
  const d = `M${A} C${B} ${Cc} ${D}`;
  const ticks: string[] = [];
  for (let i = 1; i < 14; i++) {
    const t = i / 14;
    const [x, y] = bez(A, B, Cc, D, t);
    if (Math.abs(x) < 16) continue;
    ticks.push(`<path d="M${(x - 5).toFixed(1)} ${(y + 8).toFixed(1)} L${(x + 5).toFixed(1)} ${(y - 8).toFixed(1)}" ${st(p, 0.45)}/>`);
  }
  const [mx, my] = bez(A, B, Cc, D, 0.5);
  return [
    tube(d, 30, p.paper, p),
    ticks.join(""),
    `<circle cx="${A[0]}" cy="${A[1]}" r="17" fill="${p.redD}" ${st(p, 0.8)}/>`,
    `<circle cx="${D[0]}" cy="${D[1]}" r="17" fill="${p.redD}" ${st(p, 0.8)}/>`,
    `<path d="M${mx - 10} ${my - 4} L${mx + 10} ${my - 4} L${mx + 14} ${my + 56} L${mx} ${my + 44} L${mx - 14} ${my + 56} Z" fill="${p.red}" ${st(p, 0.8)}/>`,
    `<line x1="-24" y1="80" x2="24" y2="80" stroke="${p.ink}" stroke-width="${p.sw * 0.6}" stroke-dasharray="4 8" stroke-linecap="round"/>`,
  ].join("");
}

function whistle(p: Pal) {
  return [
    tube("M-66 -22 C-96 -40 -98 -80 -70 -92", 12, p.redD, p),
    `<circle cx="-62" cy="-22" r="13" fill="none" ${st(p, 0.9)}/>`,
    `<path d="M88 -36 L-14 -36 A50 50 0 1 0 34 4 L88 4 Z" fill="${p.red}" ${st(p)}/>`,
    `<circle cx="-14" cy="14" r="17" fill="${p.redD}" ${st(p, 0.7)}/>`,
    `<rect x="18" y="-42" width="26" height="12" rx="4" fill="${p.body}" ${st(p, 0.6)}/>`,
    `<rect x="78" y="-30" width="10" height="28" rx="3" fill="${p.body}"/>`,
    p.paper !== "none"
      ? `<path d="M-46 -6 A36 36 0 0 1 -26 -26" fill="none" stroke="${C.w}" stroke-width="7" stroke-linecap="round" opacity=".5"/>`
      : "",
  ].join("");
}

function megaphone(p: Pal) {
  return [
    `<path d="M-30 30 L-22 76 L-2 76 L-6 26 Z" fill="${p.body}" ${st(p)}/>`,
    `<path d="M-44 -30 L54 -72 L54 72 L-44 30 Z" fill="${p.red}" ${st(p)}/>`,
    `<path d="M-30 -18 L40 -48 L40 -30 L-30 -4 Z" fill="${p.redL}" opacity="${p.redL === "none" ? 0 : 0.8}"/>`,
    `<ellipse cx="54" cy="0" rx="16" ry="72" fill="${p.redD}" ${st(p)}/>`,
    `<rect x="-72" y="-30" width="32" height="60" rx="8" fill="${p.body}" ${st(p)}/>`,
    `<path d="M82 -34 Q94 0 82 34" fill="none" stroke="${p.glyph}" stroke-width="${p.sw}" stroke-linecap="round"/>`,
    `<path d="M92 -56 Q114 0 92 56" fill="none" stroke="${p.glyph}" stroke-width="${p.sw}" stroke-linecap="round" opacity=".6"/>`,
  ].join("");
}

function flag(p: Pal) {
  return [
    `<rect x="-76" y="-90" width="12" height="190" rx="6" fill="${p.metal}" ${st(p, 0.8)}/>`,
    `<circle cx="-70" cy="-94" r="11" fill="${p.redL}" ${st(p, 0.8)}/>`,
    `<path d="M-64 -82 Q8 -96 94 -50 Q14 -18 -64 -6 Z" fill="${p.red}" ${st(p)}/>`,
    p.redD !== "none" ? `<path d="M-64 -30 Q14 -36 70 -40 Q14 -18 -64 -6 Z" fill="${p.redD}" opacity=".6"/>` : "",
    dots3(-38, -46, 6.5, 20, p.paper === "none" ? p.ink : C.w),
  ].join("");
}

function sneaker(p: Pal) {
  const upper =
    "M-94 26 L-94 -14 C-94 -34 -80 -44 -62 -44 L-42 -44 C-30 -44 -26 -66 -8 -66 L12 -66 C22 -44 44 -24 72 -14 C92 -8 98 8 98 26 Z";
  return [
    `<path d="${upper}" fill="${p.paper}" ${st(p)}/>`,
    `<path d="M-94 -14 C-94 -34 -80 -44 -62 -44 L-56 -44 L-56 26 L-94 26 Z" fill="${p.red}" ${st(p)}/>`,
    `<path d="M52 -20 C76 -12 96 0 98 26 L58 26 C56 8 52 -6 40 -16 Z" fill="${p.redL}" ${st(p, 0.8)}/>`,
    [0, 1, 2]
      .map((i) => `<line x1="${-4 + i * 14}" y1="${-56 + i * 12}" x2="${14 + i * 14}" y2="${-62 + i * 12}" ${st(p, 0.6)}/>`)
      .join(""),
    dots3(-30, 0, 6, 18, p.red === "none" ? p.ink : p.red),
    `<rect x="-100" y="20" width="204" height="26" rx="12" fill="${p.body}" ${st(p)}/>`,
    `<line x1="-84" y1="33" x2="88" y2="33" stroke="${p.paper === "none" ? p.ink : C.w}" stroke-width="3" stroke-dasharray="8 8" stroke-linecap="round" opacity=".5"/>`,
  ].join("");
}

function jersey(p: Pal) {
  const shirt =
    "M-38 -82 L-92 -52 L-70 -6 L-50 -18 L-50 90 L50 90 L50 -18 L70 -6 L92 -52 L38 -82 C28 -62 -28 -62 -38 -82 Z";
  return [
    `<path d="${shirt}" fill="${p.red}" ${st(p)}/>`,
    `<path d="M-92 -52 L-70 -6 L-60 -12 L-82 -58 Z" fill="${p.redD}" ${st(p, 0.6)}/>`,
    `<path d="M92 -52 L70 -6 L60 -12 L82 -58 Z" fill="${p.redD}" ${st(p, 0.6)}/>`,
    `<path d="M-38 -82 C-28 -62 28 -62 38 -82" fill="none" ${st(p)}/>`,
    `<path d="M-30 -80 C-20 -50 20 -50 30 -80" fill="${p.paper}" ${st(p, 0.7)}/>`,
    `<path d="${GLYPH_3_PATH}" fill="${p.paper === "none" ? p.ink : C.w}" transform="translate(0 18) scale(.32) translate(-161 -247.5)"/>`,
  ].join("");
}

function cone(p: Pal) {
  const hw = (y: number) => 14 + ((y + 84) / 144) * 44;
  const band = (y0: number, y1: number) =>
    `<path d="M${-hw(y0)} ${y0} L${hw(y0)} ${y0} L${hw(y1)} ${y1} L${-hw(y1)} ${y1} Z" fill="${p.paper}"/>`;
  return [
    `<rect x="-86" y="54" width="172" height="24" rx="7" fill="${p.redD}" ${st(p)}/>`,
    `<path d="M-14 -84 L14 -84 L58 60 L-58 60 Z" fill="${p.red}" ${st(p)}/>`,
    band(-40, -16),
    band(10, 32),
    p.paper === "none"
      ? `<path d="M${-hw(-40)} -40 L${hw(-40)} -40 M${-hw(-16)} -16 L${hw(-16)} -16 M${-hw(10)} 10 L${hw(10)} 10 M${-hw(32)} 32 L${hw(32)} 32" ${st(p, 0.6)}/>`
      : "",
    `<path d="M-14 -84 L14 -84 L58 60 L-58 60 Z" fill="none" ${st(p)}/>`,
    `<rect x="-18" y="-92" width="36" height="12" rx="6" fill="${p.redD}" ${st(p, 0.7)}/>`,
  ].join("");
}

const SEG: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
};
function digit(ch: string, x: number, y: number, w: number, h: number, t: number, fill: string) {
  const r: Record<string, [number, number, number, number]> = {
    a: [x, y, w, t],
    b: [x + w - t, y, t, h / 2],
    c: [x + w - t, y + h / 2, t, h / 2],
    d: [x, y + h - t, w, t],
    e: [x, y + h / 2, t, h / 2],
    f: [x, y, t, h / 2],
    g: [x, y + h / 2 - t / 2, w, t],
  };
  return [...SEG[ch]]
    .map((s) => {
      const [a, b, c, d] = r[s];
      return `<rect x="${a}" y="${b}" width="${c}" height="${d}" rx="${t / 2}" fill="${fill}"/>`;
    })
    .join("");
}

function scoreboard(p: Pal) {
  return [
    `<rect x="-60" y="50" width="14" height="46" fill="${p.metal}" ${st(p, 0.7)}/>`,
    `<rect x="46" y="50" width="14" height="46" fill="${p.metal}" ${st(p, 0.7)}/>`,
    `<rect x="-98" y="-64" width="196" height="122" rx="14" fill="${p.body}" ${st(p)}/>`,
    `<rect x="-40" y="-84" width="80" height="24" rx="6" fill="${p.red}" ${st(p)}/>`,
    `<rect x="-82" y="-44" width="66" height="86" rx="6" fill="${p.screen}"/>`,
    `<rect x="16" y="-44" width="66" height="86" rx="6" fill="${p.screen}"/>`,
    digit("3", -66, -32, 34, 62, 8, p.glyph),
    digit("1", 32, -32, 34, 62, 8, p.paper === "none" ? p.ink : C.w),
    `<circle cx="0" cy="-12" r="5" fill="${p.glyph}"/><circle cx="0" cy="14" r="5" fill="${p.glyph}"/>`,
  ].join("");
}

function headset(p: Pal) {
  return [
    `<path d="M-80 12 A80 80 0 0 1 80 12 L64 12 A64 64 0 0 0 -64 12 Z" fill="${p.body}" ${st(p)}/>`,
    tube("M-70 64 Q-62 98 -18 94", 12, p.body, p),
    `<circle cx="-14" cy="94" r="11" fill="${p.redL}" ${st(p, 0.7)}/>`,
    `<rect x="-96" y="-4" width="40" height="76" rx="16" fill="${p.red}" ${st(p)}/>`,
    `<rect x="56" y="-4" width="40" height="76" rx="16" fill="${p.red}" ${st(p)}/>`,
    `<rect x="-62" y="6" width="12" height="56" rx="6" fill="${p.body}" ${st(p, 0.6)}/>`,
    `<rect x="50" y="6" width="12" height="56" rx="6" fill="${p.body}" ${st(p, 0.6)}/>`,
    p.paper !== "none"
      ? `<path d="M-84 8 L-84 30" stroke="${C.w}" stroke-width="6" stroke-linecap="round" opacity=".5"/><path d="M68 8 L68 30" stroke="${C.w}" stroke-width="6" stroke-linecap="round" opacity=".5"/>`
      : "",
  ].join("");
}

function keyboard(p: Pal) {
  const keys: string[] = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 8; col++) {
      const x = -84 + col * 21 + row * 5;
      const y = -36 + row * 21;
      if (x > 70) continue;
      // W, then A S D under it
      const wasd = (row === 0 && col === 1) || (row === 1 && col <= 2);
      keys.push(
        `<rect x="${x}" y="${y}" width="16" height="16" rx="4" fill="${wasd ? p.redL : p.paper}" ${st(p, 0.4)}/>`,
      );
    }
  keys.push(`<rect x="-46" y="27" width="92" height="16" rx="5" fill="${p.paper}" ${st(p, 0.4)}/>`);
  return [
    `<rect x="-100" y="-50" width="200" height="104" rx="14" fill="${p.body}" ${st(p)}/>`,
    keys.join(""),
    tube("M0 -50 C0 -80 40 -70 40 -96", 10, p.metal, p),
  ].join("");
}

function camera(p: Pal) {
  return [
    `<rect x="-36" y="-74" width="72" height="34" rx="9" fill="${p.body}" ${st(p)}/>`,
    `<rect x="-94" y="-52" width="188" height="120" rx="20" fill="${p.body}" ${st(p)}/>`,
    `<rect x="-94" y="-20" width="26" height="60" fill="${p.red}" ${st(p, 0.7)}/>`,
    `<circle cx="4" cy="10" r="48" fill="${p.metal}" ${st(p)}/>`,
    `<circle cx="4" cy="10" r="31" fill="${p.screen}" ${st(p, 0.7)}/>`,
    p.paper !== "none" ? `<circle cx="-8" cy="-2" r="8" fill="${C.w}" opacity=".85"/>` : "",
    `<circle cx="70" cy="-30" r="8" fill="${p.redL}" ${st(p, 0.5)}/>`,
    `<rect x="54" y="38" width="28" height="10" rx="5" fill="${p.metal}"/>`,
  ].join("");
}

function microphone(p: Pal) {
  const grill = [-70, -54, -38, -22]
    .map((y) => `<line x1="-24" y1="${y}" x2="24" y2="${y}" ${st(p, 0.4)}/>`)
    .join("");
  return [
    `<path d="M-54 -36 L-54 -14 A54 54 0 0 0 54 -14 L54 -36" fill="none" ${st(p, 1.3)}/>`,
    `<rect x="-7" y="38" width="14" height="40" fill="${p.metal}" ${st(p, 0.8)}/>`,
    `<rect x="-48" y="74" width="96" height="20" rx="10" fill="${p.body}" ${st(p)}/>`,
    `<rect x="-34" y="-98" width="68" height="104" rx="34" fill="${p.metal}" ${st(p)}/>`,
    grill,
    `<rect x="-34" y="-12" width="68" height="16" fill="${p.red}" ${st(p, 0.8)}/>`,
    `<rect x="-34" y="-98" width="68" height="104" rx="34" fill="none" ${st(p)}/>`,
  ].join("");
}

function phoneQr(p: Pal) {
  return [
    `<rect x="-58" y="-98" width="116" height="196" rx="20" fill="${p.body}" ${st(p)}/>`,
    `<rect x="-48" y="-82" width="96" height="156" rx="8" fill="${p.paper}"/>`,
    `<rect x="-16" y="-92" width="32" height="7" rx="3.5" fill="${p.screen === "none" ? p.ink : p.screen}"/>`,
    qr(-32, -50, 64, p.ink, 11),
    `<line x1="-42" y1="-18" x2="42" y2="-18" stroke="${p.glyph}" stroke-width="${p.sw * 0.8}" stroke-linecap="round"/>`,
    `<rect x="-30" y="34" width="60" height="10" rx="5" fill="${p.paper === "none" ? p.ink : C.z300}"/>`,
    `<circle cx="46" cy="66" r="24" fill="${p.red}" ${st(p)}/>`,
    `<path d="M35 66 L43 74 L58 58" fill="none" stroke="${p.paper === "none" ? p.ink : C.w}" stroke-width="${p.sw}" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join("");
}

function calendar(p: Pal) {
  const cells: string[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      const x = -58 + c * 36;
      const y = -2 + r * 28;
      if (r === 1 && c === 2) continue;
      cells.push(`<rect x="${x}" y="${y}" width="16" height="12" rx="3" fill="${p.paper === "none" ? p.ink : C.z300}"/>`);
    }
  return [
    `<rect x="-86" y="-70" width="172" height="162" rx="16" fill="${p.paper}" ${st(p)}/>`,
    `<path d="M-86 -24 L-86 -54 Q-86 -70 -70 -70 L70 -70 Q86 -70 86 -54 L86 -24 Z" fill="${p.red}" ${st(p)}/>`,
    `<rect x="-52" y="-92" width="16" height="38" rx="8" fill="${p.body}" ${st(p, 0.7)}/>`,
    `<rect x="36" y="-92" width="16" height="38" rx="8" fill="${p.body}" ${st(p, 0.7)}/>`,
    cells.join(""),
    `<circle cx="22" cy="32" r="17" fill="${p.redL}" ${st(p, 0.7)}/>`,
    `<path d="M14 32 L20 38 L31 26" fill="none" stroke="${p.paper === "none" ? p.ink : C.w}" stroke-width="${p.sw * 0.8}" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join("");
}

function mapPin(p: Pal) {
  return [
    p.shade !== "none" ? `<ellipse cx="0" cy="94" rx="44" ry="9" fill="${p.shade}"/>` : "",
    `<path d="M0 92 C-22 56 -72 18 -72 -28 A72 72 0 0 1 72 -28 C72 18 22 56 0 92 Z" fill="${p.red}" ${st(p)}/>`,
    `<circle cx="0" cy="-28" r="38" fill="${p.paper}" ${st(p, 0.8)}/>`,
    g(crown(p), 0, -24, 0.3),
    p.paper !== "none"
      ? `<path d="M-52 -50 A60 60 0 0 1 -30 -82" fill="none" stroke="${C.w}" stroke-width="7" stroke-linecap="round" opacity=".45"/>`
      : "",
  ].join("");
}

function server(p: Pal) {
  const unit = (y: number, i: number) =>
    [
      `<rect x="-82" y="${y}" width="164" height="46" rx="10" fill="${p.body}" ${st(p)}/>`,
      `<circle cx="-56" cy="${y + 23}" r="7" fill="${i === 1 ? p.redL : p.paper}" ${st(p, 0.4)}/>`,
      `<circle cx="-34" cy="${y + 23}" r="7" fill="${p.metal}" ${st(p, 0.4)}/>`,
      [0, 1, 2, 3]
        .map((k) => `<line x1="${10 + k * 16}" y1="${y + 14}" x2="${10 + k * 16}" y2="${y + 32}" ${st(p.metal !== "none" ? { ...p, ink: C.z500 } : p, 0.5)}/>`)
        .join(""),
    ].join("");
  return [
    unit(-62, 0),
    unit(-12, 1),
    unit(38, 2),
    `<path d="M30 -70 A18 18 0 0 1 52 -92 A24 24 0 0 1 96 -84 A16 16 0 0 1 96 -54 L36 -54 A14 14 0 0 1 30 -70 Z" fill="${p.paper}" ${st(p, 0.8)}/>`,
  ].join("");
}

function bottle(p: Pal) {
  return [
    `<rect x="-24" y="-90" width="48" height="36" rx="9" fill="${p.body}" ${st(p)}/>`,
    `<rect x="-14" y="-98" width="28" height="12" rx="4" fill="${p.redD}" ${st(p, 0.6)}/>`,
    `<path d="M-38 -48 Q-38 -60 -24 -60 L24 -60 Q38 -60 38 -48 L38 82 Q38 96 24 96 L-24 96 Q-38 96 -38 82 Z" fill="${p.red}" ${st(p)}/>`,
    `<rect x="-38" y="-6" width="76" height="46" fill="${p.paper}" ${st(p, 0.8)}/>`,
    dots3(-18, 17, 6, 18, p.red === "none" ? p.ink : p.red),
    p.paper !== "none"
      ? `<path d="M-24 -44 L-24 -16 M-24 54 L-24 80" stroke="${C.w}" stroke-width="7" stroke-linecap="round" opacity=".45"/>`
      : "",
  ].join("");
}

function spotlight(p: Pal) {
  const lamps: string[] = [];
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++)
      lamps.push(`<circle cx="${-52 + c * 52}" cy="${-70 + r * 44}" r="17" fill="${p.paper}" ${st(p, 0.6)}/>`);
  return [
    `<path d="M-12 0 L12 0 L18 96 L-18 96 Z" fill="${p.metal}" ${st(p, 0.8)}/>`,
    `<rect x="-36" y="-6" width="72" height="14" rx="5" fill="${p.body}" ${st(p, 0.7)}/>`,
    `<rect x="-84" y="-98" width="168" height="98" rx="12" fill="${p.body}" ${st(p)}/>`,
    lamps.join(""),
    p.redL !== "none"
      ? lamps.map((_, i) => `<circle cx="${-52 + (i % 3) * 52 - 5}" cy="${-70 + Math.floor(i / 3) * 44 - 5}" r="5" fill="${C.r200}"/>`).join("")
      : "",
    `<rect x="-84" y="-98" width="168" height="10" rx="5" fill="${p.red}"/>`,
  ].join("");
}

function staffCard(p: Pal) {
  return [
    tube("M-40 -100 L-12 -64", 14, p.red, p),
    tube("M40 -100 L12 -64", 14, p.red, p),
    `<rect x="-14" y="-72" width="28" height="18" rx="5" fill="${p.metal}" ${st(p, 0.7)}/>`,
    `<rect x="-64" y="-58" width="128" height="156" rx="14" fill="${p.paper}" ${st(p)}/>`,
    `<path d="M-64 -24 L-64 -44 Q-64 -58 -50 -58 L50 -58 Q64 -58 64 -44 L64 -24 Z" fill="${p.red}" ${st(p, 0.8)}/>`,
    `<circle cx="0" cy="10" r="20" fill="${p.metal}" ${st(p, 0.7)}/>`,
    `<path d="M-30 56 C-30 36 30 36 30 56 Z" fill="${p.metal}" ${st(p, 0.7)}/>`,
    `<rect x="-38" y="68" width="76" height="10" rx="5" fill="${p.paper === "none" ? p.ink : C.z300}"/>`,
    dots3(-18, -41, 5, 18, p.paper === "none" ? p.ink : C.w),
  ].join("");
}

/** The "3K" glyph of the favicon, around its own centre (≈356×217). */
const GLYPH_3K =
  "M160.3 355.8L160.3 355.8Q137.4 355.8 119.6 348.0Q101.8 340.1 91.6 326.1Q81.3 312.1 81.0 293.8L81.0 293.8L124.5 293.8Q124.9 301.7 129.7 307.6Q134.4 313.5 142.5 316.8Q150.5 320.0 160.5 320.0L160.5 320.0Q170.9 320.0 178.9 316.4Q186.8 312.8 191.3 306.3Q195.9 299.8 195.9 291.1L195.9 291.1Q195.9 282.3 191.1 275.7Q186.4 269.0 177.6 265.3Q168.8 261.5 156.5 261.5L156.5 261.5L137.0 261.5L137.0 229.4L156.5 229.4Q166.8 229.4 174.6 225.8Q182.4 222.2 186.9 215.9Q191.3 209.6 191.3 201.1L191.3 201.1Q191.3 192.8 187.5 186.8Q183.7 180.7 176.8 177.2Q169.9 173.7 160.7 173.7L160.7 173.7Q151.5 173.7 143.9 177.1Q136.2 180.4 131.6 186.3Q126.9 192.3 126.8 200.5L126.8 200.5L85.1 200.5Q85.4 182.5 95.4 168.6Q105.4 154.8 122.5 147.0Q139.6 139.2 161.0 139.2L161.0 139.2Q182.7 139.2 199.0 147.1Q215.3 155.0 224.2 168.5Q233.2 181.9 233.2 198.4L233.2 198.4Q233.2 216.1 222.3 228.0Q211.3 239.9 193.7 243.3L193.7 243.3L193.7 244.8Q209.0 246.8 219.6 253.5Q230.1 260.1 235.5 270.4Q240.9 280.8 240.9 294.0L240.9 294.0Q240.9 311.8 230.5 325.8Q220.2 339.8 202.0 347.8Q183.8 355.8 160.3 355.8ZM298.5 353L255.3 353L255.3 142.0L298.5 142.0L298.5 199.6L297.9 247.5Q298.9 245.8 299.9 244.3L299.9 244.3Q306.1 234.3 313.7 224.4Q321.2 214.4 330.8 202.6L330.8 202.6L382.5 142.0L435.3 142.0L356.4 233.3L437.6 353L386.4 353L326.4 261.8L298.5 292.7L298.5 353Z";
/** Just the "3" of that glyph, centred near 161,247.5. */
const GLYPH_3_PATH = `${GLYPH_3K.split("ZM")[0]}Z`;
const glyph3k = (fill: string, x: number, y: number, s: number) =>
  `<path d="${GLYPH_3K}" fill="${fill}" transform="translate(${x} ${y}) scale(${s}) translate(-259.3 -247.5)"/>`;

/** Three ranked blocks, bottom centre at 0,0, with a crown on each. */
function podium(p: Pal) {
  const block = (x0: number, x1: number, top: number, band: string) =>
    [
      `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${-top}" fill="${p.paper}" ${st(p)}/>`,
      `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="28" fill="${band}" ${st(p)}/>`,
    ].join("");
  const pips = (cx: number, cy: number, n: number) =>
    Array.from(
      { length: n },
      (_, i) => `<circle cx="${cx + (i - (n - 1) / 2) * 26}" cy="${cy}" r="8" fill="${p.red}"/>`,
    ).join("");
  const crownOn = (cx: number, top: number, s: number) =>
    g(crown(p), cx, top - 64 * s - 1, s);
  return [
    p.shade !== "none" ? `<rect x="-120" y="-212" width="240" height="212" fill="none"/>` : "",
    block(-300, -100, -150, p.redL),
    block(100, 300, -104, p.redD),
    block(-104, 104, -236, p.red),
    p.shade !== "none"
      ? `<rect x="-300" y="-122" width="20" height="122" fill="${p.shade}" opacity=".7"/><rect x="104" y="-76" width="20" height="76" fill="${p.shade}" opacity=".7"/><rect x="-104" y="-208" width="20" height="208" fill="${p.shade}" opacity=".7"/>`
      : "",
    pips(-200, -70, 2),
    pips(200, -44, 3),
    glyph3k(p.red === "none" ? p.ink : p.red, 0, -112, 0.42),
    crownOn(-200, -150, 0.62),
    crownOn(200, -104, 0.62),
    crownOn(0, -236, 0.86),
  ].join("");
}

// ── decoration ─────────────────────────────────────────────────────────────

const sparkle = (x: number, y: number, s: number, fill: string, r = 0) =>
  `<path d="M0 -1 C.1 -.1 .1 -.1 1 0 C.1 .1 .1 .1 0 1 C-.1 .1 -.1 .1 -1 0 C-.1 -.1 -.1 -.1 0 -1 Z" fill="${fill}" transform="translate(${x} ${y}) rotate(${r}) scale(${s})"/>`;

const dots3 = (x: number, y: number, r: number, gap: number, fill: string) =>
  [0, 1, 2].map((i) => `<circle cx="${x + i * gap}" cy="${y}" r="${r}" fill="${fill}"/>`).join("");

/** A circuit trace: a polyline with a ring at the far end. */
const trace = (pts: [number, number][], color: string, sw: number, bg: string, node = sw * 2.2) => {
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const [ex, ey] = pts[pts.length - 1];
  const [sx, sy] = pts[0];
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${sx}" cy="${sy}" r="${sw * 1.1}" fill="${color}"/><circle cx="${ex}" cy="${ey}" r="${node}" fill="${bg}" stroke="${color}" stroke-width="${sw}"/>`;
};

function dotGrid(w: number, h: number, gap: number, r: number, fill: string, opacity = 1) {
  const id = uid("dots");
  return `<defs><pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse"><circle cx="${gap / 2}" cy="${gap / 2}" r="${r}" fill="${fill}"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#${id})" opacity="${opacity}"/>`;
}

function fadedDotGrid(w: number, h: number, gap: number, r: number, fill: string, cx: number, cy: number, rad: number) {
  const m = uid("fade");
  const gr = uid("fadeg");
  return `<defs><radialGradient id="${gr}" cx="${cx}" cy="${cy}" r="${rad}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><mask id="${m}"><rect width="${w}" height="${h}" fill="url(#${gr})"/></mask></defs><g mask="url(#${m})">${dotGrid(w, h, gap, r, fill)}</g>`;
}

const svg = (w: number, h: number, body: string, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><title>${title}</title>${body}</svg>\n`;

// ── items table ────────────────────────────────────────────────────────────

const ITEMS = {
  crown: (p: Pal) => crown(p),
  football,
  basketball,
  badminton: shuttlecock,
  "table-tennis": paddle,
  esports: gamepad,
  petanque,
  athletics: stopwatch,
  trophy,
  medal,
  ticket,
  code: laptop,
  volleyball,
  "tug-of-war": tugOfWar,
  whistle,
  megaphone,
  flag,
  sneaker,
  jersey,
  cone,
  scoreboard,
  headset,
  keyboard,
  camera,
  microphone,
  "phone-qr": phoneQr,
  calendar,
  "map-pin": mapPin,
  server,
  bottle,
  spotlight,
  "staff-card": staffCard,
} satisfies Record<string, (p: Pal) => string>;
type Item = keyof typeof ITEMS;

// ── compositions ───────────────────────────────────────────────────────────

type Placed = [Item, number, number, number, number]; // item, x, y, scale, rotate
const place = (p: Pal, list: Placed[]) => list.map(([k, x, y, s, r]) => g(ITEMS[k](p), x, y, s, r)).join("");

function hero(dark: boolean) {
  const W = 1600;
  const H = 900;
  const bg = dark ? C.z950 : C.w;
  const traceC = dark ? C.r800 : C.r200;
  const glow = uid("glow");
  const body = [
    `<rect width="${W}" height="${H}" fill="${bg}"/>`,
    fadedDotGrid(W, H, 30, 1.8, dark ? C.z700 : C.z300, 800, 470, 820),
    dark
      ? `<defs><radialGradient id="${glow}"><stop offset="0" stop-color="${C.r700}" stop-opacity=".55"/><stop offset="1" stop-color="${C.r700}" stop-opacity="0"/></radialGradient></defs><circle cx="800" cy="520" r="520" fill="url(#${glow})"/>`
      : `<circle cx="800" cy="520" r="400" fill="${C.r50}"/><circle cx="800" cy="520" r="470" fill="none" stroke="${C.r100}" stroke-width="3" stroke-dasharray="2 14" stroke-linecap="round"/>`,
    // circuit traces fanning out from the podium base
    trace([[500, 770], [330, 770], [290, 810], [110, 810]], traceC, 5, bg),
    trace([[500, 745], [400, 745], [360, 705], [200, 705], [170, 675]], traceC, 5, bg),
    trace([[1100, 770], [1270, 770], [1310, 810], [1490, 810]], traceC, 5, bg),
    trace([[1100, 745], [1200, 745], [1240, 705], [1400, 705], [1430, 675]], traceC, 5, bg),
    `<rect x="440" y="768" width="720" height="10" rx="5" fill="${dark ? C.z800 : C.z200}"/>`,
    g(podium(FULL), 800, 770),
    place(FULL, [
      ["table-tennis", 250, 520, 0.72, -24],
      ["football", 390, 300, 0.82, -12],
      ["badminton", 600, 150, 0.62, -28],
      ["esports", 800, 95, 0.62, 0],
      ["basketball", 1010, 160, 0.7, 10],
      ["petanque", 1215, 310, 0.72, 0],
      ["athletics", 1350, 540, 0.66, 14],
    ]),
    sparkle(500, 400, 18, C.r500, 0),
    sparkle(1110, 420, 14, C.r500, 0),
    sparkle(700, 290, 10, dark ? C.w : C.r300),
    sparkle(930, 300, 12, dark ? C.w : C.r300),
    sparkle(160, 380, 12, dark ? C.w : C.r300),
    sparkle(1460, 400, 16, dark ? C.w : C.r300),
    dots3(1240, 140, 7, 22, C.r700),
    dots3(310, 160, 7, 22, dark ? C.w : C.z900),
  ].join("");
  return svg(W, H, body, `IT·3·Kings hero ${dark ? "dark" : "light"}`);
}

/** Crown whose jewels are balls, ringed by the other sports. */
function crownCluster(p: Pal, crownPal: Pal, traceC: string, bg: string) {
  const s = 2.5;
  return [
    trace([[-120, 150], [-120, 230], [-200, 310], [-200, 470]], traceC, 7, bg, 16),
    trace([[-40, 150], [-40, 300], [-90, 350], [-90, 470]], traceC, 7, bg, 16),
    trace([[40, 150], [40, 280], [110, 350], [110, 470]], traceC, 7, bg, 16),
    trace([[120, 150], [120, 210], [230, 320], [230, 470]], traceC, 7, bg, 16),
    g(crown(crownPal, { tips: false }), 0, 0, s),
    g(football(p), -96 * s, -52 * s - 30, 0.58, -12),
    g(basketball(p), 0, -80 * s - 36, 0.66, 8),
    g(petanque(p), 96 * s + 6, -52 * s - 30, 0.6),
  ].join("");
}

function poster() {
  const W = 1240;
  const H = 1754;
  const bg = C.r700;
  const body = [
    `<rect width="${W}" height="${H}" fill="${bg}"/>`,
    dotGrid(W, H, 34, 2.2, C.r600),
    `<circle cx="620" cy="1230" r="470" fill="${C.r800}"/>`,
    `<circle cx="620" cy="1230" r="540" fill="none" stroke="${C.r500}" stroke-width="4" stroke-dasharray="2 16" stroke-linecap="round"/>`,
    g(crownCluster(FULL, ON_RED, C.r500, bg), 620, 1200),
    place(FULL, [
      ["badminton", 220, 1010, 0.7, -30],
      ["table-tennis", 1030, 1020, 0.72, 22],
      ["esports", 230, 1480, 0.72, -10],
      ["athletics", 1020, 1480, 0.66, 12],
      ["medal", 130, 1250, 0.55, -8],
      ["ticket", 1110, 1260, 0.5, 16],
    ]),
    sparkle(380, 860, 20, C.w),
    sparkle(880, 880, 14, C.w),
    sparkle(1130, 820, 10, C.r200),
    sparkle(110, 900, 12, C.r200),
    sparkle(620, 760, 12, C.r200),
    dots3(96, 110, 9, 30, C.w),
  ].join("");
  return svg(W, H, body, "IT·3·Kings poster key visual (A4)");
}

function social() {
  const W = 1080;
  const H = 1080;
  const bg = C.z950;
  const glow = uid("glow");
  const body = [
    `<rect width="${W}" height="${H}" fill="${bg}"/>`,
    fadedDotGrid(W, H, 30, 1.8, C.z700, 540, 560, 640),
    `<defs><radialGradient id="${glow}"><stop offset="0" stop-color="${C.r700}" stop-opacity=".6"/><stop offset="1" stop-color="${C.r700}" stop-opacity="0"/></radialGradient></defs>`,
    `<circle cx="540" cy="560" r="480" fill="url(#${glow})"/>`,
    g(crownCluster(FULL, FULL, C.r800, bg), 540, 560, 0.86),
    place(FULL, [
      ["badminton", 170, 330, 0.62, -30],
      ["table-tennis", 910, 330, 0.62, 22],
      ["esports", 180, 820, 0.64, -10],
      ["athletics", 900, 820, 0.6, 12],
      ["code", 150, 580, 0.5, -6],
      ["trophy", 930, 580, 0.55, 8],
    ]),
    sparkle(320, 180, 16, C.w),
    sparkle(780, 170, 12, C.r300),
    sparkle(540, 960, 12, C.r300),
    dots3(80, 80, 8, 26, C.r500),
  ].join("");
  return svg(W, H, body, "IT·3·Kings social square");
}

function cover() {
  const W = 1640;
  const H = 624;
  const bg = C.r700;
  const body = [
    `<rect width="${W}" height="${H}" fill="${bg}"/>`,
    dotGrid(W, H, 30, 2, C.r600),
    `<circle cx="1220" cy="560" r="360" fill="${C.r800}"/>`,
    trace([[120, 560], [520, 560], [560, 520], [760, 520]], C.r500, 5, bg),
    trace([[80, 590], [640, 590], [670, 560], [860, 560]], C.r500, 5, bg),
    `<rect x="880" y="590" width="680" height="34" fill="${C.r800}"/>`,
    g(podium(FULL), 1220, 594, 0.86),
    place(FULL, [
      ["football", 900, 180, 0.6, -12],
      ["badminton", 1050, 90, 0.48, -26],
      ["esports", 1220, 70, 0.5, 0],
      ["basketball", 1390, 100, 0.52, 10],
      ["petanque", 1530, 220, 0.52, 0],
      ["athletics", 790, 380, 0.5, -14],
    ]),
    sparkle(980, 330, 14, C.w),
    sparkle(1460, 360, 12, C.w),
    sparkle(1600, 80, 10, C.r200),
    dots3(80, 70, 8, 26, C.w),
  ].join("");
  return svg(W, H, body, "IT·3·Kings cover banner");
}

function pattern(variant: "light" | "red" | "dark") {
  const T = 480;
  const bg = { light: C.r50, red: C.r700, dark: C.z950 }[variant];
  const p = variant === "light" ? FULL : line(variant === "red" ? C.w : C.z500, 7);
  const op = variant === "red" ? 0.22 : variant === "dark" ? 0.6 : 1;
  const order: Item[] = [
    "crown",
    "football",
    "esports",
    "badminton",
    "basketball",
    "ticket",
    "table-tennis",
    "trophy",
    "petanque",
    "athletics",
    "medal",
    "code",
    "crown",
    "football",
    "esports",
    "basketball",
  ];
  const r = rng(42);
  const cell = T / 4;
  const items: string[] = [];
  order.forEach((k, i) => {
    const cx = (i % 4) * cell + cell / 2 + ((Math.floor(i / 4) % 2) * cell) / 2 - cell / 4;
    const cy = Math.floor(i / 4) * cell + cell / 2;
    items.push(g(ITEMS[k](p), cx + (r() - 0.5) * 10, cy + (r() - 0.5) * 10, 0.3, Math.round((r() - 0.5) * 50)));
  });
  const deco: string[] = [];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const x = i * cell + (j % 2 ? cell : cell / 2);
      const y = j * cell;
      deco.push(
        variant === "light"
          ? sparkle(x % T, y, 6, C.r300)
          : `<circle cx="${x % T}" cy="${y}" r="3" fill="${p.ink}"/>`,
      );
    }
  // items never cross the tile edge, so the tile repeats cleanly
  const body = `<rect width="${T}" height="${T}" fill="${bg}"/><g opacity="${op}">${deco.join("")}${items.join("")}</g>`;
  return svg(T, T, body, `IT·3·Kings pattern tile (${variant})`);
}

const WIDE = new Set<Item>(["ticket", "esports", "keyboard", "tug-of-war", "sneaker", "scoreboard", "camera"]);

function spot(k: Item, dark = false) {
  const S = 800;
  const r = rng(k.length * 97 + k.charCodeAt(0));
  const glow = uid("glow");
  const deco = dark
    ? [
        `<rect width="${S}" height="${S}" fill="${C.z950}"/>`,
        fadedDotGrid(S, S, 28, 1.8, C.z700, 400, 410, 420),
        `<defs><radialGradient id="${glow}"><stop offset="0" stop-color="${C.r700}" stop-opacity=".7"/><stop offset="1" stop-color="${C.r700}" stop-opacity="0"/></radialGradient></defs>`,
        `<circle cx="400" cy="410" r="360" fill="url(#${glow})"/>`,
        `<circle cx="400" cy="410" r="350" fill="none" stroke="${C.r800}" stroke-width="4" stroke-dasharray="2 16" stroke-linecap="round"/>`,
        sparkle(150 + r() * 60, 170 + r() * 60, 22, C.w),
        sparkle(600 + r() * 60, 130 + r() * 50, 14, C.r300),
        sparkle(620 + r() * 50, 620 + r() * 50, 18, C.r300),
        dots3(110, 640, 9, 28, C.r500),
      ]
    : [
        `<circle cx="400" cy="410" r="300" fill="${C.r50}"/>`,
        `<circle cx="400" cy="410" r="350" fill="none" stroke="${C.r100}" stroke-width="4" stroke-dasharray="2 16" stroke-linecap="round"/>`,
        sparkle(150 + r() * 60, 170 + r() * 60, 22, C.r500),
        sparkle(600 + r() * 60, 130 + r() * 50, 14, C.r300),
        sparkle(620 + r() * 50, 620 + r() * 50, 18, C.r300),
        dots3(110, 640, 9, 28, C.r700),
        `<ellipse cx="400" cy="${k === "crown" ? 610 : 660}" rx="190" ry="18" fill="${C.z200}" opacity=".7"/>`,
      ];
  const s = k === "ticket" ? 2.6 : WIDE.has(k) ? 2.4 : 2.3;
  // Dark grounds swallow zinc-800 bodies, so lift them one step.
  const pal = dark ? { ...FULL, body: C.z700 } : FULL;
  return svg(S, S, deco.join("") + g(ITEMS[k](pal), 400, 400, s), `IT·3·Kings spot — ${k}${dark ? " (dark)" : ""}`);
}

function icon(k: Item, color: string) {
  const S = 512;
  const s = WIDE.has(k) ? 2.1 : 2;
  return svg(S, S, g(ITEMS[k](line(color, 7)), 256, 256, s), `IT·3·Kings icon — ${k}`);
}

function confetti(seed: number, n: number, x0: number, y0: number, w: number, h: number) {
  const r = rng(seed);
  const cols = [C.r700, C.r500, C.r300, C.z900];
  return Array.from({ length: n }, () => {
    const x = x0 + r() * w;
    const y = y0 + r() * h;
    const c = cols[Math.floor(r() * cols.length)];
    const rot = Math.round(r() * 180);
    return r() > 0.5
      ? `<rect x="${(x - 7).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="14" height="6" rx="3" fill="${c}" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`
      : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${c}"/>`;
  }).join("");
}

function story() {
  const W = 1080;
  const H = 1920;
  const bg = C.z950;
  const glow = uid("glow");
  const body = [
    `<rect width="${W}" height="${H}" fill="${bg}"/>`,
    fadedDotGrid(W, H, 32, 2, C.z700, 540, 1200, 900),
    `<defs><radialGradient id="${glow}"><stop offset="0" stop-color="${C.r700}" stop-opacity=".6"/><stop offset="1" stop-color="${C.r700}" stop-opacity="0"/></radialGradient></defs>`,
    `<circle cx="540" cy="1180" r="560" fill="url(#${glow})"/>`,
    g(crownCluster(FULL, FULL, C.r800, bg), 540, 1160, 0.95),
    place(FULL, [
      ["badminton", 170, 860, 0.62, -30],
      ["table-tennis", 910, 860, 0.62, 22],
      ["volleyball", 150, 1240, 0.5, 0],
      ["jersey", 930, 1240, 0.52, 8],
      ["esports", 190, 1620, 0.62, -10],
      ["athletics", 890, 1620, 0.58, 12],
      ["flag", 330, 1800, 0.45, -8],
      ["megaphone", 760, 1800, 0.45, -10],
    ]),
    sparkle(300, 720, 16, C.w),
    sparkle(800, 700, 12, C.r300),
    sparkle(540, 640, 10, C.r300),
    dots3(80, 100, 9, 30, C.r500),
  ].join("");
  return svg(W, H, body, "IT·3·Kings story (9:16)");
}

function emptyState(kind: "no-events" | "no-tickets" | "not-found" | "success") {
  const W = 800;
  const H = 600;
  const parts = [
    `<circle cx="400" cy="300" r="230" fill="${C.r50}"/>`,
    `<circle cx="400" cy="300" r="270" fill="none" stroke="${C.r100}" stroke-width="4" stroke-dasharray="2 16" stroke-linecap="round"/>`,
    `<ellipse cx="400" cy="500" rx="200" ry="16" fill="${C.z200}" opacity=".7"/>`,
  ];
  if (kind === "no-events") {
    parts.push(
      g(calendar(FULL), 370, 300, 1.55, -6),
      // magnifier
      `<g transform="translate(540 380) rotate(-30)"><rect x="-14" y="44" width="28" height="74" rx="12" fill="${C.z800}" stroke="${C.z900}" stroke-width="7" stroke-linejoin="round"/><circle r="54" fill="${C.w}" fill-opacity=".85" stroke="${C.z900}" stroke-width="10"/><path d="M-30 -18 A36 36 0 0 1 -6 -38" fill="none" stroke="${C.r300}" stroke-width="8" stroke-linecap="round"/></g>`,
      sparkle(190, 150, 18, C.r500),
      sparkle(620, 170, 12, C.r300),
      dots3(150, 470, 8, 24, C.r700),
    );
  } else if (kind === "no-tickets") {
    const ghost = { ...line(C.z300, 6) };
    parts.push(
      g(ticket(ghost), 430, 250, 1.5, 12),
      g(ticket(FULL), 370, 330, 1.5, -8),
      sparkle(180, 170, 18, C.r500),
      sparkle(640, 430, 14, C.r300),
      dots3(560, 140, 8, 24, C.r700),
    );
  } else if (kind === "not-found") {
    parts.push(
      `<path d="M300 400 Q420 120 590 330" fill="none" stroke="${C.r300}" stroke-width="5" stroke-dasharray="4 14" stroke-linecap="round"/>`,
      g(cone(FULL), 250, 380, 1.2),
      g(cone(FULL), 580, 452, 0.85, 72),
      g(football(FULL), 470, 220, 0.75, 20),
      sparkle(640, 170, 16, C.r500),
      sparkle(170, 200, 12, C.r300),
    );
  } else {
    parts.push(
      confetti(5, 46, 150, 70, 500, 260),
      g(phoneQr(FULL), 400, 300, 1.75, 4),
      sparkle(200, 380, 18, C.r500),
      sparkle(610, 400, 14, C.r300),
    );
  }
  return svg(W, H, parts.join(""), `IT·3·Kings empty state — ${kind}`);
}

function certificate() {
  const W = 1754;
  const H = 1240;
  const corner = (x: number, y: number, r: number) => g(dots3(-30, 0, 7, 30, C.r700), x, y, 1, r);
  const body = [
    `<rect width="${W}" height="${H}" fill="${C.w}"/>`,
    `<rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${C.r700}" stroke-width="8"/>`,
    `<rect x="64" y="64" width="${W - 128}" height="${H - 128}" fill="none" stroke="${C.r300}" stroke-width="2.5"/>`,
    corner(130, 110, 0),
    corner(W - 130, 110, 0),
    corner(130, H - 110, 0),
    corner(W - 130, H - 110, 0),
    `<circle cx="${W / 2}" cy="190" r="110" fill="${C.r50}"/>`,
    g(crown(FULL), W / 2, 196, 0.85),
    trace([[300, H - 150], [640, H - 150], [680, H - 190], [W / 2 - 60, H - 190]], C.r200, 4, C.w),
    trace([[W - 300, H - 150], [W - 640, H - 150], [W - 680, H - 190], [W / 2 + 60, H - 190]], C.r200, 4, C.w),
    g(medal(FULL), W - 230, H - 270, 0.95, 6),
    sparkle(W / 2 - 170, 140, 14, C.r300),
    sparkle(W / 2 + 170, 160, 18, C.r500),
  ].join("");
  return svg(W, H, body, "IT·3·Kings certificate frame (A4 landscape)");
}

function emailHeader() {
  const W = 1200;
  const H = 400;
  const bg = C.r700;
  const body = [
    `<rect width="${W}" height="${H}" fill="${bg}"/>`,
    dotGrid(W, H, 28, 2, C.r600),
    `<circle cx="600" cy="420" r="300" fill="${C.r800}"/>`,
    g(crown(ON_RED), 600, 230, 1.15),
    place(FULL, [
      ["football", 330, 210, 0.6, -12],
      ["esports", 150, 290, 0.5, -8],
      ["badminton", 440, 90, 0.42, -26],
      ["basketball", 870, 210, 0.6, 10],
      ["petanque", 1050, 290, 0.5, 0],
      ["athletics", 770, 90, 0.42, 14],
    ]),
    sparkle(230, 120, 12, C.w),
    sparkle(980, 110, 14, C.w),
    sparkle(600, 60, 10, C.r200),
  ].join("");
  return svg(W, H, body, "IT·3·Kings email header");
}

function kiosk() {
  const W = 1920;
  const H = 1080;
  const bg = C.z950;
  const glow = uid("glow");
  const body = [
    `<rect width="${W}" height="${H}" fill="${bg}"/>`,
    fadedDotGrid(W, H, 32, 2, C.z700, 1350, 540, 900),
    `<defs><radialGradient id="${glow}"><stop offset="0" stop-color="${C.r700}" stop-opacity=".6"/><stop offset="1" stop-color="${C.r700}" stop-opacity="0"/></radialGradient></defs>`,
    `<circle cx="1350" cy="560" r="560" fill="url(#${glow})"/>`,
    trace([[1180, 640], [980, 640], [930, 690], [600, 690]], C.r800, 6, bg),
    trace([[1180, 720], [1040, 720], [990, 770], [760, 770]], C.r800, 6, bg),
    trace([[1180, 480], [1060, 480], [1010, 430], [820, 430]], C.r800, 6, bg),
    g(phoneQr(FULL), 1350, 560, 2.7, 4),
    g(ticket(FULL), 1700, 300, 0.95, 14),
    g(staffCard(FULL), 1720, 820, 0.85, -10),
    confetti(9, 30, 1100, 120, 600, 160),
    sparkle(1060, 260, 20, C.w),
    sparkle(1620, 560, 14, C.r300),
    dots3(110, 110, 10, 34, C.r500),
  ].join("");
  return svg(W, H, body, "IT·3·Kings kiosk screen");
}

// ── write ──────────────────────────────────────────────────────────────────

type Out = { name: string; svg: string; png: number }; // png width
const outs: Out[] = [
  { name: "hero-light", svg: hero(false), png: 3200 },
  { name: "hero-dark", svg: hero(true), png: 3200 },
  { name: "poster-a4", svg: poster(), png: 2480 },
  { name: "social-square", svg: social(), png: 2160 },
  { name: "cover-banner", svg: cover(), png: 3280 },
  { name: "pattern-light", svg: pattern("light"), png: 960 },
  { name: "pattern-red", svg: pattern("red"), png: 960 },
  { name: "pattern-dark", svg: pattern("dark"), png: 960 },
  { name: "story-vertical", svg: story(), png: 2160 },
  { name: "certificate-frame", svg: certificate(), png: 3508 },
  { name: "email-header", svg: emailHeader(), png: 2400 },
  { name: "kiosk-screen", svg: kiosk(), png: 3840 },
  { name: "empty-no-events", svg: emptyState("no-events"), png: 1600 },
  { name: "empty-no-tickets", svg: emptyState("no-tickets"), png: 1600 },
  { name: "empty-not-found", svg: emptyState("not-found"), png: 1600 },
  { name: "empty-success", svg: emptyState("success"), png: 1600 },
];
for (const k of Object.keys(ITEMS) as Item[]) {
  outs.push({ name: `spot-${k}`, svg: spot(k), png: 1600 });
  outs.push({ name: `spot-dark-${k}`, svg: spot(k, true), png: 1600 });
  outs.push({ name: `icon-${k}`, svg: icon(k, C.z900), png: 1024 });
}

const dirs = new Set<string>();
for (const o of outs) {
  const group = o.name.startsWith("spot-dark-")
    ? "spots-dark"
    : o.name.startsWith("spot-")
      ? "spots"
      : o.name.startsWith("icon-")
        ? "icons"
        : o.name.startsWith("pattern-")
          ? "patterns"
          : o.name.startsWith("empty-")
            ? "empty-states"
            : "key-visuals";
  for (const kind of ["svg", "png"]) {
    const d = join(OUT, kind, group);
    if (!dirs.has(d)) mkdirSync(d, { recursive: true });
    dirs.add(d);
  }
  const svgPath = join(OUT, "svg", group, `${o.name}.svg`);
  const pngPath = join(OUT, "png", group, `${o.name}.png`);
  writeFileSync(svgPath, o.svg);
  await $`rsvg-convert -w ${o.png} -o ${pngPath} ${svgPath}`;
}
console.log(`wrote ${outs.length} illustrations`);
