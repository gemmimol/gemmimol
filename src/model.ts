import type { GemmiModule, Structure, UnitCell,
              Model as GemmiModel } from './gemmi';

type Num3 = [number, number, number];

type MonomerFetcher = (resnames: string[]) => Promise<string[]>;
export type GemmiBondingInfo = {
  source: 'gemmi' | 'unavailable',
  monomers_requested: number,
  monomers_loaded: number,
  unresolved_monomers: string[],
  bond_count: number,
};
export const BondType = {
  Unspec: 0,
  Single: 1,
  Double: 2,
  Triple: 3,
  Aromatic: 4,
  Deloc: 5,
  Metal: 6,
} as const;
export type BondTypeValue = typeof BondType[keyof typeof BondType];

type CifLoop = {
  tags: string[],
  rows: string[][],
};

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

function extract_cif_loops(text: string, first_tag: string): CifLoop[] {
  const lines = text.split(/\r?\n/);
  const loops = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== 'loop_') continue;
    const tags = [];
    let j = i + 1;
    while (j < lines.length && lines[j].startsWith('_')) {
      tags.push(lines[j].trim());
      j++;
    }
    if (tags[0] !== first_tag) continue;
    const values = [];
    for (; j < lines.length; j++) {
      const trimmed = lines[j].trim();
      if (trimmed === '' || trimmed === '#') continue;
      if (trimmed === 'loop_' || trimmed.startsWith('_')) break;
      values.push(...tokenize_cif_row(lines[j]));
    }
    if (tags.length === 0 || values.length < tags.length) continue;
    const rows = [];
    for (let k = 0; k + tags.length <= values.length; k += tags.length) {
      rows.push(values.slice(k, k + tags.length));
    }
    loops.push({tags: tags, rows: rows});
  }
  return loops;
}

function extract_embedded_monomer_cifs(text: string, missing_names: string[]) {
  if (missing_names.length === 0) return [];
  const atom_loops = extract_cif_loops(text, '_chem_comp_atom.comp_id');
  if (atom_loops.length === 0) return [];
  const bond_loops = extract_cif_loops(text, '_chem_comp_bond.comp_id');
  const wanted = new Set(missing_names.map((name) => name.toUpperCase()));
  const atom_rows = new Map<string, string[][]>();
  const atom_tags = new Map<string, string[]>();
  const bond_rows = new Map<string, string[][]>();
  const bond_tags = new Map<string, string[]>();

  for (const atom_loop of atom_loops) {
    for (const row of atom_loop.rows) {
      const comp_id = (row[0] || '').toUpperCase();
      if (!wanted.has(comp_id)) continue;
      if (!atom_tags.has(comp_id)) atom_tags.set(comp_id, atom_loop.tags);
      const rows = atom_rows.get(comp_id);
      if (rows) rows.push(row);
      else atom_rows.set(comp_id, [row]);
    }
  }
  for (const bond_loop of bond_loops) {
    for (const row of bond_loop.rows) {
      const comp_id = (row[0] || '').toUpperCase();
      if (!wanted.has(comp_id)) continue;
      if (!bond_tags.has(comp_id)) bond_tags.set(comp_id, bond_loop.tags);
      const rows = bond_rows.get(comp_id);
      if (rows) rows.push(row);
      else bond_rows.set(comp_id, [row]);
    }
  }

  const monomers = [];
  for (const comp_id of Array.from(wanted)) {
    const comp_atom_rows = atom_rows.get(comp_id);
    if (comp_atom_rows == null || comp_atom_rows.length === 0) continue;
    const comp_atom_tags = atom_tags.get(comp_id);
    if (comp_atom_tags == null) continue;
    const lines = [
      'data_' + comp_id,
      '#',
      '_chem_comp.id ' + comp_id,
      '#',
      'loop_',
      ...comp_atom_tags,
      ...comp_atom_rows.map((row) => row.join(' ')),
      '#',
    ];
    const comp_bond_rows = bond_rows.get(comp_id);
    const comp_bond_tags = bond_tags.get(comp_id);
    if (comp_bond_tags != null && comp_bond_rows != null && comp_bond_rows.length !== 0) {
      lines.push(
        'loop_',
        ...comp_bond_tags,
        ...comp_bond_rows.map((row) => row.join(' ')),
        '#'
      );
    }
    monomers.push({name: comp_id, cif: lines.join('\n') + '\n'});
  }
  return monomers;
}

