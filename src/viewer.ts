import { OrthographicCamera, Scene, Color, Vector3,
         Ray, WebGLRenderer, Fog } from './three-r162/main';
import { makeLineMaterial, makeLineSegments, makeRibbon, makeCartoon,
         makeChickenWire, makeSmoothSurface, makeGrid, makeSticks, makeBalls,
         makeWheels, makeCube, makeSpaceFilling,
         makeRgbBox, Label, addXyzCross } from './draw';
import { STATE, Controls } from './controls';
import { SpeckAO } from './ao';
import { ElMap } from './elmap';
import type { BlobHit } from './elmap';
import { BondType, modelsFromGemmi, modelFromGemmiStructure,
         bondDataFromGemmiStructure } from './model';
import { mutation_targets_for_residue, plan_residue_mutation } from './mutate';
import { aminoAcidTemplate, nucleotideTemplate } from './residue-templates';

import type { GemmiModule, Structure } from './gemmi';
import type { Atom, Model } from './model';
import type { GemmiBondingInfo } from './model';
import type { LineSegments } from './three-r162/main';
import type { OrCameraType } from './controls';

type Num2 = [number, number];
type Num3 = [number, number, number];
type GemmiSelectionContext = {
  gemmi: GemmiModule,
  structure: Structure,
  model_index: number,
};

type SiteNavItem = {
  label: string,
  index: number,
  atom_indices: number[],
};

type ConnectionNavItem = {
  label: string,
  index: number,
  atom_indices: number[],
  anchor_index: number,
};

type ColorScheme = {
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
  stay?: boolean;
};

