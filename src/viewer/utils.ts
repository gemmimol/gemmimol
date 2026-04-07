import { Color } from '../three-r162/main';
import type { Atom } from '../model';
import { DEFAULT_ATOM_COLOR } from './types';
import type { Num2, ColorScheme } from './types';

export function scale_by_height(value: number, win_size: Num2): number {
  return value * win_size[1] / 700;
}

type ColorStrategy = (atoms: Atom[], scheme: Partial<ColorScheme>, hue_shift: number, temp: Color) => Color[];

const color_strategies: Record<string, ColorStrategy> = {
  element: (atoms, scheme) => atoms.map(a => 
    new Color((scheme as any)[a.element] || scheme.def || DEFAULT_ATOM_COLOR)),

  'B-factor': (atoms, _, __, temp) => {
    // Find min/max B-factors
    let bmin = Infinity, bmax = -Infinity;
    for (const a of atoms) {
      if (a.b < bmin) bmin = a.b;
      if (a.b > bmax) bmax = a.b;
    }
    const range = bmax - bmin || 1;
    return atoms.map(a => {
      const t = Math.min(1, Math.max(0, (a.b - bmin) / range));
      return temp.setHSL(0.7 - t * 0.7, 1, 0.5).clone();
    });
  },

  pLDDT: (atoms, _, __, temp) => atoms.map(a => {
    const b = a.b;
    if (b >= 90) return temp.setHex(0x0053d6).clone(); // Dark blue
    if (b >= 70) return temp.setHex(0x65cbf3).clone();  // Light blue
    if (b >= 50) return temp.setHex(0xffdb13).clone();  // Yellow
    return temp.setHex(0xff7d45).clone();               // Orange
  }),

  chain: (atoms, _, hue_shift, temp) => {
    const cache: Record<string, Color> = {};
    return atoms.map(a => {
      if (!cache[a.chain]) {
        const hue = ((a.chain.charCodeAt(0) * 47) % 360 + hue_shift) % 360;
        cache[a.chain] = temp.setHSL(hue / 360, 1, 0.5).clone();
      }
      return cache[a.chain];
    });
  },

  index: (atoms, _, __, temp) => {
    const count = atoms.length;
    return atoms.map((a, i) => {
      const hue = (240 - (240 * i / (count - 1 || 1))) / 360;
      return temp.setHSL(hue, 1, 0.5).clone();
    });
  },

  occupancy: (atoms, _, __, temp) => atoms.map(a => 
    temp.setRGB(a.occ, a.occ, a.occ).clone()),

  polymer: (atoms, scheme) => atoms.map(a => 
    new Color(a.is_ligand ? (scheme.def || DEFAULT_ATOM_COLOR) : 0x00dd00)),

  'secondary structure': (atoms, _, __, temp) => atoms.map(a => {
    const ss_colors: Record<string, number> = {
      Helix: 0xD64A4A,
      Strand: 0xD4A62A,
      Coil: 0x70A5C8,
    };
    return temp.setHex(ss_colors[a.ss] || ss_colors.Coil).clone();
  }),
};

export function color_by(prop: string, atoms: Atom[], colors?: ColorScheme,
                         hue_shift = 0): Color[] {
  const scheme = (colors || {}) as Partial<ColorScheme>;
  const temp = new Color();
  
  const strategy = color_strategies[prop];
  if (strategy) return strategy(atoms, scheme, hue_shift, temp);
  
  // Default
  const hex = scheme.def || 0xffffff;
  return atoms.map(() => new Color(hex));
}

export function number_as_f_string(x: number): string {
  return parseFloat(x.toFixed(4)).toString();
}

export function tokenize_cif_row(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) j++;
      tokens.push(line.substring(i + 1, j));
      i = j + 1;
    } else {
      let j = i;
      while (j < line.length && !/\s/.test(line[j])) j++;
      tokens.push(line.substring(i, j));
      i = j;
    }
  }
  return tokens;
}

export function modulo(a: number, b: number): number {
  const r = a % b;
  return r < 0 ? r + b : r;
}

export function rainbow_value(v: number, vmin: number, vmax: number, temp: Color): Color {
  if (vmin >= vmax) return temp.setHex(0xe0e0e0).clone();
  const ratio = Math.min(1, Math.max(0, (v - vmin) / (vmax - vmin)));
  const hue = (240 - (240 * ratio)) / 360;
  return temp.setHSL(hue, 1.0, 0.5).clone();
}