function monomer_names_in_cif(text: string) {
  const names = new Set<string>();
  for (const loop of extract_cif_loops(text, '_chem_comp_atom.comp_id')) {
    for (const row of loop.rows) {
      const comp_id = (row[0] || '').toUpperCase();
      if (comp_id !== '' && comp_id !== '.' && comp_id !== '?') {
        names.add(comp_id);
      }
    }
  }
  return names;
}

function getGemmiBondData(gemmi: GemmiModule, st: Structure,
                          getMonomerCifs?: MonomerFetcher,
                          structure_text?: string,
                          add_hydrogens?: boolean,
                          extra_cif_texts?: string[]) {
  if (typeof gemmi.BondInfo !== 'function') {
    return Promise.resolve({
      bond_data: null,
      info: {
        source: 'unavailable',
        monomers_requested: 0,
        monomers_loaded: 0,
        unresolved_monomers: [],
        bond_count: 0,
      } as GemmiBondingInfo,
    });
  }
  const bond_info = new gemmi.BondInfo();
  // For add_hydrogens, prepare_topology needs full restraints (atoms, bonds,
  // *and angles*). PDBe-updated mmCIFs embed chem_comp_atom / chem_comp_bond
  // but not angles, so we bypass embedded extraction and fetch the full
  // monomer dictionary for every residue actually present.
  const resnames = (add_hydrogens ?
    gemmi.get_residue_names(st) :
    gemmi.get_missing_monomer_names(st)).split(',').filter(Boolean);
  const monomers_requested = Array.from(new Set(resnames)).length;
  const embedded_monomers = (structure_text && !add_hydrogens) ?
    extract_embedded_monomer_cifs(structure_text, resnames) :
    [];
  const embedded_names = new Set(embedded_monomers.map((entry) => entry.name));
  const fetch_names = (getMonomerCifs && resnames.length !== 0) ?
    resnames.filter((name) => !embedded_names.has(name.toUpperCase())) :
    [];
  const load_monomers = (getMonomerCifs && fetch_names.length !== 0) ?
    getMonomerCifs(fetch_names) :
    Promise.resolve([]);
  return load_monomers.then(function (cif_texts) {
    const loaded_names = new Set<string>(embedded_names);
    let loaded_monomers = 0;
    for (const entry of embedded_monomers) {
      bond_info.add_monomer_cif(entry.cif);
      loaded_monomers++;
    }
    for (const cif_text of cif_texts) {
      bond_info.add_monomer_cif(cif_text);
      for (const name of monomer_names_in_cif(cif_text)) {
        loaded_names.add(name);
      }
      loaded_monomers++;
    }
    if (extra_cif_texts) {
      for (const cif_text of extra_cif_texts) {
        bond_info.add_monomer_cif(cif_text);
      }
    }
    if (add_hydrogens) {
      const hc = gemmi.HydrogenChange;
      try {
        bond_info.add_hydrogens(st, hc.ReAddButWater);
      } catch (e: any) {
        const getMsg = (gemmi as any).getExceptionMessage;
        if (e && typeof e.excPtr === 'number' && typeof getMsg === 'function') {
          const info = getMsg(e);
          const msg = Array.isArray(info) ? (info[1] || info[0]) : String(info);
          throw new Error(msg || 'add_hydrogens failed', { cause: e });
        }
        throw e;
      }
    }
    bond_info.get_bond_lines(st);
    const len = bond_info.bond_data_size();
    const unresolved_monomers = Array.from(new Set(resnames
      .map((name) => name.toUpperCase())
      .filter((name) => !loaded_names.has(name)))).sort();
    const source = 'gemmi' as const;
    const info: GemmiBondingInfo = {
      source: source,
      monomers_requested: monomers_requested,
      monomers_loaded: loaded_monomers,
      unresolved_monomers: unresolved_monomers,
      bond_count: len / 3,
    };
    if (loaded_monomers === 0 && len === 0) return { bond_data: null, info: info };
    const ptr = bond_info.bond_data_ptr();
    return {
      bond_data: new Int32Array(gemmi.HEAPU8.buffer, ptr, len).slice(),
      info: info,
    };
  }).finally(() => bond_info.delete());
}