const ColorSchemes: Record<string, ColorScheme> = {
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

const SYMMETRY_MATE_COLORS: Record<string, Color> = {
  C: new Color(0x1933CC),
  O: new Color(0x5D1F5D),
  S: new Color(0x626E62),
};

function symmetry_mate_color(atom: Atom, elem_colors: ColorScheme): Color {
  return SYMMETRY_MATE_COLORS[atom.element] ||
         elem_colors[atom.element] ||
         elem_colors.def ||
         SYMMETRY_MATE_COLORS.C;
}


const INIT_HUD_TEXT = 'This is GemmiMol not Coot.';

// options handled by select_next()

const COLOR_PROPS = ['element', 'B-factor', 'pLDDT', 'occupancy',
                     'index', 'chain', 'secondary structure'];
const MAINCHAIN_STYLES = ['sticks', 'lines', 'backbone', 'cartoon',
                          'ribbon', 'ball&stick', 'space-filling',
                          'space-filling+AO'];
const SIDECHAIN_STYLES = ['sticks', 'lines', 'ball&stick', 'invisible'];
const LIGAND_STYLES = ['ball&stick', 'sticks', 'lines'];
const WATER_STYLES = ['sphere', 'cross', 'invisible'];
const MAP_STYLES = ['marching cubes', 'smooth surface'/*, 'snapped MC'*/];
const LABEL_FONTS = ['bold 14px', '14px', '16px', 'bold 16px'];

type HelpActionSpec = {
  keyCode: number,
  shiftKey?: boolean,
  ctrlKey?: boolean,
};

function escape_html(text: string) {
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

function map_style_method(style: string) {
  return style === 'smooth surface' || style === 'squarish' ? 'marching cubes' : style;
}

function map_style_is_surface(style: string) {
  return style === 'smooth surface';
}

function rainbow_value(v: number, vmin: number, vmax: number) {
  const c = new Color(0xe0e0e0);
  if (vmin < vmax) {
    const ratio = (v - vmin) / (vmax - vmin);
    const hue = (240 - (240 * ratio)) / 360;
    c.setHSL(hue, 1.0, 0.5);
  }
  return c;
}

function color_by(prop: string, atoms: Atom[], elem_colors: ColorScheme,
                  hue_shift: number): Color[] {
  let color_func;
  const last_atom = atoms[atoms.length-1];
  if (prop === 'index') {
    color_func = function (atom: Atom) {
      return rainbow_value(atom.i_seq, 0, last_atom.i_seq);
    };
  } else if (prop === 'B-factor') {
    let vmin = Infinity;
    let vmax = -Infinity;
    for (let i = 0; i < atoms.length; i++) {
      const v = atoms[i].b;
      if (v > vmax) vmax = v;
      if (v < vmin) vmin = v;
    }
    //console.log('B-factors in [' + vmin + ', ' + vmax + ']');
    color_func = function (atom: Atom) {
      return rainbow_value(atom.b, vmin, vmax);
    };
  } else if (prop === 'pLDDT') {
    const steps = [90, 70, 50];
    const colors = [
      new Color(0x0053d6), // dark blue
      new Color(0x65cbf3), // light blue
      new Color(0xffdb13), // yellow
      new Color(0xff7d45)  // orange
    ];
    color_func = function (atom: Atom) {
      let i = 0;
      while (i < 3 && atom.b < steps[i]) {
        ++i;
      }
      return colors[i];
    };
  } else if (prop === 'occupancy') {
    color_func = function (atom: Atom) {
      return rainbow_value(atom.occ, 0, 1);
    };
  } else if (prop === 'chain') {
    color_func = function (atom: Atom) {
      return rainbow_value(atom.chain_index, 0, last_atom.chain_index);
    };
  } else if (prop === 'secondary structure') {
    const ss_colors = {
      Helix: new Color(0xD64A4A),
      Strand: new Color(0xD4A62A),
      Coil: new Color(0x70A5C8),
    };
    color_func = function (atom: Atom) {
      return ss_colors[atom.ss] || ss_colors.Coil;
    };
  } else { // element
    if (hue_shift === 0) {
      color_func = function (atom: Atom) {
        return elem_colors[atom.element] || elem_colors.def;
      };
    } else {
      const c_hsl = { h: 0, s: 0, l: 0 };
      elem_colors['C'].getHSL(c_hsl);
      const c_col = new Color(0, 0, 0);
      c_col.setHSL(c_hsl.h + hue_shift, c_hsl.s, c_hsl.l);
      color_func = function (atom: Atom) {
        const el = atom.element;
        return el === 'C' ? c_col : (elem_colors[el] || elem_colors.def);
      };
    }
  }
  return atoms.map(color_func);
}

function scale_by_height(value: number, size: Num2) { // for scaling bond_line
  return value * size[1] / 700;
}

function tokenize_cif_row(line: string) {
  const tokens = line.match(/'(?:[^']*)'|"(?:[^"]*)"|\S+/g);
  if (tokens == null) return [];
  return tokens.map((token) => {
    if ((token.startsWith('\'') && token.endsWith('\'')) ||
        (token.startsWith('"') && token.endsWith('"'))) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function monomer_cif_names(text: string) {
  const names = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== 'loop_') continue;
    const tags = [];
    let j = i + 1;
    while (j < lines.length && lines[j].startsWith('_')) {
      tags.push(lines[j].trim());
      j++;
    }
    if (tags[0] !== '_chem_comp_atom.comp_id') continue;
    for (; j < lines.length; j++) {
      const trimmed = lines[j].trim();
      if (trimmed === '' || trimmed === '#') continue;
      if (trimmed === 'loop_' || trimmed.startsWith('_') || trimmed.startsWith('data_')) break;
      const row = tokenize_cif_row(lines[j]);
      if (row.length !== 0 && row[0] !== '.' && row[0] !== '?') {
        names.add(row[0].toUpperCase());
      }
    }
  }
  return Array.from(names).sort();
}

function is_standalone_monomer_cif(text: string) {
  return text.indexOf('_atom_site.') === -1 && monomer_cif_names(text).length !== 0;
}

function download_filename(name: string | null | undefined, format: 'pdb' | 'mmcif') {
  const base = ((name || '').trim().replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')) || 'model';
  return base + (format === 'pdb' ? '.pdb' : '.cif');
}

class MapBag {
  map: ElMap;
  name: string;
  isolevel: number;
  visible: boolean;
  is_diff_map: boolean;
  types: string[];
  block_ctr: Vector3;
  el_objects: object[];

  constructor(map: ElMap, config: ViewerConfig, is_diff_map: boolean) {
    this.map = map;
    this.name = '';
    this.isolevel = is_diff_map ? 3.0 : config.default_isolevel;
    this.visible = true;
    this.is_diff_map = is_diff_map;
    this.types = is_diff_map ? ['map_pos', 'map_neg'] : ['map_den'];
    this.block_ctr = new Vector3(Infinity, 0, 0);
    this.el_objects = []; // three.js objects
  }
}

class ModelBag {
  model: Model;
  label: string;
  visible: boolean;
  hue_shift: number;
  color_override: ((atom: Atom) => Color) | null;
  conf: ViewerConfig;
  win_size: Num2;
  objects: object[];
  atom_array: Atom[]
  gemmi_selection: GemmiSelectionContext | null;
  build_chain_name: string | null;
  symop: string;
  static ctor_counter: number;

  constructor(model: Model, config: ViewerConfig, win_size: Num2) {
    this.model = model;
    this.label = '(model #' + ++ModelBag.ctor_counter + ')';
    this.visible = true;
    this.hue_shift = 0;
    this.color_override = null;
    this.symop = '';
    this.conf = config;
    this.win_size = win_size;
    this.objects = []; // list of three.js objects
    this.atom_array = [];
    this.gemmi_selection = null;
    this.build_chain_name = null;
  }

  get_visible_atoms() {
    const atoms = this.model.atoms;
    if (this.conf.hydrogens || !this.model.has_hydrogens) {
      return atoms;
    }
    // with filter() it's twice slower (on Node 4.2)
    //return atoms.filter(function(a) { return a.element !== 'H'; });
    const non_h = [];
    for (const atom of atoms) {
      if (!atom.is_hydrogen()) non_h.push(atom);
    }
    return non_h;
  }

  atom_colors(atoms: Atom[]) {
    if (this.color_override != null) {
      return atoms.map((atom) => this.color_override!(atom));
    }
    return color_by(this.conf.color_prop, atoms, this.conf.colors, this.hue_shift);
  }

  add_bonds(polymers: boolean, ligands: boolean, ball_size?: number,
            atom_filter?: (atom: Atom) => boolean,
            bond_filter?: (atom: Atom, other: Atom) => boolean,
            wheel_caps: boolean=true) {
    const visible_atoms = this.get_visible_atoms();
    const colors = this.atom_colors(visible_atoms);
    const vertex_arr: Num3[] = [];
    const color_arr = [];
    const bond_type_arr = [];
    const metal_vertex_arr: Num3[] = [];
    const metal_color_arr = [];
    const metal_bond_type_arr = [];
    const sphere_arr = [];
    const sphere_color_arr = [];
    const water_sphere_arr = [];
    const water_sphere_color_arr = [];
    const hydrogens = this.conf.hydrogens;
    for (let i = 0; i < visible_atoms.length; i++) {
      const atom = visible_atoms[i];
      const color = colors[i];
      if (!(atom.is_ligand ? ligands : polymers)) continue;
      if (atom_filter && !atom_filter(atom)) continue;
      if (atom.is_water() && this.conf.water_style === 'invisible') continue;
      if (atom.bonds.length === 0 && ball_size == null) { // nonbonded - cross
        if (!atom.is_water() || this.conf.water_style === 'cross') {
          addXyzCross(vertex_arr, atom.xyz, 0.7);
          for (let n = 0; n < 6; n++) {
            color_arr.push(color);
          }
        }
      } else { // bonded, draw lines
        for (let j = 0; j < atom.bonds.length; j++) {
          const other = this.model.atoms[atom.bonds[j]];
          if (!hydrogens && other.is_hydrogen()) continue;
          if (bond_filter && !bond_filter(atom, other)) continue;
          // Coot show X-H bonds as thinner lines in a single color.
          // Here we keep it simple and render such bonds like all others.
          const bond_type = atom.bond_types[j];
          if (bond_type === BondType.Metal) {
            const mid = ball_size == null ?
              atom.midpoint(other) :
              this.bond_half_end(atom, other, ball_size * 0.3);
            metal_vertex_arr.push(atom.xyz, mid);
            metal_color_arr.push(color, color);
            metal_bond_type_arr.push(bond_type, bond_type);
          } else {
            const mid = ball_size == null ?
              atom.midpoint(other) :
              this.bond_half_end(atom, other, ball_size / 2);
            vertex_arr.push(atom.xyz, mid);
            color_arr.push(color, color);
            bond_type_arr.push(bond_type, bond_type);
          }
        }
      }
      if (ball_size == null && atom.is_water() && this.conf.water_style === 'sphere') {
        water_sphere_arr.push(atom);
        water_sphere_color_arr.push(color);
      } else {
        sphere_arr.push(atom);
        sphere_color_arr.push(color);
      }
    }

    if (ball_size != null) {
      if (vertex_arr.length !== 0) {
        const obj = makeSticks(vertex_arr, color_arr, ball_size / 2);
        obj.userData.bond_types = bond_type_arr;
        this.objects.push(obj);
      }
      if (metal_vertex_arr.length !== 0) {
        const metal_obj = makeSticks(metal_vertex_arr, metal_color_arr,
                                     ball_size * 0.25);
        metal_obj.userData.bond_types = metal_bond_type_arr;
        this.objects.push(metal_obj);
      }
      if (sphere_arr.length !== 0) {
        this.objects.push(makeBalls(sphere_arr, sphere_color_arr, ball_size));
      }
    } else if (vertex_arr.length !== 0 || metal_vertex_arr.length !== 0) {
      const linewidth = scale_by_height(this.conf.bond_line, this.win_size);
      if (vertex_arr.length !== 0) {
        const material = makeLineMaterial({
          linewidth: linewidth,
          win_size: this.win_size,
        });
        const obj = makeLineSegments(material, vertex_arr, color_arr);
        obj.userData.bond_types = bond_type_arr;
        this.objects.push(obj);
      }
      if (metal_vertex_arr.length !== 0) {
        const metal_material = makeLineMaterial({
          linewidth: linewidth * 0.5,
          win_size: this.win_size,
        });
        const metal_obj = makeLineSegments(metal_material, metal_vertex_arr,
                                           metal_color_arr);
        metal_obj.userData.bond_types = metal_bond_type_arr;
        this.objects.push(metal_obj);
      }
      if (wheel_caps && sphere_arr.length !== 0) {
        // wheels (discs) as round caps
        this.objects.push(makeWheels(sphere_arr, sphere_color_arr, linewidth));
      }
    }
    if (water_sphere_arr.length !== 0) {
      this.objects.push(makeBalls(water_sphere_arr, water_sphere_color_arr,
                                  this.conf.ball_size));
    }

    sphere_arr.forEach(function (v) { this.atom_array.push(v); }, this);
    water_sphere_arr.forEach(function (v) { this.atom_array.push(v); }, this);
  }

  add_sticks(polymers: boolean, ligands: boolean, radius: number,
             atom_filter?: (atom: Atom) => boolean,
             bond_filter?: (atom: Atom, other: Atom) => boolean) {
    const visible_atoms = this.get_visible_atoms();
    const colors = this.atom_colors(visible_atoms);
    const vertex_arr: Num3[] = [];
    const color_arr = [];
    const bond_type_arr = [];
    const metal_vertex_arr: Num3[] = [];
    const metal_color_arr = [];
    const metal_bond_type_arr = [];
    const sphere_arr = [];
    const sphere_color_arr = [];
    const atom_arr = [];
    const hydrogens = this.conf.hydrogens;
    for (let i = 0; i < visible_atoms.length; i++) {
      const atom = visible_atoms[i];
      const color = colors[i];
      if (!(atom.is_ligand ? ligands : polymers)) continue;
      if (atom_filter && !atom_filter(atom)) continue;
      if (atom.is_water() && this.conf.water_style === 'invisible') continue;
      atom_arr.push(atom);
      if (atom.is_water() || atom.is_metal) {
        sphere_arr.push(atom);
        sphere_color_arr.push(color);
      }
      if (atom.bonds.length === 0) continue;
      for (let j = 0; j < atom.bonds.length; j++) {
        const other = this.model.atoms[atom.bonds[j]];
        if (!hydrogens && other.is_hydrogen()) continue;
        if (bond_filter && !bond_filter(atom, other)) continue;
        const bond_type = atom.bond_types[j];
        if (bond_type === BondType.Metal) {
          const mid = this.bond_half_end(atom, other, radius * 0.5);
          metal_vertex_arr.push(atom.xyz, mid);
          metal_color_arr.push(color, color);
          metal_bond_type_arr.push(bond_type, bond_type);
        } else if (bond_type === BondType.Double) {
          this.add_offset_stick(vertex_arr, color_arr, bond_type_arr,
                                atom, other, color, bond_type,
                                radius * 0.75, radius);
          this.add_offset_stick(vertex_arr, color_arr, bond_type_arr,
                                atom, other, color, bond_type,
                                -radius * 0.75, radius);
        } else if (bond_type === BondType.Triple) {
          const mid = this.bond_half_end(atom, other, radius);
          vertex_arr.push(atom.xyz, mid);
          color_arr.push(color, color);
          bond_type_arr.push(bond_type, bond_type);
          this.add_offset_stick(vertex_arr, color_arr, bond_type_arr,
                                atom, other, color, bond_type,
                                radius * 1.2, radius);
          this.add_offset_stick(vertex_arr, color_arr, bond_type_arr,
                                atom, other, color, bond_type,
                                -radius * 1.2, radius);
        } else {
          const mid = this.bond_half_end(atom, other, radius);
          vertex_arr.push(atom.xyz, mid);
          color_arr.push(color, color);
          bond_type_arr.push(bond_type, bond_type);
        }
      }
    }
    if (vertex_arr.length !== 0) {
      const obj = makeSticks(vertex_arr, color_arr, radius);
      obj.userData.bond_types = bond_type_arr;
      this.objects.push(obj);
    }
    if (metal_vertex_arr.length !== 0) {
      const metal_obj = makeSticks(metal_vertex_arr, metal_color_arr,
                                   radius * 0.5);
      metal_obj.userData.bond_types = metal_bond_type_arr;
      this.objects.push(metal_obj);
    }
    if (sphere_arr.length !== 0) {
      this.objects.push(makeBalls(sphere_arr, sphere_color_arr, this.conf.ball_size));
    }
    this.atom_array = atom_arr;
  }

  bond_normal(atom: Atom, other: Atom): Num3 {
    const first = atom.i_seq < other.i_seq ? atom : other;
    const second = atom.i_seq < other.i_seq ? other : atom;
    const dir = [
      second.xyz[0] - first.xyz[0],
      second.xyz[1] - first.xyz[1],
      second.xyz[2] - first.xyz[2],
    ];
    const ref = (Math.abs(dir[2]) < Math.abs(dir[1])) ? [0, 0, 1] : [0, 1, 0];
    let normal: Num3 = [
      dir[1] * ref[2] - dir[2] * ref[1],
      dir[2] * ref[0] - dir[0] * ref[2],
      dir[0] * ref[1] - dir[1] * ref[0],
    ];
    const len = Math.sqrt(normal[0] * normal[0] +
                          normal[1] * normal[1] +
                          normal[2] * normal[2]);
    if (len < 1e-6) return [1, 0, 0];
    normal = [normal[0] / len, normal[1] / len, normal[2] / len];
    return normal;
  }

  bond_half_end(atom: Atom, other: Atom, radius: number): Num3 {
    const dir: Num3 = [
      other.xyz[0] - atom.xyz[0],
      other.xyz[1] - atom.xyz[1],
      other.xyz[2] - atom.xyz[2],
    ];
    const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if (len < 1e-6) return atom.midpoint(other);
    const overlap = Math.min(radius * 0.5, len * 0.12);
    const scale = 0.5 + overlap / len;
    return [
      atom.xyz[0] + dir[0] * scale,
      atom.xyz[1] + dir[1] * scale,
      atom.xyz[2] + dir[2] * scale,
    ];
  }

  add_offset_stick(vertex_arr: Num3[], color_arr: Color[], bond_type_arr: number[],
                   atom: Atom, other: Atom, color: Color, bond_type: number,
                   offset_scale: number, radius: number) {
    const mid = this.bond_half_end(atom, other, radius);
    const normal = this.bond_normal(atom, other);
    const offset = [
      normal[0] * offset_scale,
      normal[1] * offset_scale,
      normal[2] * offset_scale,
    ];
    vertex_arr.push(
      [atom.xyz[0] + offset[0], atom.xyz[1] + offset[1], atom.xyz[2] + offset[2]],
      [mid[0] + offset[0], mid[1] + offset[1], mid[2] + offset[2]],
    );
    color_arr.push(color, color);
    bond_type_arr.push(bond_type, bond_type);
  }

  extend_stick_segment(start: Num3, end: Num3, radius: number): [Num3, Num3] {
    const dir: Num3 = [
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    ];
    const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if (len < 1e-6) return [start, end];
    const overlap = Math.min(radius * 0.35, len * 0.12);
    const unit: Num3 = [dir[0] / len, dir[1] / len, dir[2] / len];
    return [
      [start[0] - unit[0] * overlap,
       start[1] - unit[1] * overlap,
       start[2] - unit[2] * overlap],
      [end[0] + unit[0] * overlap,
       end[1] + unit[1] * overlap,
       end[2] + unit[2] * overlap],
    ];
  }

  add_trace() {
    const segments = this.model.extract_trace();
    const visible_atoms = [].concat.apply([], segments);
    const colors = this.atom_colors(visible_atoms);
    const vertex_arr: Num3[] = [];
    const color_arr = [];
    let k = 0;
    const radius = this.conf.stick_radius;
    for (const seg of segments) {
      for (let i = 1; i < seg.length; ++i) {
        const [start, end] = this.extend_stick_segment(seg[i-1].xyz, seg[i].xyz, radius);
        vertex_arr.push(start, end);
        color_arr.push(colors[k+i-1], colors[k+i]);
      }
      k += seg.length;
    }
    if (vertex_arr.length !== 0) {
      this.objects.push(makeSticks(vertex_arr, color_arr, radius));
    }
    this.atom_array = visible_atoms;
  }

  add_ribbon(smoothness: number) {
    const segments = this.model.extract_trace();
    const res_map = this.model.get_residues();
    const visible_atoms = [].concat.apply([], segments);
    const colors = this.atom_colors(visible_atoms);
    let k = 0;
    for (const seg of segments) {
      const tangents = [];
      let last = [0, 0, 0];
      for (const atom of seg) {
        const residue = res_map[atom.resid()];
        const tang = this.model.calculate_tangent_vector(residue);
        // untwisting (usually applies to beta-strands)
        if (tang[0]*last[0] + tang[1]*last[1] + tang[2]*last[2] < 0) {
          tang[0] = -tang[0];
          tang[1] = -tang[1];
          tang[2] = -tang[2];
        }
        tangents.push(tang);
        last = tang;
      }
      const color_slice = colors.slice(k, k + seg.length);
      k += seg.length;
      const obj = makeRibbon(seg, color_slice, tangents, smoothness);
      this.objects.push(obj);
    }
    this.atom_array = visible_atoms;
  }

  add_cartoon(smoothness: number) {
    const segments = this.model.extract_trace();
    const res_map = this.model.get_residues();
    const visible_atoms = [].concat.apply([], segments);
    const colors = this.atom_colors(visible_atoms);
    let k = 0;
    for (const seg of segments) {
      const tangents = [];
      let last = [0, 0, 0];
      for (const atom of seg) {
        const residue = res_map[atom.resid()];
        const tang = this.model.calculate_tangent_vector(residue);
        if (tang[0]*last[0] + tang[1]*last[1] + tang[2]*last[2] < 0) {
          tang[0] = -tang[0];
          tang[1] = -tang[1];
          tang[2] = -tang[2];
        }
        tangents.push(tang);
        last = tang;
      }
      const color_slice = colors.slice(k, k + seg.length);
      k += seg.length;
      const obj = makeCartoon(seg, color_slice, tangents, smoothness);
      this.objects.push(obj);
    }
    this.atom_array = visible_atoms;
  }
}

ModelBag.ctor_counter = 0;

function vec3_to_fixed(vec, n) {
  return [vec.x.toFixed(n), vec.y.toFixed(n), vec.z.toFixed(n)];
}

// for two-finger touch events
function touch_info(evt: TouchEvent) {
  const touches = evt.touches;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return {pageX: (touches[0].pageX + touches[1].pageX) / 2,
          pageY: (touches[0].pageY + touches[1].pageY) / 2,
          dist: Math.sqrt(dx * dx + dy * dy)};
}

// makes sense only for full-window viewer
function parse_url_fragment() {
  const ret : Record<string, any> = {};
  if (typeof window === 'undefined') return ret;
  const params = window.location.hash.substr(1).split('&');
  for (let i = 0; i < params.length; i++) {
    const kv = params[i].split('=');
    const key = kv[0];
    const val = kv[1];
    if (key === 'xyz' || key === 'eye') {
      ret[key] = val.split(',').map(Number);
    } else if (key === 'zoom') {
      ret[key] = Number(val);
    } else {
      ret[key] = val;
    }
  }
  return ret;
}


export class Viewer {
  model_bags: ModelBag[];
  map_bags: MapBag[];
  decor: {
      cell_box: object | null,
      selection: object | null,
      zoom_grid: LineSegments,
      mark: object | null
  };
  labels: {[index:string]: {o: Label, bag: ModelBag}};
  //nav: object | null;
  xhr_headers: Record<string, string>;
  monomer_cif_cache: Record<string, Promise<string | null>>;
  last_bonding_info: GemmiBondingInfo | null;
  sym_model_bags: ModelBag[];
  sym_bond_objects: object[];

  gemmi_factory: (() => Promise<GemmiModule>) | null;
  gemmi_module: GemmiModule | null;
  gemmi_loading: Promise<GemmiModule> | null;
  config: ViewerConfig;
  window_size: Num2;
  window_offset: Num2;
  last_ctr: Vector3;
  selected: {bag: ModelBag | null, atom: Atom | null};
  dbl_click_callback: (arg: object) => void;
  scene: Scene;
  default_camera_pos: Num3;
  target: Vector3;
  camera: OrCameraType;
  controls: Controls;
  tied_viewer: Viewer | null;
  renderer: WebGLRenderer;
  speckAO: SpeckAO | null;
  container: HTMLElement | null;
  hud_el: HTMLElement | null;
  help_el: HTMLElement | null;
  viewer_overlay_el: HTMLDivElement | null;
  structure_name_el: HTMLElement | null;
  cid_dialog_el: HTMLDivElement | null;
  cid_input_el: HTMLInputElement | null;
  blob_select_el: HTMLSelectElement | null;
  empty_blobs_select_el: HTMLSelectElement | null;
  place_select_el: HTMLSelectElement | null;
  metals_select_el: HTMLSelectElement | null;
  ligands_select_el: HTMLSelectElement | null;
  sites_select_el: HTMLSelectElement | null;
  connections_select_el: HTMLSelectElement | null;
  download_select_el: HTMLSelectElement | null;
  delete_select_el: HTMLSelectElement | null;
  mutate_select_el: HTMLDivElement | null;
  mutate_button_el: HTMLButtonElement | null;
  mutate_list_el: HTMLDivElement | null;
  mutate_targets: string[];
  mutate_open: boolean;
  mutate_select_target: string | null;
  mutate_select_residue_key: string | null;
  mutate_select_busy: boolean;
  queued_mutation_preview: {target: string, residue_key: string} | null;
  blob_hits: BlobHit[];
  blob_map_bag: MapBag | null;
  blob_negate: boolean;
  blob_search_sigma: number | null;
  blob_mask_waters: boolean;
  blob_focus_index: number;
  blob_objects: object[];
  initial_hud_html: string;
  fps_text: string;
  last_frame_time: number;
  frame_times: number[];
  map_radius_auto: boolean;
  scheduled: boolean;
  declare MOUSE_HELP: string;
  declare KEYBOARD_HELP: string;
  declare ABOUT_HELP: string;
  mousemove: (arg: MouseEvent) => void;
  mouseup: (arg: MouseEvent) => void;
  key_bindings: Array<((evt: KeyboardEvent) => void) | false | undefined>;
  histogram_el: HTMLDivElement | null;
  histogram_redraw: (() => void) | null;
  declare ColorSchemes: typeof ColorSchemes;

  constructor(options: Record<string, any> | string = {}) {
    options = normalize_viewer_options(options);
    // rendered objects
    this.model_bags = [];
    this.map_bags = [];
    this.decor = {
      cell_box: null,
      selection: null,
      zoom_grid: makeGrid(),
      mark: null,
    };
    this.labels = {};
    //this.nav = null;
    this.xhr_headers = {};
    this.monomer_cif_cache = {};
    this.last_bonding_info = null;
    this.sym_model_bags = [];
    this.sym_bond_objects = [];
    this.gemmi_factory = null;
    this.gemmi_module = null;
    this.gemmi_loading = null;

    this.config = {
      bond_line: 4.0, // ~ to height, like in Coot (see scale_by_height())
      map_line: 1.25,  // for any height
      map_radius: 10.0,
      max_map_radius: 40,
      default_isolevel: 1.5,
      center_cube_size: 0.1,
      map_style: MAP_STYLES[0],
      mainchain_style: 'sticks',
      sidechain_style: 'sticks',
      ligand_style: LIGAND_STYLES[0],
      water_style: WATER_STYLES[0],
      color_prop: COLOR_PROPS[0],
      label_font: LABEL_FONTS[0],
      color_scheme: 'coot dark',
      // `colors` is assigned in set_colors()
      hydrogens: false,
      ball_size: 0.4,
      stick_radius: 0.08,
    };

    // options of the constructor overwrite default values of the config
    for (const o of Object.keys(options)) {
      if (o in this.config) {
        this.config[o] = options[o];
      }
    }
    if (options.gemmi) {
      this.gemmi_module = options.gemmi;
    } else if (options.gemmi_factory) {
      this.gemmi_factory = options.gemmi_factory;
    } else if (typeof globalThis !== 'undefined' &&
               typeof (globalThis as any).Gemmi === 'function') {
      this.gemmi_factory = (globalThis as any).Gemmi;
    }

    this.set_colors();
    this.window_size = [1, 1]; // it will be set in resize()
    this.window_offset = [0, 0];

    this.last_ctr = new Vector3(Infinity, 0, 0);
    this.selected = {bag: null, atom: null};
    this.dbl_click_callback = this.toggle_label;
    this.scene = new Scene();
    this.scene.fog = new Fog(this.config.colors.bg, 0, 1);
    this.default_camera_pos = [0, 0, 100];
    if (options.share_view) {
      this.target = options.share_view.target;
      this.camera = options.share_view.camera;
      this.controls = options.share_view.controls;
      this.tied_viewer = options.share_view;
      this.tied_viewer.tied_viewer = this; // not GC friendly
    } else {
      this.target = new Vector3(0, 0, 0);
      this.camera = new OrthographicCamera() as OrCameraType;
      this.camera.position.fromArray(this.default_camera_pos);
      this.controls = new Controls(this.camera, this.target);
    }
    this.set_common_key_bindings();
    if (this.constructor === Viewer) this.set_real_space_key_bindings();

    function get_elem(name) {
      if (options[name] === null || typeof document === 'undefined') return null;
      return document.getElementById(options[name] || name);
    }
    this.hud_el = get_elem('hud');
    if (this.hud_el) {
      this.hud_el.addEventListener('click', this.on_hud_click.bind(this));
    }
    this.container = get_elem('viewer');
    this.help_el = get_elem('help');
    if (this.help_el) {
      this.help_el.addEventListener('click', this.on_help_click.bind(this));
    }
    this.viewer_overlay_el = null;
    this.structure_name_el = null;
    this.cid_dialog_el = null;
    this.cid_input_el = null;
    this.blob_select_el = null;
    this.empty_blobs_select_el = null;
    this.place_select_el = null;
    this.metals_select_el = null;
    this.ligands_select_el = null;
    this.sites_select_el = null;
    this.connections_select_el = null;
    this.download_select_el = null;
    this.delete_select_el = null;
    this.mutate_select_el = null;
    this.mutate_button_el = null;
    this.mutate_list_el = null;
    this.mutate_targets = [];
    this.mutate_open = false;
    this.mutate_select_target = null;
    this.mutate_select_residue_key = null;
    this.mutate_select_busy = false;
    this.queued_mutation_preview = null;
    this.histogram_el = null;
    this.histogram_redraw = null;
    this.blob_hits = [];
    this.blob_map_bag = null;
    this.blob_negate = false;
    this.blob_search_sigma = null;
    this.blob_mask_waters = false;
    this.blob_focus_index = -1;
    this.blob_objects = [];
    this.fps_text = 'FPS: --';
    this.last_frame_time = 0;
    this.frame_times = [];
    this.speckAO = null;
    this.map_radius_auto = !('map_radius' in options) && !('max_map_radius' in options);
    if (this.hud_el) {
      if (this.hud_el.innerHTML === '') this.hud_el.innerHTML = INIT_HUD_TEXT;
      this.initial_hud_html = this.hud_el.innerHTML;
    }

    try {
      this.renderer = new WebGLRenderer({antialias: true});
    } catch {
      this.hud('No WebGL in your browser?', 'ERR');
      this.renderer = null;
      return;
    }

    if (this.container == null) return; // can be null in headless tests
    if (window.getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }
    this.renderer.setClearColor(this.config.colors.bg, 1);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.resize();
    this.camera.zoom = this.camera.right / 35.0;  // arbitrary choice
    this.update_camera();
    const el = this.renderer.domElement;
    this.container.appendChild(el);
    this.create_structure_name_badge();
    this.create_help_toggle_link();
    if (options.focusable) {
      el.tabIndex = 0;
    }
    this.create_metals_menu();
    this.update_viewer_overlay_position();
    this.create_cid_dialog();
    this.decor.zoom_grid.visible = false;
    this.scene.add(this.decor.zoom_grid);

    window.addEventListener('resize', this.resize.bind(this));
    const keydown_el = (options.focusable ? el : window);
    keydown_el.addEventListener('keydown', this.keydown.bind(this));
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('wheel', this.wheel.bind(this));
    el.addEventListener('mousedown', this.mousedown.bind(this));
    el.addEventListener('touchstart', this.touchstart.bind(this));
    el.addEventListener('touchmove', this.touchmove.bind(this));
    el.addEventListener('touchend', this.touchend.bind(this));
    el.addEventListener('touchcancel', this.touchend.bind(this));
    el.addEventListener('dblclick', this.dblclick.bind(this));

    const self = this;

    this.mousemove = function (event: MouseEvent) {
      event.preventDefault();
      //event.stopPropagation();
      self.controls.move(self.relX(event), self.relY(event));
    };

    this.mouseup = function (event: MouseEvent) {
      event.preventDefault();
      event.stopPropagation();
      document.removeEventListener('mousemove', self.mousemove);
      document.removeEventListener('mouseup', self.mouseup);
      self.decor.zoom_grid.visible = false;
      const not_panned = self.controls.stop();
      // special case - centering on atoms after action 'pan' with no shift
      if (not_panned) {
        const pick = self.pick_atom(not_panned, self.camera);
        if (pick != null) {
          self.select_atom(pick, {steps: 60});
        }
      }
      self.redraw_maps();
    };

    this.scheduled = false;
    this.request_render();
  }

  create_structure_name_badge() {
    if (this.container == null || typeof document === 'undefined') return;
    const el = document.createElement('header');
    el.style.display = 'none';
    el.style.fontSize = '18px';
    el.style.color = '#ddd';
    el.style.backgroundColor = 'rgba(0,0,0,0.6)';
    el.style.textAlign = 'right';
    el.style.alignSelf = 'flex-end';
    el.style.maxWidth = '75%';
    el.style.padding = '3px 8px';
    el.style.borderRadius = '5px';
    el.style.letterSpacing = '0.08em';
    el.style.fontWeight = 'bold';
    el.style.whiteSpace = 'nowrap';
    el.style.overflow = 'hidden';
    el.style.textOverflow = 'ellipsis';
    el.style.pointerEvents = 'auto'; // ensure selectability
    el.style.cursor = 'text';        // ensure selectability
    el.style.userSelect = 'text';    // ensure selectability
    el.style.webkitUserSelect = 'text'; // ensure selectability
    el.onmousedown = (evt) => evt.stopPropagation();
    const overlay = this.get_or_create_viewer_overlay();
    if (overlay) overlay.insertBefore(el, overlay.firstChild);
    else this.container.appendChild(el);
    this.structure_name_el = el;
  }

  get_or_create_viewer_overlay() {
    if (this.container == null || typeof document === 'undefined') return null;
    if (this.viewer_overlay_el && this.viewer_overlay_el.parentElement === this.container) {
      this.update_viewer_overlay_position();
      return this.viewer_overlay_el;
    }
    let overlay = this.container.querySelector('.gm-viewer-overlay') as HTMLDivElement | null;
    if (overlay == null) {
      overlay = document.createElement('div');
      overlay.className = 'gm-viewer-overlay';
      overlay.style.position = 'absolute';
      overlay.style.top = '5px';
      overlay.style.left = '5px';
      overlay.style.right = '5px';
      overlay.style.display = 'flex';
      overlay.style.flexDirection = 'column';
      overlay.style.alignItems = 'flex-start';
      overlay.style.gap = '4px';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '9';
      this.container.appendChild(overlay);
    }
    this.viewer_overlay_el = overlay;
    this.update_viewer_overlay_position();
    return overlay;
  }

  update_viewer_overlay_position() {
    const overlay = this.viewer_overlay_el;
    if (overlay == null || this.container == null || typeof document === 'undefined') return;
    const global_overlay = document.getElementById('gm-overlay');
    if (global_overlay == null || this.container.contains(global_overlay)) {
      overlay.style.top = '5px';
      return;
    }
    const global_rect = global_overlay.getBoundingClientRect();
    const container_rect = this.container.getBoundingClientRect();
    const top = Math.max(5, Math.ceil(global_rect.bottom - container_rect.top + 4));
    overlay.style.top = top + 'px';
  }

  create_help_toggle_link() {
    if (this.container == null || this.help_el == null || typeof document === 'undefined') return;
    const el = document.createElement('a');
    el.className = 'gm-help-toggle';
    el.href = '#';
    el.textContent = 'H = toggle help';
    el.style.fontSize = '13px';
    el.style.color = '#9dd3ff';
    el.style.backgroundColor = 'rgba(0,0,0,0.65)';
    el.style.alignSelf = 'flex-end';
    el.style.padding = '2px 8px';
    el.style.borderRadius = '999px';
    el.style.textDecoration = 'underline';
    el.style.textUnderlineOffset = '2px';
    el.style.cursor = 'pointer';
    el.style.pointerEvents = 'auto';
    el.onclick = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.toggle_help();
    };
    const overlay = this.get_or_create_viewer_overlay();
    if (overlay) overlay.appendChild(el);
    else this.container.appendChild(el);
  }

  set_structure_name(name?: string | null) {
    const el = this.structure_name_el;
    if (!el) return;
    const text = (name || '').trim();
    if (text !== '') {
      el.textContent = text.toUpperCase();
      el.style.display = 'block';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  pick_atom(coords: Num2, camera: OrCameraType) {
    let pick = null;
    for (const bag of this.model_bags) {
      if (!bag.visible) continue;
      const z = (camera.near + camera.far) / (camera.near - camera.far);
      const ray = new Ray();
      ray.origin.set(coords[0], coords[1], z).unproject(camera);
      ray.direction.set(0, 0, -1).transformDirection(camera.matrixWorld);
      const near = camera.near;
      // '0.15' b/c the furthest 15% is hardly visible in the fog
      const far = camera.far - 0.15 * (camera.far - camera.near);
      /*
      // previous version - line-based search
      let intersects = [];
      for (const object of bag.objects) {
        if (object.visible === false) continue;
        if (object.userData.bond_lines) {
          line_raycast(object, {ray, near, far, precision: 0.3}, intersects);
        }
      }
      ...
      if (intersects.length > 0) {
        intersects.sort(function (x) { return x.dist2 || Infinity; });
        const p = intersects[0].point;
        const atom = bag.model.get_nearest_atom(p.x, p.y, p.z);
        if (atom != null) {
          return {bag, atom};
        }
      }
      */
      // search directly atom array ignoring matrixWorld
      const vec = new Vector3();
      // required picking precision: 0.35A at zoom 50, 0.27A @z30, 0.44 @z80
      const precision2 = 0.35 * 0.35 * 0.02 * camera.zoom;
      for (const atom of bag.atom_array) {
        vec.set(atom.xyz[0] - ray.origin.x,
                atom.xyz[1] - ray.origin.y,
                atom.xyz[2] - ray.origin.z);
        const distance = vec.dot(ray.direction);
        if (distance < 0 || distance < near || distance > far) continue;
        const diff2 = vec.addScaledVector(ray.direction, -distance).lengthSq();
        if (diff2 > precision2) continue;
        if (pick == null || distance < pick.distance) {
          pick = {bag, atom, distance};
        }
      }
    }
    return pick;
  }

  set_colors() {
    const scheme = this.ColorSchemes[this.config.color_scheme];
    if (!scheme) throw Error('Unknown color scheme.');
    this.decor.zoom_grid.material.uniforms.ucolor.value.set(scheme.fg);
    this.config.colors = scheme;
    this.redraw_all();
  }

  // relative position on canvas in normalized device coordinates [-1, +1]
  relX(evt: {pageX: number}) {
    return 2 * (evt.pageX - this.window_offset[0]) / this.window_size[0] - 1;
  }

  relY(evt: {pageY: number}) {
    return 1 - 2 * (evt.pageY - this.window_offset[1]) / this.window_size[1];
  }

  hud(text?: string, type?: string) {
    if (typeof document === 'undefined') return;  // for testing on node
    const el = this.hud_el;
    if (el) {
      if (text != null) {
        if (type === 'HTML') {
          el.innerHTML = text;
        } else {
          el.textContent = text;
        }
      } else {
        el.innerHTML = this.initial_hud_html;
      }
      const err = (type === 'ERR');
      el.style.backgroundColor = (err ? '#b00' : '');
      if (err && text) console.log('ERR: ' + text);
      this.update_viewer_overlay_position();
    } else {
      console.log('hud:', text);
    }
  }

  redraw_center(force?: boolean) {
    const size = this.config.center_cube_size;
    if (force ||
        this.target.distanceToSquared(this.last_ctr) > 0.01 * size * size) {
      this.last_ctr.copy(this.target);
      if (this.decor.mark) {
        this.scene.remove(this.decor.mark);
      }
      this.decor.mark = makeCube(size, this.target, {
        color: this.config.colors.center,
        linewidth: 2,
      });
      this.scene.add(this.decor.mark);
    }
  }

  redraw_maps(force?: boolean) {
    this.redraw_center(force);
    const r = this.config.map_radius;
    for (const map_bag of this.map_bags) {
      if (force || this.target.distanceToSquared(map_bag.block_ctr) > r/100) {
        this.redraw_map(map_bag);
      }
    }
  }

  remove_and_dispose(obj: any) {
    this.scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.uniforms && obj.material.uniforms.map) {
        obj.material.uniforms.map.value.dispose();
      }
      obj.material.dispose();
    }
    for (const o of obj.children) {
      this.remove_and_dispose(o);
    }
  }

  clear_el_objects(map_bag: MapBag) {
    for (const o of map_bag.el_objects) {
      this.remove_and_dispose(o);
    }
    map_bag.el_objects = [];
  }

  clear_model_objects(model_bag: ModelBag) {
    for (const o of model_bag.objects) {
      this.remove_and_dispose(o);
    }
    model_bag.objects = [];
  }

  clear_blob_objects() {
    for (const o of this.blob_objects) {
      this.remove_and_dispose(o);
    }
    this.blob_objects = [];
  }

  blob_source_map_bag(negate: boolean, prefer_diff: boolean=false) {
    const find_bag = (predicate: (map_bag: MapBag) => boolean) =>
      this.map_bags.find((map_bag) => map_bag.visible && predicate(map_bag)) ||
      this.map_bags.find(predicate) || null;
    if (negate) {
      return find_bag((map_bag) => map_bag.is_diff_map);
    }
    if (prefer_diff) {
      return find_bag((map_bag) => map_bag.is_diff_map) ||
             find_bag((map_bag) => !map_bag.is_diff_map);
    }
    return find_bag((map_bag) => !map_bag.is_diff_map) ||
           find_bag((map_bag) => map_bag.is_diff_map);
  }

  redraw_blobs() {
    this.clear_blob_objects();
    if (this.blob_hits.length === 0 || this.blob_map_bag == null) return;
    const marker_color = this.blob_negate ?
      (this.config.colors.map_neg || this.config.colors.fg) :
      (this.blob_map_bag.is_diff_map ?
        (this.config.colors.map_pos || this.config.colors.fg) :
        (this.config.colors.map_den || this.config.colors.fg));
    const centers = this.blob_hits.map((hit) => ({xyz: this.blob_target_xyz(hit)} as Atom));
    const colors = centers.map(() => marker_color);
    const wheel_size = 3 * scale_by_height(this.config.bond_line, this.window_size);
    const wheels = makeWheels(centers, colors, wheel_size);
    this.blob_objects.push(wheels);
    this.scene.add(wheels);

    const vertex_arr: Num3[] = [];
    const color_arr: Color[] = [];
    for (const hit of this.blob_hits) {
      addXyzCross(vertex_arr, hit.peak_pos, 0.45);
      for (let i = 0; i < 6; i++) {
        color_arr.push(marker_color);
      }
    }
    if (vertex_arr.length !== 0) {
      const material = makeLineMaterial({
        linewidth: scale_by_height(Math.max(this.config.bond_line, 2), this.window_size),
        win_size: this.window_size,
      });
      const peaks = makeLineSegments(material, vertex_arr, color_arr);
      this.blob_objects.push(peaks);
      this.scene.add(peaks);
    }
  }

  has_frag_depth() {
    return this.renderer && this.renderer.extensions.get('EXT_frag_depth');
  }

  make_objects_translucent(objects: object[]) {
    for (const obj of objects) {
      const o = obj as any;
      if (o.material) {
        this.set_material_opacity(o.material, 0.5);
      }
      if (o.children) {
        for (const child of o.children) {
          if (child.material) {
            this.set_material_opacity(child.material, 0.5);
          }
        }
      }
    }
  }

  set_material_opacity(material: any, opacity: number) {
    material.transparent = true;
    if (material.fragmentShader) {
      material.fragmentShader = material.fragmentShader.replace(
        /gl_FragColor\s*=\s*vec4\(([^,]+),\s*1\.0\)/g,
        'gl_FragColor = vec4($1, ' + opacity.toFixed(1) + ')'
      );
      material.needsUpdate = true;
    }
  }

  add_rendered_atoms(target: Atom[], seen: Set<number>, atoms: Atom[]) {
    for (const atom of atoms) {
      if (!seen.has(atom.i_seq)) {
        seen.add(atom.i_seq);
        target.push(atom);
      }
    }
  }

  is_atom_visible_in_current_style(atom: Atom, conf: ViewerConfig) {
    if (atom.is_water()) return conf.water_style !== 'invisible';
    if (atom.is_ligand) return true;
    return atom.is_backbone() || conf.sidechain_style !== 'invisible';
  }

  atom_style_key(atom: Atom) {
    if (atom.is_water()) return 'water_style';
    if (atom.is_ligand) return 'ligand_style';
    return atom.is_backbone() ? 'mainchain_style' : 'sidechain_style';
  }

  set_model_objects(model_bag: ModelBag) {
    model_bag.objects = [];
    model_bag.atom_array = [];
    const rendered_atoms: Atom[] = [];
    const seen_atoms = new Set<number>();
    const finish_pass = () => {
      this.add_rendered_atoms(rendered_atoms, seen_atoms, model_bag.atom_array);
      model_bag.atom_array = [];
    };
    const partner_visible = (_atom: Atom, other: Atom) =>
      this.is_atom_visible_in_current_style(other, model_bag.conf);
    let ligand_balls = null;
    const ligand_sticks = (model_bag.conf.ligand_style === 'sticks');
    if (model_bag.conf.ligand_style === 'ball&stick' && this.has_frag_depth()) {
      ligand_balls = this.config.ball_size;
    }
    const mainchain_style = model_bag.conf.mainchain_style;

    // Space-filling is a global style — all atoms as VdW spheres
    if (mainchain_style.startsWith('space-filling')) {
      if (!this.has_frag_depth()) {
        this.hud('Space-filling rendering is not working in this browser' +
                 '\ndue to lack of support for EXT_frag_depth', 'ERR');
        return;
      }
      const visible_atoms = model_bag.get_visible_atoms();
      const colors = model_bag.atom_colors(visible_atoms);
      model_bag.objects.push(makeSpaceFilling(visible_atoms, colors));
      model_bag.atom_array = visible_atoms;
      this.add_rendered_atoms(rendered_atoms, seen_atoms, visible_atoms);
    } else {
      const sidechain_style = model_bag.conf.sidechain_style;
      const wheel_caps = (mainchain_style === 'lines' &&
                          sidechain_style === 'lines' &&
                          model_bag.conf.ligand_style === 'lines');
      const mainchain_filter = (atom: Atom) => atom.is_backbone();
      const sidechain_filter = (atom: Atom) => !atom.is_backbone();
      switch (mainchain_style) {
        case 'lines':
          model_bag.add_bonds(true, false, undefined, mainchain_filter, partner_visible, wheel_caps);
          finish_pass();
          break;
        case 'sticks':
          if (!this.has_frag_depth()) {
            this.hud('Stick rendering is not working in this browser' +
                     '\ndue to lack of suppport for EXT_frag_depth', 'ERR');
            return;
          }
          model_bag.add_sticks(true, false, this.config.stick_radius,
                               mainchain_filter, partner_visible);
          finish_pass();
          break;
        case 'ball&stick':
          if (!this.has_frag_depth()) {
            this.hud('Ball-and-stick rendering is not working in this browser' +
                     '\ndue to lack of suppport for EXT_frag_depth', 'ERR');
            return;
          }
          model_bag.add_bonds(true, false, this.config.ball_size,
                              mainchain_filter, partner_visible);
          finish_pass();
          break;
        case 'backbone':
          model_bag.add_trace();
          finish_pass();
          break;
        case 'ribbon':
          model_bag.add_ribbon(8);
          finish_pass();
          break;
        case 'cartoon':
          model_bag.add_cartoon(8);
          finish_pass();
          break;
      }
      switch (sidechain_style) {
        case 'lines':
          model_bag.add_bonds(true, false, undefined, sidechain_filter, partner_visible, wheel_caps);
          finish_pass();
          break;
        case 'sticks':
          model_bag.add_sticks(true, false, this.config.stick_radius,
                               sidechain_filter, partner_visible);
          finish_pass();
          break;
        case 'ball&stick':
          model_bag.add_bonds(true, false, this.has_frag_depth() ? this.config.ball_size : undefined,
                              sidechain_filter, partner_visible);
          finish_pass();
          break;
      }
      if (ligand_sticks) {
        model_bag.add_sticks(false, true, this.config.stick_radius);
        finish_pass();
      } else {
        model_bag.add_bonds(false, true, ligand_balls, undefined, undefined, wheel_caps);
        finish_pass();
      }
    }
    model_bag.atom_array = rendered_atoms;
    for (const o of model_bag.objects) {
      this.scene.add(o);
    }
  }

  // Add/remove label if `show` is specified, toggle otherwise.
  toggle_label(pick: {bag?: ModelBag, atom?: Atom}, show?: boolean) {
    if (pick.atom == null) return;
    const symop = pick.bag && pick.bag.symop ? ' ' + pick.bag.symop : '';
    const text = pick.atom.short_label() + symop;
    const uid = text; // we assume that the labels inside one model are unique
    const is_shown = (uid in this.labels);
    if (show === undefined) show = !is_shown;
    if (show) {
      if (is_shown) return;
      const atom_style = this.atom_style_key(pick.atom);
      const balls = pick.bag && pick.bag.conf[atom_style] === 'ball&stick';
      const label = new Label(text, {
        pos: pick.atom.xyz,
        font: this.config.label_font,
        color: '#' + this.config.colors.fg.getHexString(),
        win_size: this.window_size,
        z_shift: balls ? this.config.ball_size + 0.1 : 0.2,
      });
      if (pick.bag == null || label.mesh == null) return;
      this.labels[uid] = { o: label, bag: pick.bag };
      this.scene.add(label.mesh);
    } else {
      if (!is_shown) return;
      this.remove_and_dispose(this.labels[uid].o.mesh);
      delete this.labels[uid];
    }
  }

  redraw_labels() {
    for (const uid in this.labels) {
      const text = uid;
      this.labels[uid].o.redraw(text, {
        font: this.config.label_font,
        color: '#' + this.config.colors.fg.getHexString(),
      });
    }
  }

  toggle_map_visibility(map_bag: MapBag) {
    if (typeof map_bag === 'number') {
      map_bag = this.map_bags[map_bag];
    }
    map_bag.visible = !map_bag.visible;
    if (!map_bag.visible && this.blob_map_bag === map_bag) {
      this.hide_blobs(true);
    }
    this.redraw_map(map_bag);
    this.update_nav_menus();
    this.request_render();
  }

  redraw_map(map_bag: MapBag) {
    this.clear_el_objects(map_bag);
    if (map_bag.visible) {
      map_bag.map.block.clear();
      this.add_el_objects(map_bag);
    }
  }

  toggle_model_visibility(model_bag?: ModelBag, visible?: boolean) {
    model_bag = model_bag || this.selected.bag;
    if (model_bag == null) return;
    model_bag.visible = visible == null ? !model_bag.visible : visible;
    this.redraw_model(model_bag);
    this.request_render();
  }

  redraw_model(model_bag: ModelBag) {
    this.clear_model_objects(model_bag);
    if (model_bag.visible) {
      this.set_model_objects(model_bag);
    }
  }

  redraw_models() {
    for (const model_bag of this.model_bags) {
      this.redraw_model(model_bag);
    }
    // Manage AO lifecycle based on style
    const needsAO = this.model_bags.some(
      (bag) => bag.conf.mainchain_style === 'space-filling+AO');
    if (needsAO && this.renderer) {
      if (!this.speckAO) {
        // Compute bounding radius from all visible atoms
        let cx = 0, cy = 0, cz = 0, n = 0;
        for (const bag of this.model_bags) {
          for (const atom of bag.atom_array) {
            cx += atom.xyz[0]; cy += atom.xyz[1]; cz += atom.xyz[2]; n++;
          }
        }
        if (n > 0) { cx /= n; cy /= n; cz /= n; }
        let maxR2 = 0;
        for (const bag of this.model_bags) {
          for (const atom of bag.atom_array) {
            const dx = atom.xyz[0] - cx, dy = atom.xyz[1] - cy, dz = atom.xyz[2] - cz;
            const r2 = dx * dx + dy * dy + dz * dz;
            if (r2 > maxR2) maxR2 = r2;
          }
        }
        const boundingRadius = Math.sqrt(maxR2) + 2; // +2 for VdW radii
        this.speckAO = new SpeckAO(this.renderer, this.scene, this.camera,
                                   boundingRadius);
      }
      this.speckAO.reset();
    } else if (this.speckAO) {
      this.speckAO.dispose();
      this.speckAO = null;
    }
  }

  add_el_objects(map_bag: MapBag) {
    if (!map_bag.visible || this.config.map_radius <= 0) return;
    if (map_bag.map.block.empty()) {
      const t = this.target;
      map_bag.block_ctr.copy(t);
      map_bag.map.prepare_isosurface(this.config.map_radius, [t.x, t.y, t.z],
                                     map_style_is_surface(this.config.map_style));
    }
    for (const mtype of map_bag.types) {
      const isolevel = (mtype === 'map_neg' ? -1 : 1) * map_bag.isolevel;
      const iso = map_bag.map.isomesh_in_block(isolevel,
                                               map_style_method(this.config.map_style));
      if (iso == null) continue;
      const obj = map_style_is_surface(this.config.map_style) ?
        makeSmoothSurface(iso, {
          color: this.config.colors[mtype],
          opacity: 0.5,
        }) :
        makeChickenWire(iso, {
          color: this.config.colors[mtype],
          linewidth: this.config.map_line,
        });
      map_bag.el_objects.push(obj);
      this.scene.add(obj);
    }
  }

  change_isolevel_by(map_idx: number, delta: number) {
    if (map_idx >= this.map_bags.length) return;
    const map_bag = this.map_bags[map_idx];
    map_bag.isolevel += delta;
    //TODO: move slow part into update()
    this.clear_el_objects(map_bag);
    this.add_el_objects(map_bag);
    const abs_level = map_bag.map.abs_level(map_bag.isolevel);
    let abs_text = abs_level.toFixed(4);
    const tied = this.tied_viewer;
    if (tied && map_idx < tied.map_bags.length) {
      const tied_bag = tied.map_bags[map_idx];
      // Should we tie by sigma or absolute level? Now it's sigma.
      tied_bag.isolevel = map_bag.isolevel;
      abs_text += ' / ' + tied_bag.map.abs_level(tied_bag.isolevel).toFixed(4);
      tied.clear_el_objects(tied_bag);
      tied.add_el_objects(tied_bag);
    }
    this.hud('map ' + (map_idx+1) + ' level =  ' + abs_text + ' ' +
             map_bag.map.unit + ' (' + map_bag.isolevel.toFixed(2) + ' rmsd)');
    if (this.histogram_redraw && map_idx === 0) {
      this.histogram_redraw();
    }
  }

  change_map_radius(delta: number) {
    this.map_radius_auto = false;
    const rmax = this.config.max_map_radius;
    const cf = this.config;
    cf.map_radius = Math.min(Math.max(cf.map_radius + delta, 0), rmax);
    cf.map_radius = Math.round(cf.map_radius * 1e9) / 1e9;
    let info = 'map "radius": ' + cf.map_radius;
    if (cf.map_radius === rmax) info += ' (max)';
    else if (cf.map_radius === 0) info += ' (hidden maps)';
    if (this.map_bags.length === 0) info += '\nNB: no map is loaded.';
    this.hud(info);
    this.redraw_maps(true);
  }

  change_slab_width_by(delta: number) {
    const slab_width = this.controls.slab_width;
    slab_width[0] = Math.max(slab_width[0] + delta, 0.01);
    slab_width[1] = Math.max(slab_width[1] + delta, 0.01);
    this.update_camera();
    const final_width = this.camera.far - this.camera.near;
    this.hud('clip width: ' + final_width.toPrecision(3));
  }

  change_zoom_by_factor(mult: number) {
    this.camera.zoom *= mult;
    this.update_camera();
    this.hud('zoom: ' + this.camera.zoom.toPrecision(3));
  }

  change_bond_line(delta: number) {
    this.config.bond_line = Math.max(this.config.bond_line + delta, 0.1);
    this.redraw_models();
    this.hud('bond width: ' + scale_by_height(this.config.bond_line,
                                              this.window_size).toFixed(1));
  }

  change_stick_radius(delta: number) {
    this.config.stick_radius = Math.max(this.config.stick_radius + delta, 0.01);
    this.config.stick_radius =
      Math.round(this.config.stick_radius * 1000) / 1000;
    this.redraw_models();
    this.hud('stick radius: ' + this.config.stick_radius.toFixed(3));
  }

  change_map_line(delta: number) {
    this.config.map_line = Math.max(this.config.map_line + delta, 0.1);
    this.redraw_maps(true);
    this.hud('wireframe width: ' + this.config.map_line.toFixed(1));
  }

  toggle_full_screen() {
    const d = document;
    // @ts-expect-error no mozFullScreenElement
    if (d.fullscreenElement || d.mozFullScreenElement ||
        // @ts-expect-error no msFullscreenElement
        d.webkitFullscreenElement || d.msFullscreenElement) {
      // @ts-expect-error no webkitExitFullscreen
      const ex = d.exitFullscreen || d.webkitExitFullscreen ||
                 // @ts-expect-error no msExitFullscreen
                 d.mozCancelFullScreen || d.msExitFullscreen;
      if (ex) ex.call(d);
    } else {
      const el = this.container;
      if (!el) return;
      // @ts-expect-error no webkitRequestFullscreen
      const req = el.requestFullscreen || el.webkitRequestFullscreen ||
                  // @ts-expect-error no msRequestFullscreen
                  el.mozRequestFullScreen || el.msRequestFullscreen;
      if (req) req.call(el);
    }
  }

  toggle_cell_box() {
    if (this.decor.cell_box) {
      this.scene.remove(this.decor.cell_box);
      this.decor.cell_box = null;
    } else {
      const uc_func = this.get_cell_box_func();
      if (uc_func) {
        this.decor.cell_box = makeRgbBox(uc_func, this.config.colors.fg);
        this.scene.add(this.decor.cell_box);
      }
    }
  }

  get_cell_box_func() {
    let uc = null;
    if (this.selected.bag != null) {
      uc = this.selected.bag.model.unit_cell;
    }
    // note: model may not have unit cell
    if (uc == null && this.map_bags.length > 0) {
      uc = this.map_bags[0].map.unit_cell;
    }
    return uc && uc.orthogonalize.bind(uc);
  }

  shift_clip(delta: number) {
    const eye = this.camera.position.clone().sub(this.target);
    eye.multiplyScalar(delta / eye.length());
    this.target.add(eye);
    this.camera.position.add(eye);
    this.update_camera();
    this.redraw_maps();
    this.hud('clip shifted by [' + vec3_to_fixed(eye, 2).join(' ') + ']');
  }

  go_to_nearest_Ca() {
    const t = this.target;
    const bag = this.selected.bag;
    if (bag == null) return;
    const atom = bag.model.get_nearest_atom(t.x, t.y, t.z, 'CA');
    if (atom != null) {
      this.select_atom({bag, atom}, {steps: 30});
    } else {
      this.hud('no nearby CA');
    }
  }

  toggle_inactive_models() {
    const n = this.model_bags.length;
    if (n < 2) {
      this.hud((n == 0 ? 'No' : 'Only one') + ' model is loaded. ' +
               '"V" is for working with multiple models.');
      return;
    }
    const active_bag = this.active_model_bag();
    const show_all = !this.model_bags.every(function (m) { return m.visible; });
    for (const model_bag of this.model_bags) {
      const show = show_all || model_bag === active_bag;
      this.toggle_model_visibility(model_bag, show);
    }
    this.hud(show_all ? 'All models visible' : 'Inactive models hidden');
  }

  toggle_symmetry() {
    // If symmetry mates are already shown, remove them
    if (this.sym_model_bags.length > 0) {
      const sym_bags = this.sym_model_bags.slice();
      const sym_bag_set = new Set(sym_bags);
      if (this.selected.bag != null && sym_bag_set.has(this.selected.bag)) {
        this.toggle_label(this.selected, false);
        const fallback_bag = this.model_bags.find((bag) => !sym_bag_set.has(bag)) || null;
        this.selected = {bag: fallback_bag, atom: null};
      }
      for (const uid in this.labels) {
        if (!sym_bag_set.has(this.labels[uid].bag)) continue;
        this.remove_and_dispose(this.labels[uid].o.mesh);
        delete this.labels[uid];
      }
      for (const bag of this.sym_model_bags) {
        this.clear_model_objects(bag);
        const idx = this.model_bags.indexOf(bag);
        if (idx !== -1) this.model_bags.splice(idx, 1);
      }
      for (const obj of this.sym_bond_objects) {
        this.remove_and_dispose(obj);
      }
      this.sym_model_bags = [];
      this.sym_bond_objects = [];
      this.update_nav_menus();
      this.hud('symmetry mates hidden');
      this.request_render();
      return;
    }
    const bag = this.active_model_bag();
    if (bag == null || bag.gemmi_selection == null) {
      this.hud('No model with gemmi data loaded.');
      return;
    }
    const gemmi = bag.gemmi_selection.gemmi;
    const structure = bag.gemmi_selection.structure;
    if (!gemmi.get_nearby_sym_ops) {
      this.hud('Symmetry functions not available in this gemmi build.');
      return;
    }
    const pos: [number, number, number] = [this.target.x, this.target.y, this.target.z];
    const radius = this.config.map_radius;
    const images = gemmi.get_nearby_sym_ops(structure, pos, radius);
    if (images.size() === 0) {
      this.hud('No symmetry mates within map radius ' + radius +
               '\u00C5 (use [ and ] to change the map radius)');
      images.delete();
      return;
    }
    const n = images.size();
    const shown_symops: string[] = [];
    for (let i = 0; i < n; i++) {
      const image = images.get(i)!;
      const sym_st = gemmi.get_sym_image(structure, image);
      const model = modelFromGemmiStructure(gemmi, sym_st, bag.model.bond_data);
      sym_st.delete();
      const sym_bag = new ModelBag(model, this.config, this.window_size);
      sym_bag.hue_shift = 0;
      sym_bag.color_override = (atom) => symmetry_mate_color(atom, sym_bag.conf.colors);
      sym_bag.symop = image.symmetry_code(true);
      shown_symops.push(sym_bag.symop);
      sym_bag.visible = true;
      this.model_bags.push(sym_bag);
      this.set_model_objects(sym_bag);
      this.sym_model_bags.push(sym_bag);
      // draw cross-symmetry bonds (e.g. metal coordination) from struct_conn
      if (gemmi.CrossSymBonds) {
        const csb = new gemmi.CrossSymBonds();
        csb.find(structure, image);
        const csb_len = csb.bond_data_size();
        if (csb_len > 0) {
          const csb_ptr = csb.bond_data_ptr();
          const csb_data = new Int32Array(gemmi.HEAPU8.buffer, csb_ptr, csb_len).slice();
          const vertex_arr: [number, number, number][] = [];
          const color_arr: Color[] = [];
          const stick_radius = Math.max(this.config.stick_radius,
                                        this.config.ball_size * 0.5);
          for (let j = 0; j < csb_data.length; j += 3) {
            const a1 = bag.model.atoms[csb_data[j]];
            const a2 = model.atoms[csb_data[j+1]];
            if (!a1 || !a2) continue;
            const c1 = color_by(bag.conf.color_prop, [a1], bag.conf.colors, bag.hue_shift);
            const c2 = sym_bag.atom_colors([a2]);
            const mid: [number, number, number] = [
              (a1.xyz[0] + a2.xyz[0]) / 2,
              (a1.xyz[1] + a2.xyz[1]) / 2,
              (a1.xyz[2] + a2.xyz[2]) / 2,
            ];
            vertex_arr.push(a1.xyz, mid);
            color_arr.push(c1[0], c1[0]);
            vertex_arr.push(a2.xyz, mid);
            color_arr.push(c2[0], c2[0]);
          }
          if (vertex_arr.length > 0) {
            const obj = makeSticks(vertex_arr, color_arr, stick_radius);
            this.scene.add(obj);
            this.sym_bond_objects.push(obj);
          }
        }
        csb.delete();
      }
    }
    this.hud(n + ' symmetry mate' + (n > 1 ? 's' : '') +
             ' shown: ' + shown_symops.join(', '));
    images.delete();
    this.request_render();
  }

  permalink() {
    if (typeof window === 'undefined') return;
    const xyz_prec = Math.round(-Math.log10(0.001));
    window.location.hash =
      '#xyz=' + vec3_to_fixed(this.target, xyz_prec).join(',') +
      '&eye=' + vec3_to_fixed(this.camera.position, 1).join(',') +
      '&zoom=' + this.camera.zoom.toFixed(0);
    this.hud('copy URL from the location bar');
  }

  create_cid_dialog() {
    if (typeof document === 'undefined' || this.container == null) return;
    const dialog = document.createElement('div');
    dialog.style.display = 'none';
    dialog.style.alignSelf = 'center';
    dialog.style.padding = '8px 10px';
    dialog.style.borderRadius = '6px';
    dialog.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    dialog.style.color = '#ddd';
    dialog.style.boxShadow = '0 2px 12px rgba(0,0,0,0.35)';

    const label = document.createElement('div');
    label.textContent = 'Go to atom/residue (Gemmi CID)';
    label.style.fontSize = '13px';
    label.style.marginBottom = '6px';
    dialog.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. /*/A/15/CA';
    input.style.width = '220px';
    input.style.padding = '4px 6px';
    input.style.border = '1px solid #666';
    input.style.borderRadius = '4px';
    input.style.backgroundColor = '#111';
    input.style.color = '#eee';
    input.style.outline = 'none';
    input.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
      if (evt.key === 'Escape') {
        evt.preventDefault();
        this.close_cid_dialog();
      } else if (evt.key === 'Enter') {
        evt.preventDefault();
        this.apply_cid_input();
      }
    });
    dialog.appendChild(input);

    const overlay = document.getElementById('gm-overlay');
    (overlay || this.container).appendChild(dialog);
    this.cid_dialog_el = dialog;
    this.cid_input_el = input;
  }

  create_nav_select() {
    const select = document.createElement('select');
    select.style.padding = '3px 6px';
    select.style.borderRadius = '4px';
    select.style.border = '1px solid #666';
    select.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    select.style.color = '#ddd';
    select.style.fontSize = '13px';
    select.style.display = 'none';
    select.addEventListener('change', () => {
      const idx = parseInt(select.value, 10);
      const bag = this.active_model_bag();
      if (bag && idx >= 0 && idx < bag.model.atoms.length) {
        this.select_residue(bag, bag.model.atoms[idx], {steps: 30});
      }
      select.selectedIndex = 0;
    });
    select.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
    });
    return select;
  }

  create_site_select() {
    const select = document.createElement('select');
    select.style.padding = '3px 6px';
    select.style.borderRadius = '4px';
    select.style.border = '1px solid #666';
    select.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    select.style.color = '#ddd';
    select.style.fontSize = '13px';
    select.style.display = 'none';
    select.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
    });
    return select;
  }

  create_connection_select() {
    const select = document.createElement('select');
    select.style.padding = '3px 6px';
    select.style.borderRadius = '4px';
    select.style.border = '1px solid #666';
    select.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    select.style.color = '#ddd';
    select.style.fontSize = '13px';
    select.style.display = 'none';
    select.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
    });
    return select;
  }

  create_download_select() {
    const select = document.createElement('select');
    select.style.padding = '3px 6px';
    select.style.borderRadius = '4px';
    select.style.border = '1px solid #666';
    select.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    select.style.color = '#ddd';
    select.style.fontSize = '13px';
    select.style.display = 'none';
    const header = document.createElement('option');
    header.textContent = 'Download';
    header.value = '';
    header.selected = true;
    select.appendChild(header);
    const pdb = document.createElement('option');
    pdb.textContent = 'pdb';
    pdb.value = 'pdb';
    select.appendChild(pdb);
    const cif = document.createElement('option');
    cif.textContent = 'mmcif';
    cif.value = 'mmcif';
    select.appendChild(cif);
    select.addEventListener('change', () => {
      const format = select.value;
      if (format === 'pdb' || format === 'mmcif') {
        this.download_model(format);
      }
      select.value = '';
    });
    select.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
    });
    return select;
  }

  create_blob_select() {
    const select = document.createElement('select');
    select.style.padding = '3px 6px';
    select.style.borderRadius = '4px';
    select.style.border = '1px solid #666';
    select.style.backgroundColor = 'rgba(0, 36, 64, 0.9)';
    select.style.color = '#d6f0ff';
    select.style.fontSize = '13px';
    select.style.display = 'none';
    select.addEventListener('change', () => {
      const value = select.value;
      if (value === 'show_pos') {
        this.show_blobs(false);
      } else if (value === 'show_neg') {
        this.show_blobs(true);
      } else if (value === 'hide') {
        this.hide_blobs();
      } else if (value.startsWith('blob:')) {
        this.focus_blob(parseInt(value.slice(5), 10));
      }
      select.value = '';
    });
    select.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
    });
    return select;
  }

  create_place_select() {
    const select = document.createElement('select');
    select.style.padding = '3px 6px';
    select.style.borderRadius = '4px';
    select.style.border = '1px solid #666';
    select.style.backgroundColor = 'rgba(18, 54, 18, 0.92)';
    select.style.color = '#d8f1d8';
    select.style.fontSize = '13px';
    select.style.display = 'none';
    select.addEventListener('change', () => {
      const value = select.value;
      if (value !== '') {
        this.place_selected_blob(value);
      }
      select.value = '';
    });
    select.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
    });
    return select;
  }

  create_empty_blobs_select() {
    const select = document.createElement('select');
    select.style.padding = '3px 6px';
    select.style.borderRadius = '4px';
    select.style.border = '1px solid #666';
    select.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    select.style.color = '#ddd';
    select.style.fontSize = '13px';
    select.style.display = 'none';
    select.addEventListener('change', () => {
      const value = select.value;
      if (value === 'search' || value === 'refind') {
        this.show_empty_blobs();
      } else if (value.startsWith('blob:')) {
        this.focus_blob(parseInt(value.slice(5), 10));
      }
      select.value = '';
    });
    select.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
    });
    return select;
  }

  create_delete_select() {
    const select = document.createElement('select');
    select.style.padding = '3px 6px';
    select.style.borderRadius = '4px';
    select.style.border = '1px solid #666';
    select.style.backgroundColor = 'rgba(64, 0, 0, 0.9)';
    select.style.color = '#f0d0d0';
    select.style.fontSize = '13px';
    select.style.display = 'none';
    const header = document.createElement('option');
    header.textContent = 'Delete';
    header.value = '';
    header.selected = true;
    select.appendChild(header);
    const options = [
      {value: 'atom', label: 'atom'},
      {value: 'residue', label: 'residue'},
      {value: 'chain', label: 'chain'},
      {value: 'trim_ala', label: 'trim to Ala'},
    ];
    for (const entry of options) {
      const opt = document.createElement('option');
      opt.textContent = entry.label;
      opt.value = entry.value;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      const scope = select.value as 'atom' | 'residue' | 'chain' | 'trim_ala' | '';
      if (scope === 'atom' || scope === 'residue' || scope === 'chain') {
        this.delete_selected(scope);
      } else if (scope === 'trim_ala') {
        this.trim_selected_to_alanine();
      }
      select.value = '';
    });
    select.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
    });
    return select;
  }

  create_mutate_select() {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'none';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Mutate';
    button.style.padding = '3px 6px';
    button.style.borderRadius = '4px';
    button.style.border = '1px solid #666';
    button.style.backgroundColor = 'rgba(0, 28, 56, 0.9)';
    button.style.color = '#d6e8ff';
    button.style.fontSize = '13px';
    button.style.minWidth = '84px';
    button.style.textAlign = 'left';
    button.style.cursor = 'pointer';

    const list = document.createElement('div');
    list.style.position = 'absolute';
    list.style.left = '0';
    list.style.top = 'calc(100% + 2px)';
    list.style.minWidth = '100%';
    list.style.maxHeight = '280px';
    list.style.overflowY = 'auto';
    list.style.borderRadius = '4px';
    list.style.border = '1px solid #666';
    list.style.backgroundColor = 'rgba(0, 28, 56, 0.96)';
    list.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.35)';
    list.style.zIndex = '20';
    list.style.display = 'none';

    wrapper.appendChild(button);
    wrapper.appendChild(list);
    this.mutate_button_el = button;
    this.mutate_list_el = list;

    button.addEventListener('click', (evt: MouseEvent) => {
      evt.stopPropagation();
      if (button.disabled) return;
      this.set_mutate_menu_open(!this.mutate_open);
    });
    button.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
      if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
        evt.preventDefault();
        if (this.mutate_targets.length === 0) return;
        this.set_mutate_menu_open(true);
        const next = this.mutation_target_step(this.mutate_targets,
                                               this.mutate_select_target || '',
                                               evt.key === 'ArrowDown' ? 1 : -1);
        if (next == null) return;
        this.mutate_select_target = next;
        this.sync_mutate_menu_ui();
        this.request_mutation_preview(next);
      } else if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        if (!button.disabled) this.set_mutate_menu_open(!this.mutate_open);
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        this.set_mutate_menu_open(false);
      }
    });
    wrapper.addEventListener('focusout', (evt: FocusEvent) => {
      const next = evt.relatedTarget as Node | null;
      if (next == null || !wrapper.contains(next)) this.set_mutate_menu_open(false);
    });
    return wrapper;
  }

  active_model_bag(preferred?: ModelBag | null) {
    if (preferred != null) return preferred;
    if (this.selected.bag != null && this.model_bags.indexOf(this.selected.bag) !== -1) {
      return this.selected.bag;
    }
    return this.model_bags[0] || null;
  }

  create_metals_menu() {
    if (typeof document === 'undefined' || this.container == null) return;
    const overlay = this.hud_el?.parentElement;
    if (overlay == null) return;
    const row1 = document.createElement('div');
    row1.style.display = 'flex';
    row1.style.flexWrap = 'wrap';
    row1.style.maxWidth = '100%';
    row1.style.alignItems = 'flex-start';
    row1.style.gap = '4px';
    const row2 = document.createElement('div');
    row2.style.display = 'flex';
    row2.style.flexWrap = 'wrap';
    row2.style.maxWidth = '100%';
    row2.style.alignItems = 'flex-start';
    row2.style.gap = '4px';
    this.blob_select_el = this.create_blob_select();
    this.place_select_el = this.create_place_select();
    this.metals_select_el = this.create_nav_select();
    this.ligands_select_el = this.create_nav_select();
    this.sites_select_el = this.create_site_select();
    this.connections_select_el = this.create_connection_select();
    this.empty_blobs_select_el = this.create_empty_blobs_select();
    this.download_select_el = this.create_download_select();
    this.delete_select_el = this.create_delete_select();
    this.mutate_select_el = this.create_mutate_select();
    row1.appendChild(this.blob_select_el);
    row1.appendChild(this.place_select_el);
    row1.appendChild(this.metals_select_el);
    row1.appendChild(this.ligands_select_el);
    row1.appendChild(this.sites_select_el);
    row1.appendChild(this.connections_select_el);
    row1.appendChild(this.empty_blobs_select_el);
    row2.appendChild(this.delete_select_el);
    row2.appendChild(this.mutate_select_el);
    row2.appendChild(this.download_select_el);
    overlay.appendChild(row1);
    overlay.appendChild(row2);
    this.update_viewer_overlay_position();
    if (this.tied_viewer) this.tied_viewer.update_viewer_overlay_position();
  }

  update_nav_menus() {
    const bag = this.active_model_bag();
    const metal_items = bag ? this.collect_nav_items(bag, (atom) => atom.is_metal) : [];
    const ligand_items = bag ? this.collect_nav_items(
      bag, (atom) => atom.is_ligand && !atom.is_metal && !atom.is_water()) : [];
    const site_items = bag ? this.collect_site_nav_items(bag) : [];
    const connection_items = bag ? this.collect_connection_nav_items(bag) : [];
    this.update_blob_select(this.blob_select_el);
    this.update_place_select(this.place_select_el);
    this.update_nav_select(this.metals_select_el, 'Metals', bag, metal_items);
    this.update_nav_select(this.ligands_select_el, 'Ligands', bag, ligand_items);
    this.update_site_select(this.sites_select_el, bag, site_items);
    this.update_connection_select(this.connections_select_el, bag, connection_items);
    this.update_empty_blobs_select(this.empty_blobs_select_el);
    this.update_download_select(this.download_select_el, bag);
    this.update_delete_select(this.delete_select_el);
    this.update_mutate_select(this.mutate_select_el);
    this.update_viewer_overlay_position();
    if (this.tied_viewer) this.tied_viewer.update_viewer_overlay_position();
  }

  update_blob_select(select: HTMLSelectElement | null) {
    if (select == null) return;
    select.innerHTML = '';
    const pos_map = this.blob_source_map_bag(false);
    const neg_map = this.blob_source_map_bag(true);
    if (pos_map == null && neg_map == null) {
      select.style.display = 'none';
      select.disabled = true;
      return;
    }
    const header = document.createElement('option');
    const total = this.blob_hits.length;
    header.textContent = total === 0 ? 'Blobs' : 'Blobs (' + total + ')';
    header.value = '';
    header.selected = true;
    select.appendChild(header);
    if (pos_map != null) {
      const opt = document.createElement('option');
      opt.value = 'show_pos';
      opt.textContent = 'show +';
      select.appendChild(opt);
    }
    if (neg_map != null) {
      const opt = document.createElement('option');
      opt.value = 'show_neg';
      opt.textContent = 'show -';
      select.appendChild(opt);
    }
    if (this.blob_hits.length !== 0) {
      const hide = document.createElement('option');
      hide.value = 'hide';
      hide.textContent = 'hide';
      select.appendChild(hide);
    }
    select.disabled = false;
    select.style.display = '';
    select.value = '';
  }

  update_place_select(select: HTMLSelectElement | null) {
    if (select == null) return;
    const editable_bag = this.editable_model_bag();
    select.innerHTML = '';
    if (editable_bag == null) {
      select.style.display = 'none';
      select.disabled = true;
      return;
    }
    const header = document.createElement('option');
    const placeable = (this.blob_hits.length !== 0 && !this.blob_negate &&
                       this.blob_map_bag != null && this.blob_map_bag.is_diff_map);
    if (!placeable) {
      header.textContent = 'Place (show unmodelled blobs first)';
    } else {
      const idx = this.blob_focus_index >= 0 ? this.blob_focus_index + 1 : 1;
      header.textContent = 'Place (#' + idx + ')';
    }
    header.value = '';
    header.selected = true;
    select.appendChild(header);
    const options = [
      {value: 'water', label: 'water'},
      {value: 'na', label: 'Na'},
      {value: 'mg', label: 'Mg'},
      {value: 'ca', label: 'Ca'},
      {value: 'zn', label: 'Zn'},
    ];
    for (const entry of options) {
      const opt = document.createElement('option');
      opt.value = entry.value;
      opt.textContent = entry.label;
      select.appendChild(opt);
    }
    select.disabled = !placeable;
    select.style.display = '';
    select.value = '';
  }

  update_empty_blobs_select(select: HTMLSelectElement | null) {
    if (select == null) return;
    const pos_map = this.blob_source_map_bag(false, true);
    const editable_bag = this.editable_model_bag();
    select.innerHTML = '';
    if (pos_map == null) {
      if (editable_bag == null) {
        select.style.display = 'none';
        select.disabled = true;
        return;
      }
      const header = document.createElement('option');
      header.textContent = 'Unmodelled Blobs (load map first)';
      header.value = '';
      header.selected = true;
      select.appendChild(header);
      select.disabled = true;
      select.style.display = '';
      select.value = '';
      return;
    }
    const header = document.createElement('option');
    const has_positive_hits = (this.blob_hits.length !== 0 && !this.blob_negate &&
                               this.blob_map_bag != null && this.blob_map_bag.is_diff_map);
    if (!has_positive_hits) {
      header.textContent = 'Unmodelled Blobs';
    } else {
      header.textContent = 'Unmodelled Blobs (' + this.blob_hits.length + ')';
    }
    header.value = '';
    header.selected = true;
    select.appendChild(header);
    if (!has_positive_hits) {
      const opt = document.createElement('option');
      opt.value = 'search';
      opt.textContent = 'find';
      select.appendChild(opt);
    } else {
      const refind = document.createElement('option');
      refind.value = 'refind';
      refind.textContent = 're-find';
      select.appendChild(refind);
      for (let i = 0; i < this.blob_hits.length; i++) {
        const hit = this.blob_hits[i];
        const opt = document.createElement('option');
        opt.value = 'blob:' + i;
        opt.textContent = '#' + (i + 1) + ' ' + hit.score.toFixed(1) +
                          ' e ' + hit.volume.toFixed(1) + ' A^3';
        select.appendChild(opt);
      }
    }
    select.disabled = false;
    select.style.display = '';
    select.value = '';
  }

  collect_nav_items(bag: ModelBag, filter: (atom: Atom) => boolean) {
    const seen = new Set<string>();
    const items: {label: string, index: number}[] = [];
    for (let i = 0; i < bag.model.atoms.length; i++) {
      const atom = bag.model.atoms[i];
      if (!filter(atom)) continue;
      const resid = atom.resname + '/' + atom.seqid + '/' + atom.chain;
      if (seen.has(resid)) continue;
      seen.add(resid);
      items.push({label: atom.seqid + ' ' + atom.resname + '/' + atom.chain, index: i});
    }
    return items;
  }

  update_nav_select(select: HTMLSelectElement | null, label: string,
                    bag: ModelBag | undefined,
                    items: {label: string, index: number}[]) {
    if (select == null) return;
    select.innerHTML = '';
    if (bag == null) {
      select.style.display = 'none';
      select.disabled = true;
      return;
    }
    const header = document.createElement('option');
    header.textContent = label + ' (' + items.length + ')';
    header.value = '';
    header.selected = true;
    select.appendChild(header);
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = String(item.index);
      opt.textContent = item.label;
      select.appendChild(opt);
    }
    select.disabled = (items.length === 0);
    select.style.display = '';
  }

  find_connection_residue_atoms(bag: ModelBag, chain: string, seqid: string): Atom[] {
    return bag.model.get_residues()[seqid + '/' + chain] || [];
  }

  find_connection_atom(residue_atoms: Atom[], atom_name: string, altloc: string): Atom | null {
    let fallback: Atom | null = null;
    for (const atom of residue_atoms) {
      if (atom.name !== atom_name) continue;
      if (altloc !== '') {
        if (atom.altloc === altloc) return atom;
        if (fallback == null && atom.altloc === '') fallback = atom;
      } else {
        if (atom.is_main_conformer()) return atom;
        if (fallback == null) fallback = atom;
      }
    }
    return fallback;
  }

  collect_site_nav_items(bag: ModelBag): SiteNavItem[] {
    const ctx = bag.gemmi_selection;
    if (ctx == null || bag.symop !== '') return [];
    const sites = ctx.structure.sites;
    if (sites == null) return [];
    const items: SiteNavItem[] = [];
    try {
      for (let i = 0; i < sites.size(); i++) {
        const site = sites.get(i);
        if (site == null) continue;
        try {
          const atom_indices: number[] = [];
          const members = site.members;
          try {
            for (let j = 0; j < members.size(); j++) {
              const member = members.get(j);
              if (member == null) continue;
              try {
                const auth = member.auth;
                try {
                  const res_id = auth.res_id;
                  try {
                    const chain = auth.chain_name || member.label_asym_id || '';
                    const seqid = res_id.seqid_string || member.label_seq_string || '';
                    const atoms = bag.model.get_residues()[seqid + '/' + chain];
                    if (atoms == null || atoms.length === 0) continue;
                    for (const atom of atoms) {
                      if (atom_indices.indexOf(atom.i_seq) === -1) atom_indices.push(atom.i_seq);
                    }
                  } finally {
                    res_id.delete();
                  }
                } finally {
                  auth.delete();
                }
              } finally {
                member.delete();
              }
            }
          } finally {
            members.delete();
          }
          if (atom_indices.length === 0) continue;
          let label = site.name;
          if (site.details) label += ' - ' + site.details;
          else if (site.evidence_code) label += ' (' + site.evidence_code + ')';
          items.push({label: label, index: i, atom_indices: atom_indices});
        } finally {
          site.delete();
        }
      }
    } finally {
      sites.delete();
    }
    return items;
  }

  collect_connection_nav_items(bag: ModelBag): ConnectionNavItem[] {
    const ctx = bag.gemmi_selection;
    if (ctx == null || bag.symop !== '') return [];
    const connections = ctx.structure.connections;
    if (connections == null) return [];
    const items: ConnectionNavItem[] = [];
    try {
      for (let i = 0; i < connections.size(); i++) {
        const connection = connections.get(i);
        if (connection == null) continue;
        try {
          if (connection.type === ctx.gemmi.ConnectionType.Hydrog ||
              connection.type === ctx.gemmi.ConnectionType.Unknown) {
            continue;
          }
          const kind = connection.type === ctx.gemmi.ConnectionType.Disulf ? 'SSBOND' : 'LINK';
          const partner_data: {
            chain: string,
            seqid: string,
            resname: string,
            atom_name: string,
            altloc: string,
          }[] = [];
          for (const partner of [connection.partner1, connection.partner2]) {
            if (partner == null) continue;
            try {
              const res_id = partner.res_id;
              try {
                partner_data.push({
                  chain: partner.chain_name || '',
                  seqid: res_id.seqid_string || '',
                  resname: res_id.name || '',
                  atom_name: partner.atom_name || '',
                  altloc: partner.altloc || '',
                });
              } finally {
                res_id.delete();
              }
            } finally {
              partner.delete();
            }
          }
          if (partner_data.length !== 2) continue;
          const residue_atoms = partner_data.map((partner) =>
            this.find_connection_residue_atoms(bag, partner.chain, partner.seqid));
          const atom_indices: number[] = [];
          for (const atoms of residue_atoms) {
            for (const atom of atoms) {
              if (atom_indices.indexOf(atom.i_seq) === -1) atom_indices.push(atom.i_seq);
            }
          }
          if (atom_indices.length === 0) continue;
          const anchor =
            this.find_connection_atom(residue_atoms[0], partner_data[0].atom_name,
                                      partner_data[0].altloc) ||
            this.find_connection_atom(residue_atoms[1], partner_data[1].atom_name,
                                      partner_data[1].altloc);
          const suffix = connection.asu === ctx.gemmi.Asu.Different ? ' [sym]' : '';
          const label = kind + ' ' +
                        partner_data[0].chain + '/' + partner_data[0].seqid + ' ' +
                        partner_data[0].resname + ' ' + partner_data[0].atom_name +
                        ' - ' +
                        partner_data[1].chain + '/' + partner_data[1].seqid + ' ' +
                        partner_data[1].resname + ' ' + partner_data[1].atom_name +
                        suffix;
          items.push({
            label: label,
            index: i,
            atom_indices: atom_indices,
            anchor_index: anchor ? anchor.i_seq : atom_indices[0],
          });
        } finally {
          connection.delete();
        }
      }
    } finally {
      connections.delete();
    }
    return items;
  }

  update_site_select(select: HTMLSelectElement | null, bag: ModelBag | undefined,
                     items: SiteNavItem[]) {
    if (select == null) return;
    select.innerHTML = '';
    if (bag == null || bag.gemmi_selection == null || bag.symop !== '') {
      select.style.display = 'none';
      select.disabled = true;
      return;
    }
    const header = document.createElement('option');
    header.textContent = 'SITEs (' + items.length + ')';
    header.value = '';
    header.selected = true;
    select.appendChild(header);
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = String(item.index);
      opt.textContent = item.label;
      select.appendChild(opt);
    }
    select.onchange = () => {
      if (select.value === '') return;
      const item = items.find((it) => String(it.index) === select.value);
      if (item) this.focus_site_item(bag, item);
      select.value = '';
    };
    select.disabled = (items.length === 0);
    select.style.display = '';
  }

  update_connection_select(select: HTMLSelectElement | null, bag: ModelBag | undefined,
                           items: ConnectionNavItem[]) {
    if (select == null) return;
    select.innerHTML = '';
    if (bag == null || bag.gemmi_selection == null || bag.symop !== '') {
      select.style.display = 'none';
      select.disabled = true;
      return;
    }
    const header = document.createElement('option');
    header.textContent = 'LINKs+SSBONDs (' + items.length + ')';
    header.value = '';
    header.selected = true;
    select.appendChild(header);
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = String(item.index);
      opt.textContent = item.label;
      select.appendChild(opt);
    }
    select.onchange = () => {
      if (select.value === '') return;
      const item = items.find((it) => String(it.index) === select.value);
      if (item) this.focus_connection_item(bag, item);
      select.value = '';
    };
    select.disabled = (items.length === 0);
    select.style.display = '';
  }

  focus_site_item(bag: ModelBag, item: SiteNavItem) {
    if (item.atom_indices.length === 0) return;
    let x = 0, y = 0, z = 0;
    let count = 0;
    let anchor: Atom | null = null;
    for (const idx of item.atom_indices) {
      const atom = bag.model.atoms[idx];
      if (atom == null) continue;
      x += atom.xyz[0];
      y += atom.xyz[1];
      z += atom.xyz[2];
      count++;
      if (anchor == null || atom.is_main_conformer()) anchor = atom;
    }
    if (anchor == null || count === 0) return;
    this.hud('-> ' + bag.label + ' site ' + item.label);
    this.toggle_label(this.selected, false);
    this.selected = {bag: bag, atom: anchor};
    this.update_nav_menus();
    this.toggle_label(this.selected, true);
    this.controls.go_to(new Vector3(x / count, y / count, z / count), null, null, 30);
    this.request_render();
  }

  focus_connection_item(bag: ModelBag, item: ConnectionNavItem) {
    if (item.atom_indices.length === 0) return;
    let x = 0, y = 0, z = 0;
    let count = 0;
    let anchor = bag.model.atoms[item.anchor_index] || null;
    for (const idx of item.atom_indices) {
      const atom = bag.model.atoms[idx];
      if (atom == null) continue;
      x += atom.xyz[0];
      y += atom.xyz[1];
      z += atom.xyz[2];
      count++;
      if (anchor == null || atom.is_main_conformer()) anchor = atom;
    }
    if (anchor == null || count === 0) return;
    this.hud('-> ' + bag.label + ' ' + item.label);
    this.toggle_label(this.selected, false);
    this.selected = {bag: bag, atom: anchor};
    this.update_nav_menus();
    this.toggle_label(this.selected, true);
    this.controls.go_to(new Vector3(x / count, y / count, z / count), null, null, 30);
    this.request_render();
  }

  update_download_select(select: HTMLSelectElement | null,
                         bag: ModelBag | null | undefined) {
    if (select == null) return;
    const ctx = this.download_target_context(bag);
    select.disabled = (ctx == null);
    select.style.display = (ctx == null) ? 'none' : '';
    select.value = '';
  }

  update_delete_select(select: HTMLSelectElement | null) {
    if (select == null) return;
    const editable_bag = this.editable_model_bag();
    const edit = this.current_edit_target();
    select.disabled = (edit == null);
    select.style.display = (editable_bag == null) ? 'none' : '';
    select.value = '';
  }

  mutation_target_from_resname(resname: string): string {
    const upper = resname.toUpperCase();
    if (upper === 'A' || upper === 'C' || upper === 'G' || upper === 'U') return upper;
    if (upper === 'DA' || upper === 'DC' || upper === 'DG' || upper === 'DT') return upper.slice(1);
    return upper;
  }

  edit_target_key(edit: {bag: ModelBag, atom: Atom}): string {
    return this.model_bags.indexOf(edit.bag) + ':' + edit.atom.chain + ':' + edit.atom.seqid;
  }

  mutation_target_step(targets: string[], current_target: string, dir: number): string | null {
    if (targets.length === 0) return null;
    let index = targets.indexOf(current_target);
    if (index === -1) {
      return dir < 0 ? null : targets[0];
    }
    const next_index = Math.max(0, Math.min(targets.length - 1, index + dir));
    if (next_index === index) return null;
    return targets[next_index];
  }

  set_mutate_menu_open(open: boolean) {
    this.mutate_open = open && this.mutate_targets.length > 0;
    this.sync_mutate_menu_ui();
  }

  sync_mutate_menu_ui() {
    const button = this.mutate_button_el;
    const list = this.mutate_list_el;
    if (button == null || list == null) return;
    button.textContent = this.mutate_select_target ? ('Mutate: ' + this.mutate_select_target) : 'Mutate';
    button.setAttribute('aria-expanded', this.mutate_open ? 'true' : 'false');
    list.style.display = this.mutate_open ? '' : 'none';
    for (const child of Array.from(list.children)) {
      if (!(child instanceof HTMLButtonElement)) continue;
      const active = child.dataset.target === this.mutate_select_target;
      child.style.backgroundColor = active ? 'rgba(90, 145, 210, 0.35)' : 'transparent';
    }
  }

  request_mutation_preview(target_resname: string) {
    if (target_resname === '') return;
    const edit = this.current_edit_target();
    if (edit == null) return;
    const residue_key = this.edit_target_key(edit);
    const current_target = this.mutation_target_from_resname(edit.atom.resname);
    this.mutate_select_target = target_resname;
    this.mutate_select_residue_key = residue_key;
    if (this.mutate_select_busy) {
      this.queued_mutation_preview = {target: target_resname, residue_key: residue_key};
      return;
    }
    if (target_resname === current_target) return;
    this.mutate_select_busy = true;
    Promise.resolve(this.mutate_selected_residue(target_resname)).finally(() => {
      this.mutate_select_busy = false;
      const queued = this.queued_mutation_preview;
      this.queued_mutation_preview = null;
      if (queued == null) return;
      const next_edit = this.current_edit_target();
      if (next_edit == null || this.edit_target_key(next_edit) !== queued.residue_key) return;
      if (this.mutation_target_from_resname(next_edit.atom.resname) === queued.target) {
        this.mutate_select_target = queued.target;
        return;
      }
      this.request_mutation_preview(queued.target);
    });
  }

  update_mutate_select(select: HTMLDivElement | null) {
    if (select == null) return;
    const editable_bag = this.editable_model_bag();
    const edit = this.current_edit_target();
    const button = this.mutate_button_el;
    const list = this.mutate_list_el;
    if (button == null || list == null) return;
    const residue_key = edit == null ? null : this.edit_target_key(edit);
    const same_residue = (residue_key != null && residue_key === this.mutate_select_residue_key);
    const preferred_target = same_residue ? (this.mutate_select_target || '') : '';
    let targets: string[] = [];
    if (edit != null) {
      const residue_atoms = edit.bag.model.get_residues()[edit.atom.resid()] || [edit.atom];
      targets = mutation_targets_for_residue(residue_atoms);
    }
    this.mutate_targets = targets;
    if (!same_residue) this.mutate_open = false;
    list.innerHTML = '';
    for (const target of targets) {
      const item = document.createElement('button');
      item.type = 'button';
      item.tabIndex = -1;
      item.dataset.target = target;
      item.textContent = target;
      item.style.display = 'block';
      item.style.width = '100%';
      item.style.padding = '3px 8px';
      item.style.border = '0';
      item.style.backgroundColor = 'transparent';
      item.style.color = '#d6e8ff';
      item.style.fontSize = '13px';
      item.style.textAlign = 'left';
      item.style.cursor = 'pointer';
      item.addEventListener('mousedown', (evt: MouseEvent) => {
        evt.preventDefault();
      });
      item.addEventListener('click', (evt: MouseEvent) => {
        evt.stopPropagation();
        this.mutate_select_target = target;
        this.sync_mutate_menu_ui();
        this.request_mutation_preview(target);
        this.mutate_button_el?.focus();
      });
      list.appendChild(item);
    }
    button.disabled = (edit == null || targets.length === 0);
    button.style.opacity = button.disabled ? '0.7' : '1';
    button.style.cursor = button.disabled ? 'default' : 'pointer';
    select.style.display = (editable_bag == null) ? 'none' : '';
    const current_target = edit == null ? '' : this.mutation_target_from_resname(edit.atom.resname);
    const value = targets.indexOf(preferred_target) !== -1 ? preferred_target :
      (targets.indexOf(current_target) !== -1 ? current_target : '');
    if (value === '' && targets.length === 0) this.mutate_open = false;
    this.mutate_select_residue_key = residue_key;
    this.mutate_select_target = value === '' ? null : value;
    this.sync_mutate_menu_ui();
  }

  unresolved_monomer_message() {
    const unresolved = this.last_bonding_info ? this.last_bonding_info.unresolved_monomers : [];
    if (unresolved == null || unresolved.length === 0) return null;
    let msg = 'Missing monomer dictionar' + (unresolved.length === 1 ? 'y' : 'ies') +
      ': ' + unresolved.join(', ') + '.';
    msg += ' Drop companion CIF to show ligand bonds.';
    return msg;
  }

  drop_complete_message(names: string[]) {
    let msg = 'loaded ' + names.join(', ');
    const warning = this.unresolved_monomer_message();
    if (warning != null) msg += '. ' + warning;
    return msg;
  }

  show_blobs(negate: boolean, prefer_diff: boolean=false,
             search_sigma?: number, mask_waters: boolean=false) {
    const map_bag = this.blob_source_map_bag(negate, prefer_diff);
    if (map_bag == null) {
      this.hud('No suitable map is loaded for blob search.', 'ERR');
      return;
    }
    const ctx = this.blob_search_context();
    const sigma = search_sigma ?? map_bag.isolevel;
    let hits;
    try {
      hits = map_bag.map.find_blobs(map_bag.map.abs_level(sigma), {
        negate: negate,
        structure: ctx ? ctx.structure : null,
        model_index: ctx ? ctx.model_index : 0,
        mask_waters: mask_waters,
      });
    } catch (err) {
      const msg = (err instanceof Error && err.message) ?
        err.message : 'Blob search failed for this map.';
      this.hud(msg, 'ERR');
      return;
    }
    hits.sort((a, b) => b.score - a.score || b.peak_value - a.peak_value);
    const total = hits.length;
    const limit = 25;
    if (hits.length > limit) hits = hits.slice(0, limit);
    this.blob_hits = hits;
    this.blob_map_bag = map_bag;
    this.blob_negate = negate;
    this.blob_search_sigma = sigma;
    this.blob_mask_waters = mask_waters;
    this.blob_focus_index = hits.length === 0 ? -1 : 0;
    this.redraw_blobs();
    this.update_nav_menus();
    const kind = negate ? 'negative' :
      (map_bag.is_diff_map ? 'positive diff' : 'positive');
    if (hits.length === 0) {
      this.hud('No ' + kind + ' blobs above ' +
               sigma.toFixed(2) + ' rmsd.');
    } else {
      let msg = 'Found ' + hits.length + ' ' + kind + ' blob';
      if (hits.length !== 1) msg += 's';
      msg += ' above ' + sigma.toFixed(2) + ' rmsd';
      if (total > hits.length) msg += ' (top ' + hits.length + ' by score)';
      this.hud(msg + '.');
    }
    this.request_render();
  }

  show_empty_blobs() {
    this.show_blobs(false, true, 1.0, true);
  }

  hide_blobs(quiet: boolean=false) {
    const had_blobs = this.blob_hits.length !== 0 || this.blob_objects.length !== 0;
    this.blob_hits = [];
    this.blob_map_bag = null;
    this.blob_focus_index = -1;
    this.blob_search_sigma = null;
    this.blob_mask_waters = false;
    this.clear_blob_objects();
    this.update_nav_menus();
    if (!quiet && had_blobs) this.hud('Blobs hidden.');
    this.request_render();
  }

  focus_blob(index: number) {
    if (index < 0 || index >= this.blob_hits.length) return;
    this.blob_focus_index = index;
    this.update_nav_menus();
    const hit = this.blob_hits[index];
    const xyz = this.blob_target_xyz(hit);
    this.hud('Blob #' + (index + 1) +
             ': score ' + hit.score.toFixed(1) +
             ', peak ' + hit.peak_value.toFixed(2) +
             ', volume ' + hit.volume.toFixed(1) + ' A^3');
    this.controls.go_to(new Vector3(xyz[0], xyz[1], xyz[2]),
                        null, null, 30);
    this.request_render();
  }

  current_blob_hit() {
    if (this.blob_hits.length === 0) return null;
    let index = this.blob_focus_index;
    if (index < 0 || index >= this.blob_hits.length) index = 0;
    this.blob_focus_index = index;
    return {index: index, hit: this.blob_hits[index]};
  }

  blob_target_xyz(hit: BlobHit) {
    if (!this.blob_negate && this.blob_map_bag != null && this.blob_map_bag.is_diff_map) {
      return hit.peak_pos;
    }
    return hit.centroid;
  }

  choose_build_chain_name(ctx: GemmiSelectionContext) {
    const gm = ctx.structure.at(ctx.model_index);
    const used = new Set<string>();
    for (let i = 0; gm != null && i < gm.length; i++) {
      const chain = gm.at(i);
      if (chain != null) used.add(chain.name);
    }
    const preferred = ['', 'Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'S', 'R', 'Q', 'P'];
    for (const name of preferred) {
      if (!used.has(name)) return name;
    }
    let n = 1;
    while (used.has('G' + n)) n++;
    return 'G' + n;
  }

  ensure_build_chain(bag: ModelBag, ctx: GemmiSelectionContext) {
    const gm = ctx.structure.at(ctx.model_index);
    if (gm == null) throw Error('Gemmi model is unavailable.');
    const last_chain = gm.length === 0 ? null : gm.at(gm.length - 1);
    if (bag.build_chain_name != null &&
        last_chain != null && last_chain.name === bag.build_chain_name) {
      return last_chain;
    }
    const chain = new ctx.gemmi.Chain();
    try {
      bag.build_chain_name = this.choose_build_chain_name(ctx);
      chain.name = bag.build_chain_name;
      gm.add_chain(chain);
    } finally {
      chain.delete();
    }
    return gm.at(gm.length - 1);
  }

  next_build_seqid(chain: any) {
    let max_seqid = 0;
    for (let i = 0; i < chain.length; i++) {
      const residue = chain.at(i);
      if (residue == null) continue;
      const match = residue.seqid_string.match(/^-?\d+/);
      if (match == null) continue;
      const seqid = parseInt(match[0], 10);
      if (!Number.isNaN(seqid) && seqid > max_seqid) max_seqid = seqid;
    }
    return max_seqid + 1;
  }

  refresh_model_from_structure(bag: ModelBag, center: Num3) {
    const ctx = bag.gemmi_selection;
    if (ctx == null) throw Error('Gemmi selection is unavailable for this model.');
    const bond_data = bag.model.bond_data;
    const model = modelFromGemmiStructure(ctx.gemmi, ctx.structure, bond_data, ctx.model_index);
    if (bond_data != null) model.bond_data = bond_data;
    this.clear_labels_for_bag(bag);
    bag.model = model;
    this.redraw_model(bag);
    const next_atom = bag.model.get_nearest_atom(center[0], center[1], center[2]) ||
                      bag.model.atoms[bag.model.atoms.length - 1];
    this.selected = {bag: bag, atom: next_atom};
    this.update_nav_menus();
    this.toggle_label(this.selected, true);
    this.controls.go_to(new Vector3(center[0], center[1], center[2]), null, null, 15);
    this.request_render();
  }

  refresh_model_from_structure_with_bonds(bag: ModelBag, center: Num3) {
    const ctx = bag.gemmi_selection;
    if (ctx == null) return Promise.reject(Error('Gemmi selection is unavailable for this model.'));
    const self = this;
    return bondDataFromGemmiStructure(ctx.gemmi, ctx.structure,
                                      this.fetch_monomer_cifs.bind(this)).then(function (result) {
      const model = modelFromGemmiStructure(ctx.gemmi, ctx.structure,
                                            result.bond_data, ctx.model_index);
      if (result.bond_data != null) model.bond_data = result.bond_data;
      self.last_bonding_info = result.bonding;
      self.clear_labels_for_bag(bag);
      bag.model = model;
      self.redraw_model(bag);
      const next_atom = bag.model.get_nearest_atom(center[0], center[1], center[2]) ||
                        bag.model.atoms[bag.model.atoms.length - 1];
      self.selected = {bag: bag, atom: next_atom};
      self.update_nav_menus();
      self.toggle_label(self.selected, true);
      self.controls.go_to(new Vector3(center[0], center[1], center[2]), null, null, 15);
      self.request_render();
    });
  }

  place_selected_blob(kind: string) {
    const blob = this.current_blob_hit();
    if (blob == null) {
      this.hud('Show blobs and pick one first.', 'ERR');
      return;
    }
    const bag = this.editable_model_bag();
    if (bag == null || bag.gemmi_selection == null) {
      this.hud('Blob placement requires an editable Gemmi-backed model.', 'ERR');
      return;
    }
    if (this.sym_model_bags.length > 0) {
      this.toggle_symmetry();
    }
    const spec = {
      water: {resname: 'HOH', atom_name: 'O', element: 'O', charge: 0, label: 'water'},
      na: {resname: 'NA', atom_name: 'NA', element: 'NA', charge: 1, label: 'Na'},
      mg: {resname: 'MG', atom_name: 'MG', element: 'MG', charge: 2, label: 'Mg'},
      ca: {resname: 'CA', atom_name: 'CA', element: 'CA', charge: 2, label: 'Ca'},
      zn: {resname: 'ZN', atom_name: 'ZN', element: 'ZN', charge: 2, label: 'Zn'},
    }[kind];
    if (spec == null) {
      this.hud('Unknown blob placement type: ' + kind, 'ERR');
      return;
    }
    const ctx = bag.gemmi_selection;
    const chain = this.ensure_build_chain(bag, ctx);
    const residue = new ctx.gemmi.Residue();
    const atom = new ctx.gemmi.Atom();
    const xyz = this.blob_target_xyz(blob.hit);
    let placed_label: string;
    try {
      residue.name = spec.resname;
      residue.set_seqid(this.next_build_seqid(chain), '');
      atom.name = spec.atom_name;
      atom.set_element(spec.element);
      atom.pos = xyz;
      atom.occ = 1.0;
      atom.b_iso = 30.0;
      atom.charge = spec.charge;
      residue.add_atom(atom);
      chain.add_residue(residue);
      placed_label = atom.name + ' /' + residue.seqid_string + ' ' +
                     residue.name + '/' + chain.name;
    } finally {
      atom.delete();
      residue.delete();
    }
    this.toggle_label(this.selected, false);
    this.refresh_model_from_structure(bag, xyz);
    if (this.blob_map_bag != null) {
      this.show_blobs(this.blob_negate,
                      this.blob_map_bag.is_diff_map,
                      this.blob_search_sigma == null ? undefined : this.blob_search_sigma,
                      this.blob_mask_waters);
    }
    this.hud('Placed ' + spec.label + ' at blob #' + (blob.index + 1) +
             ' as ' + placed_label + '.');
  }

  download_target_context(preferred_bag?: ModelBag | null) {
    const bag = preferred_bag || this.active_model_bag();
    if (bag != null && bag.symop === '' && bag.gemmi_selection != null) {
      return bag.gemmi_selection;
    }
    const primary = this.model_bags.find((it) => it.symop === '' && it.gemmi_selection != null);
    if (primary != null) return primary.gemmi_selection;
    const any = this.model_bags.find((it) => it.gemmi_selection != null);
    return any ? any.gemmi_selection : null;
  }

  blob_search_context() {
    const bag = this.active_model_bag();
    if (bag != null && bag.symop === '' && bag.gemmi_selection != null) {
      return bag.gemmi_selection;
    }
    const target = [this.target.x, this.target.y, this.target.z] as Num3;
    let best: {ctx: GemmiSelectionContext, dist2: number} | null = null;
    for (const candidate of this.model_bags) {
      if (candidate.symop !== '' || candidate.gemmi_selection == null) continue;
      const atom = candidate.model.get_nearest_atom(target[0], target[1], target[2]);
      let dist2;
      if (atom != null) {
        dist2 = ((atom.xyz[0] - target[0]) ** 2 +
                 (atom.xyz[1] - target[1]) ** 2 +
                 (atom.xyz[2] - target[2]) ** 2);
      } else {
        const center = candidate.model.get_center();
        dist2 = ((center[0] - target[0]) ** 2 +
                 (center[1] - target[1]) ** 2 +
                 (center[2] - target[2]) ** 2);
      }
      if (best == null || dist2 < best.dist2) {
        best = {ctx: candidate.gemmi_selection, dist2: dist2};
      }
    }
    return best ? best.ctx : null;
  }

  download_model(format: 'pdb' | 'mmcif') {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return;
    const ctx = this.download_target_context();
    if (ctx == null) {
      this.hud('No Gemmi-backed structure loaded.');
      return;
    }
    const structure_name = ctx.structure.name || null;
    const text = format === 'pdb' ?
      ctx.gemmi.make_pdb_string(ctx.structure) :
      ctx.gemmi.make_mmcif_string(ctx.structure);
    const filename = download_filename(structure_name, format);
    const href = URL.createObjectURL(new Blob([text], {type: 'text/plain'}));
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    this.hud('Downloaded ' + filename + '.');
  }

  current_edit_target() {
    const bag = this.selected.bag;
    const atom = this.selected.atom;
    if (bag == null || atom == null) return null;
    if (bag.symop !== '' || bag.gemmi_selection == null) return null;
    if (this.model_bags.indexOf(bag) === -1) return null;
    return {bag, atom, ctx: bag.gemmi_selection};
  }

  editable_model_bag() {
    const bag = this.active_model_bag();
    if (bag != null && bag.symop === '' && bag.gemmi_selection != null) {
      return bag;
    }
    const primary = this.model_bags.find((it) => it.symop === '' && it.gemmi_selection != null);
    if (primary != null) return primary;
    const any = this.model_bags.find((it) => it.gemmi_selection != null);
    return any || null;
  }

  deletion_scope(scope: 'atom' | 'residue' | 'chain',
                 bag: ModelBag, atom: Atom) {
    let atoms: Atom[];
    let label: string;
    if (scope === 'atom') {
      atoms = [atom];
      label = atom.short_label();
    } else if (scope === 'residue') {
      atoms = bag.model.get_residues()[atom.resid()] || [atom];
      label = '/' + atom.seqid + ' ' + atom.resname + '/' + atom.chain;
    } else {
      atoms = bag.model.atoms.filter((item) => item.chain_index === atom.chain_index);
      label = atom.chain;
    }
    let x = 0, y = 0, z = 0;
    for (const item of atoms) {
      x += item.xyz[0];
      y += item.xyz[1];
      z += item.xyz[2];
    }
    return {
      atoms: atoms,
      indices: atoms.map((item) => item.i_seq),
      label: label,
      center: atoms.length === 0 ? atom.xyz : [x / atoms.length, y / atoms.length, z / atoms.length] as Num3,
    };
  }

  deletion_cid(scope: 'atom' | 'residue' | 'chain',
               ctx: GemmiSelectionContext, atom: Atom) {
    const gm = ctx.structure.at(ctx.model_index);
    const model_num = gm ? gm.num : ctx.model_index + 1;
    const chain_part = atom.chain;
    const residue_part = atom.seqid;
    if (scope === 'chain') {
      return chain_part === '' ? '/' + model_num + '//' : '/' + model_num + '/' + chain_part;
    }
    if (scope === 'residue') {
      return '/' + model_num + '/' + chain_part + '/' + residue_part;
    }
    const altloc_part = atom.altloc === '' ? ':' : ':' + atom.altloc;
    return '/' + model_num + '/' + chain_part + '/' + residue_part + '/' + atom.name + altloc_part;
  }

  remove_from_structure_by_cid(ctx: GemmiSelectionContext, cid: string) {
    if (typeof ctx.gemmi.Selection !== 'function') {
      throw Error('Deletion is unavailable in this Gemmi build.');
    }
    const sel = new ctx.gemmi.Selection(cid);
    try {
      sel.remove_selected(ctx.structure);
    } finally {
      sel.delete();
    }
  }

  find_gemmi_residue(ctx: GemmiSelectionContext, atom: Atom) {
    const gm = ctx.structure.at(ctx.model_index);
    if (gm == null) return null;
    for (let i_chain = 0; i_chain < gm.length; i_chain++) {
      const chain = gm.at(i_chain);
      if (chain == null || chain.name !== atom.chain) continue;
      for (let i_res = 0; i_res < chain.length; i_res++) {
        const residue = chain.at(i_res);
        if (residue != null && residue.seqid_string === atom.seqid) return residue;
      }
    }
    return null;
  }

  should_keep_atom_for_alanine(atom: Atom) {
    return [
      'N', 'CA', 'C', 'O', 'OXT', 'OT1', 'OT2', 'CB',
      'H', 'H1', 'H2', 'H3', 'HA', 'HA2', 'HA3',
      'HB', 'HB1', 'HB2', 'HB3', '1HB', '2HB', '3HB',
      'D', 'D1', 'D2', 'D3', 'DA', 'DA2', 'DA3',
      'DB', 'DB1', 'DB2', 'DB3', '1DB', '2DB', '3DB',
    ].indexOf(atom.name) !== -1;
  }

  trim_scope_to_alanine(bag: ModelBag, atom: Atom) {
    const residue_atoms = bag.model.get_residues()[atom.resid()] || [atom];
    const has_cb = residue_atoms.some((item) => item.name === 'CB');
    const remove_atoms = residue_atoms.filter((item) => !this.should_keep_atom_for_alanine(item));
    let x = 0, y = 0, z = 0;
    for (const item of residue_atoms) {
      x += item.xyz[0];
      y += item.xyz[1];
      z += item.xyz[2];
    }
    return {
      atoms: residue_atoms,
      remove_atoms: remove_atoms,
      remove_indices: remove_atoms.map((item) => item.i_seq),
      has_cb: has_cb,
      label: '/' + atom.seqid + ' ' + atom.resname + '/' + atom.chain,
      center: [x / residue_atoms.length, y / residue_atoms.length, z / residue_atoms.length] as Num3,
    };
  }

  clear_labels_for_bag(bag: ModelBag) {
    for (const uid in this.labels) {
      if (this.labels[uid].bag !== bag) continue;
      this.remove_and_dispose(this.labels[uid].o.mesh);
      delete this.labels[uid];
    }
  }

  apply_deletion_result(bag: ModelBag, center: Num3) {
    if (bag.model.atoms.length === 0) {
      this.clear_model_objects(bag);
      const idx = this.model_bags.indexOf(bag);
      if (idx !== -1) this.model_bags.splice(idx, 1);
      this.selected = {bag: this.model_bags[0] || null, atom: null};
      this.update_nav_menus();
      this.request_render();
      return;
    }
    this.redraw_model(bag);
    const next_atom = bag.model.get_nearest_atom(center[0], center[1], center[2]) ||
                      bag.model.atoms[0];
    this.selected = {bag, atom: next_atom};
    this.update_nav_menus();
    this.toggle_label(this.selected, true);
    this.controls.go_to(new Vector3(next_atom.xyz[0], next_atom.xyz[1], next_atom.xyz[2]),
                        null, null, 15);
    this.request_render();
  }

  delete_selected(scope: 'atom' | 'residue' | 'chain') {
    const edit = this.current_edit_target();
    if (edit == null) {
      this.hud('Select an atom in a loaded model first.', 'ERR');
      return;
    }
    if (this.sym_model_bags.length > 0) {
      this.toggle_symmetry();
    }
    const target = this.deletion_scope(scope, edit.bag, edit.atom);
    if (target.indices.length === 0) {
      this.hud('Nothing selected for deletion.', 'ERR');
      return;
    }
    try {
      this.remove_from_structure_by_cid(edit.ctx, this.deletion_cid(scope, edit.ctx, edit.atom));
    } catch (e) {
      const msg = (e instanceof Error) ? e.message : 'Deletion failed.';
      this.hud(msg, 'ERR');
      return;
    }
    this.toggle_label(this.selected, false);
    this.clear_labels_for_bag(edit.bag);
    edit.bag.model.remove_atoms(target.indices);
    this.apply_deletion_result(edit.bag, target.center);
    this.hud('Deleted ' + scope + ' ' + target.label + '.');
  }

  trim_selected_to_alanine() {
    const edit = this.current_edit_target();
    if (edit == null) {
      this.hud('Select an atom in a loaded model first.', 'ERR');
      return;
    }
    if (this.sym_model_bags.length > 0) {
      this.toggle_symmetry();
    }
    const target = this.trim_scope_to_alanine(edit.bag, edit.atom);
    if (!target.has_cb) {
      this.hud('Residue lacks CB and cannot be trimmed to ALA.', 'ERR');
      return;
    }
    const gm_residue = this.find_gemmi_residue(edit.ctx, edit.atom);
    if (gm_residue == null) {
      this.hud('Residue is unavailable in the Gemmi structure.', 'ERR');
      return;
    }
    try {
      for (const atom of target.remove_atoms) {
        this.remove_from_structure_by_cid(edit.ctx, this.deletion_cid('atom', edit.ctx, atom));
      }
      gm_residue.name = 'ALA';
    } catch (e) {
      const msg = (e instanceof Error) ? e.message : 'Trim to ALA failed.';
      this.hud(msg, 'ERR');
      return;
    }
    this.toggle_label(this.selected, false);
    this.clear_labels_for_bag(edit.bag);
    edit.bag.model.remove_atoms(target.remove_indices);
    const residue_atoms = edit.bag.model.get_residues()[edit.atom.resid()] || [];
    for (const atom of residue_atoms) atom.resname = 'ALA';
    this.apply_deletion_result(edit.bag, target.center);
    this.hud('Trimmed ' + target.label + ' to ALA.');
  }

  mutate_selected_residue(target_resname: string) {
    const edit = this.current_edit_target();
    if (edit == null) {
      this.hud('Select an atom in a loaded model first.', 'ERR');
      return Promise.resolve();
    }
    if (this.sym_model_bags.length > 0) {
      this.toggle_symmetry();
    }
    const residue_atoms = edit.bag.model.get_residues()[edit.atom.resid()] || [edit.atom];
    let plan;
    try {
      plan = plan_residue_mutation(residue_atoms, target_resname);
    } catch (e) {
      const msg = (e instanceof Error) ? e.message : 'Mutation failed.';
      this.hud(msg, 'ERR');
      return Promise.resolve();
    }
    const gm_residue = this.find_gemmi_residue(edit.ctx, edit.atom);
    if (gm_residue == null) {
      this.hud('Residue is unavailable in the Gemmi structure.', 'ERR');
      return Promise.resolve();
    }
    try {
      for (const atom of plan.remove_atoms) {
        this.remove_from_structure_by_cid(edit.ctx, this.deletion_cid('atom', edit.ctx, atom));
      }
      gm_residue.name = plan.target_resname;
      for (const atom_data of plan.add_atoms) {
        const atom = new edit.ctx.gemmi.Atom();
        try {
          atom.name = atom_data.name;
          atom.set_element(atom_data.element);
          atom.pos = atom_data.xyz;
          atom.occ = plan.occupancy;
          atom.b_iso = plan.b_iso;
          atom.charge = 0;
          gm_residue.add_atom(atom);
        } finally {
          atom.delete();
        }
      }
    } catch (e) {
      const msg = (e instanceof Error) ? e.message : 'Mutation failed.';
      this.hud(msg, 'ERR');
      return Promise.resolve();
    }
    this.toggle_label(this.selected, false);
    const self = this;
    return this.refresh_model_from_structure_with_bonds(edit.bag, plan.focus).then(function () {
      self.hud('Mutated ' + plan.label + ' to ' + plan.target_resname + '.');
    }, function (err) {
      const msg = err instanceof Error ? err.message : String(err);
      self.hud(msg || 'Mutation failed.', 'ERR');
    });
  }

  open_cid_dialog() {
    if (this.cid_dialog_el == null || this.cid_input_el == null) return;
    const bag = this.active_model_bag();
    if (bag == null || bag.gemmi_selection == null) {
      this.hud('Gemmi selection is unavailable for this model.', 'ERR');
      return;
    }
    this.cid_dialog_el.style.display = 'block';
    this.cid_input_el.focus();
    this.cid_input_el.select();
  }

  close_cid_dialog() {
    if (this.cid_dialog_el == null || this.cid_input_el == null) return;
    this.cid_dialog_el.style.display = 'none';
    this.cid_input_el.blur();
    if (this.renderer && this.renderer.domElement) this.renderer.domElement.focus();
  }

  apply_cid_input() {
    if (this.cid_input_el == null) return;
    const cid = this.cid_input_el.value.trim();
    if (cid === '') {
      this.close_cid_dialog();
      return;
    }
    try {
      const sel = this.selection_atoms(cid);
      if (sel.atoms.length === 0) {
        this.close_cid_dialog();
        this.hud('No atoms match selection: ' + cid, 'ERR');
        return;
      }
      if (sel.atoms.length === 1) {
        this.select_atom({bag: sel.bag, atom: sel.atoms[0]}, {steps: 30});
      } else {
        this.center_on_selection(cid, {bag: sel.bag, steps: 30});
      }
      this.close_cid_dialog();
    } catch (e) {
      this.close_cid_dialog();
      const msg = (e instanceof Error) ? e.message : 'Invalid CID selection: ' + cid;
      this.hud(msg, 'ERR');
    }
  }

  redraw_all() {
    if (!this.renderer) return;
    this.scene.fog.color = this.config.colors.bg;
    if (this.renderer) this.renderer.setClearColor(this.config.colors.bg, 1);
    this.redraw_models();
    this.redraw_maps(true);
    this.redraw_blobs();
    this.redraw_labels();
  }

  toggle_help() {
    const el = this.help_el;
    if (!el) return;
    el.style.display = el.style.display === 'block' ? 'none' : 'block';
    if (el.style.display === 'block') {
      this.update_help();
    }
  }

  toggle_histogram() {
    if (this.histogram_el) {
      this.histogram_el.remove();
      this.histogram_el = null;
      this.histogram_redraw = null;
      return;
    }
    const map_bag = this.map_bags[0];
    if (!map_bag) {
      this.hud('no map loaded');
      return;
    }
    const map = map_bag.map;
    let data: Float32Array | null = null;
    if (map.wasm_map != null) {
      data = map.wasm_map.data();
    } else if (map.grid != null) {
      data = map.grid.values;
    }
    if (data == null || data.length === 0) {
      this.hud('no map data for histogram');
      return;
    }
    this.draw_histogram(data, map_bag);
  }

  draw_histogram(data: Float32Array, map_bag: MapBag) {
    const map = map_bag.map;
    const mean = map.stats.mean;
    const rms = map.stats.rms;

    const n_bins = 200;
    // find actual data range for the right tail
    let data_max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (data[i] > data_max) data_max = data[i];
    }
    const range_min = Math.max(0, mean - 6 * rms);
    const range_max = Math.max(mean + 6 * rms, data_max);
    const bin_width = (range_max - range_min) / n_bins;
    const counts = new Uint32Array(n_bins);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      let bin = Math.floor((v - range_min) / bin_width);
      if (bin < 0) bin = 0;
      if (bin >= n_bins) bin = n_bins - 1;
      counts[bin]++;
    }

    const log_counts = new Float64Array(n_bins);
    let max_log = 0;
    for (let i = 0; i < n_bins; i++) {
      log_counts[i] = counts[i] > 0 ? Math.log10(counts[i]) : 0;
      if (log_counts[i] > max_log) max_log = log_counts[i];
    }

    const W = 400;
    const H = 220;
    const pad_left = 40;
    const pad_right = 10;
    const pad_top = 25;
    const pad_bottom = 35;
    const plot_w = W - pad_left - pad_right;
    const plot_h = H - pad_top - pad_bottom;

    const val2x = (v: number) =>
      pad_left + ((v - range_min) / (range_max - range_min)) * plot_w;
    const x2sigma = (x: number) =>
      ((x - pad_left) / plot_w * (range_max - range_min) + range_min - mean) / rms;

    // wrapper
    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.right = '10px';
    wrapper.style.top = '50%';
    wrapper.style.transform = 'translateY(-50%)';
    wrapper.style.zIndex = '10';

    // container for the two canvases
    const canvas_box = document.createElement('div');
    canvas_box.style.position = 'relative';
    canvas_box.style.width = W + 'px';
    canvas_box.style.height = H + 'px';

    // minimize button
    const btn = document.createElement('div');
    btn.style.position = 'absolute';
    btn.style.top = '2px';
    btn.style.right = '2px';
    btn.style.width = '18px';
    btn.style.height = '18px';
    btn.style.lineHeight = '16px';
    btn.style.textAlign = 'center';
    btn.style.cursor = 'pointer';
    btn.style.color = '#aaa';
    btn.style.fontSize = '14px';
    btn.style.zIndex = '12';
    btn.textContent = '\u2013';
    btn.title = 'minimize';
    btn.onclick = (e) => {
      e.stopPropagation();
      if (canvas_box.style.display === 'none') {
        canvas_box.style.display = '';
        btn.textContent = '\u2013';
        btn.title = 'minimize';
        btn.style.position = 'absolute';
        btn.style.backgroundColor = '';
      } else {
        canvas_box.style.display = 'none';
        btn.textContent = '\u25a4';
        btn.title = 'show histogram';
        btn.style.position = '';
        btn.style.backgroundColor = 'rgba(0,0,0,0.7)';
      }
    };

    // background canvas: bars, axes, labels (drawn once)
    const bg = document.createElement('canvas');
    bg.width = W;
    bg.height = H;
    bg.style.position = 'absolute';
    bg.style.left = '0';
    bg.style.top = '0';

    const bg_ctx = bg.getContext('2d')!;
    bg_ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    bg_ctx.fillRect(0, 0, W, H);

    // bars
    const bar_w = plot_w / n_bins;
    bg_ctx.fillStyle = '#5588cc';
    for (let i = 0; i < n_bins; i++) {
      if (log_counts[i] === 0) continue;
      const bar_h = (log_counts[i] / max_log) * plot_h;
      bg_ctx.fillRect(pad_left + i * bar_w, pad_top + plot_h - bar_h,
                      Math.max(bar_w - 0.5, 1), bar_h);
    }

    // mean line
    const mean_x = val2x(mean);
    if (mean_x >= pad_left && mean_x <= pad_left + plot_w) {
      bg_ctx.strokeStyle = '#aaa';
      bg_ctx.lineWidth = 1;
      bg_ctx.setLineDash([4, 3]);
      bg_ctx.beginPath();
      bg_ctx.moveTo(mean_x, pad_top);
      bg_ctx.lineTo(mean_x, pad_top + plot_h);
      bg_ctx.stroke();
      bg_ctx.setLineDash([]);
    }

    // axes
    bg_ctx.strokeStyle = '#888';
    bg_ctx.lineWidth = 1;
    bg_ctx.beginPath();
    bg_ctx.moveTo(pad_left, pad_top);
    bg_ctx.lineTo(pad_left, pad_top + plot_h);
    bg_ctx.lineTo(pad_left + plot_w, pad_top + plot_h);
    bg_ctx.stroke();

    // x-axis labels (in sigma)
    bg_ctx.fillStyle = '#ccc';
    bg_ctx.font = '10px monospace';
    bg_ctx.textAlign = 'center';
    for (let s = -5; s <= 5; s += 1) {
      const v = mean + s * rms;
      const x = val2x(v);
      if (x < pad_left || x > pad_left + plot_w) continue;
      bg_ctx.beginPath();
      bg_ctx.moveTo(x, pad_top + plot_h);
      bg_ctx.lineTo(x, pad_top + plot_h + 4);
      bg_ctx.stroke();
      if (s % 2 === 0) {
        bg_ctx.fillText(s + '\u03c3', x, pad_top + plot_h + 15);
      }
    }

    // y-axis labels
    bg_ctx.textAlign = 'right';
    for (let p = 0; p <= max_log; p += 1) {
      const y = pad_top + plot_h - (p / max_log) * plot_h;
      bg_ctx.beginPath();
      bg_ctx.moveTo(pad_left - 4, y);
      bg_ctx.lineTo(pad_left, y);
      bg_ctx.stroke();
      bg_ctx.fillText('10' + (p === 0 ? '\u2070' :
                               p === 1 ? '\u00b9' :
                               p === 2 ? '\u00b2' :
                               p === 3 ? '\u00b3' :
                               '\u2074\u207a'), pad_left - 6, y + 3);
    }

    // title
    bg_ctx.fillStyle = '#ddd';
    bg_ctx.font = '11px sans-serif';
    bg_ctx.textAlign = 'left';
    const title = (map_bag.name || 'map') +
      '  \u03bc=' + mean.toFixed(3) + '  \u03c3=' + rms.toFixed(3);
    bg_ctx.fillText(title, pad_left, pad_top - 10);

    // x-axis label
    bg_ctx.fillStyle = '#aaa';
    bg_ctx.font = '10px sans-serif';
    bg_ctx.textAlign = 'center';
    bg_ctx.fillText('density (' + map.unit + ')', pad_left + plot_w / 2,
                    H - 3);

    // overlay canvas: isolevel line (redrawn on interaction)
    const overlay = document.createElement('canvas');
    overlay.width = W;
    overlay.height = H;
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.cursor = 'ew-resize';
    const ov_ctx = overlay.getContext('2d')!;

    const iso_color = map_bag.is_diff_map ? '#40b040' : '#ff6644';
    const draw_isolevel = () => {
      ov_ctx.clearRect(0, 0, W, H);
      const abs_level = map.abs_level(map_bag.isolevel);
      const iso_x = val2x(abs_level);
      if (iso_x >= pad_left && iso_x <= pad_left + plot_w) {
        ov_ctx.strokeStyle = iso_color;
        ov_ctx.lineWidth = 2;
        ov_ctx.beginPath();
        ov_ctx.moveTo(iso_x, pad_top);
        ov_ctx.lineTo(iso_x, pad_top + plot_h);
        ov_ctx.stroke();
        ov_ctx.fillStyle = iso_color;
        ov_ctx.font = '10px monospace';
        ov_ctx.textAlign = 'center';
        ov_ctx.fillText(map_bag.isolevel.toFixed(1) + '\u03c3',
                        iso_x, pad_top - 3);
      }
    };
    draw_isolevel();

    // interactive isolevel selection
    let dragging = false;
    const set_level_from_x = (x: number) => {
      const sigma = x2sigma(x);
      const sigma_min = (range_min - mean) / rms;
      const sigma_max = (range_max - mean) / rms;
      const clamped = Math.round(Math.max(sigma_min, Math.min(sigma_max, sigma)) * 10) / 10;
      if (clamped === map_bag.isolevel) return;
      map_bag.isolevel = clamped;
      draw_isolevel();
      this.clear_el_objects(map_bag);
      this.add_el_objects(map_bag);
      const abs_level = map.abs_level(map_bag.isolevel);
      this.hud('map level = ' + abs_level.toFixed(4) + ' ' +
               map.unit + ' (' + map_bag.isolevel.toFixed(2) + ' rmsd)');
      this.request_render();
    };
    overlay.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      set_level_from_x(e.offsetX);
    });
    overlay.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      set_level_from_x(e.offsetX);
    });
    const stop_drag = () => { dragging = false; };
    overlay.addEventListener('mouseup', stop_drag);
    overlay.addEventListener('mouseleave', stop_drag);

    canvas_box.appendChild(bg);
    canvas_box.appendChild(overlay);
    wrapper.appendChild(btn);
    wrapper.appendChild(canvas_box);

    this.histogram_el = wrapper;
    this.histogram_redraw = draw_isolevel;
    (this.container || document.body).appendChild(wrapper);
  }

  update_help() {
    const el = this.help_el;
    if (!el) return;
    el.innerHTML = [this.MOUSE_HELP, this.KEYBOARD_HELP,
                    this.ABOUT_HELP, this.fps_text].join('\n\n');
  }

  trigger_help_action(keyCode: number, shiftKey: boolean=false, ctrlKey: boolean=false) {
    this.keydown({
      keyCode: keyCode,
      shiftKey: shiftKey,
      ctrlKey: ctrlKey,
      preventDefault() {},
    } as KeyboardEvent);
  }

  on_help_click(event: MouseEvent) {
    let el = event.target as HTMLElement | null;
    while (el && el !== this.help_el) {
      const keycode = el.getAttribute('data-help-keycode');
      if (keycode != null) {
        event.preventDefault();
        event.stopPropagation();
        this.trigger_help_action(
          parseInt(keycode, 10),
          el.getAttribute('data-help-shift') === '1',
          el.getAttribute('data-help-ctrl') === '1'
        );
        return;
      }
      el = el.parentElement;
    }
  }

  select_menu_html(info: string, key: string, options: string[]) {
    const value = this.config[key];
    const encoded_options = JSON.stringify(options);
    let html = escape_html(info) + ':';
    for (const option of options) {
      const tag = (option === value ? 'u' : 's');
      html += ' <a href="#" class="gm-hud-option" data-hud-select-key="' + escape_html(key) +
              '" data-hud-select-value="' + escape_html(option) +
              '" data-hud-select-info="' + escape_html(info) +
              '" data-hud-select-options="' + escape_html(encoded_options) + '">' +
              '<' + tag + '>' + escape_html(option) + '</' + tag + '></a>';
    }
    return html;
  }

  apply_selected_option(key: string) {
    switch (key) {
      case 'color_scheme':
        this.set_colors();
        break;
      case 'color_prop':
      case 'mainchain_style':
      case 'sidechain_style':
      case 'ligand_style':
      case 'water_style':
        this.redraw_models();
        break;
      case 'label_font':
        this.redraw_labels();
        break;
      case 'map_style':
        this.redraw_maps(true);
        break;
    }
    this.request_render();
  }

  set_selected_option(info: string, key: string, options: string[], value: string) {
    if (options.indexOf(value) === -1) return;
    this.config[key] = value;
    this.apply_selected_option(key);
    this.hud(this.select_menu_html(info, key, options), 'HTML');
  }

  on_hud_click(event: MouseEvent) {
    let el = event.target as HTMLElement | null;
    while (el && el !== this.hud_el) {
      const key = el.getAttribute('data-hud-select-key');
      if (key != null) {
        event.preventDefault();
        event.stopPropagation();
        const value = el.getAttribute('data-hud-select-value') || '';
        const info = el.getAttribute('data-hud-select-info') || key;
        const options = JSON.parse(el.getAttribute('data-hud-select-options') || '[]');
        this.set_selected_option(info, key, options, value);
        return;
      }
      el = el.parentElement;
    }
  }

  update_fps() {
    const now = performance.now();
    if (this.last_frame_time !== 0) {
      this.frame_times.push(now - this.last_frame_time);
      if (this.frame_times.length > 30) this.frame_times.shift();
      let sum = 0;
      for (const dt of this.frame_times) sum += dt;
      if (sum > 0) {
        const fps = 1000 * this.frame_times.length / sum;
        this.fps_text = 'FPS: ' + fps.toFixed(1);
      }
    }
    this.last_frame_time = now;
    if (this.help_el && this.help_el.style.display === 'block') {
      this.update_help();
    }
  }

  select_next(info: string, key: string, options: string[], back: boolean) {
    const old_idx = options.indexOf(this.config[key]);
    const len = options.length;
    const new_idx = (old_idx + (back ? len - 1 : 1)) % len;
    this.set_selected_option(info, key, options, options[new_idx]);
  }

  keydown(evt: KeyboardEvent) {
    if (evt.ctrlKey) {
      if (evt.keyCode === 71) { // Ctrl-G
        evt.preventDefault();
        this.open_cid_dialog();
        return;
      }
      return;
    }
    const action = this.key_bindings[evt.keyCode];
    if (action) {
      (action.bind(this))(evt);
    } else {
      if (action === false) evt.preventDefault();
      if (this.help_el) this.hud('Nothing here. Press H for help.');
    }
    this.request_render();
  }

  set_common_key_bindings() {
    const kb = new Array(256);
    // b
    kb[66] = function (this: Viewer, evt: KeyboardEvent) {
      const schemes = Object.keys(this.ColorSchemes);
      this.select_next('color scheme', 'color_scheme', schemes, evt.shiftKey);
      this.set_colors();
    };
    // c
    kb[67] = function (this: Viewer, evt: KeyboardEvent) {
      this.select_next('coloring by', 'color_prop', COLOR_PROPS, evt.shiftKey);
      this.redraw_models();
    };
    // e
    kb[69] = function (this: Viewer) {
      const fog = this.scene.fog;
      const has_fog = (fog.far === 1);
      fog.far = (has_fog ? 1e9 : 1);
      this.hud((has_fog ? 'dis': 'en') + 'able fog');
      this.redraw_all();
    };
    // h
    kb[72] = this.toggle_help;
    // i
    kb[73] = function (this: Viewer, evt: KeyboardEvent) {
      this.hud('toggled spinning');
      this.controls.toggle_auto(evt.shiftKey);
    };
    // k
    kb[75] = function (this: Viewer) {
      this.hud('toggled rocking');
      this.controls.toggle_auto(0.0);
    };
    // q
    kb[81] = function (this: Viewer, evt: KeyboardEvent) {
      this.select_next('label font', 'label_font', LABEL_FONTS, evt.shiftKey);
      this.redraw_labels();
    };
    // r
    kb[82] = function (this: Viewer, evt: KeyboardEvent) {
      if (evt.shiftKey) {
        this.hud('redraw!');
        this.redraw_all();
      } else {
        this.hud('recentered');
        this.recenter();
      }
    };
    // w
    kb[87] = function (this: Viewer, evt: KeyboardEvent) {
      this.select_next('map style', 'map_style', MAP_STYLES, evt.shiftKey);
      this.redraw_maps(true);
    };
    // add, equals/firefox, equal sign
    kb[107] = kb[61] = kb[187] = function (this: Viewer, evt: KeyboardEvent) {
      this.change_isolevel_by(evt.shiftKey ? 1 : 0, 0.1);
    };
    // subtract, minus/firefox, dash
    kb[109] = kb[173] = kb[189] = function (this: Viewer, evt: KeyboardEvent) {
      this.change_isolevel_by(evt.shiftKey ? 1 : 0, -0.1);
    };
    // [
    kb[219] = function (this: Viewer) { this.change_map_radius(-2); };
    // ]
    kb[221] = function (this: Viewer) { this.change_map_radius(2); };
    // shift, ctrl, alt, altgr
    kb[16] = kb[17] = kb[18] = kb[225] = function () {};
    // slash, single quote
    kb[191] = kb[222] = false;  // -> preventDefault()

    this.key_bindings = kb;
  }

  set_real_space_key_bindings() {
    const kb = this.key_bindings;
    // Home
    kb[36] = function (this: Viewer, evt: KeyboardEvent) {
      if (evt.shiftKey) {
        this.change_map_line(0.1);
      } else {
        this.change_stick_radius(0.01);
      }
    };
    // End
    kb[35] = function (this: Viewer, evt: KeyboardEvent) {
      if (evt.shiftKey) {
        this.change_map_line(-0.1);
      } else {
        this.change_stick_radius(-0.01);
      }
    };
    // Space
    kb[32] = function (this: Viewer, evt: KeyboardEvent) {
      this.center_next_residue(evt.shiftKey);
    };
    // d
    kb[68] = function (this: Viewer) {
      this.change_slab_width_by(-0.1);
    };
    // f
    kb[70] = function (this: Viewer, evt: KeyboardEvent) {
      if (evt.shiftKey) {
        this.toggle_full_screen();
      } else {
        this.change_slab_width_by(0.1);
      }
    };
    // l
    kb[76] = function (this: Viewer, evt: KeyboardEvent) {
      this.select_next('ligands as', 'ligand_style', LIGAND_STYLES, evt.shiftKey);
      this.redraw_models();
    };
    // p
    kb[80] = function (this: Viewer, evt: KeyboardEvent) {
      if (evt.shiftKey) {
        this.permalink();
      } else {
        this.go_to_nearest_Ca();
      }
    };
    // m
    kb[77] = function (this: Viewer, evt: KeyboardEvent) {
      this.select_next('mainchain as', 'mainchain_style', MAINCHAIN_STYLES, evt.shiftKey);
      this.redraw_models();
    };
    // s
    kb[83] = function (this: Viewer, evt: KeyboardEvent) {
      this.select_next('sidechains as', 'sidechain_style', SIDECHAIN_STYLES, evt.shiftKey);
      this.redraw_models();
    };
    // t
    kb[84] = function (this: Viewer, evt: KeyboardEvent) {
      this.select_next('waters as', 'water_style', WATER_STYLES, evt.shiftKey);
      this.redraw_models();
    };
    // g
    kb[71] = function (this: Viewer) {
      this.toggle_histogram();
    };
    // u
    kb[85] = function (this: Viewer) {
      this.hud('toggled unit cell box');
      this.toggle_cell_box();
    };
    // v
    kb[86] = function (this: Viewer) {
      this.toggle_inactive_models();
    };
    // y
    kb[89] = function (this: Viewer) {
      this.config.hydrogens = !this.config.hydrogens;
      const n_h = this.current_model_hydrogen_count();
      this.hud((this.config.hydrogens ? 'show' : 'hide') +
               ' hydrogens (' + n_h + ' H/D atom' + (n_h === 1 ? '' : 's') +
               ' in model)');
      this.redraw_models();
    };
    // backslash
    kb[220] = function (this: Viewer) {
      this.toggle_symmetry();
    };
    // comma
    kb[188] = function (this: Viewer, evt: KeyboardEvent) {
      if (evt.shiftKey) this.shift_clip(1);
    };
    // period
    kb[190] = function (this: Viewer, evt: KeyboardEvent) {
      if (evt.shiftKey) this.shift_clip(-1);
    };
  }

  mousedown(event: MouseEvent) {
    //event.preventDefault(); // default involves setting focus, which we need
    event.stopPropagation();
    document.addEventListener('mouseup', this.mouseup);
    document.addEventListener('mousemove', this.mousemove);
    let state = STATE.NONE;
    if (event.button === 1 || (event.button === 0 && event.ctrlKey)) {
      state = STATE.PAN;
    } else if (event.button === 0) {
      // in Coot shift+Left is labeling atoms like dblclick, + rotation
      if (event.shiftKey) {
        this.dblclick(event);
      }
      state = STATE.ROTATE;
    } else if (event.button === 2) {
      if (event.ctrlKey) {
        state = event.shiftKey ? STATE.ROLL : STATE.SLAB;
      } else {
        this.decor.zoom_grid.visible = true;
        state = STATE.ZOOM;
      }
    }
    this.controls.start(state, this.relX(event), this.relY(event));
    this.request_render();
  }

  dblclick(event: MouseEvent) {
    if (event.button !== 0) return;
    if (this.decor.selection) {
      this.remove_and_dispose(this.decor.selection);
      this.decor.selection = null;
    }
    const mouse: Num2 = [this.relX(event), this.relY(event)];
    const pick = this.pick_atom(mouse, this.camera);
    if (pick) {
      const atom = pick.atom;
      this.hud(pick.bag.label + ' ' + atom.long_label(pick.bag.symop));
      this.dbl_click_callback(pick);
      const color = this.config.colors[atom.element] || this.config.colors.def;
      const size = 2.5 * scale_by_height(this.config.bond_line,
                                         this.window_size);
      this.decor.selection = makeWheels([atom], [color], size);
      this.scene.add(this.decor.selection);
    } else {
      this.hud();
    }
    this.request_render();
  }

  touchstart(event: TouchEvent) {
    const touches = event.touches;
    if (touches.length === 1) {
      this.controls.start(STATE.ROTATE,
                          this.relX(touches[0]), this.relY(touches[0]));
    } else { // for now using only two touches
      const info = touch_info(event);
      this.controls.start(STATE.PAN_ZOOM,
                          this.relX(info), this.relY(info), info.dist);
    }
    this.request_render();
  }

  current_model_hydrogen_count() {
    const bag = this.active_model_bag();
    return bag ? bag.model.hydrogen_count : 0;
  }

  touchmove(event: TouchEvent) {
    event.preventDefault();
    event.stopPropagation();
    const touches = event.touches;
    if (touches.length === 1) {
      this.controls.move(this.relX(touches[0]), this.relY(touches[0]));
    } else { // for now using only two touches
      const info = touch_info(event);
      this.controls.move(this.relX(info), this.relY(info), info.dist);
    }
  }

  touchend(/*event*/) {
    this.controls.stop();
    this.redraw_maps();
  }

  wheel(evt: WheelEvent) {
    evt.preventDefault();
    evt.stopPropagation();
    this.mousewheel_action(evt.deltaY, evt);
    this.request_render();
  }

  // overrided in ReciprocalViewer
  mousewheel_action(delta: number, evt: WheelEvent) {
    const map_idx = evt.shiftKey ? 1 : 0;
    this.change_isolevel_by(map_idx, 0.0005 * delta);
  }

  resize(/*evt*/) {
    const el = this.container;
    if (el == null) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    this.window_offset[0] = el.offsetLeft;
    this.window_offset[1] = el.offsetTop;
    this.camera.left = -width;
    this.camera.right = width;
    this.camera.top = height;
    this.camera.bottom = -height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (width !== this.window_size[0] || height !== this.window_size[1]) {
      this.window_size[0] = width;
      this.window_size[1] = height;
      this.redraw_models(); // b/c bond_line is scaled by height
    }
    this.request_render();
  }

  // If xyz set recenter on it looking toward the model center.
  // Otherwise recenter on the model center looking along the z axis.
  recenter(xyz?: Num3, cam?: Num3, steps?: number) {
    const bag = this.selected.bag;
    const new_up = new Vector3(0, 1, 0);
    let vec_cam;
    let vec_xyz;
    let eye;
    if (xyz != null && cam == null && bag != null) {
      // look from specified point toward the center of the molecule,
      // i.e. shift camera away from the molecule center.
      const mc = bag.model.get_center();
      eye = new Vector3(xyz[0] - mc[0], xyz[1] - mc[1], xyz[2] - mc[2]);
      eye.setLength(100);
      vec_xyz = new Vector3(xyz[0], xyz[1], xyz[2]);
      vec_cam = eye.clone().add(vec_xyz);
    } else {
      if (xyz == null) {
        if (bag != null) {
          xyz = bag.model.get_center();
        } else {
          const uc_func = this.get_cell_box_func();
          xyz = uc_func ? uc_func([0.5, 0.5, 0.5]) : [0, 0, 0];
        }
      }
      vec_xyz = new Vector3(xyz[0], xyz[1], xyz[2]);
      if (cam != null) {
        vec_cam = new Vector3(cam[0], cam[1], cam[2]);
        eye = vec_cam.clone().sub(vec_xyz);
        new_up.copy(this.camera.up); // preserve the up direction
      } else {
        const dc = this.default_camera_pos;
        vec_cam = new Vector3(xyz[0] + dc[0], xyz[1] + dc[1], xyz[2] + dc[2]);
      }
    }
    if (eye != null) {
      new_up.projectOnPlane(eye);
      if (new_up.lengthSq() < 0.0001) new_up.x += 1;
      new_up.normalize();
    }
    this.controls.go_to(vec_xyz, vec_cam, new_up, steps);
  }

  center_next_residue(back: boolean) {
    const bag = this.selected.bag;
    if (bag == null) return;
    const atom = bag.model.next_residue(this.selected.atom, back);
    if (atom != null) {
      this.select_atom({bag, atom}, {steps: 30});
    }
  }

  select_atom(pick: {bag: ModelBag, atom: Atom}, options: {steps?: number}={}) {
    this.hud('-> ' + pick.bag.label + ' ' + pick.atom.long_label(pick.bag.symop));
    const xyz = pick.atom.xyz;
    this.controls.go_to(new Vector3(xyz[0], xyz[1], xyz[2]),
                        null, null, options.steps);
    this.toggle_label(this.selected, false);
    this.selected = pick;
    this.update_nav_menus();
    this.toggle_label(this.selected, true);
    this.request_render();
  }

  select_residue(bag: ModelBag, atom: Atom, options: {steps?: number}={}) {
    const residue = bag.model.get_residues()[atom.resid()];
    if (residue == null || residue.length === 0) {
      this.select_atom({bag, atom}, options);
      return;
    }
    let x = 0, y = 0, z = 0;
    for (const res_atom of residue) {
      x += res_atom.xyz[0];
      y += res_atom.xyz[1];
      z += res_atom.xyz[2];
    }
    const anchor = residue.find((res_atom) => res_atom.is_main_conformer()) || residue[0];
    this.hud('-> ' + bag.label + ' /' + atom.seqid + ' ' + atom.resname + '/' + atom.chain);
    this.toggle_label(this.selected, false);
    this.selected = {bag, atom: anchor};
    this.update_nav_menus();
    this.toggle_label(this.selected, true);
    this.controls.go_to(new Vector3(x / residue.length, y / residue.length, z / residue.length),
                        null, null, options.steps);
    this.request_render();
  }

  selection_atom_indices(cid: string, model_bag?: ModelBag | null) {
    const bag = this.active_model_bag(model_bag);
    if (bag == null) throw Error('No model is loaded.');
    if (bag.gemmi_selection == null) {
      throw Error('Gemmi selection is unavailable for this model.');
    }
    const ctx = bag.gemmi_selection;
    const result = new ctx.gemmi.SelectionResult();
    try {
      result.set_atom_indices(ctx.structure, cid, ctx.model_index);
      const ptr = result.atom_data_ptr();
      const len = result.atom_data_size();
      return new Int32Array(ctx.gemmi.HEAPU8.buffer, ptr, len).slice();
    } finally {
      result.delete();
    }
  }

  selection_atoms(cid: string, model_bag?: ModelBag | null) {
    const bag = this.active_model_bag(model_bag);
    if (bag == null) throw Error('No model is loaded.');
    const indices = this.selection_atom_indices(cid, bag);
    const atoms = [];
    for (let i = 0; i < indices.length; ++i) {
      const idx = indices[i];
      if (idx >= 0 && idx < bag.model.atoms.length) atoms.push(bag.model.atoms[idx]);
    }
    return { bag: bag, atoms: atoms, indices: indices };
  }

  selection_anchor(bag: ModelBag, atoms: Atom[]) {
    for (const atom of atoms) {
      if (atom.is_main_conformer() &&
          ((atom.name === 'CA' && atom.element === 'C') || atom.name === 'P')) {
        return atom;
      }
    }
    let x = 0, y = 0, z = 0;
    for (const atom of atoms) {
      x += atom.xyz[0];
      y += atom.xyz[1];
      z += atom.xyz[2];
    }
    const n = atoms.length;
    let anchor = bag.model.get_nearest_atom(x / n, y / n, z / n, 'CA');
    if (anchor == null) {
      anchor = bag.model.get_nearest_atom(x / n, y / n, z / n, 'P');
    }
    if (anchor != null && anchor.is_main_conformer()) {
      return anchor;
    }
    for (const atom of atoms) {
      if (atom.is_main_conformer()) return atom;
    }
    return atoms[0];
  }

  center_on_selection(cid: string, options: {bag?: ModelBag | null, steps?: number}={}) {
    const sel = this.selection_atoms(cid, options.bag);
    if (sel.atoms.length === 0) {
      this.hud('No atoms match selection: ' + cid);
      return;
    }
    let x = 0, y = 0, z = 0;
    for (const atom of sel.atoms) {
      x += atom.xyz[0];
      y += atom.xyz[1];
      z += atom.xyz[2];
    }
    const n = sel.atoms.length;
    this.hud('selection ' + cid + ': ' + n + ' atoms');
    this.toggle_label(this.selected, false);
    this.selected = {bag: sel.bag, atom: this.selection_anchor(sel.bag, sel.atoms)};
    this.update_nav_menus();
    this.controls.go_to(new Vector3(x / n, y / n, z / n),
                        null, null, options.steps);
    this.request_render();
  }

  select_by_cid(cid: string, options: {bag?: ModelBag | null, steps?: number}={}) {
    const sel = this.selection_atoms(cid, options.bag);
    if (sel.atoms.length === 0) {
      this.hud('No atoms match selection: ' + cid);
      return;
    }
    this.select_atom({bag: sel.bag, atom: sel.atoms[0]}, {steps: options.steps});
    this.request_render();
  }

  update_camera() {
    const dxyz = this.camera.position.distanceTo(this.target);
    const w = this.controls.slab_width;
    const scale = w[2] || this.camera.zoom;
    this.camera.near = dxyz * (1 - w[0] / scale);
    this.camera.far = dxyz * (1 + w[1] / scale);
    this.camera.updateProjectionMatrix();
  }

  // The main loop. Running when a mouse button is pressed or when the view
  // is moving (and run once more after the mouse button is released).
  // It is also triggered by keydown events.
  render() {
    this.scheduled = true;
    if (this.renderer === null) return;
    this.update_fps();
    if (this.controls.update()) {
      this.update_camera();
    }
    const tied = this.tied_viewer;
    if (!this.controls.is_moving()) {
      this.redraw_maps();
      if (tied && !tied.scheduled) tied.redraw_maps();
    }
    if (this.speckAO) {
      if (this.controls.is_moving()) {
        this.speckAO.reset();
        this.renderer.render(this.scene, this.camera);
      } else {
        this.speckAO.render();
        const pct = Math.min(100, Math.round(100 * this.speckAO.sampleCount /
                                              this.speckAO.maxSamples));
        if (pct < 100) {
          this.hud('calculating AO: ' + pct + '%');
        }
      }
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    if (tied && !tied.scheduled) tied.renderer.render(tied.scene, tied.camera);
    //if (this.nav) {
    //  this.nav.renderer.render(this.nav.scene, this.camera);
    //}
    this.scheduled = false;
    if (this.controls.is_moving()) {
      this.request_render();
    } else if (this.speckAO && !this.speckAO.isDone()) {
      // Throttle AO accumulation to keep UI responsive
      setTimeout(() => this.request_render(), 50);
    }
  }

  request_render() {
    if (typeof window !== 'undefined' && !this.scheduled) {
      this.scheduled = true;
      window.requestAnimationFrame(this.render.bind(this));
    }
  }

  auto_adjust_map_radius() {
    if (!this.map_radius_auto || this.map_bags.length === 0) return;
    const model_bag = this.model_bags.find((bag) =>
      bag.symop === '' &&
      bag.model.unit_cell != null &&
      !bag.model.unit_cell.is_crystal());
    if (model_bag == null) return;
    const center = model_bag.model.get_center();
    const required_radius = Math.max(
      center[0] - model_bag.model.lower_bound[0],
      model_bag.model.upper_bound[0] - center[0],
      center[1] - model_bag.model.lower_bound[1],
      model_bag.model.upper_bound[1] - center[1],
      center[2] - model_bag.model.lower_bound[2],
      model_bag.model.upper_bound[2] - center[2]
    ) + 2;
    let cell_limit = Infinity;
    for (const map_bag of this.map_bags) {
      const uc = map_bag.map.unit_cell;
      if (uc == null) continue;
      const half_edge = 0.5 * Math.min(uc.a, uc.b, uc.c);
      if (Number.isFinite(half_edge) && half_edge > 0) {
        cell_limit = Math.min(cell_limit, half_edge);
      }
    }
    const radius = Math.min(required_radius, cell_limit);
    if (!Number.isFinite(radius) || radius <= this.config.map_radius + 1e-6) return;
    const rounded_radius = Math.round(radius * 10) / 10;
    const suggested_max = Math.max(rounded_radius + 20, rounded_radius * 1.25);
    const rounded_max = Math.round(Math.min(cell_limit, suggested_max) * 10) / 10;
    this.config.map_radius = rounded_radius;
    this.config.max_map_radius = Math.max(this.config.max_map_radius, rounded_max);
    this.redraw_maps(true);
  }

  add_model(model: Model, options: {hue_shift?: number, gemmi_selection?: GemmiSelectionContext}={}) {
    const model_bag = new ModelBag(model, this.config, this.window_size);
    model_bag.hue_shift = options.hue_shift || 0.06 * this.model_bags.length;
    model_bag.gemmi_selection = options.gemmi_selection || null;
    this.model_bags.push(model_bag);
    this.auto_adjust_map_radius();
    this.set_model_objects(model_bag);
    this.update_nav_menus();
    this.request_render();
  }

  add_map(map: ElMap, is_diff_map: boolean) {
    const map_bag = new MapBag(map, this.config, is_diff_map);
    this.map_bags.push(map_bag);
    this.add_el_objects(map_bag);
    this.auto_adjust_map_radius();
    this.update_nav_menus();
    this.request_render();
  }

  load_file(url: string, options: Record<string, any>,
            callback: (arg: XMLHttpRequest) => void,
            error_callback?: (req: XMLHttpRequest, err?: Error) => void ) {
    if (this.renderer === null) return;  // no WebGL detected
    const req = new XMLHttpRequest();
    req.open('GET', url, true);
    if (options.binary) {
      req.responseType = 'arraybuffer';
    } else {
      // http://stackoverflow.com/questions/7374911/
      req.overrideMimeType('text/plain');
    }
    const self = this;
    Object.keys(this.xhr_headers).forEach(function (name) {
      req.setRequestHeader(name, self.xhr_headers[name]);
    });
    req.onreadystatechange = function () {
      if (req.readyState === 4) {
        // chrome --allow-file-access-from-files gives status 0
        if (req.status === 200 || (req.status === 0 && req.response !== null &&
                                                       req.response !== '')) {
          try {
            callback(req);
          } catch (e) {
            if (error_callback) error_callback(req, e);
            else self.hud('Error: ' + e.message + '\nwhen processing ' + url, 'ERR');
          }
        } else {
          if (error_callback) error_callback(req);
          else self.hud('Failed to fetch ' + url, 'ERR');
        }
      }
    };
    if (options.progress) {
      req.addEventListener('progress', function (evt: ProgressEvent) {
        if (evt.lengthComputable && evt.loaded && evt.total) {
          const fn = url.split('/').pop();
          self.hud('loading ' + fn + ' ... ' + ((evt.loaded / 1024) | 0) +
                   ' / ' + ((evt.total / 1024) | 0) + ' kB');
          if (evt.loaded === evt.total) self.hud(); // clear progress message
        }
      });
    }
    try {
      req.send(null);
    } catch (e) {
      if (error_callback) error_callback(req, e);
      else self.hud('loading ' + url + ' failed:\n' + e, 'ERR');
    }
  }

  set_dropzone(zone: HTMLElement, callback: (arg: File) => void | Promise<void>) {
    const self = this;
    zone.addEventListener('dragstart', function (e: DragEvent) {
      e.preventDefault();
    });
    zone.addEventListener('dragover', function (e: DragEvent) {
      e.stopPropagation();
      e.preventDefault();
      if (e.dataTransfer != null) e.dataTransfer.dropEffect = 'copy';
      self.hud('ready for file drop...');
    });
    zone.addEventListener('drop', function (e: DragEvent) {
      e.stopPropagation();
      e.preventDefault();
      if (e.dataTransfer == null) return;
      const files = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files.item(i);
        if (file != null) files.push(file);
      }
      files.sort((a, b) => a.name.localeCompare(b.name, undefined,
                                                {numeric: true, sensitivity: 'base'}));
      const names = [];
      Promise.resolve().then(async function () {
        for (const file of files) {
          self.hud('Loading ' + file.name);
          await callback(file);
          names.push(file.name);
        }
        self.hud(self.drop_complete_message(names));
      }).catch(function (err) {
        const msg = err instanceof Error ? err.message : String(err);
        self.hud('Loading failed.\n' + msg, 'ERR');
      });
    });
  }

  // for use with set_dropzone
  pick_pdb_and_map(file: File) {
    const self = this;
    const reader = new FileReader();
    if (/\.(pdb|ent|cif|mmcif|mcif|mmjson)$/i.test(file.name)) {
      return new Promise<void>(function (resolve, reject) {
        reader.onloadend = function (evt) {
          if (evt.target == null || evt.target.readyState != 2) return;
          const buffer = evt.target.result as ArrayBuffer;
          if (/\.(cif|mmcif|mcif)$/i.test(file.name)) {
            const text = new TextDecoder().decode(new Uint8Array(buffer));
            if (is_standalone_monomer_cif(text)) {
              const names = self.cache_monomer_cif_text(text);
              self.refresh_bonding_for_cached_monomers(names).then(function (refreshed) {
                let msg = 'Loaded monomer dictionary ' + names.join(', ') + '.';
                if (refreshed !== 0) msg += ' Updated bonding in ' + refreshed + ' loaded structure';
                if (refreshed > 1) msg += 's';
                self.hud(msg);
                resolve();
              }, reject);
              return;
            }
          }
          self.load_coordinate_buffer(buffer, file.name).then(function () {
            self.recenter();
            resolve();
          }, reject);
        };
        reader.onerror = () => reject(reader.error || Error('Failed to read ' + file.name));
        reader.readAsArrayBuffer(file);
      });
    } else if (/\.(map|ccp4|mrc|dsn6|omap)$/.test(file.name)) {
      const map_format = /\.(dsn6|omap)$/.test(file.name) ? 'dsn6' : 'ccp4';
      return new Promise<void>(function (resolve, reject) {
        reader.onloadend = function (evt) {
          if (evt.target == null || evt.target.readyState != 2) return;
          const after_load = (map_format === 'ccp4') ?
            self.resolve_gemmi().then(function (gemmi) {
              if (gemmi == null) throw Error('Gemmi is required for CCP4 map loading.');
              self.load_map_from_buffer(evt.target.result as ArrayBuffer,
                                        {format: map_format}, gemmi);
            }) :
            Promise.resolve().then(function () {
              self.load_map_from_buffer(evt.target.result as ArrayBuffer,
                                        {format: map_format});
            });
          after_load.then(function () {
            if (self.model_bags.length === 0 && self.map_bags.length === 1) {
              self.recenter();
            }
            resolve();
          }, reject);
        };
        reader.onerror = () => reject(reader.error || Error('Failed to read ' + file.name));
        reader.readAsArrayBuffer(file);
      });
    } else {
      throw Error('Unknown file extension. ' +
                  'Use: pdb, ent, cif, mmcif, mcif, mmjson, ccp4, mrc, map, dsn6 or omap.');
    }
  }

  set_view(options?: Record<string, any>) {
    const frag = parse_url_fragment();
    if (frag.zoom) this.camera.zoom = frag.zoom;
    this.recenter(frag.xyz || (options && options.center), frag.eye, 1);
  }

  cache_monomer_cif_text(text: string) {
    const names = monomer_cif_names(text);
    for (const name of names) {
      this.monomer_cif_cache[name] = Promise.resolve(text);
    }
    return names;
  }

  refresh_bonding_for_cached_monomers(names: string[]) {
    if (names.length === 0) return Promise.resolve(0);
    const wanted = new Set(names.map((name) => name.toUpperCase()));
    const groups = new Map<Structure, {gemmi: GemmiModule, bags: ModelBag[]}>();
    for (const bag of this.model_bags) {
      const ctx = bag.gemmi_selection;
      if (bag.symop !== '' || ctx == null) continue;
      const group = groups.get(ctx.structure);
      if (group) group.bags.push(bag);
      else groups.set(ctx.structure, {gemmi: ctx.gemmi, bags: [bag]});
    }
    const refresh_groups = Array.from(groups.values()).filter((group) => {
      const missing = group.gemmi.get_missing_monomer_names(group.bags[0].gemmi_selection!.structure)
        .split(',').filter(Boolean);
      return missing.some((name) => wanted.has(name.toUpperCase()));
    });
    if (refresh_groups.length === 0) return Promise.resolve(0);

    const selected = this.selected.atom ? {
      bag: this.selected.bag,
      i_seq: this.selected.atom.i_seq,
    } : null;
    this.toggle_label(this.selected, false);

    const self = this;
    return Promise.all(refresh_groups.map(function (group) {
      const ctx = group.bags[0].gemmi_selection!;
      return bondDataFromGemmiStructure(group.gemmi, ctx.structure,
                                        self.fetch_monomer_cifs.bind(self))
        .then(function (result) {
          for (const bag of group.bags) {
            self.clear_labels_for_bag(bag);
            const model = modelFromGemmiStructure(ctx.gemmi, ctx.structure,
                                                  result.bond_data, ctx.model_index);
            if (result.bond_data != null) model.bond_data = result.bond_data;
            bag.model = model;
            self.redraw_model(bag);
            if (selected != null && selected.bag === bag) {
              const selected_atom = bag.model.atoms[selected.i_seq] || null;
              self.selected = {bag: bag, atom: selected_atom};
            }
          }
          return result;
        });
    })).then(function (results) {
      if (results.length !== 0) {
        self.last_bonding_info = results[results.length - 1].bonding;
      }
      self.update_nav_menus();
      self.toggle_label(self.selected, true);
      self.request_render();
      return results.length;
    });
  }

  fetch_monomer_cif(resname: string) {
    const name = resname.toUpperCase();
    if (!(name in this.monomer_cif_cache)) {
      const template = aminoAcidTemplate(name) || nucleotideTemplate(name);
      if (template != null) {
        this.monomer_cif_cache[name] = Promise.resolve(template.cif);
      } else {
        this.monomer_cif_cache[name] = fetch(
          'https://files.rcsb.org/ligands/view/' + encodeURIComponent(name) + '.cif'
        ).then(function (resp) {
          return resp.ok ? resp.text() : null;
        }).catch(function () {
          return null;
        });
      }
    }
    return this.monomer_cif_cache[name];
  }

  fetch_monomer_cifs(resnames: string[]) {
    const unique = Array.from(new Set(resnames.filter(Boolean))).sort();
    return Promise.all(unique.map(this.fetch_monomer_cif, this)).then(function (cif_texts) {
      return cif_texts.filter(function (v): v is string { return v != null; });
    });
  }

  resolve_gemmi(explicit_module?: GemmiModule) {
    if (explicit_module) {
      return Promise.resolve(explicit_module);
    }
    if (this.gemmi_module) {
      return Promise.resolve(this.gemmi_module);
    }
    if (this.gemmi_factory == null) return Promise.resolve(null);
    if (this.gemmi_loading == null) {
      const self = this;
      this.gemmi_loading = this.gemmi_factory().then(function (gemmi) {
        self.gemmi_module = gemmi;
        return gemmi;
      }, function (err) {
        self.gemmi_loading = null;
        throw err;
      });
    }
    return this.gemmi_loading;
  }

  load_coordinate_buffer(buffer: ArrayBuffer, name: string, explicit_gemmi?: GemmiModule) {
    const self = this;
    return this.resolve_gemmi(explicit_gemmi).then(function (gemmi) {
      if (!gemmi) throw Error('Gemmi is required for coordinate loading.');
      return self.load_structure_from_buffer(gemmi, buffer, name);
    });
  }

  // Load molecular model from PDB file and centers the view
  load_pdb_from_text(text: string, name: string='model.pdb', explicit_gemmi?: GemmiModule) {
    const self = this;
    return this.resolve_gemmi(explicit_gemmi).then(function (gemmi) {
      if (!gemmi) throw Error('Gemmi is required for coordinate loading.');
      const buffer = new TextEncoder().encode(text).buffer;
      return self.load_structure_from_buffer(gemmi, buffer, name);
    });
  }

  load_structure_from_buffer(gemmi, buffer: ArrayBuffer, name: string) {
    const len = this.model_bags.length;
    const self = this;
    return modelsFromGemmi(gemmi, buffer, name,
                           this.fetch_monomer_cifs.bind(this)).then(function (result) {
      for (const model of result.models) {
        self.add_model(model, {
          gemmi_selection: {
            gemmi: gemmi,
            structure: result.structure,
            model_index: model.source_model_index == null ? 0 : model.source_model_index,
          },
        });
      }
      self.selected = {bag: self.model_bags[len] || null, atom: null};
      self.set_structure_name(result.structure.name);
      self.update_nav_menus();
      self.last_bonding_info = result.bonding;
    });
  }

  load_pdb(url: string | string[], options?: Record<string, any>,
           callback?: () => void) {
    if (Array.isArray(url)) {
      this.load_pdb_candidates(url, options, callback);
      return;
    }
    const self = this;
    const gemmi = options && options.gemmi;
    this.load_file(url, {binary: true, progress: true}, function (req) {
      const t0 = performance.now();
      self.load_coordinate_buffer(req.response, url, gemmi).then(function () {
        console.log('coordinate file processed in', (performance.now() - t0).toFixed(2),
                    (gemmi || self.gemmi_module) ? 'ms (using gemmi)': 'ms');
        if (options == null || !options.stay) self.set_view(options);
        if (callback) callback();
      }, function (e) {
        self.hud('Error: ' + e.message + '\nwhen processing ' + url, 'ERR');
      });
    });
  }

  private load_pdb_candidates(urls: string[], options?: Record<string, any>,
                              callback?: () => void) {
    const self = this;
    const gemmi = options && options.gemmi;
    const failed: string[] = [];

    function try_next(index: number) {
      if (index >= urls.length) {
        self.hud('Failed to fetch ' + failed.join(' or '), 'ERR');
        return;
      }
      const url = urls[index];
      self.load_file(url, {binary: true, progress: true}, function (req) {
        const t0 = performance.now();
        self.load_coordinate_buffer(req.response, url, gemmi).then(function () {
          console.log('coordinate file processed in', (performance.now() - t0).toFixed(2),
                      (gemmi || self.gemmi_module) ? 'ms (using gemmi)' : 'ms');
          if (options == null || !options.stay) self.set_view(options);
          if (callback) callback();
        }, function () {
          failed.push(url);
          try_next(index + 1);
        });
      }, function () {
        failed.push(url);
        try_next(index + 1);
      });
    }

    try_next(0);
  }

  load_map(url: string | null, options: Record<string, any>,
           callback?: () => void) {
    if (url == null) {
      if (callback) callback();
      return;
    }
    if (options.format !== 'ccp4' && options.format !== 'dsn6') {
      throw Error('Unknown map format.');
    }
    const self = this;
    this.load_file(url, {binary: true, progress: true}, function (req) {
      const after_load = (options.format === 'ccp4') ?
        self.resolve_gemmi().then(function (gemmi) {
          if (gemmi == null) throw Error('Gemmi is required for CCP4 map loading.');
          self.load_map_from_buffer(req.response, options, gemmi);
        }) :
        Promise.resolve().then(function () {
          self.load_map_from_buffer(req.response, options);
        });
      after_load.then(function () {
        if (callback) callback();
      }, function (e) {
        self.hud('Error: ' + e.message + '\nwhen processing ' + url, 'ERR');
      });
    });
  }

  load_map_from_buffer(buffer: ArrayBuffer, options: Record<string, any>, gemmi?: any) {
    const map = new ElMap();
    if (options.format === 'dsn6') {
      map.from_dsn6(buffer, gemmi);
    } else {
      map.from_ccp4(buffer, true, gemmi);
    }
    this.add_map(map, options.diff_map);
  }

  // Load a normal map and a difference map.
  // To show the first map ASAP we do not download both maps in parallel.
  load_maps(url1: string, url2: string,
            options: Record<string, any>, callback?: () => void) {
    const format = options.format || 'ccp4';
    const self = this;
    this.load_map(url1, {diff_map: false, format: format}, function () {
      self.load_map(url2, {diff_map: true, format: format}, callback);
    });
  }

  // Load a model (PDB), normal map and a difference map - in this order.
  load_pdb_and_maps(pdb: string | string[], map1: string, map2: string,
                    options: Record<string, any>, callback?: () => void) {
    const self = this;
    this.load_pdb(pdb, options, function () {
      self.load_maps(map1, map2, options, callback);
    });
  }

  // for backward compatibility:
  load_ccp4_maps(url1: string, url2: string, callback?: () => void) {
    this.load_maps(url1, url2, {format: 'ccp4'}, callback);
  }
  load_pdb_and_ccp4_maps(pdb: string | string[], map1: string, map2: string,
                         callback?: () => void) {
    this.load_pdb_and_maps(pdb, map1, map2, {format: 'ccp4'}, callback);
  }

  // pdb_id here should be lowercase ('1abc')
  load_from_pdbe(pdb_id: string, callback?: () => void) {
    const id = pdb_id.toLowerCase();
    this.load_pdb_and_maps(
      [
        'https://www.ebi.ac.uk/pdbe/entry-files/pdb' + id + '.ent',
        'https://www.ebi.ac.uk/pdbe/entry-files/download/' + id + '_updated.cif',
      ],
      'https://www.ebi.ac.uk/pdbe/coordinates/files/' + id + '.ccp4',
      'https://www.ebi.ac.uk/pdbe/coordinates/files/' + id + '_diff.ccp4',
      {format: 'ccp4'}, callback);
  }
  load_from_rcsb(pdb_id: string, callback?: () => void) {
    const id = pdb_id.toLowerCase();
    this.load_pdb_and_maps(
      'https://files.rcsb.org/download/' + id + '.pdb',
      'https://edmaps.rcsb.org/maps/' + id + '_2fofc.dsn6',
      'https://edmaps.rcsb.org/maps/' + id + '_fofc.dsn6',
      {format: 'dsn6'}, callback);
  }

  // TODO: navigation window like in gimp and mifit
  /*
  show_nav(inset_id) {
    var inset = document.getElementById(inset_id);
    if (!inset) return;
    inset.style.display = 'block';
    var nav = {};
    nav.renderer = new WebGLRenderer();
    nav.renderer.setClearColor(0x555555, 1);
    nav.renderer.setSize(200, 200);
    inset.appendChild(nav.renderer.domElement);
    //nav.scene = new Scene();
    nav.scene = this.scene;
    //nav.scene.add(new AmbientLight(0xffffff));
    this.nav = nav;
  };
  */
}

Viewer.prototype.MOUSE_HELP = [
  '<b>mouse:</b>',
  'Left = rotate',
  'Middle or Ctrl+Left = pan',
  'Right = zoom',
  'Ctrl+Right = clipping',
  'Ctrl+Shift+Right = roll',
  'Wheel = σ level',
  'Shift+Wheel = diff map σ',
].join('\n');

Viewer.prototype.KEYBOARD_HELP = [
  '<b>keyboard:</b>',
  help_action_link('M = mainchain style', {keyCode: 77}),
  help_action_link('S = sidechain style', {keyCode: 83}),
  help_action_link('L = ligand style', {keyCode: 76}),
  help_action_link('T = water style', {keyCode: 84}),
  help_action_link('C = coloring', {keyCode: 67}),
  help_action_link('B = bg color', {keyCode: 66}),
  help_action_link('E = toggle fog', {keyCode: 69}),
  help_action_link('Q = label font', {keyCode: 81}),
  help_action_link('+ = sigma level up', {keyCode: 187}),
  help_action_link('- = sigma level down', {keyCode: 189}),
  help_action_link('] = larger map radius', {keyCode: 221}),
  help_action_link('[ = smaller map radius', {keyCode: 219}),
  help_action_link('D = narrower clip', {keyCode: 68}),
  help_action_link('F = wider clip', {keyCode: 70}),
  help_action_link('Shift+, = move clip', {keyCode: 188, shiftKey: true}),
  help_action_link('Shift+. = move clip', {keyCode: 190, shiftKey: true}),
  help_action_link('U = unitcell box', {keyCode: 85}),
  help_action_link('\\ = toggle symmetry', {keyCode: 220}),
  help_action_link('Y = hydrogens', {keyCode: 89}),
  help_action_link('V = inactive models', {keyCode: 86}),
  help_action_link('R = center view', {keyCode: 82}),
  help_action_link('G = density histogram', {keyCode: 71}),
  help_action_link('W = density style', {keyCode: 87}),
  help_action_link('I = spin', {keyCode: 73}),
  help_action_link('K = rock', {keyCode: 75}),
  help_action_link('Home = wider sticks', {keyCode: 36}),
  help_action_link('End = thinner sticks', {keyCode: 35}),
  help_action_link('P = nearest Cα', {keyCode: 80}),
  help_action_link('Ctrl+G = go to CID', {keyCode: 71, ctrlKey: true}),
  'Delete menu = selected atom/residue/chain',
  help_action_link('Shift+P = permalink', {keyCode: 80, shiftKey: true}),
  help_action_link('Space = next residue', {keyCode: 32}),
  help_action_link('Shift+Space = previous residue', {keyCode: 32, shiftKey: true}),
  help_action_link('Shift+F = full screen', {keyCode: 70, shiftKey: true}),
].join('\n');

Viewer.prototype.ABOUT_HELP =
  '&nbsp; <a href="https://gemmimol.github.io">GemmiMol</a> ' +
  // @ts-expect-error Cannot find name 'VERSION'
  (typeof VERSION === 'string' ? VERSION : 'dev') +
  // @ts-expect-error Cannot find name 'GIT_DESCRIBE'
  (typeof GIT_DESCRIBE === 'string' ? ' (' + GIT_DESCRIBE + ')' : '') +
  '<br>&nbsp; Gemmi ' +
  // @ts-expect-error Cannot find name 'GEMMI_GIT_DESCRIBE'
  (typeof GEMMI_GIT_DESCRIBE === 'string' ? GEMMI_GIT_DESCRIBE : 'unknown');

Viewer.prototype.ColorSchemes = ColorSchemes;
