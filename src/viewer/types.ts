import { Color } from '../three-r162/main';

export type Num2 = [number, number];
export type Num3 = [number, number, number];

export type GemmiSelectionContext = {
  gemmi: any, // GemmiModule - avoiding circular import
  structure: any, // Structure
  model_index: number,
};

export type SiteNavItem = {
  label: string,
  index: number,
  atom_indices: number[],
};

export type ConnectionNavItem = {
  label: string,
  index: number,
  atom_indices: number[],
  anchor_index: number,
};

export type ColorScheme = {
  bg: Color,
  fg: Color,
  map_den?: Color,
  map_pos?: Color,
  map_neg?: Color,
  center?: Color,
  H?: Color,
  C?: Color,
  N?: Color,
  O?: Color,
  S?: Color,
  P?: Color,
  MG?: Color,
  CL?: Color,
  CA?: Color,
  MN?: Color,
  FE?: Color,
  NI?: Color,
  def?: Color,
};

export type ViewerConfig = {
  bond_line: number,
  map_line: number,
  map_radius: number,
  max_map_radius: number,
  default_isolevel: number,
  center_cube_size: number,
  map_style: string,
  mainchain_style: string,
  sidechain_style: string,
  ligand_style: string,
  water_style: string,
  color_prop: string,
  label_font: string,
  color_scheme: string,
  colors?: ColorScheme,
  hydrogens: boolean,
  ball_size: number,
  stick_radius: number,
  ao: boolean,
  stay?: boolean;
};

// Default configuration - centralized here
export const DEFAULT_CONFIG: ViewerConfig = {
  bond_line: 4,
  map_line: 2,
  map_radius: 10,
  max_map_radius: 40,
  default_isolevel: 1.5,
  center_cube_size: 0.15,
  map_style: 'marching cubes',
  mainchain_style: 'cartoon',
  sidechain_style: 'invisible',
  ligand_style: 'ball&stick',
  water_style: 'invisible',
  color_prop: 'element',
  label_font: 'bold 14px',
  color_scheme: 'coot dark',
  hydrogens: false,
  ball_size: 0.5,
  stick_radius: 0.2,
  ao: false,
};

export const ColorSchemes: Record<string, ColorScheme> = {
  // the default scheme that generally mimicks Coot
  'coot dark': {
    bg: new Color(0x000000),
    fg: new Color(0xFFFFFF),
    map_den: new Color(0x3362B2),
    map_pos: new Color(0x298029),
    map_neg: new Color(0x8B2E2E),
    center: new Color(0xC997B0),
    // atoms
    H: new Color(0x858585), // H is normally invisible
    // C, N and O are taken approximately (by color-picker) from coot
    C: new Color(0xb3b300),
    N: new Color(0x7EAAFB),
    O: new Color(0xF24984),
    S: new Color(0x40ff40), // S in coot is too similar to C, here it's greener
    // Coot doesn't define other colors (?)
    MG: new Color(0xc0c0c0),
    P:  new Color(0xffc040),
    CL: new Color(0xa0ff60),
    CA: new Color(0xffffff),
    MN: new Color(0xff90c0),
    FE: new Color(0xa03000),
    NI: new Color(0x00ff80),
    def: new Color(0xa0a0a0), // default atom color
  },

  // scheme made of "solarized" colors (http://ethanschoonover.com/solarized):
  // base03  base02  base01  base00  base0   base1   base2   base3
  // #002b36 #073642 #586e75 #657b83 #839496 #93a1a1 #eee8d5 #fdf6e3
  // yellow  orange  red     magenta violet  blue    cyan    green
  // #b58900 #cb4b16 #dc322f #d33682 #6c71c4 #268bd2 #2aa198 #859900
  'solarized dark': {
    bg: new Color(0x002b36),
    fg: new Color(0xfdf6e3),
    map_den: new Color(0x268bd2),
    map_pos: new Color(0x859900),
    map_neg: new Color(0xd33682),
    center: new Color(0xfdf6e3),
    H: new Color(0x586e75),
    C: new Color(0x93a1a1),
    N: new Color(0x6c71c4),
    O: new Color(0xcb4b16),
    S: new Color(0xb58900),
    def: new Color(0xeee8d5),
  },

  'solarized light': {
    bg: new Color(0xfdf6e3),
    fg: new Color(0x002b36),
    map_den: new Color(0x268bd2),
    map_pos: new Color(0x859900),
    map_neg: new Color(0xd33682),
    center: new Color(0x002b36),
    H: new Color(0x93a1a1),
    C: new Color(0x586e75),
    N: new Color(0x6c71c4),
    O: new Color(0xcb4b16),
    S: new Color(0xb58900),
    def: new Color(0x073642),
  },

  // like in Coot after Edit > Background Color > White
  'coot light': {
    bg: new Color(0xFFFFFF),
    fg: new Color(0x000000),
    map_den: new Color(0x3362B2),
    map_pos: new Color(0x298029),
    map_neg: new Color(0x8B2E2E),
    center: new Color(0xC7C769),
    H: new Color(0x999999),
    C: new Color(0xA96464),
    N: new Color(0x1C51B3),
    O: new Color(0xC33869),
    S: new Color(0x9E7B3D),
    def: new Color(0x808080),
  },
};