function copy_unit_cell(gemmi: GemmiModule, cell: UnitCell) {
  return new gemmi.UnitCell(cell.a, cell.b, cell.c,
                            cell.alpha, cell.beta, cell.gamma);
}

function fill_model_from_gemmi(gm: GemmiModel, model: Model) {
  let atom_i_seq = 0;
  for (let i_chain = 0; i_chain < gm.length; ++i_chain) {
    const chain = gm.at(i_chain);
    const chain_name = chain.name;
    for (let i_res = 0; i_res < chain.length; ++i_res) {
      const res = chain.at(i_res);
      const seqid = res.seqid_string;
      const resname = res.name;
      const ent_type = res.entity_type_string;
      const ss = res.ss_from_file_string || 'Coil';
      const strand_sense = res.strand_sense_from_file_string || 'NotStrand';
      const residue_atoms = [];
      let residue_has_metal = false;
      for (let i_atom = 0; i_atom < res.length; ++i_atom) {
        const atom = res.at(i_atom);
        const new_atom = new Atom();
        new_atom.i_seq = atom_i_seq++;
        new_atom.chain = chain_name;
        new_atom.chain_index = i_chain + 1;
        new_atom.resname = resname;
        new_atom.seqid = seqid;
        new_atom.name = atom.name;
        new_atom.altloc = atom.altloc === 0 ? '' : String.fromCharCode(atom.altloc);
        new_atom.xyz = atom.pos;
        new_atom.occ = atom.occ;
        new_atom.b = atom.b_iso;
        new_atom.element = atom.element_uname;
        new_atom.is_metal = atom.is_metal;
        new_atom.ss = ss;
        new_atom.strand_sense = strand_sense;
        residue_has_metal = residue_has_metal || atom.is_metal;
        if (new_atom.is_hydrogen()) {
          model.has_hydrogens = true;
          model.hydrogen_count++;
        }
        residue_atoms.push(new_atom);
      }
      const inferred_ligand = (ent_type === 'non-polymer' || ent_type === 'branched' ||
                               ((ent_type === '?' || ent_type === '') &&
                                (resname === 'HOH' || residue_has_metal)));
      for (const new_atom of residue_atoms) {
        new_atom.is_ligand = inferred_ligand;
        model.atoms.push(new_atom);
      }
    }
  }
}

function finalize_model(model: Model, bond_data?: Int32Array | null,
                        keep_bond_data?: boolean) {
  model.calculate_bounds();
  if (bond_data != null) {
    model.apply_bond_data(bond_data);
    if (keep_bond_data) model.bond_data = bond_data;
  } else {
    model.calculate_cubicles();
  }
}

export function modelsFromGemmi(gemmi: GemmiModule, buffer: ArrayBuffer, name: string,
                                getMonomerCifs?: MonomerFetcher) {
  const st = gemmi.read_structure(buffer, name);
  const structure_text = /\.(cif|mmcif|mcif)$/i.test(name) ?
    new TextDecoder().decode(new Uint8Array(buffer)) :
    undefined;
  return getGemmiBondData(gemmi, st, getMonomerCifs, structure_text).then(function (bond_result) {
    const bond_data = bond_result.bond_data;
    const cell = st.cell;  // TODO: check if a copy of cell is created here
    const models: Model[] = [];
    for (let i_model = 0; i_model < st.length; ++i_model) {
      const model = st.at(i_model);
      const m = new Model();
      m.source_model_index = i_model;
      m.unit_cell = copy_unit_cell(gemmi, cell);
      fill_model_from_gemmi(model, m);
      finalize_model(m, bond_data, true);
      models.push(m);
    }
    //console.log("[after modelsFromGemmi] wasm mem:", gemmi.HEAPU8.length / 1024, "kb");
    return { models: models, bonding: bond_result.info, structure: st,
             structure_text: structure_text };
  }, function (err) {
    st.delete();
    throw err;
  });
}

