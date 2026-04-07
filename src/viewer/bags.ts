import { Vector3, Color, Object3D } from '../three-r162/main';
import type { ElMap } from '../elmap';
import type { Atom, Model } from '../model';
import type { ViewerConfig, Num3, GemmiSelectionContext } from './types';
import { makeLineMaterial, makeLineSegments, makeRibbon, makeCartoon,
         makeSticks, makeBalls, makeWheels, addXyzCross } from '../draw';
import { color_by, scale_by_height } from './utils';

export class MapBag {
  map: ElMap;
  name: string;
  isolevel: number;
  visible: boolean;
  is_diff_map: boolean;
  types: string[];
  block_ctr: Vector3;
  el_objects: Object3D[];

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

export class ModelBag {
  model: Model;
  label: string;
  visible: boolean;
  hue_shift: number;
  color_override: ((atom: Atom) => Color) | null;
  conf: ViewerConfig;
  win_size: Num2;
  objects: Object3D[];
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
          if (bond_type === 6) { // BondType.Metal
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
        if (bond_type === 6) { // BondType.Metal
          const mid = this.bond_half_end(atom, other, radius * 0.5);
          metal_vertex_arr.push(atom.xyz, mid);
          metal_color_arr.push(color, color);
          metal_bond_type_arr.push(bond_type, bond_type);
        } else if (bond_type === 2) { // BondType.Double
          this.add_offset_stick(vertex_arr, color_arr, bond_type_arr,
                                atom, other, color, bond_type,
                                radius * 0.75, radius);
          this.add_offset_stick(vertex_arr, color_arr, bond_type_arr,
                                atom, other, color, bond_type,
                                -radius * 0.75, radius);
        } else if (bond_type === 3) { // BondType.Triple
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

  private calculate_tangents(seg: Atom[], res_map: Record<string, any>): number[][] {
    const tangents: number[][] = [];
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
    return tangents;
  }

  add_ribbon(smoothness: number) {
    const segments = this.model.extract_trace();
    const res_map = this.model.get_residues();
    const visible_atoms = [].concat.apply([], segments);
    const colors = this.atom_colors(visible_atoms);
    let k = 0;
    for (const seg of segments) {
      const tangents = this.calculate_tangents(seg, res_map);
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
      const tangents = this.calculate_tangents(seg, res_map);
      const color_slice = colors.slice(k, k + seg.length);
      k += seg.length;
      const obj = makeCartoon(seg, color_slice, tangents, smoothness);
      this.objects.push(obj);
    }
    this.atom_array = visible_atoms;
  }
}

ModelBag.ctor_counter = 0;