export const SYMMETRY_MATE_COLORS: Record<string, Color> = {
  C: new Color(0x1933CC),
  O: new Color(0x5D1F5D),
  S: new Color(0x626E62),
};

export const INIT_HUD_TEXT = 'This is GemmiMol not Coot.';

// options handled by select_next()
export const COLOR_PROPS = ['element', 'B-factor', 'pLDDT', 'occupancy',
                            'index', 'chain', 'secondary structure'];
export const MAINCHAIN_STYLES = ['sticks', 'lines', 'backbone', 'cartoon',
                                 'ribbon', 'ball&stick', 'space-filling'];
export const SIDECHAIN_STYLES = ['sticks', 'lines', 'ball&stick', 'invisible'];
export const LIGAND_STYLES = ['ball&stick', 'sticks', 'lines'];
export const WATER_STYLES = ['sphere', 'cross', 'invisible'];
export const MAP_STYLES = ['marching cubes', 'smooth surface'/*, 'snapped MC'*/];
export const LABEL_FONTS = ['bold 14px', '14px', '16px', 'bold 16px'];

export type HelpActionSpec = {
  keyCode: number,
  shiftKey?: boolean,
  ctrlKey?: boolean,
};

export function escape_html(text: string) {
  return text.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
  }[ch] || ch));
}

function help_action_attrs(spec: HelpActionSpec) {
  let attrs = ' data-help-keycode="' + spec.keyCode + '"';
  if (spec.shiftKey) attrs += ' data-help-shift="1"';
  if (spec.ctrlKey) attrs += ' data-help-ctrl="1"';
  return attrs;
}

export function help_action_link(text: string, spec: HelpActionSpec) {
  return '<a href="#" class="gm-help-action"' + help_action_attrs(spec) + '>' +
         escape_html(text) + '</a>';
}

export function normalize_viewer_options(options?: Record<string, any> | string | null) {
  if (typeof options === 'string') return {viewer: options};
  if (options && typeof options === 'object') {
    if (options.map_style === 'squarish') options.map_style = 'marching cubes';
    return options;
  }
  return {};
}

export function map_style_method(style: string) {
  return style === 'smooth surface' || style === 'squarish' ? 'marching cubes' : style;
}

export function map_style_is_surface(style: string) {
  return style === 'smooth surface';
}

// Default colors
export const DEFAULT_ATOM_COLOR = 0x808080;
export const DEFAULT_LIGAND_COLOR = 0x00dd00;

// Residue template types for editing
export interface ResidueTemplate {
  name: string;
  element: string;
  xyz: [number, number, number];
}
export type ResidueTemplates = Record<string, { atoms: ResidueTemplate[] }>;

export function rainbow_value(v: number, vmin: number, vmax: number) {
  if (vmin >= vmax) return new Color(0xe0e0e0);
  const ratio = (v - vmin) / (vmax - vmin);
  const hue = (240 - (240 * ratio)) / 360;
  return new Color().setHSL(hue, 1.0, 0.5);
}
