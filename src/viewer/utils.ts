import { Color } from '../three-r162/main';
import type { Atom } from '../model';
import type { Num2, ColorScheme } from './types';

export function scale_by_height(value: number, win_size: Num2): number {
  return value * win_size[1] / 640;
}

type ColorStrategy = (atoms: Atom[], scheme: ColorScheme, hue_shift: number, temp: Color) => Color[];

const color_strategies: Record<string, ColorStrategy> = {
  element: (atoms, scheme) => atoms.map(a => 
    new Color((scheme as any)[a.element] || scheme.def)),

  chain: (atoms, _, hue_shift, temp) => {
    const cache: Record<string, Color> = {};
    return atoms.map(a => {
      if (!cache[a.chain]) {
        const hue = ((a.chain.charCodeAt(0) * 47) % 360 + hue_shift) % 360;
        cache[a.chain] = temp.setHSL(hue / 360, 1, 0.5);
      }
      return cache[a.chain];
    });
  },

  polymer: (atoms, scheme) => atoms.map(a => 
    new Color(a.is_ligand ? scheme.def : 0x00dd00)),

  bfactor: (atoms, _, __, temp) => atoms.map(a => {
    const t = Math.min(1, Math.max(0, (a.b - 20) / 80));
    return temp.setHSL(0.7 - t * 0.7, 1, 0.5);
  }),

  occupancy: (atoms, _, __, temp) => atoms.map(a => 
    temp.setRGB(a.occ, a.occ, a.occ)),
};

export function color_by(prop: string, atoms: Atom[], colors?: ColorScheme,
                         hue_shift = 0): Color[] {
  const scheme = colors || {};
  const temp = new Color();
  
  const strategy = color_strategies[prop];
  if (strategy) return strategy(atoms, scheme, hue_shift, temp);
  
  // Dynamic fallback: check if atoms have this property
  const attr = prop + 's';
  if ((atoms as any)[0]?.[attr]) {
    return atoms.map(a => new Color((a as any)[prop]));
  }
  
  // Default
  const hex = scheme.def || 0xffffff;
  return atoms.map(() => new Color(hex));
}

export function number_as_f_string(x: number): string {
  let s = x.toFixed(4);
  s = s.replace(/\.?0+$/, '');
  return s;
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