export function bondDataFromGemmiStructure(gemmi: GemmiModule, st: Structure,
                                           getMonomerCifs?: MonomerFetcher,
                                           add_hydrogens?: boolean,
                                           extra_cif_texts?: string[],
                                           structure_text?: string) {
  return getGemmiBondData(gemmi, st, getMonomerCifs, structure_text,
                          add_hydrogens, extra_cif_texts)
    .then(function (bond_result) {
      return {
        bond_data: bond_result.bond_data,
        bonding: bond_result.info,
      };
    });
}

export function modelFromGemmiStructure(gemmi: GemmiModule, st: Structure,
                                        bond_data?: Int32Array | null,
                                        model_index: number=0): Model {
  const cell = st.cell;
  const gm = st.at(model_index);
  const m = new Model();
  m.source_model_index = model_index;
  m.unit_cell = copy_unit_cell(gemmi, cell);
  fill_model_from_gemmi(gm, m);
  finalize_model(m, bond_data);
  return m;
}

export class Model {
  atoms: Atom[];
  unit_cell: UnitCell | null;
  has_hydrogens: boolean;
  hydrogen_count: number;
  lower_bound: Num3;
  upper_bound: Num3;
  residue_map: Record<string, Atom[]> | null;
  cubes: Cubicles | null;
  source_model_index: number | null;
  bond_data: Int32Array | null;

  constructor() {
    this.atoms = [];
    this.unit_cell = null;
    this.has_hydrogens = false;
    this.hydrogen_count = 0;
    this.lower_bound = [0, 0, 0];
    this.upper_bound = [0, 0, 0];
    this.bond_data = null;
    this.residue_map = null;
    this.cubes = null;
    this.source_model_index = null;
  }

  calculate_bounds() {
    const lower = this.lower_bound = [Infinity, Infinity, Infinity];
    const upper = this.upper_bound = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.atoms.length; i++) {
      const atom = this.atoms[i];
      for (let j = 0; j < 3; j++) {
        const v = atom.xyz[j];
        if (v < lower[j]) lower[j] = v;
        if (v > upper[j]) upper[j] = v;
      }
    }
    // with a margin
    for (let k = 0; k < 3; ++k) {
      lower[k] -= 0.001;
      upper[k] += 0.001;
    }
  }

  next_residue(atom: Atom | null, backward: boolean) {
    const len = this.atoms.length;
    const start = (atom ? atom.i_seq : 0) + len;  // +len to avoid idx<0 below
    for (let i = (atom ? 1 : 0); i < len; i++) {
      const idx = (start + (backward ? -i : i)) % len;
      const a = this.atoms[idx];
      if (!a.is_main_conformer()) continue;
      if ((a.name === 'CA' && a.element === 'C') || a.name === 'P') {
        return a;
      }
    }
  }

  extract_trace() {
    const segments = [];
    let current_segment: Atom[] = [];
    let last_atom = null;
    for (let i = 0; i < this.atoms.length; i++) {
      const atom = this.atoms[i];
      if (atom.altloc !== '' && atom.altloc !== 'A') continue;
      if ((atom.name === 'CA' && atom.element === 'C') || atom.name === 'P') {
        let start_new = true;
        if (last_atom !== null && last_atom.chain_index === atom.chain_index) {
          const dxyz2 = atom.distance_sq(last_atom);
          if ((atom.name === 'CA' && dxyz2 <= 5.5*5.5) ||
              (atom.name === 'P' && dxyz2 < 7.5*7.5)) {
            current_segment.push(atom);
            start_new = false;
          }
        }
        if (start_new) {
          if (current_segment.length > 2) {
            segments.push(current_segment);
          }
          current_segment = [atom];
        }
        last_atom = atom;
      }
    }
    if (current_segment.length > 2) {
      segments.push(current_segment);
    }
    //console.log(segments.length + " segments extracted");
    return segments;
  }

  get_residues() {
    if (this.residue_map != null) return this.residue_map;
    const residues: Record<string, Atom[]> = {};
    for (let i = 0; i < this.atoms.length; i++) {
      const atom = this.atoms[i];
      const resid = atom.resid();
      const reslist = residues[resid];
      if (reslist === undefined) {
        residues[resid] = [atom];
      } else {
        reslist.push(atom);
      }
    }
    this.residue_map = residues;
    return residues;
  }

  // tangent vector to the ribbon representation
  calculate_tangent_vector(residue: Atom[]): Num3 {
    let a1 = null;
    let a2 = null;
    // it may be too simplistic
    const peptide = (residue[0].resname.length === 3);
    const name1 = peptide ? 'C' : 'C2\'';
    const name2 = peptide ? 'O' : 'O4\'';
    for (let i = 0; i < residue.length; i++) {
      const atom = residue[i];
      if (!atom.is_main_conformer()) continue;
      if (atom.name === name1) {
        a1 = atom.xyz;
      } else if (atom.name === name2) {
        a2 = atom.xyz;
      }
    }
    if (a1 === null || a2 === null) return [0, 0, 1]; // arbitrary value
    const d = [a1[0]-a2[0], a1[1]-a2[1], a1[2]-a2[2]];
    const len = Math.sqrt(d[0]*d[0] + d[1]*d[1] + d[2]*d[2]);
    return [d[0]/len, d[1]/len, d[2]/len];
  }

  get_center(): Num3 {
    let xsum = 0, ysum = 0, zsum = 0;
    const n_atoms = this.atoms.length;
    for (let i = 0; i < n_atoms; i++) {
      const xyz = this.atoms[i].xyz;
      xsum += xyz[0];
      ysum += xyz[1];
      zsum += xyz[2];
    }
    return [xsum / n_atoms, ysum / n_atoms, zsum / n_atoms];
  }

  calculate_cubicles() {
    const cubes = new Cubicles(this.atoms, 3.0, this.lower_bound, this.upper_bound);
    this.cubes = cubes;
    return cubes;
  }

  add_missing_hydrogen_bonds() {
    const max_d2 = 1.45 * 1.45;
    const residues = this.get_residues();
    for (const atom of this.atoms) {
      if (!atom.is_hydrogen() || atom.bonds.length !== 0) continue;
      const residue = residues[atom.resid()];
      if (residue == null) continue;
      let nearest = null;
      let min_d2 = Infinity;
      for (const other of residue) {
        if (other === atom || other.is_hydrogen()) continue;
        if (!atom.is_same_conformer(other)) continue;
        const d2 = atom.distance_sq(other);
        if (d2 < min_d2) {
          min_d2 = d2;
          nearest = other;
        }
      }
      if (nearest != null && min_d2 <= max_d2) {
        this.add_bond(atom.i_seq, nearest.i_seq, BondType.Single);
      }
    }
  }

  apply_bond_data(bond_data: Int32Array) {
    for (const atom of this.atoms) {
      atom.bonds = [];
      atom.bond_types = [];
    }
    for (let i = 0; i + 2 < bond_data.length; i += 3) {
      const idx1 = bond_data[i];
      const idx2 = bond_data[i+1];
      const bond_type = bond_data[i+2] as BondTypeValue;
      if (idx1 < 0 || idx2 < 0 ||
          idx1 >= this.atoms.length || idx2 >= this.atoms.length) {
        continue;
      }
      this.add_bond(idx1, idx2, bond_type);
    }
    this.add_missing_hydrogen_bonds();
    this.calculate_cubicles();
  }

  add_bond(idx1: number, idx2: number, bond_type: BondTypeValue) {
    this.atoms[idx1].bonds.push(idx2);
    this.atoms[idx1].bond_types.push(bond_type);
    this.atoms[idx2].bonds.push(idx1);
    this.atoms[idx2].bond_types.push(bond_type);
  }

  get_nearest_atom(x: number, y: number, z: number, atom_name?: string) {
    const cubes = this.cubes;
    if (cubes == null) throw Error('Missing Cubicles');
    const box_id = cubes.find_box_id(x, y, z);
    const indices = cubes.get_nearby_atoms(box_id);
    let nearest = null;
    let min_d2 = Infinity;
    for (let i = 0; i < indices.length; i++) {
      const atom = this.atoms[indices[i]];
      if (atom_name != null && atom_name !== atom.name) continue;
      const dx = atom.xyz[0] - x;
      const dy = atom.xyz[1] - y;
      const dz = atom.xyz[2] - z;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 < min_d2) {
        nearest = atom;
        min_d2 = d2;
      }
    }
    return nearest;
  }

  remove_atoms(indices: number[]) {
    if (indices.length === 0) return 0;
    const removed = new Uint8Array(this.atoms.length);
    let removed_count = 0;
    for (const idx of indices) {
      if (idx < 0 || idx >= this.atoms.length || removed[idx] !== 0) continue;
      removed[idx] = 1;
      removed_count++;
    }
    if (removed_count === 0) return 0;

    const old_to_new = new Int32Array(this.atoms.length);
    old_to_new.fill(-1);
    const remaining_atoms: Atom[] = [];
    for (let i = 0; i < this.atoms.length; i++) {
      if (removed[i] !== 0) continue;
      const atom = this.atoms[i];
      atom.i_seq = remaining_atoms.length;
      old_to_new[i] = atom.i_seq;
      remaining_atoms.push(atom);
    }

    for (const atom of remaining_atoms) {
      const bonds = [];
      const bond_types = [];
      for (let i = 0; i < atom.bonds.length; i++) {
        const other_idx = old_to_new[atom.bonds[i]];
        if (other_idx < 0) continue;
        bonds.push(other_idx);
        bond_types.push(atom.bond_types[i]);
      }
      atom.bonds = bonds;
      atom.bond_types = bond_types;
    }

    this.atoms = remaining_atoms;
    this.bond_data = null;
    this.residue_map = null;
    this.cubes = null;
    this.has_hydrogens = false;
    this.hydrogen_count = 0;
    for (const atom of this.atoms) {
      if (!atom.is_hydrogen()) continue;
      this.has_hydrogens = true;
      this.hydrogen_count++;
    }
    if (this.atoms.length === 0) {
      this.lower_bound = [0, 0, 0];
      this.upper_bound = [0, 0, 0];
    } else {
      this.calculate_bounds();
      this.calculate_cubicles();
    }
    return removed_count;
  }
}

// Single atom and associated labels
class Atom {
  name: string;
  altloc: string;
  resname: string;
  chain: string;
  chain_index: number;
  seqid: string;
  ss: string;
  strand_sense: string;
  xyz: Num3;
  occ: number;
  b: number;
  element: string;
  is_metal: boolean;
  i_seq: number;
  is_ligand: boolean | null;
  bonds: number[];
  bond_types: BondTypeValue[];

  constructor() {
    this.name = '';
    this.altloc = '';
    this.resname = '';
    this.chain = '';
    this.chain_index = -1;
    this.seqid = '';
    this.ss = 'Coil';
    this.strand_sense = 'NotStrand';
    this.xyz = [0, 0, 0];
    this.occ = 1.0;
    this.b = 0;
    this.element = '';
    this.is_metal = false;
    this.i_seq = -1;
    this.is_ligand = null;
    this.bonds = [];
    this.bond_types = [];
  }

  distance_sq(other: Atom) {
    const dx = this.xyz[0] - other.xyz[0];
    const dy = this.xyz[1] - other.xyz[1];
    const dz = this.xyz[2] - other.xyz[2];
    return dx*dx + dy*dy + dz*dz;
  }

  midpoint(other: Atom): Num3 {
    return [(this.xyz[0] + other.xyz[0]) / 2,
            (this.xyz[1] + other.xyz[1]) / 2,
            (this.xyz[2] + other.xyz[2]) / 2];
  }

  is_hydrogen() {
    return this.element === 'H' || this.element === 'D';
  }

  is_water() {
    return this.resname === 'HOH';
  }

  is_same_conformer(other: Atom) {
    return this.altloc === '' || other.altloc === '' ||
           this.altloc === other.altloc;
  }

  is_main_conformer() {
    return this.altloc === '' || this.altloc === 'A';
  }

  is_backbone() {
    if (this.resname.length === 3) {
      return ['N', 'CA', 'C', 'O', 'OXT'].indexOf(this.name) !== -1;
    }
    return [
      'P', 'OP1', 'OP2', 'O1P', 'O2P', 'O5\'', 'C5\'', 'C4\'', 'O4\'',
      'C3\'', 'O3\'', 'C2\'', 'O2\'', 'C1\'',
      'O5*', 'C5*', 'C4*', 'O4*', 'C3*', 'O3*', 'C2*', 'O2*', 'C1*',
    ].indexOf(this.name) !== -1;
  }


  resid() {
    return this.seqid + '/' + this.chain;
  }

  long_label(symop?: string) {
    const symop_str = symop ? ' [' + symop + ']' : '';
    return this.name + ' /' + this.seqid + ' ' + this.resname + '/' + this.chain +
           symop_str +
           ' - occ: ' + this.occ.toFixed(2) + ' bf: ' + this.b.toFixed(2) +
           ' ele: ' + this.element + ' pos: (' + this.xyz[0].toFixed(2) + ',' +
           this.xyz[1].toFixed(2) + ',' + this.xyz[2].toFixed(2) + ')';
  }

  short_label() {
    return this.name + ' /' + this.seqid + ' ' + this.resname + '/' + this.chain;
  }
}


// Partition atoms into boxes for quick neighbor searching.
class Cubicles {
  boxes: number[][];
  box_length: number;
  lower_bound: Num3;
  upper_bound: Num3;
  xdim: number;
  ydim: number;
  zdim: number;

  constructor(atoms: Atom[], box_length: number,
              lower_bound: Num3, upper_bound: Num3) {
    this.boxes = [];
    this.box_length = box_length;
    this.lower_bound = lower_bound;
    this.upper_bound = upper_bound;
    this.xdim = Math.ceil((upper_bound[0] - lower_bound[0]) / box_length);
    this.ydim = Math.ceil((upper_bound[1] - lower_bound[1]) / box_length);
    this.zdim = Math.ceil((upper_bound[2] - lower_bound[2]) / box_length);
    //console.log("Cubicles: " + this.xdim + "x" + this.ydim + "x" + this.zdim);
    const nxyz = this.xdim * this.ydim * this.zdim;
    for (let j = 0; j < nxyz; j++) {
      this.boxes.push([]);
    }
    for (let i = 0; i < atoms.length; i++) {
      const xyz = atoms[i].xyz;
      const box_id = this.find_box_id(xyz[0], xyz[1], xyz[2]);
      if (box_id === null) {
        throw Error('wrong cubicle');
      }
      this.boxes[box_id].push(i);
    }
  }

  find_box_id(x: number, y: number, z: number) {
    const xstep = Math.floor((x - this.lower_bound[0]) / this.box_length);
    const ystep = Math.floor((y - this.lower_bound[1]) / this.box_length);
    const zstep = Math.floor((z - this.lower_bound[2]) / this.box_length);
    const box_id = (zstep * this.ydim + ystep) * this.xdim + xstep;
    if (box_id < 0 || box_id >= this.boxes.length) throw Error('Ups!');
    return box_id;
  }

  get_nearby_atoms(box_id: number) {
    const indices = [];
    const xydim = this.xdim * this.ydim;
    const uv = Math.max(box_id % xydim, 0);
    const u = Math.max(uv % this.xdim, 0);
    const v = Math.floor(uv / this.xdim);
    const w = Math.floor(box_id / xydim);
    console.assert((w * xydim) + (v * this.xdim) + u === box_id);
    for (let iu = u-1; iu <= u+1; iu++) {
      if (iu < 0 || iu >= this.xdim) continue;
      for (let iv = v-1; iv <= v+1; iv++) {
        if (iv < 0 || iv >= this.ydim) continue;
        for (let iw = w-1; iw <= w+1; iw++) {
          if (iw < 0 || iw >= this.zdim) continue;
          const other_box_id = (iw * xydim) + (iv * this.xdim) + iu;
          if (other_box_id >= this.boxes.length || other_box_id < 0) {
            throw Error('Box out of bounds: ID ' + other_box_id);
          }
          const box = this.boxes[other_box_id];
          for (let i = 0; i < box.length; i++) {
            indices.push(box[i]);
          }
        }
      }
    }
    return indices;
  }
}

export type { Atom };
