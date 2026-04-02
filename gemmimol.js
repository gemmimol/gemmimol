/*!
 * GemmiMol v0.8.3. Macromolecular Viewer for Crystallographers.
 * Copyright 2014 Nat Echols
 * Copyright 2016 Diamond Light Source Ltd
 * Copyright 2016 Marcin Wojdyr
 * Released under the MIT License.
 */
(function (global, factory) {
typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
typeof define === 'function' && define.amd ? define(['exports'], factory) :
(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.GM = {}));
})(this, (function (exports) { 'use strict';

var VERSION = exports.VERSION = "0.8.3";
var GIT_DESCRIBE = exports.GIT_DESCRIBE = "0.8.3-16-g944353a-dirty";
var GEMMI_GIT_DESCRIBE = exports.GEMMI_GIT_DESCRIBE = "v0.7.5-141-g3fd5922f";


const BondType = {
  Unspec: 0,
  Single: 1,
  Double: 2,
  Triple: 3,
  Aromatic: 4,
  Deloc: 5,
  Metal: 6,
} ;
 






function tokenize_cif_row$1(line) {
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

function extract_cif_loops(text, first_tag) {
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
      values.push(...tokenize_cif_row$1(lines[j]));
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

function extract_embedded_monomer_cifs(text, missing_names) {
  if (missing_names.length === 0) return [];
  const atom_loops = extract_cif_loops(text, '_chem_comp_atom.comp_id');
  if (atom_loops.length === 0) return [];
  const bond_loops = extract_cif_loops(text, '_chem_comp_bond.comp_id');
  const wanted = new Set(missing_names.map((name) => name.toUpperCase()));
  const atom_rows = new Map();
  const atom_tags = new Map();
  const bond_rows = new Map();
  const bond_tags = new Map();

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

function monomer_names_in_cif(text) {
  const names = new Set();
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

function getGemmiBondData(gemmi, st,
                          getMonomerCifs,
                          structure_text) {
  if (typeof gemmi.BondInfo !== 'function') {
    return Promise.resolve({
      bond_data: null,
      info: {
        source: 'unavailable',
        monomers_requested: 0,
        monomers_loaded: 0,
        unresolved_monomers: [],
        bond_count: 0,
      } ,
    });
  }
  const bond_info = new gemmi.BondInfo();
  const resnames = gemmi.get_missing_monomer_names(st).split(',').filter(Boolean);
  const monomers_requested = Array.from(new Set(resnames)).length;
  const embedded_monomers = structure_text ?
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
    const loaded_names = new Set(embedded_names);
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
    bond_info.get_bond_lines(st);
    const len = bond_info.bond_data_size();
    const unresolved_monomers = Array.from(new Set(resnames
      .map((name) => name.toUpperCase())
      .filter((name) => !loaded_names.has(name)))).sort();
    const source = 'gemmi' ;
    const info = {
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

function copy_unit_cell(gemmi, cell) {
  return new gemmi.UnitCell(cell.a, cell.b, cell.c,
                            cell.alpha, cell.beta, cell.gamma);
}

function fill_model_from_gemmi(gm, model) {
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

function finalize_model(model, bond_data,
                        keep_bond_data) {
  model.calculate_bounds();
  if (bond_data != null) {
    model.apply_bond_data(bond_data);
    if (keep_bond_data) model.bond_data = bond_data;
  } else {
    model.calculate_cubicles();
  }
}

function modelsFromGemmi(gemmi, buffer, name,
                                getMonomerCifs) {
  const st = gemmi.read_structure(buffer, name);
  const structure_text = /\.(cif|mmcif|mcif)$/i.test(name) ?
    new TextDecoder().decode(new Uint8Array(buffer)) :
    undefined;
  return getGemmiBondData(gemmi, st, getMonomerCifs, structure_text).then(function (bond_result) {
    const bond_data = bond_result.bond_data;
    const cell = st.cell;  // TODO: check if a copy of cell is created here
    const models = [];
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
    return { models: models, bonding: bond_result.info, structure: st };
  }, function (err) {
    st.delete();
    throw err;
  });
}

function bondDataFromGemmiStructure(gemmi, st,
                                           getMonomerCifs) {
  return getGemmiBondData(gemmi, st, getMonomerCifs).then(function (bond_result) {
    return {
      bond_data: bond_result.bond_data,
      bonding: bond_result.info,
    };
  });
}

function modelFromGemmiStructure(gemmi, st,
                                        bond_data,
                                        model_index=0) {
  const cell = st.cell;
  const gm = st.at(model_index);
  const m = new Model();
  m.source_model_index = model_index;
  m.unit_cell = copy_unit_cell(gemmi, cell);
  fill_model_from_gemmi(gm, m);
  finalize_model(m, bond_data);
  return m;
}

class Model {
  
  
  
  
  
  
  
  
  
  

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

  next_residue(atom, backward) {
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
    let current_segment = [];
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
    const residues = {};
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
  calculate_tangent_vector(residue) {
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

  get_center() {
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

  apply_bond_data(bond_data) {
    for (const atom of this.atoms) {
      atom.bonds = [];
      atom.bond_types = [];
    }
    for (let i = 0; i + 2 < bond_data.length; i += 3) {
      const idx1 = bond_data[i];
      const idx2 = bond_data[i+1];
      const bond_type = bond_data[i+2] ;
      if (idx1 < 0 || idx2 < 0 ||
          idx1 >= this.atoms.length || idx2 >= this.atoms.length) {
        continue;
      }
      this.add_bond(idx1, idx2, bond_type);
    }
    this.add_missing_hydrogen_bonds();
    this.calculate_cubicles();
  }

  add_bond(idx1, idx2, bond_type) {
    this.atoms[idx1].bonds.push(idx2);
    this.atoms[idx1].bond_types.push(bond_type);
    this.atoms[idx2].bonds.push(idx1);
    this.atoms[idx2].bond_types.push(bond_type);
  }

  get_nearest_atom(x, y, z, atom_name) {
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

  remove_atoms(indices) {
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
    const remaining_atoms = [];
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

  distance_sq(other) {
    const dx = this.xyz[0] - other.xyz[0];
    const dy = this.xyz[1] - other.xyz[1];
    const dz = this.xyz[2] - other.xyz[2];
    return dx*dx + dy*dy + dz*dz;
  }

  midpoint(other) {
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

  is_same_conformer(other) {
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

  long_label(symop) {
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
  
  
  
  
  
  
  

  constructor(atoms, box_length,
              lower_bound, upper_bound) {
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

  find_box_id(x, y, z) {
    const xstep = Math.floor((x - this.lower_bound[0]) / this.box_length);
    const ystep = Math.floor((y - this.lower_bound[1]) / this.box_length);
    const zstep = Math.floor((z - this.lower_bound[2]) / this.box_length);
    const box_id = (zstep * this.ydim + ystep) * this.xdim + xstep;
    if (box_id < 0 || box_id >= this.boxes.length) throw Error('Ups!');
    return box_id;
  }

  get_nearby_atoms(box_id) {
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

function _nullishCoalesce$1(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } }

































function modulo(a, b) {
  const reminder = a % b;
  return reminder >= 0 ? reminder : reminder + b;
}

class GridArray {
  
  

  constructor(dim) {
    this.dim = dim; // dimensions of the grid for the entire unit cell
    this.values = new Float32Array(dim[0] * dim[1] * dim[2]);
  }

  grid2index(i, j, k) {
    i = modulo(i, this.dim[0]);
    j = modulo(j, this.dim[1]);
    k = modulo(k, this.dim[2]);
    return this.dim[2] * (this.dim[1] * i + j) + k;
  }

  grid2index_unchecked(i, j, k) {
    return this.dim[2] * (this.dim[1] * i + j) + k;
  }

  grid2frac(i, j, k) {
    return [i / this.dim[0], j / this.dim[1], k / this.dim[2]];
  }

  // return grid coordinates (rounded down) for the given fractional coordinates
  frac2grid(xyz) {
    // at one point "| 0" here made extract_block() 40% faster on V8 3.14,
    // but I don't see any effect now
    return [Math.floor(xyz[0] * this.dim[0]) | 0,
            Math.floor(xyz[1] * this.dim[1]) | 0,
            Math.floor(xyz[2] * this.dim[2]) | 0];
  }

  set_grid_value(i, j, k, value) {
    const idx = this.grid2index(i, j, k);
    this.values[idx] = value;
  }

  get_grid_value(i, j, k) {
    const idx = this.grid2index(i, j, k);
    return this.values[idx];
  }
}

class Block {
  
  
  

  constructor() {
    this._points = null;
    this._values = null;
    this._size = [0, 0, 0];
  }

  set(points, values, size) {
    if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) {
      throw Error('Grid dimensions are zero along at least one edge');
    }
    const len = size[0] * size[1] * size[2];
    if (values.length !== len || points.length !== len) {
      throw Error('isosurface: array size mismatch');
    }

    this._points = new Float32Array(3 * len);
    for (let i = 0; i < len; ++i) {
      const point = points[i];
      this._points[3*i] = point[0];
      this._points[3*i+1] = point[1];
      this._points[3*i+2] = point[2];
    }
    this._values = new Float32Array(values);
    this._size = size;
  }

  clear() {
    this._points = null;
    this._values = null;
  }

  empty()  {
    return this._values === null;
  }

  isosurface(gemmi_module, isolevel, method='') {
    if (gemmi_module == null) {
      throw Error('Gemmi is required for isosurface extraction.');
    }
    if (this._values == null || this._points == null) {
      throw Error('Block is empty.');
    }

    let iso = null;
    try {
      iso = new gemmi_module.Isosurface();
      iso.resize_input(this._values.length);
      iso.set_size(this._size[0], this._size[1], this._size[2]);
      iso.input_points().set(this._points);
      iso.input_values().set(this._values);
      if (!iso.calculate(isolevel, method)) {
        throw Error(iso.last_error || 'Failed to calculate isosurface.');
      }
      return {
        vertices: iso.vertices().slice(),
        segments: iso.segments().slice(),
      };
    } finally {
      if (iso != null) iso.delete();
    }
  }
}

function extract_block_from_grid(block, grid, unit_cell,
                                 radius, center) {
  const fc = unit_cell.fractionalize(center);
  const r = [radius / unit_cell.a,
             radius / unit_cell.b,
             radius / unit_cell.c];
  const grid_min = grid.frac2grid([fc[0] - r[0], fc[1] - r[1], fc[2] - r[2]]);
  const grid_max = grid.frac2grid([fc[0] + r[0], fc[1] + r[1], fc[2] + r[2]]);
  const size = [grid_max[0] - grid_min[0] + 1,
                      grid_max[1] - grid_min[1] + 1,
                      grid_max[2] - grid_min[2] + 1];
  const points = [];
  const values = [];
  for (let i = grid_min[0]; i <= grid_max[0]; i++) {
    for (let j = grid_min[1]; j <= grid_max[1]; j++) {
      for (let k = grid_min[2]; k <= grid_max[2]; k++) {
        const frac = grid.grid2frac(i, j, k);
        const orth = unit_cell.orthogonalize(frac);
        points.push(orth);
        const map_value = grid.get_grid_value(i, j, k);
        values.push(map_value);
      }
    }
  }
  block.set(points, values, size);
}

class ElMap {
  
  
  
  
  
  
  
  
  
   // used in ReciprocalSpaceMap

  constructor() {
    this.gemmi_module = null;
    this.unit_cell = null;
    this.grid = null;
    this.stats = { mean: 0.0, rms: 1.0 };
    this.block = new Block();
    this.wasm_map = null;
    this.block_center = null;
    this.block_radius = 0;
  }

  abs_level(sigma) {
    return sigma * this.stats.rms + this.stats.mean;
  }

  from_ccp4(buf, expand_symmetry, gemmi) {
    if (expand_symmetry === undefined) expand_symmetry = true;
    if (gemmi == null || typeof gemmi.readCcp4Map !== 'function') {
      throw Error('Gemmi is required for CCP4 map loading.');
    }
    this.gemmi_module = gemmi;
    if (this.wasm_map != null) {
      this.wasm_map.delete();
      this.wasm_map = null;
    }
    const ccp4 = gemmi.readCcp4Map(buf, expand_symmetry);
    this.wasm_map = ccp4;
    this.set_from_wasm_map(ccp4, gemmi);
  }

  // DSN6 MAP FORMAT
  // http://www.uoxray.uoregon.edu/tnt/manual/node104.html
  // Density values are stored as bytes.
  from_dsn6(buf, gemmi) {
    if (typeof gemmi.readDsn6Map !== 'function') {
      throw Error('Gemmi is required for DSN6 map loading.');
    }
    this.gemmi_module = gemmi;
    if (this.wasm_map != null) {
      this.wasm_map.delete();
      this.wasm_map = null;
    }
    const dsn6 = gemmi.readDsn6Map(buf);
    this.wasm_map = dsn6;
    this.set_from_wasm_map(dsn6, gemmi);
  }

  prepare_isosurface(radius, center) {
    this.block_center = center;
    this.block_radius = radius;
    if (this.wasm_map != null && this.unit_cell != null) return;
    const grid = this.grid;
    const unit_cell = this.unit_cell;
    if (grid == null || unit_cell == null) return;
    extract_block_from_grid(this.block, grid, unit_cell, radius, center);
  }

  isomesh_in_block(sigma, method) {
    const abs_level = this.abs_level(sigma);
    if (this.wasm_map != null && this.block_center != null && this.unit_cell != null) {
      if (!this.wasm_map.extract_isosurface(this.block_radius,
                                            this.block_center[0],
                                            this.block_center[1],
                                            this.block_center[2],
                                            abs_level,
                                            method || '')) {
        throw Error(this.wasm_map.last_error || 'Failed to extract isosurface.');
      }
      return {
        vertices: this.wasm_map.isosurface_vertices().slice(),
        segments: this.wasm_map.isosurface_segments().slice(),
      } ;
    }
    return this.block.isosurface(this.gemmi_module, abs_level, method);
  }

  find_blobs(cutoff, options={}) {
    if (this.wasm_map == null) {
      throw Error('Blob search requires a Gemmi-backed map.');
    }
    const result = this.wasm_map.find_blobs(
      cutoff,
      _nullishCoalesce$1(options.min_volume, () => ( 10.0)),
      _nullishCoalesce$1(options.min_score, () => ( 15.0)),
      _nullishCoalesce$1(options.min_peak, () => ( 0.0)),
      _nullishCoalesce$1(options.negate, () => ( false)),
      _nullishCoalesce$1(options.structure, () => ( null)),
      _nullishCoalesce$1(options.model_index, () => ( 0)),
      _nullishCoalesce$1(options.mask_radius, () => ( 2.0)),
      _nullishCoalesce$1(options.mask_waters, () => ( false))
    );
    if (result == null) return [];
    try {
      const centroids = result.centroids();
      const peaks = result.peak_positions();
      const scores = result.scores();
      const volumes = result.volumes();
      const peak_values = result.peak_values();
      const blobs = [];
      for (let i = 0; i < result.size(); i++) {
        blobs.push({
          centroid: [centroids[3*i], centroids[3*i+1], centroids[3*i+2]] ,
          peak_pos: [peaks[3*i], peaks[3*i+1], peaks[3*i+2]] ,
          score: scores[i],
          volume: volumes[i],
          peak_value: peak_values[i],
        } );
      }
      return blobs;
    } finally {
      result.delete();
    }
  }

  dispose() {
    if (this.wasm_map != null) {
      this.wasm_map.delete();
      this.wasm_map = null;
    }
  }

   set_from_wasm_map(map, gemmi) {
    const cell = map.cell;
    this.unit_cell = new gemmi.UnitCell(cell.a, cell.b, cell.c,
                                        cell.alpha, cell.beta, cell.gamma);
    this.stats.mean = map.mean;
    this.stats.rms = map.rms;
    this.grid = null;
  }

}

ElMap.prototype.unit = 'e/\u212B\u00B3';

/* eslint-disable */
// @ts-nocheck
// Copyright 2010-2023 Three.js Authors
// SPDX-License-Identifier: MIT

const _lut = [
  '00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '0a', '0b', '0c',
  '0d', '0e', '0f', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '1a', '1b', '1c', '1d', '1e', '1f', '20', '21', '22', '23', '24', '25', '26',
  '27', '28', '29', '2a', '2b', '2c', '2d', '2e', '2f', '30', '31', '32', '33',
  '34', '35', '36', '37', '38', '39', '3a', '3b', '3c', '3d', '3e', '3f', '40',
  '41', '42', '43', '44', '45', '46', '47', '48', '49', '4a', '4b', '4c', '4d',
  '4e', '4f', '50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '5a',
  '5b', '5c', '5d', '5e', '5f', '60', '61', '62', '63', '64', '65', '66', '67',
  '68', '69', '6a', '6b', '6c', '6d', '6e', '6f', '70', '71', '72', '73', '74',
  '75', '76', '77', '78', '79', '7a', '7b', '7c', '7d', '7e', '7f', '80', '81',
  '82', '83', '84', '85', '86', '87', '88', '89', '8a', '8b', '8c', '8d', '8e',
  '8f', '90', '91', '92', '93', '94', '95', '96', '97', '98', '99', '9a', '9b',
  '9c', '9d', '9e', '9f', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8',
  'a9', 'aa', 'ab', 'ac', 'ad', 'ae', 'af', 'b0', 'b1', 'b2', 'b3', 'b4', 'b5',
  'b6', 'b7', 'b8', 'b9', 'ba', 'bb', 'bc', 'bd', 'be', 'bf', 'c0', 'c1', 'c2',
  'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'ca', 'cb', 'cc', 'cd', 'ce', 'cf',
  'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'da', 'db', 'dc',
  'dd', 'de', 'df', 'e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9',
  'ea', 'eb', 'ec', 'ed', 'ee', 'ef', 'f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6',
  'f7', 'f8', 'f9', 'fa', 'fb', 'fc', 'fd', 'fe', 'ff'
];

// http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript/21963136#21963136
function generateUUID() {
  const d0 = (Math.random() * 0xffffffff) | 0;
  const d1 = (Math.random() * 0xffffffff) | 0;
  const d2 = (Math.random() * 0xffffffff) | 0;
  const d3 = (Math.random() * 0xffffffff) | 0;
  const uuid =
    _lut[d0 & 0xff] + _lut[(d0 >> 8) & 0xff] +
    _lut[(d0 >> 16) & 0xff] + _lut[(d0 >> 24) & 0xff] + '-' +
    _lut[d1 & 0xff] + _lut[(d1 >> 8) & 0xff] + '-' +
    _lut[((d1 >> 16) & 0x0f) | 0x40] + _lut[(d1 >> 24) & 0xff] + '-' +
    _lut[(d2 & 0x3f) | 0x80] + _lut[(d2 >> 8) & 0xff] + '-' +
    _lut[(d2 >> 16) & 0xff] + _lut[(d2 >> 24) & 0xff] + _lut[d3 & 0xff] +
    _lut[(d3 >> 8) & 0xff] + _lut[(d3 >> 16) & 0xff] + _lut[(d3 >> 24) & 0xff];
  // .toLowerCase() here flattens concatenated strings to save heap memory space.
  return uuid.toLowerCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// compute euclidean modulo of m % n
// https://en.wikipedia.org/wiki/Modulo_operation
function euclideanModulo(n, m) {
  return ((n % m) + m) % m;
}


let Quaternion$1 = class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
  }

  get x() {
    return this._x;
  }

  get y() {
    return this._y;
  }

  get z() {
    return this._z;
  }

  get w() {
    return this._w;
  }

  setFromAxisAngle(axis, angle) {
    // http://www.euclideanspace.com/maths/geometry/rotations/conversions/angleToQuaternion/index.htm
    // assumes axis is normalized
    let halfAngle = angle / 2, s = Math.sin(halfAngle);

    this._x = axis.x * s;
    this._y = axis.y * s;
    this._z = axis.z * s;
    this._w = Math.cos(halfAngle);

    return this;
  }

  setFromRotationMatrix(m) {
    // http://www.euclideanspace.com/maths/geometry/rotations/conversions/matrixToQuaternion/index.htm
    // assumes the upper 3x3 of m is a pure rotation matrix (i.e, unscaled)

    const te = m.elements,

      m11 = te[0], m12 = te[4], m13 = te[8],
      m21 = te[1], m22 = te[5], m23 = te[9],
      m31 = te[2], m32 = te[6], m33 = te[10],

      trace = m11 + m22 + m33;

    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);

      this._w = 0.25 / s;
      this._x = (m32 - m23) * s;
      this._y = (m13 - m31) * s;
      this._z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);

      this._w = (m32 - m23) / s;
      this._x = 0.25 * s;
      this._y = (m12 + m21) / s;
      this._z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);

      this._w = (m13 - m31) / s;
      this._x = (m12 + m21) / s;
      this._y = 0.25 * s;
      this._z = (m23 + m32) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);

      this._w = (m21 - m12) / s;
      this._x = (m13 + m31) / s;
      this._y = (m23 + m32) / s;
      this._z = 0.25 * s;
    }

    return this;
  }

  setFromUnitVectors(vFrom, vTo) {
    // assumes direction vectors vFrom and vTo are normalized
    let r = vFrom.dot(vTo) + 1;
    if (r < 1e-8) {
      // vFrom and vTo point in opposite directions
      r = 0;
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
        this._x = -vFrom.y;
        this._y = vFrom.x;
        this._z = 0;
        this._w = r;
      } else {
        this._x = 0;
        this._y = -vFrom.z;
        this._z = vFrom.y;
        this._w = r;
      }
    } else {
      // crossVectors( vFrom, vTo ); // inlined to avoid cyclic dependency on Vector3
      this._x = vFrom.y * vTo.z - vFrom.z * vTo.y;
      this._y = vFrom.z * vTo.x - vFrom.x * vTo.z;
      this._z = vFrom.x * vTo.y - vFrom.y * vTo.x;
      this._w = r;
    }
    return this.normalize();
  }

  length() {
    return Math.sqrt(this._x * this._x + this._y * this._y +
                     this._z * this._z + this._w * this._w);
  }

  normalize() {
    let l = this.length();
    if (l === 0) {
      this._x = 0;
      this._y = 0;
      this._z = 0;
      this._w = 1;
    } else {
      l = 1 / l;
      this._x = this._x * l;
      this._y = this._y * l;
      this._z = this._z * l;
      this._w = this._w * l;
    }
    return this;
  }
};


let Vector3$1 = class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    if (z === undefined) z = this.z; // sprite.scale.set(x,y)
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  clone() {
    return new this.constructor(this.x, this.y, this.z);
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  addVectors(a, b) {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    return this;
  }

  addScaledVector(v, s) {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  subVectors(a, b) {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }

  multiplyScalar(scalar) {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    return this;
  }

  applyMatrix4(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }

  applyQuaternion(q) {
    // quaternion q is assumed to have unit length
    const vx = this.x, vy = this.y, vz = this.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    // t = 2 * cross( q.xyz, v );
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    // v + q.w * t + cross( q.xyz, t );
    this.x = vx + qw * tx + qy * tz - qz * ty;
    this.y = vy + qw * ty + qz * tx - qx * tz;
    this.z = vz + qw * tz + qx * ty - qy * tx;
    return this;
  }

  unproject(camera) {
    return this.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld);
  }

  transformDirection(m) {
    // input: THREE.Matrix4 affine matrix
    // vector interpreted as a direction

    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;

    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;

    return this.normalize();
  }

  divideScalar(scalar) {
    return this.multiplyScalar(1 / scalar);
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize() {
    return this.divideScalar(this.length() || 1);
  }

  setLength(length) {
    return this.normalize().multiplyScalar(length);
  }

  lerp(v, alpha) {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;
    return this;
  }

  cross(v) {
    return this.crossVectors(this, v);
  }

  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z;
    const bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }

  projectOnVector(v) {
    const denominator = v.lengthSq();
    if (denominator === 0) return this.set(0, 0, 0);
    const scalar = v.dot(this) / denominator;
    return this.copy(v).multiplyScalar(scalar);
  }

  projectOnPlane(planeNormal) {
    _vector.copy(this).projectOnVector(planeNormal);
    return this.sub(_vector);
  }

  distanceTo(v) {
    return Math.sqrt(this.distanceToSquared(v));
  }

  distanceToSquared(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  setFromMatrixPosition(m) {
    const e = m.elements;
    this.x = e[12];
    this.y = e[13];
    this.z = e[14];
    return this;
  }

  setFromMatrixColumn(m, index) {
    return this.fromArray(m.elements, index * 4);
  }

  equals(v) {
    return v.x === this.x && v.y === this.y && v.z === this.z;
  }

  fromArray(array, offset = 0) {
    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];
    return this;
  }
};
Vector3$1.prototype.isVector3 = true;
const _vector = /*@__PURE__*/ new Vector3$1();


class Vector4 {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  set(x, y, z, w) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    this.w = v.w !== undefined ? v.w : 1;
    return this;
  }

  multiplyScalar(scalar) {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    this.w *= scalar;
    return this;
  }

  equals(v) {
    return v.x === this.x && v.y === this.y && v.z === this.z && v.w === this.w;
  }
}


let Matrix4$1 = class Matrix4 {
  constructor() {
    this.elements = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
  }

  set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
    const te = this.elements;
    te[0] = n11; te[4] = n12; te[8] = n13; te[12] = n14;
    te[1] = n21; te[5] = n22; te[9] = n23; te[13] = n24;
    te[2] = n31; te[6] = n32; te[10] = n33; te[14] = n34;
    te[3] = n41; te[7] = n42; te[11] = n43; te[15] = n44;
    return this;
  }

  copy(m) {
    const te = this.elements;
    const me = m.elements;

    te[0] = me[0];
    te[1] = me[1];
    te[2] = me[2];
    te[3] = me[3];
    te[4] = me[4];
    te[5] = me[5];
    te[6] = me[6];
    te[7] = me[7];
    te[8] = me[8];
    te[9] = me[9];
    te[10] = me[10];
    te[11] = me[11];
    te[12] = me[12];
    te[13] = me[13];
    te[14] = me[14];
    te[15] = me[15];

    return this;
  }

  makeRotationFromQuaternion(q) {
    return this.compose(_zero, q, _one);
  }

  compose(position, quaternion, scale) {
    const te = this.elements;

    const x = quaternion._x, y = quaternion._y, z = quaternion._z, w = quaternion._w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    const sx = scale.x, sy = scale.y, sz = scale.z;

    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;

    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;

    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;

    te[12] = position.x;
    te[13] = position.y;
    te[14] = position.z;
    te[15] = 1;

    return this;
  }

  lookAt(eye, target, up) {
    const te = this.elements;

    _z.subVectors(eye, target);

    if (_z.lengthSq() === 0) {
      // eye and target are in the same position

      _z.z = 1;
    }

    _z.normalize();
    _x.crossVectors(up, _z);

    if (_x.lengthSq() === 0) {
      // up and z are parallel

      if (Math.abs(up.z) === 1) {
        _z.x += 0.0001;
      } else {
        _z.z += 0.0001;
      }

      _z.normalize();
      _x.crossVectors(up, _z);
    }

    _x.normalize();
    _y.crossVectors(_z, _x);

    te[0] = _x.x; te[4] = _y.x; te[8] = _z.x;
    te[1] = _x.y; te[5] = _y.y; te[9] = _z.y;
    te[2] = _x.z; te[6] = _y.z; te[10] = _z.z;

    return this;
  }

  multiplyMatrices(a, b) {
    const ae = a.elements;
    const be = b.elements;
    const te = this.elements;

    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
    const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
    const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];

    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
    const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
    const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];

    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

    return this;
  }

  setPosition(x, y, z) {
    const te = this.elements;

    if (x.isVector3) {
      te[12] = x.x;
      te[13] = x.y;
      te[14] = x.z;
    } else {
      te[12] = x;
      te[13] = y;
      te[14] = z;
    }
    return this;
  }

  invert() {
    // based on https://github.com/toji/gl-matrix
    const te = this.elements,
      n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3],
      n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7],
      n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11],
      n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15],
      t1 = n11 * n22 - n21 * n12,
      t2 = n11 * n32 - n31 * n12,
      t3 = n11 * n42 - n41 * n12,
      t4 = n21 * n32 - n31 * n22,
      t5 = n21 * n42 - n41 * n22,
      t6 = n31 * n42 - n41 * n32,
      t7 = n13 * n24 - n23 * n14,
      t8 = n13 * n34 - n33 * n14,
      t9 = n13 * n44 - n43 * n14,
      t10 = n23 * n34 - n33 * n24,
      t11 = n23 * n44 - n43 * n24,
      t12 = n33 * n44 - n43 * n34;

    const det = t1 * t12 - t2 * t11 + t3 * t10 + t4 * t9 - t5 * t8 + t6 * t7;

    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

    const detInv = 1 / det;

    te[0] = (n22 * t12 - n32 * t11 + n42 * t10) * detInv;
    te[1] = (n31 * t11 - n21 * t12 - n41 * t10) * detInv;
    te[2] = (n24 * t6 - n34 * t5 + n44 * t4) * detInv;
    te[3] = (n33 * t5 - n23 * t6 - n43 * t4) * detInv;

    te[4] = (n32 * t9 - n12 * t12 - n42 * t8) * detInv;
    te[5] = (n11 * t12 - n31 * t9 + n41 * t8) * detInv;
    te[6] = (n34 * t3 - n14 * t6 - n44 * t2) * detInv;
    te[7] = (n13 * t6 - n33 * t3 + n43 * t2) * detInv;

    te[8] = (n12 * t11 - n22 * t9 + n42 * t7) * detInv;
    te[9] = (n21 * t9 - n11 * t11 - n41 * t7) * detInv;
    te[10] = (n14 * t5 - n24 * t3 + n44 * t1) * detInv;
    te[11] = (n23 * t3 - n13 * t5 - n43 * t1) * detInv;

    te[12] = (n22 * t8 - n12 * t10 - n32 * t7) * detInv;
    te[13] = (n11 * t10 - n21 * t8 + n31 * t7) * detInv;
    te[14] = (n24 * t2 - n14 * t4 - n34 * t1) * detInv;
    te[15] = (n13 * t4 - n23 * t2 + n33 * t1) * detInv;

    return this;
  }

  scale(v) {
    const te = this.elements;
    const x = v.x, y = v.y, z = v.z;

    te[0] *= x; te[4] *= y; te[8] *= z;
    te[1] *= x; te[5] *= y; te[9] *= z;
    te[2] *= x; te[6] *= y; te[10] *= z;
    te[3] *= x; te[7] *= y; te[11] *= z;

    return this;
  }

  getMaxScaleOnAxis() {
    const te = this.elements;

    const scaleXSq = te[0] * te[0] + te[1] * te[1] + te[2] * te[2];
    const scaleYSq = te[4] * te[4] + te[5] * te[5] + te[6] * te[6];
    const scaleZSq = te[8] * te[8] + te[9] * te[9] + te[10] * te[10];

    return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
  }

  makeOrthographic(left, right, top, bottom, near, far) {
    let te = this.elements;
    let w = 1.0 / (right - left);
    let h = 1.0 / (top - bottom);
    let p = 1.0 / (far - near);

    let x = (right + left) * w;
    let y = (top + bottom) * h;
    let z = (far + near) * p;

    te[0] = 2 * w; te[4] = 0; te[8] = 0; te[12] = -x;
    te[1] = 0; te[5] = 2 * h; te[9] = 0; te[13] = -y;
    te[2] = 0; te[6] = 0; te[10] = -2 * p; te[14] = -z;
    te[3] = 0; te[7] = 0; te[11] = 0; te[15] = 1;

    return this;
  }
};

const _zero = /*@__PURE__*/ new Vector3$1(0, 0, 0);
const _one = /*@__PURE__*/ new Vector3$1(1, 1, 1);
const _x = /*@__PURE__*/ new Vector3$1();
const _y = /*@__PURE__*/ new Vector3$1();
const _z = /*@__PURE__*/ new Vector3$1();


function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
}

let Color$1 = class Color {
  constructor(r, g, b) {
    this.isColor = true;
    this.r = 1;
    this.g = 1;
    this.b = 1;
    return this.set(r, g, b);
  }

  set(r, g, b) {
    if (g === undefined && b === undefined) {
      // r is THREE.Color, hex or string
      const value = r;
      if (value && value.isColor) {
        this.copy(value);
      } else if (typeof value === 'number') {
        this.setHex(value);
      }
    } else {
      this.setRGB(r, g, b);
    }
    return this;
  }

  setHex(hex) {
    hex = Math.floor(hex);
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
    return this;
  }

  setRGB(r, g, b) {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }

  setHSL(h, s, l) {
    // h,s,l ranges are in 0.0 - 1.0
    h = euclideanModulo(h, 1);
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);

    if (s === 0) {
      this.r = this.g = this.b = l;
    } else {
      const p = l <= 0.5 ? l * (1 + s) : l + s - l * s;
      const q = 2 * l - p;

      this.r = hue2rgb(q, p, h + 1 / 3);
      this.g = hue2rgb(q, p, h);
      this.b = hue2rgb(q, p, h - 1 / 3);
    }
    return this;
  }

  getHSL(target) {
    // h,s,l ranges are in 0.0 - 1.0

    const r = this.r, g = this.g, b = this.b;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    let hue, saturation;
    const lightness = (min + max) / 2.0;

    if (min === max) {
      hue = 0;
      saturation = 0;
    } else {
      const delta = max - min;

      saturation = lightness <= 0.5 ? delta / (max + min) : delta / (2 - max - min);

      switch (max) {
        case r:
          hue = (g - b) / delta + (g < b ? 6 : 0);
          break;
        case g:
          hue = (b - r) / delta + 2;
          break;
        case b:
          hue = (r - g) / delta + 4;
          break;
      }

      hue /= 6;
    }
    target.h = hue;
    target.s = saturation;
    target.l = lightness;

    return target;
  }

  clone() {
    return new this.constructor(this.r, this.g, this.b);
  }

  copy(color) {
    this.r = color.r;
    this.g = color.g;
    this.b = color.b;

    return this;
  }

  getHex() {
    return ( this.r * 255 ) << 16 ^ ( this.g * 255 ) << 8 ^ ( this.b * 255 ) << 0;
  }

  getHexString() {
    return ('000000' + this.getHex().toString(16)).slice(-6);
  }
};


//const _vector is already defined above
const _segCenter = /*@__PURE__*/ new Vector3$1();
const _segDir = /*@__PURE__*/ new Vector3$1();
const _diff = /*@__PURE__*/ new Vector3$1();

let Ray$1 = class Ray {
  constructor(origin = new Vector3$1(), direction = new Vector3$1(0, 0, -1)) {
    this.origin = origin;
    this.direction = direction;
  }

  copy(ray) {
    this.origin.copy(ray.origin);
    this.direction.copy(ray.direction);
    return this;
  }

  distanceSqToPoint(point) {
    const directionDistance = _vector.subVectors(point, this.origin).dot(this.direction);
    // point behind the ray
    if (directionDistance < 0) {
      return this.origin.distanceToSquared(point);
    }
    _vector.copy(this.origin).addScaledVector(this.direction, directionDistance);
    return _vector.distanceToSquared(point);
  }

  distanceSqToSegment(v0, v1, optionalPointOnRay, optionalPointOnSegment) {
    // from https://github.com/pmjoniak/GeometricTools/blob/master/GTEngine/Include/Mathematics/GteDistRaySegment.h
    // It returns the min distance between the ray and the segment
    // defined by v0 and v1
    // It can also set two optional targets :
    // - The closest point on the ray
    // - The closest point on the segment

    _segCenter.copy(v0).add(v1).multiplyScalar(0.5);
    _segDir.copy(v1).sub(v0).normalize();
    _diff.copy(this.origin).sub(_segCenter);

    const segExtent = v0.distanceTo(v1) * 0.5;
    const a01 = -this.direction.dot(_segDir);
    const b0 = _diff.dot(this.direction);
    const b1 = -_diff.dot(_segDir);
    const c = _diff.lengthSq();
    const det = Math.abs(1 - a01 * a01);
    let s0, s1, sqrDist, extDet;

    if (det > 0) {
      // The ray and segment are not parallel.

      s0 = a01 * b1 - b0;
      s1 = a01 * b0 - b1;
      extDet = segExtent * det;

      if (s0 >= 0) {
        if (s1 >= -extDet) {
          if (s1 <= extDet) {
            // region 0
            // Minimum at interior points of ray and segment.

            const invDet = 1 / det;
            s0 *= invDet;
            s1 *= invDet;
            sqrDist = s0 * (s0 + a01 * s1 + 2 * b0) + s1 * (a01 * s0 + s1 + 2 * b1) + c;
          } else {
            // region 1

            s1 = segExtent;
            s0 = Math.max(0, -(a01 * s1 + b0));
            sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
          }
        } else {
          // region 5

          s1 = -segExtent;
          s0 = Math.max(0, -(a01 * s1 + b0));
          sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
        }
      } else {
        if (s1 <= -extDet) {
          // region 4

          s0 = Math.max(0, -(-a01 * segExtent + b0));
          s1 = s0 > 0 ? -segExtent : Math.min(Math.max(-segExtent, -b1), segExtent);
          sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
        } else if (s1 <= extDet) {
          // region 3

          s0 = 0;
          s1 = Math.min(Math.max(-segExtent, -b1), segExtent);
          sqrDist = s1 * (s1 + 2 * b1) + c;
        } else {
          // region 2

          s0 = Math.max(0, -(a01 * segExtent + b0));
          s1 = s0 > 0 ? segExtent : Math.min(Math.max(-segExtent, -b1), segExtent);
          sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
        }
      }
    } else {
      // Ray and segment are parallel.

      s1 = a01 > 0 ? -segExtent : segExtent;
      s0 = Math.max(0, -(a01 * s1 + b0));
      sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
    }

    if (optionalPointOnRay) {
      optionalPointOnRay.copy(this.origin).addScaledVector(this.direction, s0);
    }

    if (optionalPointOnSegment) {
      optionalPointOnSegment.copy(_segCenter).addScaledVector(_segDir, s1);
    }

    return sqrDist;
  }

  applyMatrix4(matrix4) {
    this.origin.applyMatrix4(matrix4);
    this.direction.transformDirection(matrix4);
    return this;
  }
};

/* eslint-disable */
// @ts-nocheck
// Copyright 2010-2023 Three.js Authors
// SPDX-License-Identifier: MIT


// constants.js
let NoBlending = 0;
let NormalBlending = 1;

// core/EventDispatcher.js
class EventDispatcher {
  addEventListener(type, listener) {
    if (this._listeners === undefined) this._listeners = {};

    const listeners = this._listeners;

    if (listeners[type] === undefined) {
      listeners[type] = [];
    }

    if (listeners[type].indexOf(listener) === -1) {
      listeners[type].push(listener);
    }
  }

  removeEventListener(type, listener) {
    if (this._listeners === undefined) return;

    const listeners = this._listeners;
    const listenerArray = listeners[type];

    if (listenerArray !== undefined) {
      const index = listenerArray.indexOf(listener);

      if (index !== -1) {
        listenerArray.splice(index, 1);
      }
    }
  }

  dispatchEvent(event) {
    if (this._listeners === undefined) return;

    const listeners = this._listeners;
    const listenerArray = listeners[event.type];

    if (listenerArray !== undefined) {
      event.target = this;

      // Make a copy, in case listeners are removed while iterating.
      const array = listenerArray.slice(0);

      for (let i = 0, l = array.length; i < l; i++) {
        array[i].call(this, event);
      }

      event.target = null;
    }
  }
}

// textures/Source.js
let _sourceId = 0;
class Source {
  constructor(data = null) {
    Object.defineProperty(this, 'id', { value: _sourceId++ });
    this.uuid = generateUUID();
    this.data = data;
    this.dataReady = true;
    this.version = 0;
  }
  set needsUpdate( value ) {
    if (value === true) this.version++;
  }
}

// textures/Texture.js
let _textureId = 0;
let Texture$1 = class Texture extends EventDispatcher {
  constructor(image) {
    super();
    Object.defineProperty(this, 'id', { value: _textureId++ });
    this.uuid = generateUUID();
    this.name = '';
    this.source = new Source(image);
    this.version = 0;
  }

  get image() {
    return this.source.data;
  }

  set image(value) {
    this.source.data = value;
  }

  dispose() {
    this.dispatchEvent({ type: 'dispose' });
  }

  set needsUpdate(value) {
    if (value === true) {
      this.version++;
      this.source.needsUpdate = true;
    }
  }
};


// renderers/webgl/WebGLUniforms.js
/**
 * Uniforms of a program.
 * Those form a tree structure with a special top-level container for the root,
 * which you get by calling 'new WebGLUniforms( gl, program )'.
 *
 *
 * Properties of inner nodes including the top-level container:
 *
 * .seq - array of nested uniforms
 * .map - nested uniforms by name
 *
 *
 * Methods of all nodes except the top-level container:
 *
 * .setValue( gl, value, [textures] )
 *
 *              uploads a uniform value(s)
 *      the 'textures' parameter is needed for sampler uniforms
 *
 *
 * Static methods of the top-level container (textures factorizations):
 *
 * .upload( gl, seq, values, textures )
 *
 *              sets uniforms in 'seq' to 'values[id].value'
 *
 * .seqWithValue( seq, values ) : filteredSeq
 *
 *              filters 'seq' entries with corresponding entry in values
 *
 *
 * Methods of the top-level container (textures factorizations):
 *
 * .setValue( gl, name, value, textures )
 *
 *              sets uniform with  name 'name' to 'value'
 *
 * .setOptional( gl, obj, prop )
 *
 *              like .set for an optional property of the object
 *
 */
const emptyTexture = /*@__PURE__*/ new Texture$1();

// --- Utilities ---

// Float32Array caches used for uploading Matrix uniforms

const mat4array = new Float32Array(16);
const mat3array = new Float32Array(9);
const mat2array = new Float32Array(4);

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;

  for (let i = 0, l = a.length; i < l; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

function copyArray(a, b) {
  for (let i = 0, l = b.length; i < l; i++) {
    a[i] = b[i];
  }
}

// --- Setters ---

// Note: Defining these methods externally, because they come in a bunch
// and this way their names minify.

// Single scalar
function setValueV1f(gl, v) {
  const cache = this.cache;
  if (cache[0] === v) return;
  gl.uniform1f(this.addr, v);
  cache[0] = v;
}

// Single float vector (from flat array or THREE.VectorN)

function setValueV2f(gl, v) {
  const cache = this.cache;
  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y) {
      gl.uniform2f(this.addr, v.x, v.y);
      cache[0] = v.x;
      cache[1] = v.y;
    }
  } else {
    if (arraysEqual(cache, v)) return;
    gl.uniform2fv(this.addr, v);
    copyArray(cache, v);
  }
}

function setValueV3f(gl, v) {
  const cache = this.cache;

  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z) {
      gl.uniform3f(this.addr, v.x, v.y, v.z);
      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
    }
  } else if (v.r !== undefined) {
    if (cache[0] !== v.r || cache[1] !== v.g || cache[2] !== v.b) {
      gl.uniform3f(this.addr, v.r, v.g, v.b);
      cache[0] = v.r;
      cache[1] = v.g;
      cache[2] = v.b;
    }
  } else {
    if (arraysEqual(cache, v)) return;
    gl.uniform3fv(this.addr, v);
    copyArray(cache, v);
  }
}

function setValueV4f(gl, v) {
  const cache = this.cache;
  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z || cache[3] !== v.w) {
      gl.uniform4f(this.addr, v.x, v.y, v.z, v.w);
      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
      cache[3] = v.w;
    }
  } else {
    if (arraysEqual(cache, v)) return;
    gl.uniform4fv(this.addr, v);
    copyArray(cache, v);
  }
}

// Single matrix (from flat array or THREE.MatrixN)

function setValueM2(gl, v) {
  const cache = this.cache;
  const elements = v.elements;

  if (elements === undefined) {
    if (arraysEqual(cache, v)) return;
    gl.uniformMatrix2fv(this.addr, false, v);
    copyArray(cache, v);
  } else {
    if (arraysEqual(cache, elements)) return;
    mat2array.set(elements);
    gl.uniformMatrix2fv(this.addr, false, mat2array);
    copyArray(cache, elements);
  }
}

function setValueM3(gl, v) {
  const cache = this.cache;
  const elements = v.elements;
  if (elements === undefined) {
    if (arraysEqual(cache, v)) return;
    gl.uniformMatrix3fv(this.addr, false, v);
    copyArray(cache, v);
  } else {
    if (arraysEqual(cache, elements)) return;
    mat3array.set(elements);
    gl.uniformMatrix3fv(this.addr, false, mat3array);
    copyArray(cache, elements);
  }
}

function setValueM4(gl, v) {
  const cache = this.cache;
  const elements = v.elements;
  if (elements === undefined) {
    if (arraysEqual(cache, v)) return;
    gl.uniformMatrix4fv(this.addr, false, v);
    copyArray(cache, v);
  } else {
    if (arraysEqual(cache, elements)) return;
    mat4array.set(elements);
    gl.uniformMatrix4fv(this.addr, false, mat4array);
    copyArray(cache, elements);
  }
}

// Single integer / boolean

function setValueV1i(gl, v) {
  const cache = this.cache;
  if (cache[0] === v) return;
  gl.uniform1i(this.addr, v);
  cache[0] = v;
}

// Single integer / boolean vector (from flat array or THREE.VectorN)

function setValueV2i(gl, v) {
  const cache = this.cache;
  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y) {
      gl.uniform2i(this.addr, v.x, v.y);
      cache[0] = v.x;
      cache[1] = v.y;
    }
  } else {
    if (arraysEqual(cache, v)) return;
    gl.uniform2iv(this.addr, v);
    copyArray(cache, v);
  }
}

function setValueV3i(gl, v) {
  const cache = this.cache;
  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z) {
      gl.uniform3i(this.addr, v.x, v.y, v.z);
      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
    }
  } else {
    if (arraysEqual(cache, v)) return;
    gl.uniform3iv(this.addr, v);
    copyArray(cache, v);
  }
}

function setValueV4i(gl, v) {
  const cache = this.cache;
  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z || cache[3] !== v.w) {
      gl.uniform4i(this.addr, v.x, v.y, v.z, v.w);
      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
      cache[3] = v.w;
    }
  } else {
    if (arraysEqual(cache, v)) return;
    gl.uniform4iv(this.addr, v);
    copyArray(cache, v);
  }
}

// Single unsigned integer
function setValueV1ui(gl, v) {
  const cache = this.cache;

  if (cache[0] === v) return;

  gl.uniform1ui(this.addr, v);

  cache[0] = v;
}

// Single unsigned integer vector (from flat array or THREE.VectorN)

function setValueV2ui(gl, v) {
  const cache = this.cache;
  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y) {
      gl.uniform2ui(this.addr, v.x, v.y);

      cache[0] = v.x;
      cache[1] = v.y;
    }
  } else {
    if (arraysEqual(cache, v)) return;
    gl.uniform2uiv(this.addr, v);
    copyArray(cache, v);
  }
}

function setValueV3ui(gl, v) {
  const cache = this.cache;
  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z) {
      gl.uniform3ui(this.addr, v.x, v.y, v.z);
      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
    }
  } else {
    if (arraysEqual(cache, v)) return;
    gl.uniform3uiv(this.addr, v);
    copyArray(cache, v);
  }
}

function setValueV4ui(gl, v) {
  const cache = this.cache;
  if (v.x !== undefined) {
    if (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z || cache[3] !== v.w) {
      gl.uniform4ui(this.addr, v.x, v.y, v.z, v.w);

      cache[0] = v.x;
      cache[1] = v.y;
      cache[2] = v.z;
      cache[3] = v.w;
    }
  } else {
    if (arraysEqual(cache, v)) return;
    gl.uniform4uiv(this.addr, v);
    copyArray(cache, v);
  }
}

// Single texture (2D / Cube)

function setValueT1(gl, v, textures) {
  const cache = this.cache;
  const unit = textures.allocateTextureUnit();

  if (cache[0] !== unit) {
    gl.uniform1i(this.addr, unit);
    cache[0] = unit;
  }
  const emptyTexture2D = emptyTexture;
  textures.setTexture2D(v || emptyTexture2D, unit);
}

// Helper to pick the right setter for the singular case
function getSingularSetter(type) {
  switch (type) {
    case 0x1406: return setValueV1f; // FLOAT
    case 0x8b50: return setValueV2f; // _VEC2
    case 0x8b51: return setValueV3f; // _VEC3
    case 0x8b52: return setValueV4f; // _VEC4

    case 0x8b5a: return setValueM2; // _MAT2
    case 0x8b5b: return setValueM3; // _MAT3
    case 0x8b5c: return setValueM4; // _MAT4

    case 0x1404: case 0x8b56: return setValueV1i; // INT, BOOL
    case 0x8b53: case 0x8b57: return setValueV2i; // _VEC2
    case 0x8b54: case 0x8b58: return setValueV3i; // _VEC3
    case 0x8b55: case 0x8b59: return setValueV4i; // _VEC4

    case 0x1405: return setValueV1ui; // UINT
    case 0x8dc6: return setValueV2ui; // _VEC2
    case 0x8dc7: return setValueV3ui; // _VEC3
    case 0x8dc8: return setValueV4ui; // _VEC4

    case 0x8b5e: // SAMPLER_2D
    case 0x8d66: // SAMPLER_EXTERNAL_OES
    case 0x8dca: // INT_SAMPLER_2D
    case 0x8dd2: // UNSIGNED_INT_SAMPLER_2D
      return setValueT1;
  }
}

// --- Uniform Classes ---

class SingleUniform {
  constructor(id, activeInfo, addr) {
    this.id = id;
    this.addr = addr;
    this.cache = [];
    this.type = activeInfo.type;
    this.setValue = getSingularSetter(activeInfo.type);
    // this.path = activeInfo.name; // DEBUG
  }
}

class StructuredUniform {
  constructor(id) {
    this.id = id;
    this.seq = [];
    this.map = {};
  }
  setValue(gl, value, textures) {
    const seq = this.seq;
    for (let i = 0, n = seq.length; i !== n; ++i) {
      const u = seq[i];
      u.setValue(gl, value[u.id], textures);
    }
  }
}


// --- Top-level ---

// Parser - builds up the property tree from the path strings

const RePathPart = /(\w+)(\])?(\[|\.)?/g;

// extracts
//  - the identifier (member name or array index)
//  - followed by an optional right bracket (found when array index)
//  - followed by an optional left bracket or dot (type of subscript)
//
// Note: These portions can be read in a non-overlapping fashion and
// allow straightforward parsing of the hierarchy that WebGL encodes
// in the uniform names.

function addUniform(container, uniformObject) {
  container.seq.push(uniformObject);
  container.map[uniformObject.id] = uniformObject;
}

function parseUniform(activeInfo, addr, container) {
  const path = activeInfo.name,
    pathLength = path.length;
  // reset RegExp object, because of the early exit of a previous run
  RePathPart.lastIndex = 0;
  while (true) {
    const match = RePathPart.exec(path),
      matchEnd = RePathPart.lastIndex;
    let id = match[1];
    const idIsIndex = match[2] === ']',
      subscript = match[3];
    if (idIsIndex) id = id | 0; // convert to integer
    if (subscript === undefined || (subscript === '[' && matchEnd + 2 === pathLength)) {
      // bare name or "pure" bottom-level array "[0]" suffix
      if (subscript !== undefined) throw new TypeError('PureArrayUniform?');
      addUniform(container, new SingleUniform(id, activeInfo, addr));
      break;
    } else {
      // step into inner node / create it in case it doesn't exist
      const map = container.map;
      let next = map[id];
      if (next === undefined) {
        next = new StructuredUniform(id);
        addUniform(container, next);
      }
      container = next;
    }
  }
}

// Root Container

class WebGLUniforms {
  constructor(gl, program) {
    this.seq = [];
    this.map = {};
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);

    for (let i = 0; i < n; ++i) {
      const info = gl.getActiveUniform(program, i),
        addr = gl.getUniformLocation(program, info.name);
      parseUniform(info, addr, this);
    }
  }

  setValue(gl, name, value, textures) {
    const u = this.map[name];
    if (u !== undefined) u.setValue(gl, value, textures);
  }

  setOptional(gl, object, name) {
    const v = object[name];
    if (v !== undefined) this.setValue(gl, name, v);
  }

  static upload(gl, seq, values, textures) {
    for (let i = 0, n = seq.length; i !== n; ++i) {
      const u = seq[i],
        v = values[u.id];
      if (v.needsUpdate !== false) {
        // note: always updating when .needsUpdate is undefined
        u.setValue(gl, v.value, textures);
      }
    }
  }

  static seqWithValue(seq, values) {
    const r = [];
    for (let i = 0, n = seq.length; i !== n; ++i) {
      const u = seq[i];
      if (u.id in values) r.push(u);
    }
    return r;
  }
}



// materials/Material.js
let _materialId = 0;

class Material extends EventDispatcher {
  constructor() {
    super();
    Object.defineProperty(this, 'id', { value: _materialId++ });
    this.uuid = generateUUID();
    this.name = '';
    this.type = 'Material';

    this.opacity = 1;
    this.transparent = false;

    this.depthTest = true;
    this.depthWrite = true;

    this.precision = null; // override the renderer's default precision for this material

    this.premultipliedAlpha = false;

    this.visible = true;

    //TODO
    //this.version = 0;
    this._needsUpdate = true;
  }

  setValues(values) {
    if (values === undefined) return;

    for (const key in values) {
      const newValue = values[key];
      if (newValue === undefined) {
        console.warn(`THREE.Material: parameter '${key}' has value of undefined.`);
        continue;
      }
      const currentValue = this[key];
      if (currentValue === undefined) {
        console.warn(`THREE.Material: '${key}' is not a property of THREE.${this.type}.`);
        continue;
      }
      if (currentValue && currentValue.isColor) {
        currentValue.set(newValue);
      } else if (currentValue && currentValue.isVector3 && newValue && newValue.isVector3) {
        currentValue.copy(newValue);
      } else {
        this[key] = newValue;
      }
    }
  }

  dispose() {
    this.dispatchEvent({ type: 'dispose' });
  }

  //TODO
  //set needsUpdate(value) {
  //  if (value === true) this.version++;
  //}
  //old:
  get needsUpdate() {
    return this._needsUpdate;
  }
  set needsUpdate(value) {
    if ( value === true ) this.update();
    this._needsUpdate = value;
  }
  update() {
    this.dispatchEvent( { type: 'update' } );
  }
}
Material.prototype.isMaterial = true;

// materials/ShaderMaterial.js
let ShaderMaterial$1 = class ShaderMaterial extends Material {
  constructor(parameters) {
    super();
    this.type = 'ShaderMaterial';
    this.uniforms = {};
    this.vertexShader = '';
    this.fragmentShader = '';
    this.linewidth = 1;
    this.fog = false; // set to use scene fog

    this.extensions = {
      fragDepth: false, // set to use fragment depth values
    };

    this.setValues(parameters);
  }
};
ShaderMaterial$1.prototype.isShaderMaterial = true;


// core/Object3D.js
let _object3DId = 0;

const _addedEvent = { type: 'added' };
const _removedEvent = { type: 'removed' };

let Object3D$1 = class Object3D extends EventDispatcher {
  constructor() {
    super();

    Object.defineProperty(this, 'id', { value: _object3DId++ });

    this.uuid = generateUUID();

    this.name = '';
    this.type = 'Object3D';

    this.parent = null;
    this.children = [];

    this.up = Object3D.DEFAULT_UP.clone();

    const position = new Vector3$1();
    //const rotation = new Euler();
    const quaternion = new Quaternion$1();
    const scale = new Vector3$1(1, 1, 1);

    //function onRotationChange() {
    //  quaternion.setFromEuler(rotation, false);
    //}
    //function onQuaternionChange() {
    //  rotation.setFromQuaternion(quaternion, undefined, false);
    //}
    //rotation._onChange(onRotationChange);
    //quaternion._onChange(onQuaternionChange);

    Object.defineProperties(this, {
      position: {
        configurable: true,
        enumerable: true,
        value: position,
      },
      //rotation: {
      //  configurable: true,
      //  enumerable: true,
      //  value: rotation,
      //},
      quaternion: {
        configurable: true,
        enumerable: true,
        value: quaternion,
      },
      scale: {
        configurable: true,
        enumerable: true,
        value: scale,
      },
      modelViewMatrix: {
        value: new Matrix4$1(),
      },
      //normalMatrix: {
      //  value: new Matrix3(),
      //},
    });

    this.matrix = new Matrix4$1();
    this.matrixWorld = new Matrix4$1();

    this.matrixAutoUpdate = Object3D.DEFAULT_MATRIX_AUTO_UPDATE;

    this.matrixWorldAutoUpdate = Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE; // checked by the renderer
    this.matrixWorldNeedsUpdate = false;

    //this.layers = new Layers();
    this.visible = true;

    //this.castShadow = false;
    //this.receiveShadow = false;

    this.frustumCulled = true;
    this.renderOrder = 0;

    //this.animations = [];

    this.userData = {};
  }

  add(object) {
    if (arguments.length > 1) {
      for (let i = 0; i < arguments.length; i++) {
        this.add(arguments[i]);
      }
      return this;
    }
    if (object && object.isObject3D) {
      if (object.parent !== null) {
        object.parent.remove(object);
      }
      object.parent = this;
      this.children.push(object);
      object.dispatchEvent(_addedEvent);
    }
    return this;
  }

  remove(object) {
    if (arguments.length > 1) {
      for (let i = 0; i < arguments.length; i++) {
        this.remove(arguments[i]);
      }
      return this;
    }

    const index = this.children.indexOf(object);
    if (index !== -1) {
      object.parent = null;
      this.children.splice(index, 1);
      object.dispatchEvent(_removedEvent);
    }
    return this;
  }

  updateMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.matrixWorldNeedsUpdate = true;
  }

  updateMatrixWorld(force) {
    if (this.matrixAutoUpdate) this.updateMatrix();

    if (this.matrixWorldNeedsUpdate || force) {
      if (this.parent === null) {
        this.matrixWorld.copy(this.matrix);
      } else {
        this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }

    // update children
    const children = this.children;
    for (let i = 0, l = children.length; i < l; i++) {
      const child = children[i];
      //if (child.matrixWorldAutoUpdate === true || force === true) {
      child.updateMatrixWorld(force);
      //}
    }
  }
};

Object3D$1.prototype.isObject3D = true;
Object3D$1.DEFAULT_UP = /*@__PURE__*/ new Vector3$1(0, 1, 0);
Object3D$1.DEFAULT_MATRIX_AUTO_UPDATE = true;
Object3D$1.DEFAULT_MATRIX_WORLD_AUTO_UPDATE = true;



// core/BufferAttribute.js
let BufferAttribute$1 = class BufferAttribute {
  constructor(array, itemSize, normalized = false) {
    if (Array.isArray(array)) {
      throw new TypeError('BufferAttribute: array should be a Typed Array.');
    }

    this.array = array;
    this.itemSize = itemSize;
    this.count = array !== undefined ? array.length / itemSize : 0;
    this.normalized = normalized;

    // FIXME: new variables
    //this.usage = StaticDrawUsage;
    //this._updateRange = { offset: 0, count: -1 };
    //this.updateRanges = [];
    //this.gpuType = FloatType;
    // FIXME: old variables
    this.dynamic = false;
    this.updateRange = { offset: 0, count: -1 };
    this.uuid = generateUUID();

    this.version = 0;
  }

  onUploadCallback() {}
};
BufferAttribute$1.prototype.isBufferAttribute = true;


// core/BufferGeometry.js
let _id = 0;

let BufferGeometry$1 = class BufferGeometry extends EventDispatcher {
  constructor() {
    super();
    Object.defineProperty(this, 'id', { value: _id++ });
    this.uuid = generateUUID();
    this.name = '';
    this.type = 'BufferGeometry';
    this.index = null;
    this.attributes = {};
    this.groups = [];
    this.boundingBox = null;
    this.boundingSphere = null;
    this.drawRange = { start: 0, count: Infinity };
  }

  getIndex() {
    return this.index;
  }

  setIndex(index) {
    this.index = index;
  }

  setAttribute(name, attribute) {
    this.attributes[name] = attribute;
    return this;
  }

  dispose() {
    this.dispatchEvent({ type: 'dispose' });
  }
};
BufferGeometry$1.prototype.isBufferGeometry = true;


// objects/Mesh.js
let Mesh$1 = class Mesh extends Object3D$1 {
  constructor(geometry, material) {
    super();
    this.type = 'Mesh';

    if (!geometry) throw new TypeError('Mesh: geometry not set');
    this.geometry = geometry;
    this.material = material;
  }
};
Mesh$1.prototype.isMesh = true;


// cameras/Camera.js
class Camera extends Object3D$1 {
  constructor() {
    super();
    this.type = 'Camera';
    this.matrixWorldInverse = new Matrix4$1();
    this.projectionMatrix = new Matrix4$1();
    this.projectionMatrixInverse = new Matrix4$1();
    //this.coordinateSystem = WebGLCoordinateSystem;
  }

  // FIXME
  //updateMatrixWorld(force) {
  //  super.updateMatrixWorld(force);
  //  this.matrixWorldInverse.copy(this.matrixWorld).invert();
  //}

  //updateWorldMatrix(updateParents, updateChildren) {
  //  super.updateWorldMatrix(updateParents, updateChildren);
  //  this.matrixWorldInverse.copy(this.matrixWorld).invert();
  //}
}
Camera.prototype.isCamera = true;

// cameras/OrthographicCamera.js
let OrthographicCamera$1 = class OrthographicCamera extends Camera {
  constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 2000) {
    super();
    this.type = 'OrthographicCamera';
    this.zoom = 1;
    //this.view = null;
    this.left = left;
    this.right = right;
    this.top = top;
    this.bottom = bottom;
    this.near = near;
    this.far = far;
    this.updateProjectionMatrix();
  }

  updateProjectionMatrix() {
    const dx = (this.right - this.left) / (2 * this.zoom);
    const dy = (this.top - this.bottom) / (2 * this.zoom);
    const cx = (this.right + this.left) / 2;
    const cy = (this.top + this.bottom) / 2;

    let left = cx - dx;
    let right = cx + dx;
    let top = cy + dy;
    let bottom = cy - dy;

    this.projectionMatrix.makeOrthographic(left, right, top, bottom, this.near, this.far);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
};


// renderers/webgl/WebGLIndexedBufferRenderer.js (not updated)
function WebGLIndexedBufferRenderer( gl, extensions, infoRender ) {
  let mode;

  function setMode( value ) {
    mode = value;
  }

  let type, size;

  function setIndex( index ) {
    if ( index.array instanceof Uint32Array && extensions.get( 'OES_element_index_uint' ) ) {
      type = gl.UNSIGNED_INT;
      size = 4;
    } else if ( index.array instanceof Uint16Array ) {
      type = gl.UNSIGNED_SHORT;
      size = 2;
    } else {
      type = gl.UNSIGNED_BYTE;
      size = 1;
    }
  }

  function render( start, count ) {
    gl.drawElements( mode, count, type, start * size );

    infoRender.calls ++;
    infoRender.vertices += count;

    if ( mode === gl.TRIANGLES ) infoRender.faces += count / 3;
  }

  return {
    setMode: setMode,
    setIndex: setIndex,
    render: render,
  };
}


// renderers/webgl/WebGLBufferRenderer.js (not updated)
function WebGLBufferRenderer( gl, extensions, infoRender ) {
  let mode;

  function setMode( value ) {
    mode = value;
  }

  function render( start, count ) {
    gl.drawArrays( mode, start, count );

    infoRender.calls ++;
    infoRender.vertices += count;

    if ( mode === gl.TRIANGLES ) infoRender.faces += count / 3;
  }

  return {
    setMode: setMode,
    render: render,
  };
}


// renderers/webgl/WebGLShader.js (not updated)
function WebGLShader( gl, type, string ) {
  let shader = gl.createShader( type );

  gl.shaderSource( shader, string );
  gl.compileShader( shader );

  if ( gl.getShaderParameter( shader, gl.COMPILE_STATUS ) === false ) {
    console.error( 'WebGLShader: Shader couldn\'t compile.' );
  }

  if ( gl.getShaderInfoLog( shader ) !== '' ) {
    let info = gl.getShaderInfoLog( shader );
    // workaround for https://github.com/mrdoob/three.js/issues/9716
    if (info.indexOf('GL_ARB_gpu_shader5') === -1) {
      console.warn( 'WebGLShader: gl.getShaderInfoLog()', type === gl.VERTEX_SHADER ? 'vertex' : 'fragment', info, string );
    }
  }

  return shader;
}


// renderers/webgl/WebGLProgram.js (not updated)
let programIdCount = 0;

function generateExtensions( extensions, parameters, rendererExtensions ) {
  extensions = extensions || {};

  let chunks = [
  ( extensions.fragDepth ) && rendererExtensions.get( 'EXT_frag_depth' ) ? '#extension GL_EXT_frag_depth : enable' : '',
  ];

  return chunks.join( '\n' );
}

function fetchAttributeLocations( gl, program ) {
  let attributes = {};

  let n = gl.getProgramParameter( program, gl.ACTIVE_ATTRIBUTES );

  for ( let i = 0; i < n; i ++ ) {
    let info = gl.getActiveAttrib( program, i );
    let name = info.name;

    // console.log("WebGLProgram: ACTIVE VERTEX ATTRIBUTE:", name, i );

    attributes[name] = gl.getAttribLocation( program, name );
  }

  return attributes;
}

function WebGLProgram( renderer, code, material, parameters ) {
  let gl = renderer.context;

  let extensions = material.extensions;

  let vertexShader = material.__webglShader.vertexShader;
  let fragmentShader = material.__webglShader.fragmentShader;

  // console.log( 'building new program ' );

  //

  let customExtensions = generateExtensions( extensions, parameters, renderer.extensions );

  //

  let program = gl.createProgram();

  let prefixVertex, prefixFragment;

  prefixVertex = [
    'precision ' + parameters.precision + ' float;',
    'precision ' + parameters.precision + ' int;',
    '#define SHADER_NAME ' + material.__webglShader.name,
    'uniform mat4 modelMatrix;',
    'uniform mat4 modelViewMatrix;',
    'uniform mat4 projectionMatrix;',
    'uniform mat4 viewMatrix;',
    'attribute vec3 position;',
    '',
  ].join( '\n' );

  prefixFragment = [
    customExtensions,
    'precision ' + parameters.precision + ' float;',
    'precision ' + parameters.precision + ' int;',
    '#define SHADER_NAME ' + material.__webglShader.name,
    ( parameters.useFog && parameters.fog ) ? '#define USE_FOG' : '',
    '',
  ].join( '\n' );

  let vertexGlsl = prefixVertex + vertexShader;
  let fragmentGlsl = prefixFragment + fragmentShader;

  // console.log( '*VERTEX*', vertexGlsl );
  // console.log( '*FRAGMENT*', fragmentGlsl );

  let glVertexShader = WebGLShader( gl, gl.VERTEX_SHADER, vertexGlsl );
  let glFragmentShader = WebGLShader( gl, gl.FRAGMENT_SHADER, fragmentGlsl );

  gl.attachShader( program, glVertexShader );
  gl.attachShader( program, glFragmentShader );

  gl.linkProgram( program );

  let programLog = gl.getProgramInfoLog( program );
  let vertexLog = gl.getShaderInfoLog( glVertexShader );
  let fragmentLog = gl.getShaderInfoLog( glFragmentShader );

  // console.log( '**VERTEX**', gl.getExtension( 'WEBGL_debug_shaders' ).getTranslatedShaderSource( glVertexShader ) );
  // console.log( '**FRAGMENT**', gl.getExtension( 'WEBGL_debug_shaders' ).getTranslatedShaderSource( glFragmentShader ) );

  if ( gl.getProgramParameter( program, gl.LINK_STATUS ) === false ) {
    console.error( 'WebGLProgram: shader error: ', gl.getError(), 'gl.VALIDATE_STATUS', gl.getProgramParameter( program, gl.VALIDATE_STATUS ), 'gl.getProgramInfoLog', programLog, vertexLog, fragmentLog );
  } else if ( programLog !== '' ) {
    console.warn( 'WebGLProgram: gl.getProgramInfoLog()', programLog );
  }

  // clean up

  gl.deleteShader( glVertexShader );
  gl.deleteShader( glFragmentShader );

  // set up caching for uniform locations

  let cachedUniforms;

  this.getUniforms = function () {
    if ( cachedUniforms === undefined ) {
      cachedUniforms = new WebGLUniforms( gl, program );
    }

    return cachedUniforms;
  };

  // set up caching for attribute locations

  let cachedAttributes;

  this.getAttributes = function () {
    if ( cachedAttributes === undefined ) {
      cachedAttributes = fetchAttributeLocations( gl, program );
    }

    return cachedAttributes;
  };

  // free resource

  this.destroy = function () {
    gl.deleteProgram( program );
    this.program = undefined;
  };

  //

  this.id = programIdCount ++;
  this.code = code;
  this.usedTimes = 1;
  this.program = program;
  this.vertexShader = glVertexShader;
  this.fragmentShader = glFragmentShader;

  return this;
}


function WebGLPrograms( renderer, capabilities ) {
  let programs = [];

  let parameterNames = [
    'precision',
    'fog', 'useFog',
    'premultipliedAlpha',
  ];

  this.getParameters = function ( material, fog ) {
    let precision = renderer.getPrecision();

    if ( material.precision !== null ) {
      precision = capabilities.getMaxPrecision( material.precision );

      if ( precision !== material.precision ) {
        console.warn( 'WebGLProgram.getParameters:', material.precision, 'not supported, using', precision, 'instead.' );
      }
    }

    let parameters = {
      precision: precision,
      fog: !! fog,
      useFog: material.fog,
      premultipliedAlpha: material.premultipliedAlpha,
    };

    return parameters;
  };

  this.getProgramCode = function ( material, parameters ) {
    let array = [];

    array.push( material.fragmentShader );
    array.push( material.vertexShader );

    for ( let i = 0; i < parameterNames.length; i ++ ) {
      array.push( parameters[parameterNames[i]] );
    }

    return array.join();
  };

  this.acquireProgram = function ( material, parameters, code ) {
    let program;

    // Check if code has been already compiled
    for ( let p = 0, pl = programs.length; p < pl; p ++ ) {
      let programInfo = programs[p];

      if ( programInfo.code === code ) {
        program = programInfo;
        ++ program.usedTimes;

        break;
      }
    }

    if ( program === undefined ) {
      program = new WebGLProgram( renderer, code, material, parameters );
      programs.push( program );
    }

    return program;
  };

  this.releaseProgram = function ( program ) {
    if ( -- program.usedTimes === 0 ) {
      // Remove from unordered set
      let i = programs.indexOf( program );
      programs[i] = programs[programs.length - 1];
      programs.pop();

      // Free WebGL resources
      program.destroy();
    }
  };

  // Exposed for resource monitoring & error feedback via renderer.info:
  this.programs = programs;
}


// renderers/webgl/WebGLGeometries.js (not updated)
function WebGLGeometries( gl, properties ) {
  let geometries = {};

  function onGeometryDispose( event ) {
    let geometry = event.target;
    let buffergeometry = geometries[geometry.id];

    if ( buffergeometry.index !== null ) {
      deleteAttribute( buffergeometry.index );
    }

    deleteAttributes( buffergeometry.attributes );

    geometry.removeEventListener( 'dispose', onGeometryDispose );

    delete geometries[geometry.id];

    properties.delete( geometry );

    properties.delete( buffergeometry );
  }

  function getAttributeBuffer( attribute ) {
    return properties.get( attribute ).__webglBuffer;
  }

  function deleteAttribute( attribute ) {
    let buffer = getAttributeBuffer( attribute );

    if ( buffer !== undefined ) {
      gl.deleteBuffer( buffer );
      removeAttributeBuffer( attribute );
    }
  }

  function deleteAttributes( attributes ) {
    for ( let name in attributes ) {
      deleteAttribute( attributes[name] );
    }
  }

  function removeAttributeBuffer( attribute ) {
    properties.delete( attribute );
  }

  return {

    get: function ( object ) {
      let geometry = object.geometry;

      if ( geometries[geometry.id] !== undefined ) {
        return geometries[geometry.id];
      }

      geometry.addEventListener( 'dispose', onGeometryDispose );

      let buffergeometry;

      if ( geometry.isBufferGeometry ) {
        buffergeometry = geometry;
      }

      geometries[geometry.id] = buffergeometry;

      return buffergeometry;
    },

  };
}


// renderers/webgl/WebGLObjects.js (not updated)
function WebGLObjects( gl, properties, info ) {
  let geometries = new WebGLGeometries( gl, properties);

  //

  function update( object ) {
    let geometry = geometries.get( object );

    let index = geometry.index;
    let attributes = geometry.attributes;

    if ( index !== null ) {
      updateAttribute( index, gl.ELEMENT_ARRAY_BUFFER );
    }

    for ( let name in attributes ) {
      updateAttribute( attributes[name], gl.ARRAY_BUFFER );
    }

    return geometry;
  }

  function updateAttribute( attribute, bufferType ) {
    let data = attribute;

    let attributeProperties = properties.get( data );

    if ( attributeProperties.__webglBuffer === undefined ) {
      createBuffer( attributeProperties, data, bufferType );
    } else if ( attributeProperties.version !== data.version ) {
      updateBuffer( attributeProperties, data, bufferType );
    }
  }

  function createBuffer( attributeProperties, data, bufferType ) {
    attributeProperties.__webglBuffer = gl.createBuffer();
    gl.bindBuffer( bufferType, attributeProperties.__webglBuffer );

    let usage = data.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;

    gl.bufferData( bufferType, data.array, usage );

    let type = gl.FLOAT;
    let array = data.array;

    if ( array instanceof Float32Array ) {
      type = gl.FLOAT;
    } else if ( array instanceof Float64Array ) {
      console.warn( 'Unsupported data buffer format: Float64Array' );
    } else if ( array instanceof Uint16Array ) {
      type = gl.UNSIGNED_SHORT;
    } else if ( array instanceof Int16Array ) {
      type = gl.SHORT;
    } else if ( array instanceof Uint32Array ) {
      type = gl.UNSIGNED_INT;
    } else if ( array instanceof Int32Array ) {
      type = gl.INT;
    } else if ( array instanceof Int8Array ) {
      type = gl.BYTE;
    } else if ( array instanceof Uint8Array ) {
      type = gl.UNSIGNED_BYTE;
    }

    attributeProperties.bytesPerElement = array.BYTES_PER_ELEMENT;
    attributeProperties.type = type;
    attributeProperties.version = data.version;

    data.onUploadCallback();
  }

  function updateBuffer( attributeProperties, data, bufferType ) {
    gl.bindBuffer( bufferType, attributeProperties.__webglBuffer );

    if ( data.dynamic === false ) {
      gl.bufferData( bufferType, data.array, gl.STATIC_DRAW );
    } else if ( data.updateRange.count === -1 ) {
      // Not using update ranges

      gl.bufferSubData( bufferType, 0, data.array );
    } else if ( data.updateRange.count === 0 ) {
      console.error( 'WebGLObjects.updateBuffer: updateRange.count is 0.' );
    } else {
      gl.bufferSubData( bufferType, data.updateRange.offset * data.array.BYTES_PER_ELEMENT,
                        data.array.subarray( data.updateRange.offset, data.updateRange.offset + data.updateRange.count ) );

      data.updateRange.count = 0; // reset range
    }

    attributeProperties.version = data.version;
  }

  function getAttributeBuffer( attribute ) {
    return properties.get( attribute ).__webglBuffer;
  }

  function getAttributeProperties( attribute ) {
    return properties.get( attribute );
  }


  return {

    getAttributeBuffer: getAttributeBuffer,
    getAttributeProperties: getAttributeProperties,

    update: update,

  };
}


// renderers/webgl/WebGLTextures.js (not updated)
function WebGLTextures( _gl, extensions, state, properties, capabilities ) {
  function onTextureDispose( event ) {
    let texture = event.target;

    texture.removeEventListener( 'dispose', onTextureDispose );

    deallocateTexture( texture );
  }

  //

  function deallocateTexture( texture ) {
    let textureProperties = properties.get( texture );

    // 2D texture

    if ( textureProperties.__webglInit === undefined ) return;

    _gl.deleteTexture( textureProperties.__webglTexture );

    // remove all webgl properties
    properties.delete( texture );
  }

  let textureUnits = 0;

  function resetTextureUnits() {
    textureUnits = 0;
  }

  function allocateTextureUnit() {
    const textureUnit = textureUnits;
    if (textureUnit >= capabilities.maxTextures) {
      console.warn('WebGLTextures: Trying to use ' + textureUnit +
                   ' texture units while this GPU supports only ' + capabilities.maxTextures);
    }
    textureUnits += 1;
    return textureUnit;
  }

  function setTexture2D( texture, slot ) {
    let textureProperties = properties.get( texture );

    if ( texture.version > 0 && textureProperties.__version !== texture.version ) {
      let image = texture.image;

      if ( image === undefined ) {
        console.warn( 'WebGLRenderer: Texture marked for update but image is undefined', texture );
      } else if ( image.complete === false ) {
        console.warn( 'WebGLRenderer: Texture marked for update but image is incomplete', texture );
      } else {
        uploadTexture( textureProperties, texture, slot );
        return;
      }
    }

    state.activeTexture( _gl.TEXTURE0 + slot );
    state.bindTexture( _gl.TEXTURE_2D, textureProperties.__webglTexture );
  }

  function setTextureParameters( textureType ) {
    _gl.texParameteri( textureType, _gl.TEXTURE_WRAP_S, _gl.CLAMP_TO_EDGE );
    _gl.texParameteri( textureType, _gl.TEXTURE_WRAP_T, _gl.CLAMP_TO_EDGE );
    _gl.texParameteri( textureType, _gl.TEXTURE_MAG_FILTER, _gl.LINEAR );
    _gl.texParameteri( textureType, _gl.TEXTURE_MIN_FILTER, _gl.LINEAR_MIPMAP_LINEAR );
  }

  function uploadTexture( textureProperties, texture, slot ) {
    if ( textureProperties.__webglInit === undefined ) {
      textureProperties.__webglInit = true;

      texture.addEventListener( 'dispose', onTextureDispose );

      textureProperties.__webglTexture = _gl.createTexture();
    }

    state.activeTexture( _gl.TEXTURE0 + slot );
    state.bindTexture( _gl.TEXTURE_2D, textureProperties.__webglTexture );

    _gl.pixelStorei( _gl.UNPACK_FLIP_Y_WEBGL, true );
    _gl.pixelStorei( _gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false );
    _gl.pixelStorei( _gl.UNPACK_ALIGNMENT, 4 );

    let image = texture.image;

    let glFormat = _gl.RGBA;
    let glType = _gl.UNSIGNED_BYTE;

    setTextureParameters( _gl.TEXTURE_2D );

    state.texImage2D( _gl.TEXTURE_2D, 0, glFormat, glFormat, glType, image );

    _gl.generateMipmap( _gl.TEXTURE_2D );

    textureProperties.__version = texture.version;
  }

  this.setTexture2D = setTexture2D;
  this.resetTextureUnits = resetTextureUnits;
  this.allocateTextureUnit = allocateTextureUnit;
}


// renderers/webgl/WebGLProperties.js (not updated)
function WebGLProperties() {
  let properties = {};

  return {

    get: function ( object ) {
      let uuid = object.uuid;
      let map = properties[uuid];

      if ( map === undefined ) {
        map = {};
        properties[uuid] = map;
      }

      return map;
    },

    delete: function ( object ) {
      delete properties[object.uuid];
    },

    clear: function () {
      properties = {};
    }
  };
}


// renderers/webgl/WebGLState.js (not updated)
function WebGLState( gl ) {
  function ColorBuffer() {
    let color = new Vector4();
    let currentColorClear = new Vector4();

    return {

      setClear: function ( r, g, b, a, premultipliedAlpha ) {
        if ( premultipliedAlpha === true ) {
          r *= a; g *= a; b *= a;
        }
        color.set( r, g, b, a );
        if ( currentColorClear.equals( color ) === false ) {
          gl.clearColor( r, g, b, a );
          currentColorClear.copy( color );
        }
      },

      reset: function () {
        currentColorClear.set( 0, 0, 0, 1 );
      }
    };
  }

  function DepthBuffer() {
    let currentDepthMask = null;
    let currentDepthClear = null;

    return {

      setTest: function ( depthTest ) {
        if ( depthTest ) {
          enable( gl.DEPTH_TEST );
        } else {
          disable( gl.DEPTH_TEST );
        }
      },

      setMask: function ( depthMask ) {
        if ( currentDepthMask !== depthMask ) {
          gl.depthMask( depthMask );
          currentDepthMask = depthMask;
        }
      },

      setClear: function ( depth ) {
        if ( currentDepthClear !== depth ) {
          gl.clearDepth( depth );
          currentDepthClear = depth;
        }
      },

      reset: function () {
        currentDepthMask = null;
        currentDepthClear = null;
      },

    };
  }


  //

  let colorBuffer = new ColorBuffer();
  let depthBuffer = new DepthBuffer();

  let maxVertexAttributes = gl.getParameter( gl.MAX_VERTEX_ATTRIBS );
  let newAttributes = new Uint8Array( maxVertexAttributes );
  let enabledAttributes = new Uint8Array( maxVertexAttributes );

  let capabilities = {};

  let currentBlending = null;
  let currentPremultipledAlpha = false;

  let currentLineWidth = null;

  const glVersion = gl.getParameter(gl.VERSION);
  let lineWidthAvailable = false;
  if ( glVersion.indexOf( 'WebGL' ) !== -1 ) {
    let version = parseFloat( /^WebGL\ (\d)/.exec( glVersion )[1] );
    lineWidthAvailable = ( version >= 1.0 );
  }

  let currentTextureSlot = null;
  let currentBoundTextures = {};

  let currentViewport = new Vector4();

  function createTexture( type, target, count ) {
    let data = new Uint8Array( 4 ); // 4 is required to match default unpack alignment of 4.
    let texture = gl.createTexture();

    gl.bindTexture( type, texture );
    gl.texParameteri( type, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
    gl.texParameteri( type, gl.TEXTURE_MAG_FILTER, gl.NEAREST );

    for ( let i = 0; i < count; i ++ ) {
      gl.texImage2D( target + i, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data );
    }

    return texture;
  }

  let emptyTextures = {};
  emptyTextures[gl.TEXTURE_2D] = createTexture( gl.TEXTURE_2D, gl.TEXTURE_2D, 1 );

  //

  function init() {
    colorBuffer.setClear( 0, 0, 0, 1 );
    depthBuffer.setClear( 1 );

    enable( gl.DEPTH_TEST );
    gl.depthFunc( gl.LEQUAL );

    enable( gl.BLEND );
    setBlending( NormalBlending );
  }

  function initAttributes() {
    for ( let i = 0, l = newAttributes.length; i < l; i ++ ) {
      newAttributes[i] = 0;
    }
  }

  function enableAttribute( attribute ) {
    newAttributes[attribute] = 1;

    if ( enabledAttributes[attribute] === 0 ) {
      gl.enableVertexAttribArray( attribute );
      enabledAttributes[attribute] = 1;
    }
  }

  function disableUnusedAttributes() {
    for ( let i = 0, l = enabledAttributes.length; i !== l; ++ i ) {
      if ( enabledAttributes[i] !== newAttributes[i] ) {
        gl.disableVertexAttribArray( i );
        enabledAttributes[i] = 0;
      }
    }
  }

  function enable( id ) {
    if ( capabilities[id] !== true ) {
      gl.enable( id );
      capabilities[id] = true;
    }
  }

  function disable( id ) {
    if ( capabilities[id] !== false ) {
      gl.disable( id );
      capabilities[id] = false;
    }
  }

  function setBlending( blending, premultipliedAlpha ) {
    if ( blending !== NoBlending ) {
      enable( gl.BLEND );
    } else {
      disable( gl.BLEND );
    }

    if ( blending !== currentBlending || premultipliedAlpha !== currentPremultipledAlpha ) {
      if ( premultipliedAlpha ) {
        gl.blendEquationSeparate( gl.FUNC_ADD, gl.FUNC_ADD );
        gl.blendFuncSeparate( gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA );
      } else {
        gl.blendEquationSeparate( gl.FUNC_ADD, gl.FUNC_ADD );
        gl.blendFuncSeparate( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA );
      }

      currentBlending = blending;
      currentPremultipledAlpha = premultipliedAlpha;
    }
  }

  function setDepthTest( depthTest ) {
    depthBuffer.setTest( depthTest );
  }

  function setDepthWrite( depthWrite ) {
    depthBuffer.setMask( depthWrite );
  }

  //

  function setLineWidth( width ) {
    if ( width !== currentLineWidth ) {
      if ( lineWidthAvailable ) gl.lineWidth( width );

      currentLineWidth = width;
    }
  }

  // texture

  function activeTexture( webglSlot ) {
    if ( currentTextureSlot !== webglSlot ) {
      gl.activeTexture( webglSlot );
      currentTextureSlot = webglSlot;
    }
  }

  function bindTexture( webglType, webglTexture ) {
    let boundTexture = currentBoundTextures[currentTextureSlot];
    if ( boundTexture === undefined ) {
      boundTexture = { type: undefined, texture: undefined };
      currentBoundTextures[currentTextureSlot] = boundTexture;
    }

    if ( boundTexture.type !== webglType || boundTexture.texture !== webglTexture ) {
      gl.bindTexture( webglType, webglTexture || emptyTextures[webglType] );

      boundTexture.type = webglType;
      boundTexture.texture = webglTexture;
    }
  }

  function texImage2D() {
    try {
      gl.texImage2D.apply( gl, arguments );
    } catch ( error ) {
      console.error( error );
    }
  }

  //

  function viewport( viewport ) {
    if ( currentViewport.equals( viewport ) === false ) {
      gl.viewport( viewport.x, viewport.y, viewport.z, viewport.w );
      currentViewport.copy( viewport );
    }
  }

  function reset() {
    for ( let i = 0; i < enabledAttributes.length; i ++ ) {
      if ( enabledAttributes[ i ] === 1 ) {
        gl.disableVertexAttribArray( i );
        enabledAttributes[ i ] = 0;
      }
    }
    capabilities = {};
    currentTextureSlot = null;
    currentBoundTextures = {};
    currentBlending = null;
    colorBuffer.reset();
    depthBuffer.reset();
  }

  //

  return {
    buffers: {
      color: colorBuffer,
      depth: depthBuffer,
    },

    init: init,
    initAttributes: initAttributes,
    enableAttribute: enableAttribute,
    disableUnusedAttributes: disableUnusedAttributes,
    enable: enable,
    disable: disable,

    setBlending: setBlending,

    setDepthTest: setDepthTest,
    setDepthWrite: setDepthWrite,

    setLineWidth: setLineWidth,

    activeTexture: activeTexture,
    bindTexture: bindTexture,
    texImage2D: texImage2D,

    viewport: viewport,
    reset: reset
  };
}


// renderers/webgl/WebGLCapabilities.js (not updated)
function WebGLCapabilities( gl, extensions, parameters ) {
  function getMaxPrecision( precision ) {
    if ( precision === 'highp' ) {
      if ( gl.getShaderPrecisionFormat( gl.VERTEX_SHADER, gl.HIGH_FLOAT ).precision > 0 &&
         gl.getShaderPrecisionFormat( gl.FRAGMENT_SHADER, gl.HIGH_FLOAT ).precision > 0 ) {
        return 'highp';
      }

      precision = 'mediump';
    }

    if ( precision === 'mediump' ) {
      if ( gl.getShaderPrecisionFormat( gl.VERTEX_SHADER, gl.MEDIUM_FLOAT ).precision > 0 &&
         gl.getShaderPrecisionFormat( gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT ).precision > 0 ) {
        return 'mediump';
      }
    }

    return 'lowp';
  }

  let precision = parameters.precision !== undefined ? parameters.precision : 'highp';
  let maxPrecision = getMaxPrecision( precision );

  if ( maxPrecision !== precision ) {
    console.warn( 'WebGLRenderer:', precision, 'not supported, using', maxPrecision, 'instead.' );
    precision = maxPrecision;
  }

  let maxTextures = gl.getParameter( gl.MAX_TEXTURE_IMAGE_UNITS );

  return {
    getMaxPrecision: getMaxPrecision,
    precision: precision,
    maxTextures: maxTextures,
  };
}


// renderers/webgl/WebGLExtensions.js (not updated)
function WebGLExtensions( gl ) {
  let extensions = {};

  return {

    get: function ( name ) {
      if ( extensions[name] !== undefined ) {
        return extensions[name];
      }

      let extension;

      switch ( name ) {
        case 'WEBGL_depth_texture':
          extension = gl.getExtension( 'WEBGL_depth_texture' ) || gl.getExtension( 'MOZ_WEBGL_depth_texture' ) || gl.getExtension( 'WEBKIT_WEBGL_depth_texture' );
          break;
        default:
          extension = gl.getExtension( name );
      }

      if ( extension === null ) {
        console.warn( 'WebGLRenderer: ' + name + ' extension not supported.' );
      }

      extensions[name] = extension;

      return extension;
    },

  };
}


// renderers/WebGLRenderer.js (not updated)
function WebGLRenderer$1( parameters ) {
  parameters = parameters || {};

  let _canvas = parameters.canvas !== undefined ? parameters.canvas : document.createElementNS( 'http://www.w3.org/1999/xhtml', 'canvas' ),
    _context = parameters.context !== undefined ? parameters.context : null,
    _antialias = parameters.antialias !== undefined ? parameters.antialias : false,
    _premultipliedAlpha = parameters.premultipliedAlpha !== undefined ? parameters.premultipliedAlpha : true;

  let opaqueObjects = [];
  let opaqueObjectsLastIndex = -1;
  let transparentObjects = [];
  let transparentObjectsLastIndex = -1;

  // public properties

  this.domElement = _canvas;
  this.context = null;

  // clearing

  this.autoClear = true;
  this.autoClearColor = true;
  this.autoClearDepth = true;

  // scene graph

  this.sortObjects = true;

  // internal properties

  let _this = this,

    // internal state cache

    _currentProgram = null,
    _currentRenderTarget = null,
    _currentMaterialId = -1,
    _currentGeometryProgram = '',
    _currentCamera = null,

    _currentViewport = new Vector4(),

    //

    _clearColor = new Color$1( 0x000000 ),
    _clearAlpha = 0,

    _width = _canvas.width,
    _height = _canvas.height,

    _pixelRatio = 1,

    _viewport = new Vector4( 0, 0, _width, _height ),

    // camera matrices cache

    _projScreenMatrix = new Matrix4$1(),

    _vector3 = new Vector3$1(),

    // info

    _infoRender = {
      calls: 0,
      vertices: 0,
      faces: 0,
      points: 0,
    };

  this.info = {
    render: _infoRender,
    programs: null,
  };


  // initialize

  let _gl;

  try {
    let attributes = {
      alpha: false,
      depth: true,
      antialias: _antialias,
      premultipliedAlpha: _premultipliedAlpha,
      preserveDrawingBuffer: false,
    };

    _gl = _context || _canvas.getContext( 'webgl', attributes ) || _canvas.getContext( 'experimental-webgl', attributes );

    if ( _gl === null ) {
      if ( _canvas.getContext( 'webgl' ) !== null ) {
        throw new Error('Error creating WebGL context with your selected attributes.');
      } else {
        throw new Error('Error creating WebGL context.');
      }
    }

    // Some experimental-webgl implementations do not have getShaderPrecisionFormat

    if ( _gl.getShaderPrecisionFormat === undefined ) {
      _gl.getShaderPrecisionFormat = function () {
        return { 'rangeMin': 1, 'rangeMax': 1, 'precision': 1 };
      };
    }

    _canvas.addEventListener( 'webglcontextlost', onContextLost, false );
  } catch ( error ) {
    console.error( 'WebGLRenderer: ' + error );
  }

  let extensions = new WebGLExtensions( _gl );
  extensions.get( 'WEBGL_depth_texture' );
  extensions.get( 'OES_element_index_uint' );

  let capabilities = new WebGLCapabilities( _gl, extensions, parameters );

  let state = new WebGLState( _gl );
  let properties = new WebGLProperties();
  let textures = new WebGLTextures( _gl, extensions, state, properties, capabilities );
  let objects = new WebGLObjects( _gl, properties, this.info );
  let programCache = new WebGLPrograms( this, capabilities );

  this.info.programs = programCache.programs;

  let bufferRenderer = new WebGLBufferRenderer( _gl, extensions, _infoRender );
  let indexedBufferRenderer = new WebGLIndexedBufferRenderer( _gl, extensions, _infoRender );

  //

  function getTargetPixelRatio() {
    return _currentRenderTarget === null ? _pixelRatio : 1;
  }

  function setDefaultGLState() {
    state.init();

    state.viewport( _currentViewport.copy( _viewport ).multiplyScalar( _pixelRatio ) );

    state.buffers.color.setClear( _clearColor.r, _clearColor.g, _clearColor.b, _clearAlpha, _premultipliedAlpha );
  }

  function resetGLState() {
    _currentProgram = null;
    _currentCamera = null;

    _currentGeometryProgram = '';
    _currentMaterialId = -1;

    state.reset();
  }

  setDefaultGLState();

  this.context = _gl;
  this.capabilities = capabilities;
  this.extensions = extensions;
  this.properties = properties;
  this.state = state;

  // API

  this.getContext = function () {
    return _gl;
  };

  this.getPrecision = function () {
    return capabilities.precision;
  };

  this.getPixelRatio = function () {
    return _pixelRatio;
  };

  this.setPixelRatio = function ( value ) {
    if ( value === undefined ) return;

    _pixelRatio = value;

    this.setSize( _viewport.z, _viewport.w, false );
  };

  this.setSize = function ( width, height, updateStyle ) {
    _width = width;
    _height = height;

    _canvas.width = Math.floor(width * _pixelRatio);
    _canvas.height = Math.floor(height * _pixelRatio);

    if ( updateStyle !== false ) {
      _canvas.style.width = width + 'px';
      _canvas.style.height = height + 'px';
    }

    this.setViewport( 0, 0, width, height );
  };

  this.setViewport = function ( x, y, width, height ) {
    state.viewport( _viewport.set( x, y, width, height ) );
  };

  // Clearing

  this.getClearColor = function () {
    return _clearColor;
  };

  this.setClearColor = function ( color, alpha ) {
    _clearColor.set( color );

    _clearAlpha = alpha !== undefined ? alpha : 1;

    state.buffers.color.setClear( _clearColor.r, _clearColor.g, _clearColor.b, _clearAlpha, _premultipliedAlpha );
  };

  this.clear = function ( color, depth ) {
    let bits = 0;

    if ( color === undefined || color ) bits |= _gl.COLOR_BUFFER_BIT;
    if ( depth === undefined || depth ) bits |= _gl.DEPTH_BUFFER_BIT;

    if ( bits !== 0 ) {
      _gl.clear( bits );
    }
  };

  this.clearColor = function () {
    this.clear( true, false );
  };

  this.clearDepth = function () {
    this.clear( false, true );
  };

  // Reset

  this.resetGLState = resetGLState;

  this.dispose = function () {
    transparentObjects = [];
    transparentObjectsLastIndex = -1;
    opaqueObjects = [];
    opaqueObjectsLastIndex = -1;

    _canvas.removeEventListener( 'webglcontextlost', onContextLost, false );
  };

  // Events

  function onContextLost( event ) {
    event.preventDefault();

    resetGLState();
    setDefaultGLState();

    properties.clear();
  }

  function onMaterialDispose( event ) {
    let material = event.target;

    material.removeEventListener( 'dispose', onMaterialDispose );

    deallocateMaterial( material );
  }

  // Buffer deallocation

  function deallocateMaterial( material ) {
    releaseMaterialProgramReference( material );

    properties.delete( material );
  }


  function releaseMaterialProgramReference( material ) {
    let programInfo = properties.get( material ).program;

    material.program = undefined;

    if ( programInfo !== undefined ) {
      programCache.releaseProgram( programInfo );
    }
  }

  // Buffer rendering


  this.renderBufferDirect = function ( camera, fog, geometry, material, object, group ) {
    setMaterial( material );

    let program = setProgram( camera, fog, material, object );

    let updateBuffers = false;
    let geometryProgram = geometry.id + '_' + program.id;

    if ( geometryProgram !== _currentGeometryProgram ) {
      _currentGeometryProgram = geometryProgram;
      updateBuffers = true;
    }

    //

    let index = geometry.index;
    let position = geometry.attributes.position;
    let rangeFactor = 1;

    let renderer;

    if ( index !== null ) {
      renderer = indexedBufferRenderer;
      renderer.setIndex( index );
    } else {
      renderer = bufferRenderer;
    }

    if ( updateBuffers ) {
      setupVertexAttributes( material, program, geometry );

      if ( index !== null ) {
        _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, objects.getAttributeBuffer( index ) );
      }
    }

    //

    let dataCount = 0;

    if ( index !== null ) {
      dataCount = index.count;
    } else if ( position !== undefined ) {
      dataCount = position.count;
    }

    let rangeStart = geometry.drawRange.start * rangeFactor;
    let rangeCount = geometry.drawRange.count * rangeFactor;

    let groupStart = group !== null ? group.start * rangeFactor : 0;
    let groupCount = group !== null ? group.count * rangeFactor : Infinity;

    let drawStart = Math.max( rangeStart, groupStart );
    let drawEnd = Math.min( dataCount, rangeStart + rangeCount, groupStart + groupCount ) - 1;

    let drawCount = Math.max( 0, drawEnd - drawStart + 1 );

    if ( drawCount === 0 ) return;

    //

    if ( object.isMesh ) {
      renderer.setMode( _gl.TRIANGLES );
    } else if ( object.isLine ) {
      let lineWidth = material.linewidth;
      if ( lineWidth === undefined ) lineWidth = 1; // Not using Line*Material
      state.setLineWidth( lineWidth * getTargetPixelRatio() );

      if ( object.isLineSegments ) {
        renderer.setMode( _gl.LINES );
      } else {
        renderer.setMode( _gl.LINE_STRIP );
      }
    } else if ( object.isPoints ) {
      renderer.setMode( _gl.POINTS );
    }

    renderer.render( drawStart, drawCount );
  };

  function setupVertexAttributes( material, program, geometry, startIndex ) {
    if ( startIndex === undefined ) startIndex = 0;

    state.initAttributes();

    let geometryAttributes = geometry.attributes;

    let programAttributes = program.getAttributes();

    for ( let name in programAttributes ) {
      let programAttribute = programAttributes[name];

      if ( programAttribute >= 0 ) {
        let geometryAttribute = geometryAttributes[name];

        if ( geometryAttribute !== undefined ) {
          let normalized = geometryAttribute.normalized;
          let size = geometryAttribute.itemSize;

          let attributeProperties = objects.getAttributeProperties( geometryAttribute );

          let buffer = attributeProperties.__webglBuffer;
          let type = attributeProperties.type;
          let bytesPerElement = attributeProperties.bytesPerElement;

          state.enableAttribute( programAttribute );

          _gl.bindBuffer( _gl.ARRAY_BUFFER, buffer );
          _gl.vertexAttribPointer( programAttribute, size, type, normalized, 0, startIndex * size * bytesPerElement );
        } else {
          console.error( 'undefined geometryAttribute' );
        }
      }
    }
    state.disableUnusedAttributes();
  }

  // Sorting

  function painterSortStable( a, b ) {
    if ( a.object.renderOrder !== b.object.renderOrder ) {
      return a.object.renderOrder - b.object.renderOrder;
    } else if ( a.material.program && b.material.program && a.material.program !== b.material.program ) {
      return a.material.program.id - b.material.program.id;
    } else if ( a.material.id !== b.material.id ) {
      return a.material.id - b.material.id;
    } else if ( a.z !== b.z ) {
      return a.z - b.z;
    } else {
      return a.id - b.id;
    }
  }

  function reversePainterSortStable( a, b ) {
    if ( a.object.renderOrder !== b.object.renderOrder ) {
      return a.object.renderOrder - b.object.renderOrder;
    } if ( a.z !== b.z ) {
      return b.z - a.z;
    } else {
      return a.id - b.id;
    }
  }

  // Rendering

  this.render = function ( scene, camera, renderTarget, forceClear ) {
    if ( camera !== undefined && camera.isCamera !== true ) {
      console.error( 'camera is not an instance of Camera.' );
      return;
    }

    // reset caching for this frame

    _currentGeometryProgram = '';
    _currentMaterialId = -1;
    _currentCamera = null;

    // update scene graph

    if ( scene.matrixWorldAutoUpdate === true ) scene.updateMatrixWorld();

    // update camera matrices and frustum

    if ( camera.parent === null ) camera.updateMatrixWorld();

    camera.matrixWorldInverse.copy( camera.matrixWorld ).invert();

    _projScreenMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );

    opaqueObjectsLastIndex = -1;
    transparentObjectsLastIndex = -1;

    projectObject( scene );

    opaqueObjects.length = opaqueObjectsLastIndex + 1;
    transparentObjects.length = transparentObjectsLastIndex + 1;

    if ( _this.sortObjects === true ) {
      opaqueObjects.sort( painterSortStable );
      transparentObjects.sort( reversePainterSortStable );
    }

    //

    _infoRender.calls = 0;
    _infoRender.vertices = 0;
    _infoRender.faces = 0;
    _infoRender.points = 0;

    this.setRenderTarget( );

    state.buffers.color.setClear( _clearColor.r, _clearColor.g, _clearColor.b, _clearAlpha, _premultipliedAlpha );

    if ( this.autoClear || forceClear ) {
      this.clear( this.autoClearColor, this.autoClearDepth );
    }

    // opaque pass (front-to-back order)

    state.setBlending( NoBlending );
    renderObjects( opaqueObjects, scene, camera );

    // transparent pass (back-to-front order)

    renderObjects( transparentObjects, scene, camera );

    // Ensure depth buffer writing is enabled so it can be cleared on next render

    state.setDepthTest( true );
    state.setDepthWrite( true );

    // _gl.finish();
  };

  function pushRenderItem( object, geometry, material, z, group ) {
    let array, index;

    // allocate the next position in the appropriate array

    if ( material.transparent ) {
      array = transparentObjects;
      index = ++ transparentObjectsLastIndex;
    } else {
      array = opaqueObjects;
      index = ++ opaqueObjectsLastIndex;
    }

    // recycle existing render item or grow the array

    let renderItem = array[index];

    if ( renderItem !== undefined ) {
      renderItem.id = object.id;
      renderItem.object = object;
      renderItem.geometry = geometry;
      renderItem.material = material;
      renderItem.z = _vector3.z;
      renderItem.group = group;
    } else {
      renderItem = {
        id: object.id,
        object: object,
        geometry: geometry,
        material: material,
        z: _vector3.z,
        group: group,
      };

      // assert( index === array.length );
      array.push( renderItem );
    }
  }

  function projectObject( object ) {
    if ( object.visible === false ) return;

    if ( object.isMesh || object.isLine || object.isPoints ) {
      let material = object.material;

      if ( material.visible === true ) {
        if ( _this.sortObjects === true ) {
          _vector3.setFromMatrixPosition( object.matrixWorld );
          _vector3.applyMatrix4( _projScreenMatrix );
        }

        let geometry = objects.update( object );

        pushRenderItem( object, geometry, material, _vector3.z, null );
      }
    }

    let children = object.children;

    for ( let i = 0, l = children.length; i < l; i ++ ) {
      projectObject( children[i] );
    }
  }

  function renderObjects( renderList, scene, camera, overrideMaterial ) {
    for ( let i = 0, l = renderList.length; i < l; i ++ ) {
      let renderItem = renderList[i];
      let object = renderItem.object;
      let geometry = renderItem.geometry;
      let material = renderItem.material ;
      let group = renderItem.group;

      object.modelViewMatrix.multiplyMatrices( camera.matrixWorldInverse, object.matrixWorld );
      _this.renderBufferDirect( camera, scene.fog, geometry, material, object, group );
    }
  }

  function initMaterial( material, fog, object ) {
    let materialProperties = properties.get( material );

    let parameters = programCache.getParameters(
      material, fog, object );

    let code = programCache.getProgramCode( material, parameters );

    let program = materialProperties.program;
    let programChange = true;

    if ( program === undefined ) {
      // new material
      material.addEventListener( 'dispose', onMaterialDispose );
    } else if ( program.code !== code ) {
      // changed glsl or parameters
      releaseMaterialProgramReference( material );
    } else {
      // only rebuild uniform list
      programChange = false;
    }

    if ( programChange ) {
      materialProperties.__webglShader = {
        name: material.type,
        uniforms: material.uniforms,
        vertexShader: material.vertexShader,
        fragmentShader: material.fragmentShader,
      };

      material.__webglShader = materialProperties.__webglShader;

      program = programCache.acquireProgram( material, parameters, code );

      materialProperties.program = program;
      material.program = program;
    }

    let uniforms = materialProperties.__webglShader.uniforms;

    materialProperties.fog = fog;

    let progUniforms = materialProperties.program.getUniforms(),
      uniformsList =
      WebGLUniforms.seqWithValue( progUniforms.seq, uniforms );

    materialProperties.uniformsList = uniformsList;
  }

  function setMaterial( material ) {
    material.transparent === true ?
      state.setBlending( NormalBlending, material.premultipliedAlpha )
      : state.setBlending( NoBlending );

    state.setDepthTest( material.depthTest );
    state.setDepthWrite( material.depthWrite );
  }

  function setProgram( camera, fog, material, object ) {
    textures.resetTextureUnits();

    let materialProperties = properties.get( material );

    if ( material.needsUpdate === false ) {
      if ( materialProperties.program === undefined ) {
        material.needsUpdate = true;
      } else if ( material.fog && materialProperties.fog !== fog ) {
        material.needsUpdate = true;
      }
    }

    if ( material.needsUpdate ) {
      initMaterial( material, fog, object );
      material.needsUpdate = false;
    }

    let refreshProgram = false;
    let refreshMaterial = false;

    let program = materialProperties.program,
      p_uniforms = program.getUniforms(),
      m_uniforms = materialProperties.__webglShader.uniforms;

    if ( program.id !== _currentProgram ) {
      _gl.useProgram( program.program );
      _currentProgram = program.id;

      refreshProgram = true;
      refreshMaterial = true;
    }

    if ( material.id !== _currentMaterialId ) {
      _currentMaterialId = material.id;

      refreshMaterial = true;
    }

    if ( refreshProgram || camera !== _currentCamera ) {
      p_uniforms.setValue(_gl, 'projectionMatrix', camera.projectionMatrix);

      if ( camera !== _currentCamera ) {
        _currentCamera = camera;

        // lighting uniforms depend on the camera so enforce an update
        // now, in case this material supports lights - or later, when
        // the next material that does gets activated:

        refreshMaterial = true;   // set to true on material change
      }

      // load material specific uniforms
      // (shader material also gets them for the sake of genericity)

      if ( material.isShaderMaterial ) {
        p_uniforms.setValue( _gl, 'viewMatrix', camera.matrixWorldInverse );
      }
    }

    if ( refreshMaterial ) {
      // refresh uniforms common to several materials

      if ( fog && material.fog ) {
        refreshUniformsFog( m_uniforms, fog );
      }

      // refresh single material specific uniforms

      WebGLUniforms.upload(
        _gl, materialProperties.uniformsList, m_uniforms, textures );
    }


    // common matrices

    p_uniforms.setValue(_gl, 'modelViewMatrix', object.modelViewMatrix);
    p_uniforms.setValue( _gl, 'modelMatrix', object.matrixWorld );

    return program;
  }

  // Uniforms (refresh uniforms objects)

  function refreshUniformsFog( uniforms, fog ) {
    uniforms.fogColor.value = fog.color;
    if ( fog.isFog ) {
      uniforms.fogNear.value = fog.near;
      uniforms.fogFar.value = fog.far;
    }
  }

  this.setRenderTarget = function ( ) {
    _currentRenderTarget = null;
    _currentViewport.copy( _viewport ).multiplyScalar( _pixelRatio );
    state.viewport( _currentViewport );
  };
}

// scenes/Fog.js
let Fog$1 = class Fog {
  constructor(color, near = 1, far = 1000) {
    this.isFog = true;
    this.name = '';
    this.color = new Color$1(color);
    this.near = near;
    this.far = far;
  }
};


// scenes/Scene.js
let Scene$1 = class Scene extends Object3D$1 {
  constructor() {
    super();
    this.type = 'Scene';
    this.fog = null;
  }
};


// objects/Line.js
let Line$1 = class Line extends Object3D$1 {
  constructor(geometry, material) {
    super();
    this.type = 'Line';
    this.geometry = geometry;
    this.material = material;
  }
};
Line$1.prototype.isLine = true;


// objects/LineSegments.js
let LineSegments$1 = class LineSegments extends Line$1 {
  constructor(geometry, material) {
    super(geometry, material);
    this.isLineSegments = true;
    this.type = 'LineSegments';
  }
};


// objects/Points.js
let Points$1 = class Points extends Object3D$1 {
  constructor(geometry, material) {
    super();
    this.type = 'Points';
    this.geometry = geometry;
    this.material = material;
  }
};
Points$1.prototype.isPoints = true;

var Impl = /*#__PURE__*/Object.freeze({
__proto__: null,
BufferAttribute: BufferAttribute$1,
BufferGeometry: BufferGeometry$1,
Color: Color$1,
Fog: Fog$1,
Line: Line$1,
LineSegments: LineSegments$1,
Matrix4: Matrix4$1,
Mesh: Mesh$1,
Object3D: Object3D$1,
OrthographicCamera: OrthographicCamera$1,
Points: Points$1,
Quaternion: Quaternion$1,
Ray: Ray$1,
Scene: Scene$1,
ShaderMaterial: ShaderMaterial$1,
Texture: Texture$1,
Vector3: Vector3$1,
WebGLRenderer: WebGLRenderer$1
});

const impl = Impl ;

 


















const WebGLRenderer = impl.WebGLRenderer;
const Fog = impl.Fog;
const Scene = impl.Scene;
const Mesh = impl.Mesh;
const LineSegments = impl.LineSegments;
const Line = impl.Line;
const Points = impl.Points;
const ShaderMaterial = impl.ShaderMaterial;
const OrthographicCamera = impl.OrthographicCamera;
const BufferGeometry = impl.BufferGeometry;
const BufferAttribute = impl.BufferAttribute;
const Object3D = impl.Object3D;
const Ray = impl.Ray;
const Matrix4 = impl.Matrix4;
const Vector3 = impl.Vector3;
const Quaternion = impl.Quaternion;
const Color = impl.Color;
const Texture = impl.Texture;

/* eslint-disable */
// @ts-nocheck
// Copyright 2010-2023 Three.js Authors
// SPDX-License-Identifier: MIT


// from extras/core/Curve.js
class Curve {
  constructor() {
    this.type = 'Curve';
    this.arcLengthDivisions = 200;
  }

  getPoints(divisions = 5) {
    const points = [];
    for (let d = 0; d <= divisions; d++) {
      points.push(this.getPoint(d / divisions));
    }
    return points;
  }
}

// from extras/curves/CatmullRomCurve3.js
/**
 * Centripetal CatmullRom Curve - which is useful for avoiding
 * cusps and self-intersections in non-uniform catmull rom curves.
 * http://www.cemyuksel.com/research/catmullrom_param/catmullrom.pdf
 *
 * curve.type accepts centripetal(default), chordal and catmullrom
 * curve.tension is used for catmullrom which defaults to 0.5
 */

/*
Based on an optimized c++ solution in
 - http://stackoverflow.com/questions/9489736/catmull-rom-curve-with-no-cusps-and-no-self-intersections/
 - http://ideone.com/NoEbVM

This CubicPoly class could be used for reusing some variables and calculations,
but for three.js curve use, it could be possible inlined and flatten into a single function call
which can be placed in CurveUtils.
*/

function CubicPoly() {
  let c0 = 0,
    c1 = 0,
    c2 = 0,
    c3 = 0;

  /*
   * Compute coefficients for a cubic polynomial
   *   p(s) = c0 + c1*s + c2*s^2 + c3*s^3
   * such that
   *   p(0) = x0, p(1) = x1
   *  and
   *   p'(0) = t0, p'(1) = t1.
   */
  function init(x0, x1, t0, t1) {
    c0 = x0;
    c1 = t0;
    c2 = -3 * x0 + 3 * x1 - 2 * t0 - t1;
    c3 = 2 * x0 - 2 * x1 + t0 + t1;
  }

  return {
    initCatmullRom: function (x0, x1, x2, x3, tension) {
      init(x1, x2, tension * (x2 - x0), tension * (x3 - x1));
    },

    initNonuniformCatmullRom: function (x0, x1, x2, x3, dt0, dt1, dt2) {
      // compute tangents when parameterized in [t1,t2]
      let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
      let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;

      // rescale tangents for parametrization in [0,1]
      t1 *= dt1;
      t2 *= dt1;

      init(x1, x2, t1, t2);
    },

    calc: function (t) {
      const t2 = t * t;
      const t3 = t2 * t;
      return c0 + c1 * t + c2 * t2 + c3 * t3;
    },
  };
}

//

const tmp = /*@__PURE__*/ new Vector3$1();
const px = /*@__PURE__*/ new CubicPoly();
const py = /*@__PURE__*/ new CubicPoly();
const pz = /*@__PURE__*/ new CubicPoly();

let CatmullRomCurve3$1 = class CatmullRomCurve3 extends Curve {
  constructor(points = [], closed = false, curveType = 'centripetal', tension = 0.5) {
    super();
    this.isCatmullRomCurve3 = true;
    this.type = 'CatmullRomCurve3';

    this.points = points;
    this.closed = closed;
    this.curveType = curveType;
    this.tension = tension;
  }

  getPoint(t, optionalTarget = new Vector3$1()) {
    const point = optionalTarget;

    const points = this.points;
    const l = points.length;

    const p = (l - (this.closed ? 0 : 1)) * t;
    let intPoint = Math.floor(p);
    let weight = p - intPoint;

    if (this.closed) {
      intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l;
    } else if (weight === 0 && intPoint === l - 1) {
      intPoint = l - 2;
      weight = 1;
    }

    let p0, p3; // 4 points (p1 & p2 defined below)

    if (this.closed || intPoint > 0) {
      p0 = points[(intPoint - 1) % l];
    } else {
      // extrapolate first point
      tmp.subVectors(points[0], points[1]).add(points[0]);
      p0 = tmp;
    }

    const p1 = points[intPoint % l];
    const p2 = points[(intPoint + 1) % l];

    if (this.closed || intPoint + 2 < l) {
      p3 = points[(intPoint + 2) % l];
    } else {
      // extrapolate last point
      tmp.subVectors(points[l - 1], points[l - 2]).add(points[l - 1]);
      p3 = tmp;
    }

    if (this.curveType === 'centripetal' || this.curveType === 'chordal') {
      // init Centripetal / Chordal Catmull-Rom
      const pow = this.curveType === 'chordal' ? 0.5 : 0.25;
      let dt0 = Math.pow(p0.distanceToSquared(p1), pow);
      let dt1 = Math.pow(p1.distanceToSquared(p2), pow);
      let dt2 = Math.pow(p2.distanceToSquared(p3), pow);

      // safety check for repeated points
      if (dt1 < 1e-4) dt1 = 1.0;
      if (dt0 < 1e-4) dt0 = dt1;
      if (dt2 < 1e-4) dt2 = dt1;

      px.initNonuniformCatmullRom(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2);
      py.initNonuniformCatmullRom(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2);
      pz.initNonuniformCatmullRom(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2);
    } else if (this.curveType === 'catmullrom') {
      px.initCatmullRom(p0.x, p1.x, p2.x, p3.x, this.tension);
      py.initCatmullRom(p0.y, p1.y, p2.y, p3.y, this.tension);
      pz.initCatmullRom(p0.z, p1.z, p2.z, p3.z, this.tension);
    }

    point.set(px.calc(weight), py.calc(weight), pz.calc(weight));

    return point;
  }
};

const CatmullRomCurve3 = CatmullRomCurve3$1;

const CUBE_EDGES =
  [[0, 0, 0], [1, 0, 0],
   [0, 0, 0], [0, 1, 0],
   [0, 0, 0], [0, 0, 1],
   [1, 0, 0], [1, 1, 0],
   [1, 0, 0], [1, 0, 1],
   [0, 1, 0], [1, 1, 0],
   [0, 1, 0], [0, 1, 1],
   [0, 0, 1], [1, 0, 1],
   [0, 0, 1], [0, 1, 1],
   [1, 0, 1], [1, 1, 1],
   [1, 1, 0], [1, 1, 1],
   [0, 1, 1], [1, 1, 1]];

function makeColorAttribute(colors) {
  const col = new Float32Array(colors.length * 3);
  for (let i = 0; i < colors.length; i++) {
    col[3*i+0] = colors[i].r;
    col[3*i+1] = colors[i].g;
    col[3*i+2] = colors[i].b;
  }
  return new BufferAttribute(col, 3);
}

const light_dir = new Vector3(-0.2, 0.3, 1.0); // length affects brightness

const fog_pars_fragment =
`#ifdef USE_FOG
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
#endif`;

const fog_end_fragment =
`#ifdef USE_FOG
  float depth = gl_FragCoord.z / gl_FragCoord.w;
  float fogFactor = smoothstep(fogNear, fogFar, depth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;


const varcolor_vert = `
attribute vec3 color;
varying vec3 vcolor;
void main() {
  vcolor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const unicolor_vert = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const unicolor_frag = `
${fog_pars_fragment}
uniform vec3 vcolor;
void main() {
  gl_FragColor = vec4(vcolor, 1.0);
${fog_end_fragment}
}`;

const varcolor_frag = `
${fog_pars_fragment}
varying vec3 vcolor;
void main() {
  gl_FragColor = vec4(vcolor, 1.0);
${fog_end_fragment}
}`;

function makeLines(pos, color, linewidth) {
  const material = new ShaderMaterial({
    uniforms: makeUniforms({vcolor: color}),
    vertexShader: unicolor_vert,
    fragmentShader: unicolor_frag,
    fog: true,
    linewidth: linewidth,
    type: 'um_lines',
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  return new LineSegments(geometry, material);
}






function makeCube(size, ctr, options) {
  const pos = new Float32Array(CUBE_EDGES.length * 3);
  for (let i = 0; i < CUBE_EDGES.length; i++) {
    const coor = CUBE_EDGES[i];
    pos[3*i+0] = ctr.x + size * (coor[0] - 0.5);
    pos[3*i+1] = ctr.y + size * (coor[1] - 0.5);
    pos[3*i+2] = ctr.z + size * (coor[2] - 0.5);
  }
  return makeLines(pos, options.color, options.linewidth);
}

function makeMultiColorLines(pos,
                             colors,
                             linewidth) {
  const material = new ShaderMaterial({
    uniforms: makeUniforms({}),
    vertexShader: varcolor_vert,
    fragmentShader: varcolor_frag,
    fog: true,
    linewidth: linewidth,
    type: 'um_multicolor_lines',
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', makeColorAttribute(colors));
  return new LineSegments(geometry, material);
}

// A cube with 3 edges (for x, y, z axes) colored in red, green and blue.
function makeRgbBox(transform_func, color) {
  const pos = new Float32Array(CUBE_EDGES.length * 3);
  for (let i = 0; i < CUBE_EDGES.length; i++) {
    const coor = transform_func(CUBE_EDGES[i]);
    pos[3*i+0] = coor[0];
    pos[3*i+1] = coor[1];
    pos[3*i+2] = coor[2];
  }
  const colors = [
    new Color(0xff0000), new Color(0xffaa00),
    new Color(0x00ff00), new Color(0xaaff00),
    new Color(0x0000ff), new Color(0x00aaff),
  ];
  for (let j = 6; j < CUBE_EDGES.length; j++) {
    colors.push(color);
  }
  return makeMultiColorLines(pos, colors, 1);
}

function double_pos(pos) {
  const double_pos = [];
  for (let i = 0; i < pos.length; i++) {
    const v = pos[i];
    double_pos.push(v[0], v[1], v[2]);
    double_pos.push(v[0], v[1], v[2]);
  }
  return double_pos;
}

function double_color(color_arr) {
  const len = color_arr.length;
  const color = new Float32Array(6*len);
  for (let i = 0; i < len; i++) {
    const col = color_arr[i];
    color[6*i] = col.r;
    color[6*i+1] = col.g;
    color[6*i+2] = col.b;
    color[6*i+3] = col.r;
    color[6*i+4] = col.g;
    color[6*i+5] = col.b;
  }
  return color;
}

// draw quads as 2 triangles: 4 attributes / quad, 6 indices / quad
function make_quad_index_buffer(len) {
  const index = (4*len < 65536 ? new Uint16Array(6*len)
                               : new Uint32Array(6*len));
  const vert_order = [0, 1, 2, 0, 2, 3];
  for (let i = 0; i < len; i++) {
    for (let j = 0; j < 6; j++) {
      index[6*i+j] = 4*i + vert_order[j];
    }
  }
  return new BufferAttribute(index, 1);
}

function normalize_vec(v, fallback) {
  const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
  if (len < 1e-6) return [fallback[0], fallback[1], fallback[2]];
  return [v[0]/len, v[1]/len, v[2]/len];
}

function scale_vec(v, factor) {
  return [factor * v[0], factor * v[1], factor * v[2]];
}

function add_vec(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function cross_vec(a, b) {
  return [a[1]*b[2] - a[2]*b[1],
          a[2]*b[0] - a[0]*b[2],
          a[0]*b[1] - a[1]*b[0]];
}

function rotate_about_axis(v, axis, angle) {
  const cos_a = Math.cos(angle);
  const sin_a = Math.sin(angle);
  const dot = v[0]*axis[0] + v[1]*axis[1] + v[2]*axis[2];
  const cross = cross_vec(axis, v);
  return [
    v[0] * cos_a + cross[0] * sin_a + axis[0] * dot * (1 - cos_a),
    v[1] * cos_a + cross[1] * sin_a + axis[1] * dot * (1 - cos_a),
    v[2] * cos_a + cross[2] * sin_a + axis[2] * dot * (1 - cos_a),
  ];
}



function cartoon_kind(atom) {
  return atom.ss === 'Helix' ? 'h' : atom.ss === 'Strand' ? 's' : 'c';
}

function compute_cartoon_kinds(vertices) {
  const kinds = vertices.map(cartoon_kind);
  let strand_start = -1;
  for (let i = 0; i <= vertices.length; i++) {
    const in_strand = i < vertices.length && kinds[i] === 's';
    if (in_strand) {
      if (strand_start < 0) strand_start = i;
      continue;
    }
    if (strand_start >= 0 && i - strand_start >= 2) {
      kinds[i - 2] = 'arrow start';
      kinds[i - 1] = 'arrow end';
    }
    strand_start = -1;
  }
  return kinds;
}


const wide_segments_vert = `
attribute vec3 color;
attribute vec3 other;
attribute float side;
uniform vec2 win_size;
uniform float linewidth;
varying vec3 vcolor;

void main() {
  vcolor = color;
  mat4 mat = projectionMatrix * modelViewMatrix;
  vec2 dir = normalize((mat * vec4(position - other, 0.0)).xy);
  vec2 normal = vec2(-dir.y, dir.x);
  gl_Position = mat * vec4(position, 1.0);
  gl_Position.xy += side * linewidth * normal / win_size;
}`;

function interpolate_vertices(segment, smooth) {
  const vertices = [];
  for (let i = 0; i < segment.length; i++) {
    const xyz = segment[i].xyz;
    vertices.push(new Vector3(xyz[0], xyz[1], xyz[2]));
  }
  return interpolate_points(vertices, smooth);
}

function interpolate_points(points, smooth) {
  if (!smooth || smooth < 2) return points;
  const curve = new CatmullRomCurve3(points);
  return curve.getPoints((points.length - 1) * smooth);
}

function interpolate_colors(colors, smooth) {
  if (!smooth || smooth < 2) return colors;
  const ret = [];
  for (let i = 0; i < colors.length - 1; i++) {
    for (let j = 0; j < smooth; j++) {
      // currently we don't really interpolate colors
      ret.push(colors[i]);
    }
  }
  ret.push(colors[colors.length - 1]);
  return ret;
}

function interpolate_numbers(values, smooth) {
  if (!smooth || smooth < 2) return values;
  const ret = [];
  let i;
  for (i = 0; i < values.length - 1; i++) {
    const p = values[i];
    const n = values[i+1];
    for (let j = 0; j < smooth; j++) {
      const an = j / smooth;
      const ap = 1 - an;
      ret.push(ap * p + an * n);
    }
  }
  ret.push(values[i]);
  return ret;
}

// a simplistic linear interpolation, no need to SLERP
function interpolate_directions(dirs, smooth) {
  smooth = smooth || 1;
  const ret = [];
  let i;
  for (i = 0; i < dirs.length - 1; i++) {
    const p = dirs[i];
    const n = dirs[i+1];
    for (let j = 0; j < smooth; j++) {
      const an = j / smooth;
      const ap = 1 - an;
      ret.push(ap*p[0] + an*n[0], ap*p[1] + an*n[1], ap*p[2] + an*n[2]);
    }
  }
  ret.push(dirs[i][0], dirs[i][1], dirs[i][2]);
  return ret;
}

function makeUniforms(params) {
  const uniforms = {
    fogNear: { value: null },  // will be updated in setProgram()
    fogFar: { value: null },
    fogColor: { value: null },
  };
  for (const [p, v] of Object.entries(params)) {
    uniforms[p] = { value: v };
  }
  return uniforms;
}

const ribbon_vert = `
attribute vec3 color;
attribute vec3 tan;
uniform float shift;
varying vec3 vcolor;
void main() {
  vcolor = color;
  vec3 pos = position + shift * normalize(tan);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

// 9-line ribbon
function makeRibbon(vertices,
                           colors,
                           tangents,
                           smoothness) {
  const vertex_arr = interpolate_vertices(vertices, smoothness);
  const color_arr = interpolate_colors(colors, smoothness);
  const tang_arr = interpolate_directions(tangents, smoothness);
  const obj = new Object3D();
  const geometry = new BufferGeometry();
  const pos = new Float32Array(vertex_arr.length * 3);
  for (let i = 0; i < vertex_arr.length; i++) {
    const v = vertex_arr[i];
    pos[3*i+0] = v.x;
    pos[3*i+1] = v.y;
    pos[3*i+2] = v.z;
  }
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', makeColorAttribute(color_arr));
  const tan = new Float32Array(tang_arr);
  geometry.setAttribute('tan', new BufferAttribute(tan, 3));
  for (let n = -4; n < 5; n++) {
    const material = new ShaderMaterial({
      uniforms: makeUniforms({shift: 0.1 * n}),
      vertexShader: ribbon_vert,
      fragmentShader: varcolor_frag,
      fog: true,
      type: 'um_ribbon',
    });
    obj.add(new Line(geometry, material));
  }
  return obj;
}

const cartoon_vert = `
attribute vec3 color;
attribute vec3 normal;
varying vec3 vcolor;
varying vec3 vnormal;
void main() {
  vcolor = color;
  vnormal = normalize((modelViewMatrix * vec4(normal, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const cartoon_frag = `
${fog_pars_fragment}
uniform vec3 lightDir;
varying vec3 vcolor;
varying vec3 vnormal;
void main() {
  float weight = abs(dot(normalize(vnormal), normalize(lightDir))) * 0.6 + 0.4;
  gl_FragColor = vec4(weight * vcolor, 1.0);
${fog_end_fragment}
}`;

function makeCartoon(vertices,
                            colors,
                            tangents,
                            smoothness) {
  if (vertices.length < 2) return new Object3D();
  const kinds = compute_cartoon_kinds(vertices);
  const sample_centers = [];
  const sample_sides = [];
  const sample_widths = [];
  const sample_thicknesses = [];
  const sample_colors = [];
  let last_side = [0, 0, 1];
  for (let i = 0; i < vertices.length; i++) {
    let side = normalize_vec(tangents[i], last_side);
    if (side[0]*last_side[0] + side[1]*last_side[1] + side[2]*last_side[2] < 0) {
      side[0] = -side[0];
      side[1] = -side[1];
      side[2] = -side[2];
    }
    let center = [vertices[i].xyz[0], vertices[i].xyz[1], vertices[i].xyz[2]];
    const prev = vertices[Math.max(i - 1, 0)].xyz;
    const next = vertices[Math.min(i + 1, vertices.length - 1)].xyz;
    const forward = normalize_vec([next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]],
                                  [1, 0, 0]);
    const kind = kinds[i];
    let width = 0.5;
    let thickness = 0.16;
    if (kind === 'h') {
      width = 1.3;
      thickness = 0.20;
    } else if (kind === 's' || kind === 'arrow start') {
      width = 1.3;
      thickness = 0.16;
    } else if (kind === 'arrow end') {
      width = 0.5;
      thickness = 0.12;
    }
    if (kind === 'arrow start') {
      center = add_vec(center, cross_vec(scale_vec(forward, 0.3), side));
      const up = normalize_vec(cross_vec(forward, side), [0, 0, 1]);
      side = normalize_vec(rotate_about_axis(side, up, 0.43), side);
    }
    sample_centers.push(new Vector3(center[0], center[1], center[2]));
    sample_sides.push(side);
    sample_widths.push(width);
    sample_thicknesses.push(thickness);
    sample_colors.push(colors[i]);
    if (kind === 'arrow start') {
      sample_centers.push(new Vector3(center[0], center[1], center[2]));
      sample_sides.push(side);
      sample_widths.push(2.0 * width);
      sample_thicknesses.push(0.9 * thickness);
      sample_colors.push(colors[i]);
    }
    last_side = side;
  }

  const rail_count = 7;
  const rails = [];
  for (let j = 0; j < rail_count; j++) rails.push([]);
  for (let i = 0; i < sample_centers.length; i++) {
    const center = sample_centers[i];
    const side = sample_sides[i];
    const width = sample_widths[i];
    for (let j = 0; j < rail_count; j++) {
      const delta = -1 + 2 * j / (rail_count - 1);
      rails[j].push(new Vector3(center.x + delta * width * side[0],
                                center.y + delta * width * side[1],
                                center.z + delta * width * side[2]));
    }
  }

  const centerline = interpolate_points(sample_centers, smoothness);
  if (centerline.length < 2) return new Object3D();
  const color_arr = interpolate_colors(sample_colors, smoothness);
  const thickness_arr = interpolate_numbers(sample_thicknesses, smoothness);
  const interp_rails = rails.map((rail) => interpolate_points(rail, smoothness));
  const ups = [];
  const axes = [];
  let last_up = [0, 0, 1];
  for (let i = 0; i < centerline.length; i++) {
    const left = interp_rails[0][i];
    const right = interp_rails[rail_count - 1][i];
    const axis = normalize_vec([right.x - left.x, right.y - left.y, right.z - left.z],
                               [1, 0, 0]);
    const prev = centerline[Math.max(i - 1, 0)];
    const next = centerline[Math.min(i + 1, centerline.length - 1)];
    const forward = normalize_vec([next.x - prev.x, next.y - prev.y, next.z - prev.z],
                                  [0, 1, 0]);
    const up = normalize_vec(cross_vec(axis, forward), last_up);
    if (up[0]*last_up[0] + up[1]*last_up[1] + up[2]*last_up[2] < 0) {
      up[0] = -up[0];
      up[1] = -up[1];
      up[2] = -up[2];
    }
    axes.push(axis);
    ups.push(up);
    last_up = up;
  }

  const profile = [];
  for (let j = 0; j < rail_count; j++) {
    profile.push(0.5);
  }
  const quad_count = (centerline.length - 1) * (2 * (rail_count - 1) + 2);
  const pos = new Float32Array(quad_count * 12);
  const col = new Float32Array(quad_count * 12);
  const norm = new Float32Array(quad_count * 12);
  function add_quad(quad_id, quad, quad_normals,
                    c0, c1) {
    const quad_colors = [c0, c0, c1, c1];
    for (let j = 0; j < 4; j++) {
      const k = 12*quad_id + 3*j;
      pos[k+0] = quad[j][0];
      pos[k+1] = quad[j][1];
      pos[k+2] = quad[j][2];
      col[k+0] = quad_colors[j].r;
      col[k+1] = quad_colors[j].g;
      col[k+2] = quad_colors[j].b;
      norm[k+0] = quad_normals[j][0];
      norm[k+1] = quad_normals[j][1];
      norm[k+2] = quad_normals[j][2];
    }
  }

  let quad_id = 0;
  for (let i = 0; i < centerline.length - 1; i++) {
    const c0 = color_arr[i];
    const c1 = color_arr[i+1];
    const top0 = [];
    const top1 = [];
    const bot0 = [];
    const bot1 = [];
    for (let j = 0; j < rail_count; j++) {
      const p0 = interp_rails[j][i];
      const p1 = interp_rails[j][i+1];
      const u0 = scale_vec(ups[i], thickness_arr[i] * profile[j]);
      const u1 = scale_vec(ups[i+1], thickness_arr[i+1] * profile[j]);
      top0.push([p0.x + u0[0], p0.y + u0[1], p0.z + u0[2]]);
      top1.push([p1.x + u1[0], p1.y + u1[1], p1.z + u1[2]]);
      bot0.push([p0.x - u0[0], p0.y - u0[1], p0.z - u0[2]]);
      bot1.push([p1.x - u1[0], p1.y - u1[1], p1.z - u1[2]]);
    }
    for (let j = 0; j < rail_count - 1; j++) {
      add_quad(quad_id++,
               [top0[j], top0[j+1], top1[j+1], top1[j]],
               [ups[i], ups[i], ups[i+1], ups[i+1]],
               c0, c1);
      add_quad(quad_id++,
               [bot0[j], bot1[j], bot1[j+1], bot0[j+1]],
               [[-ups[i][0], -ups[i][1], -ups[i][2]],
                [-ups[i+1][0], -ups[i+1][1], -ups[i+1][2]],
                [-ups[i+1][0], -ups[i+1][1], -ups[i+1][2]],
                [-ups[i][0], -ups[i][1], -ups[i][2]]],
               c0, c1);
    }
    add_quad(quad_id++,
             [top0[0], top1[0], bot1[0], bot0[0]],
             [[-axes[i][0], -axes[i][1], -axes[i][2]],
              [-axes[i+1][0], -axes[i+1][1], -axes[i+1][2]],
              [-axes[i+1][0], -axes[i+1][1], -axes[i+1][2]],
              [-axes[i][0], -axes[i][1], -axes[i][2]]],
             c0, c1);
    add_quad(quad_id++,
             [top0[rail_count - 1], bot0[rail_count - 1],
              bot1[rail_count - 1], top1[rail_count - 1]],
             [axes[i], axes[i], axes[i+1], axes[i+1]],
             c0, c1);
  }

  if (quad_id === 0) {
    return new Object3D();
  }
  const used_pos = pos.subarray(0, quad_id * 12);
  const used_col = col.subarray(0, quad_id * 12);
  const used_norm = norm.subarray(0, quad_id * 12);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(used_pos, 3));
  geometry.setAttribute('color', new BufferAttribute(used_col, 3));
  geometry.setAttribute('normal', new BufferAttribute(used_norm, 3));
  geometry.setIndex(make_quad_index_buffer(quad_id));
  const material = new ShaderMaterial({
    uniforms: makeUniforms({lightDir: light_dir}),
    vertexShader: cartoon_vert,
    fragmentShader: cartoon_frag,
    fog: true,
    type: 'um_cartoon',
  });
  return new Mesh(geometry, material);
}


function makeChickenWire(data,
                         options) {
  const geom = new BufferGeometry();
  const position = new Float32Array(data.vertices);
  geom.setAttribute('position', new BufferAttribute(position, 3));

  // Although almost all browsers support OES_element_index_uint nowadays,
  // use Uint32 indexes only when needed.
  const arr = (data.vertices.length < 3*65536 ? new Uint16Array(data.segments)
                                              : new Uint32Array(data.segments));
  //console.log('arr len:', data.vertices.length, data.segments.length);
  geom.setIndex(new BufferAttribute(arr, 1));
  const material = new ShaderMaterial({
    uniforms: makeUniforms({vcolor: options.color}),
    vertexShader: unicolor_vert,
    fragmentShader: unicolor_frag,
    fog: true,
    linewidth: options.linewidth,
    type: 'um_line_chickenwire',
  });
  return new LineSegments(geom, material);
}


const grid_vert = `
uniform vec3 ucolor;
uniform vec3 fogColor;
varying vec4 vcolor;
void main() {
  vec2 scale = vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
  float z = position.z;
  float fogFactor = (z > 0.5 ? 0.2 : 0.7);
  float alpha = 0.8 * smoothstep(z > 1.5 ? -10.0 : 0.01, 0.1, scale.y);
  vcolor = vec4(mix(ucolor, fogColor, fogFactor), alpha);
  gl_Position = vec4(position.xy * scale, -0.99, 1.0);
}`;

const grid_frag = `
varying vec4 vcolor;
void main() {
  gl_FragColor = vcolor;
}`;

function makeGrid() {
  const N = 50;
  const pos = [];
  for (let i = -N; i <= N; i++) {
    let z = 0; // z only marks major/minor axes
    if (i % 5 === 0) z = i % 2 === 0 ? 2 : 1;
    pos.push(-N, i, z, N, i, z);  // horizontal line
    pos.push(i, -N, z, i, N, z);  // vertical line
  }
  const geom = new BufferGeometry();
  const pos_arr = new Float32Array(pos);
  geom.setAttribute('position', new BufferAttribute(pos_arr, 3));
  const material = new ShaderMaterial({
    uniforms: makeUniforms({ucolor: new Color(0x888888)}),
    //linewidth: 3,
    vertexShader: grid_vert,
    fragmentShader: grid_frag,
    fog: true, // no really, but we use fogColor
    type: 'um_grid',
  });
  material.transparent = true;
  const obj = new LineSegments(geom, material);
  obj.frustumCulled = false;  // otherwise the renderer could skip it
  return obj;
}


function makeLineMaterial(options) {
  const uniforms = makeUniforms({
    linewidth: options.linewidth,
    win_size: options.win_size,
  });
  return new ShaderMaterial({
    uniforms: uniforms,
    vertexShader: wide_segments_vert,
    fragmentShader: varcolor_frag,
    fog: true,
    type: 'um_line',
  });
}

// vertex_arr and color_arr must be of the same length
function makeLineSegments(material,
                                 vertex_arr,
                                 color_arr) {
  // n input vertices => 2n output vertices, n triangles, 3n indexes
  const len = vertex_arr.length;
  const pos = double_pos(vertex_arr);
  const position = new Float32Array(pos);
  const other_vert = new Float32Array(6*len);
  for (let i = 0; i < 6 * len; i += 12) {
    let j = 0;
    for (; j < 6; j++) other_vert[i+j] = pos[i+j+6];
    for (; j < 12; j++) other_vert[i+j] = pos[i+j-6];
  }
  const side = new Float32Array(2*len);
  for (let k = 0; k < len; k++) {
    side[2*k] = -1;
    side[2*k+1] = 1;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('other', new BufferAttribute(other_vert, 3));
  geometry.setAttribute('side', new BufferAttribute(side, 1));
  if (color_arr != null) {
    const color = double_color(color_arr);
    geometry.setAttribute('color', new BufferAttribute(color, 3));
  }
  geometry.setIndex(make_quad_index_buffer(len/2));

  const mesh = new Mesh(geometry, material);
  //mesh.userData.bond_lines = true;
  return mesh;
}

const wheel_vert = `
attribute vec3 color;
uniform float size;
varying vec3 vcolor;
void main() {
  vcolor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size;
}`;

// not sure how portable it is
const wheel_frag = `
${fog_pars_fragment}
varying vec3 vcolor;
void main() {
  vec2 diff = gl_PointCoord - vec2(0.5, 0.5);
  if (dot(diff, diff) >= 0.25) discard;
  gl_FragColor = vec4(vcolor, 1.0);
${fog_end_fragment}
}`;

function makeWheels(atom_arr, color_arr, size) {
  const geometry = new BufferGeometry();
  const pos = new Float32Array(atom_arr.length * 3);
  for (let i = 0; i < atom_arr.length; i++) {
    const xyz = atom_arr[i].xyz;
    pos[3*i+0] = xyz[0];
    pos[3*i+1] = xyz[1];
    pos[3*i+2] = xyz[2];
  }
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', makeColorAttribute(color_arr));
  const material = new ShaderMaterial({
    uniforms: makeUniforms({size: size}),
    vertexShader: wheel_vert,
    fragmentShader: wheel_frag,
    fog: true,
    type: 'um_wheel',
  });
  const obj = new Points(geometry, material);
  return obj;
}

// For the ball-and-stick rendering we use so-called imposters.
// This technique was described in:
// http://doi.ieeecomputersociety.org/10.1109/TVCG.2006.115
// free copy here:
// http://vcg.isti.cnr.it/Publications/2006/TCM06/Tarini_FinalVersionElec.pdf
// and was nicely summarized in:
// http://www.sunsetlakesoftware.com/2011/05/08/enhancing-molecules-using-opengl-es-20

const sphere_vert = `
attribute vec3 color;
attribute vec2 corner;
uniform float radius;
varying vec3 vcolor;
varying vec2 vcorner;
varying vec3 vpos;

void main() {
  vcolor = color;
  vcorner = corner;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vpos = mvPosition.xyz;
  mvPosition.xy += corner * radius;
  gl_Position = projectionMatrix * mvPosition;
}
`;

// based on 3Dmol imposter shaders
const sphere_frag = `
${fog_pars_fragment}
uniform mat4 projectionMatrix;
uniform vec3 lightDir;
uniform float radius;
varying vec3 vcolor;
varying vec2 vcorner;
varying vec3 vpos;

void main() {
  float sq = dot(vcorner, vcorner);
  if (sq > 1.0) discard;
  float z = sqrt(1.0-sq);
  vec3 xyz = vec3(vcorner.x, vcorner.y, z);
  vec4 projPos = projectionMatrix * vec4(vpos + radius * xyz, 1.0);
  gl_FragDepthEXT = 0.5 * ((gl_DepthRange.diff * (projPos.z / projPos.w)) +
                           gl_DepthRange.near + gl_DepthRange.far);
  float weight = clamp(dot(xyz, lightDir), 0.0, 1.0) * 0.8 + 0.2;
  gl_FragColor = vec4(weight * vcolor, 1.0);
  ${fog_end_fragment}
}
`;

const stick_vert = `
attribute vec3 color;
attribute vec3 axis;
attribute vec2 corner;
uniform float radius;
varying vec3 vcolor;
varying vec2 vcorner;
varying vec3 vpos;
varying vec3 vaxis;

void main() {
  vcolor = color;
  vcorner = corner;
  vaxis = normalize((modelViewMatrix * vec4(axis, 0.0)).xyz);
  vec2 normal = normalize(vec2(-vaxis.y, vaxis.x));
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vpos = mvPosition.xyz;
  mvPosition.xy += corner[1] * radius * normal;
  gl_Position = projectionMatrix * mvPosition;
}`;

const stick_frag = `
${fog_pars_fragment}
uniform mat4 projectionMatrix;
uniform vec3 lightDir;
uniform float radius;
uniform float shineStrength;
uniform float shinePower;
uniform vec3 shineColor;
varying vec3 vcolor;
varying vec2 vcorner;
varying vec3 vpos;
varying vec3 vaxis;
void main() {
  float central = 1.0 - vcorner[1] * vcorner[1];
  vec4 pos = vec4(vpos, 1.0);
  pos.z += radius * vaxis.z * central;
  vec4 projPos = projectionMatrix * pos;
  gl_FragDepthEXT = 0.5 * ((gl_DepthRange.diff * (projPos.z / projPos.w)) +
                           gl_DepthRange.near + gl_DepthRange.far);
  float diffuse = length(cross(vaxis, lightDir)) * central;
  float weight = diffuse * 0.8 + 0.2;
  float specular = shineStrength * pow(clamp(diffuse, 0.0, 1.0), shinePower) * central;
  vec3 shaded = min(weight, 1.0) * vcolor;
  gl_FragColor = vec4(min(shaded + specular * shineColor, 1.0), 1.0);
${fog_end_fragment}
}`;







function makeSticks(vertex_arr, color_arr, radius,
                    options = {}) {
  const uniforms = makeUniforms({
    radius: radius,
    lightDir: light_dir,
    shineStrength: options.shineStrength || 0.0,
    shinePower: options.shinePower || 8.0,
    shineColor: options.shineColor || new Color(0xffffff),
  });
  const material = new ShaderMaterial({
    uniforms: uniforms,
    vertexShader: stick_vert,
    fragmentShader: stick_frag,
    fog: true,
    type: 'um_stick',
  });
  material.extensions.fragDepth = true;

  const len = vertex_arr.length;
  const pos = double_pos(vertex_arr);
  const position = new Float32Array(pos);
  const axis = new Float32Array(6*len);
  for (let i = 0; i < 6 * len; i += 12) {
    for (let j = 0; j < 6; j++) axis[i+j] = pos[i+j+6] - pos[i+j];
    for (let j = 0; j < 6; j++) axis[i+j+6] = axis[i+j];
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  const corner = new Float32Array(4*len);
  for (let i = 0; 2 * i < len; i++) {
    corner[8*i + 0] = -1;  // 0
    corner[8*i + 1] = -1;  // 0
    corner[8*i + 2] = -1;  // 1
    corner[8*i + 3] = 1;  // 1
    corner[8*i + 4] = 1;  // 2
    corner[8*i + 5] = 1;  // 2
    corner[8*i + 6] = 1;  // 3
    corner[8*i + 7] = -1;  // 3
  }
  geometry.setAttribute('axis', new BufferAttribute(axis, 3));
  geometry.setAttribute('corner', new BufferAttribute(corner, 2));
  const color = double_color(color_arr);
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setIndex(make_quad_index_buffer(len/2));

  const mesh = new Mesh(geometry, material);
  //mesh.userData.bond_lines = true;
  return mesh;
}

function makeBalls(atom_arr, color_arr, radius) {
  const N = atom_arr.length;
  const geometry = new BufferGeometry();

  const pos = new Float32Array(N * 4 * 3);
  for (let i = 0; i < N; i++) {
    const xyz = atom_arr[i].xyz;
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 3; k++) {
        pos[3 * (4*i + j) + k] = xyz[k];
      }
    }
  }
  geometry.setAttribute('position', new BufferAttribute(pos, 3));

  const corner = new Float32Array(N * 4 * 2);
  for (let i = 0; i < N; i++) {
    corner[8*i + 0] = -1;  // 0
    corner[8*i + 1] = -1;  // 0
    corner[8*i + 2] = -1;  // 1
    corner[8*i + 3] = 1;  // 1
    corner[8*i + 4] = 1;  // 2
    corner[8*i + 5] = 1;  // 2
    corner[8*i + 6] = 1;  // 3
    corner[8*i + 7] = -1;  // 3
  }
  geometry.setAttribute('corner', new BufferAttribute(corner, 2));

  const colors = new Float32Array(N * 4 * 3);
  for (let i = 0; i < N; i++) {
    const col = color_arr[i];
    for (let j = 0; j < 4; j++) {
      colors[3 * (4*i + j) + 0] = col.r;
      colors[3 * (4*i + j) + 1] = col.g;
      colors[3 * (4*i + j) + 2] = col.b;
    }
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  geometry.setIndex(make_quad_index_buffer(N));

  const material = new ShaderMaterial({
    uniforms: makeUniforms({
      radius: radius,
      lightDir: light_dir,
    }),
    vertexShader: sphere_vert,
    fragmentShader: sphere_frag,
    fog: true,
    type: 'um_sphere',
  });
  material.extensions.fragDepth = true;
  const obj = new Mesh(geometry, material);
  return obj;
}

const label_vert = `
attribute vec2 uvs;
uniform vec2 canvas_size;
uniform vec2 win_size;
uniform float z_shift;
varying vec2 vUv;
void main() {
  vUv = uvs;
  vec2 rel_offset = vec2(0.02, -0.3);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.xy += (uvs + rel_offset) * 2.0 * canvas_size / win_size;
  gl_Position.z += z_shift * projectionMatrix[2][2];
}`;

const label_frag = `
${fog_pars_fragment}
varying vec2 vUv;
uniform sampler2D map;
void main() {
  gl_FragColor = texture2D(map, vUv);
${fog_end_fragment}
}`;

class Label {
  
  

  constructor(text, options) {
    this.texture = new Texture();
    const canvas_size = this.redraw(text, options);
    if (canvas_size === undefined) return;

    // Rectangle geometry.
    const geometry = new BufferGeometry();
    const pos = options.pos;
    const position = new Float32Array([].concat(pos, pos, pos, pos));
    const uvs = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 2, 1, 2, 3, 1]);
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('uvs', new BufferAttribute(uvs, 2));

    const material = new ShaderMaterial({
      uniforms: makeUniforms({map: this.texture,
                              canvas_size: canvas_size,
                              win_size: options.win_size,
                              z_shift: options.z_shift}),
      vertexShader: label_vert,
      fragmentShader: label_frag,
      fog: true,
      type: 'um_label',
    });
    material.transparent = true;
    this.mesh = new Mesh(geometry, material);
  }

  redraw(text, options) {
    if (typeof document === 'undefined') return;  // for testing on node
    const canvas = document.createElement('canvas');
    // Canvas size should be 2^N.
    canvas.width = 256;  // arbitrary limit, to keep it simple
    canvas.height = 16;  // font size
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.font = (options.font || 'bold 14px') + ' sans-serif';
    //context.fillStyle = 'green';
    //context.fillRect(0, 0, canvas.width, canvas.height);
    context.textBaseline = 'bottom';
    if (options.color) context.fillStyle = options.color;
    context.fillText(text, 0, canvas.height);
    this.texture.image = canvas;
    this.texture.needsUpdate = true;
    return [canvas.width, canvas.height];
  }
}


// Add vertices of a 3d cross (representation of an unbonded atom)
function addXyzCross(vertices, xyz, r) {
  vertices.push([xyz[0]-r, xyz[1], xyz[2]], [xyz[0]+r, xyz[1], xyz[2]]);
  vertices.push([xyz[0], xyz[1]-r, xyz[2]], [xyz[0], xyz[1]+r, xyz[2]]);
  vertices.push([xyz[0], xyz[1], xyz[2]-r], [xyz[0], xyz[1], xyz[2]+r]);
}

// Properties defined with Object.defineProperties() in JS are not understood
// by TypeScript; add them here.
 






// map 2d position to sphere with radius 1.
function project_on_ball(x, y) {
  let z = 0;
  const length_sq = x * x + y * y;
  if (length_sq < 1) {  // in ellipse
    z = Math.sqrt(1.0 - length_sq);
  } else {  // in a corner
    const length = Math.sqrt(length_sq);
    x /= length;
    y /= length;
  }
  return [x, y, z];  // guaranteed to be normalized
}

// object used in computations (to avoid creating and deleting it)
const _m1 = new Matrix4();

const STATE = { NONE: -1, ROTATE: 0, PAN: 1, ZOOM: 2, PAN_ZOOM: 3,
                       SLAB: 4, ROLL: 5, AUTO_ROTATE: 6, GO: 7 };

const auto_speed = 1.0;

// based on three.js/examples/js/controls/OrthographicTrackballControls.js
class Controls {
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  constructor(camera, target) {
    this._camera = camera;
    this._target = target;
    this._state = STATE.NONE;
    this._rotate_start = new Vector3();
    this._rotate_end = new Vector3();
    this._zoom_start = [0, 0];
    this._zoom_end = [0, 0];
    this._pinch_start = 0;
    this._pinch_end = 0;
    this._pan_start = [0, 0];
    this._pan_end = [0, 0];
    this._panned = true;
    this._rotating = 0.0;
    this._auto_stamp = null;
    this._go_func = null;

    // the far plane is more distant from the target than the near plane (3:1)
    this.slab_width = [2.5, 7.5, null];
  }

  _rotate_camera(eye) {
    const quat = new Quaternion();
    quat.setFromUnitVectors(this._rotate_end, this._rotate_start);
    eye.applyQuaternion(quat);
    this._camera.up.applyQuaternion(quat);
    this._rotate_end.applyQuaternion(quat);
    this._rotate_start.copy(this._rotate_end);
  }

  _zoom_camera(eye) {
    const dx = this._zoom_end[0] - this._zoom_start[0];
    const dy = this._zoom_end[1] - this._zoom_start[1];
    if (this._state === STATE.ZOOM) {
      this._camera.zoom /= (1 - dx + dy);
    } else if (this._state === STATE.SLAB) {
      this._target.addScaledVector(eye, -5 / eye.length() * dy);
    } else if (this._state === STATE.ROLL) {
      const quat = new Quaternion();
      quat.setFromAxisAngle(eye, 0.05 * (dx - dy));
      this._camera.up.applyQuaternion(quat);
    }
    this._zoom_start[0] = this._zoom_end[0];
    this._zoom_start[1] = this._zoom_end[1];
    return this._state === STATE.SLAB ? 10*dx : null;
  }

  _pan_camera(eye) {
    let dx = this._pan_end[0] - this._pan_start[0];
    let dy = this._pan_end[1] - this._pan_start[1];
    dx *= 0.5 * (this._camera.right - this._camera.left) / this._camera.zoom;
    dy *= 0.5 * (this._camera.bottom - this._camera.top) / this._camera.zoom;
    const pan = eye.clone().cross(this._camera.up).setLength(dx);
    pan.addScaledVector(this._camera.up, dy / this._camera.up.length());
    this._camera.position.add(pan);
    this._target.add(pan);
    this._pan_start[0] = this._pan_end[0];
    this._pan_start[1] = this._pan_end[1];
  }

  _auto_rotate(eye) {
    this._rotate_start.copy(eye).normalize();
    const now = Date.now();
    const elapsed = (this._auto_stamp !== null ? now - this._auto_stamp : 16.7);
    let speed = 1.8e-5 * elapsed * auto_speed;
    this._auto_stamp = now;
    if (this._rotating === true) {
      speed = -speed;
    } else if (this._rotating !== false) {
      this._rotating += 0.02;
      speed = 4e-5 * auto_speed * Math.cos(this._rotating);
    }
    this._rotate_end.crossVectors(this._camera.up, eye).multiplyScalar(speed)
      .add(this._rotate_start);
  }

  toggle_auto(param) {
    if (this._state === STATE.AUTO_ROTATE &&
        typeof param === typeof this._rotating) {
      this._state = STATE.NONE;
    } else {
      this._state = STATE.AUTO_ROTATE;
      this._auto_stamp = null;
      this._rotating = param;
    }
  }

  is_going() { return this._state === STATE.GO; }

  is_moving() { return this._state !== STATE.NONE; }

  update() {
    let changed = false;
    const eye = this._camera.position.clone().sub(this._target);
    if (this._state === STATE.AUTO_ROTATE) {
      this._auto_rotate(eye);
    }
    if (!this._rotate_start.equals(this._rotate_end)) {
      this._rotate_camera(eye);
      changed = true;
    }
    if (this._pinch_end !== this._pinch_start) {
      this._camera.zoom *= this._pinch_end / this._pinch_start;
      this._pinch_start = this._pinch_end;
      changed = true;
    }
    if (this._zoom_end[0] !== this._zoom_start[0] ||
        this._zoom_end[1] !== this._zoom_start[1]) {
      const dslab = this._zoom_camera(eye);
      if (dslab) {
        this.slab_width[0] = Math.max(this.slab_width[0] + dslab, 0.01);
        this.slab_width[1] = Math.max(this.slab_width[1] + dslab, 0.01);
      }
      changed = true;
    }
    if (this._pan_end[0] !== this._pan_start[0] ||
        this._pan_end[1] !== this._pan_start[1]) {
      this._pan_camera(eye);
      this._panned = true;
      changed = true;
    }
    this._camera.position.addVectors(this._target, eye);
    if (this._state === STATE.GO && this._go_func) {
      this._go_func();
      changed = true;
    }
    //this._camera.lookAt(this._target);
    _m1.lookAt(this._camera.position, this._target, this._camera.up);
    this._camera.quaternion.setFromRotationMatrix(_m1);
    return changed;
  }

  start(new_state, x, y, dist) {
    if (this._state === STATE.NONE || this._state === STATE.AUTO_ROTATE) {
      this._state = new_state;
    }
    this.move(x, y, dist);
    switch (this._state) {
      case STATE.ROTATE:
        this._rotate_start.copy(this._rotate_end);
        break;
      case STATE.ZOOM:
      case STATE.SLAB:
      case STATE.ROLL:
        this._zoom_start[0] = this._zoom_end[0];
        this._zoom_start[1] = this._zoom_end[1];
        break;
      case STATE.PAN:
        this._pan_start[0] = this._pan_end[0];
        this._pan_start[1] = this._pan_end[1];
        this._panned = false;
        break;
      case STATE.PAN_ZOOM:
        this._pinch_start = this._pinch_end;
        this._pan_start[0] = this._pan_end[0];
        this._pan_start[1] = this._pan_end[1];
        break;
    }
  }

  move(x, y, dist) {
    switch (this._state) {
      case STATE.ROTATE: {
        const xyz = project_on_ball(x, y);
        //console.log(this._camera.projectionMatrix);
        //console.log(this._camera.matrixWorld);
        // TODO maybe use project()/unproject()/applyProjection()
        const eye = this._camera.position.clone().sub(this._target);
        const up = this._camera.up;
        this._rotate_end.crossVectors(up, eye).setLength(xyz[0]);
        this._rotate_end.addScaledVector(up, xyz[1] / up.length());
        this._rotate_end.addScaledVector(eye, xyz[2] / eye.length());
        break;
      }
      case STATE.ZOOM:
      case STATE.SLAB:
      case STATE.ROLL:
        this._zoom_end = [x, y];
        break;
      case STATE.PAN:
        this._pan_end = [x, y];
        break;
      case STATE.PAN_ZOOM:
        if (dist == null) return; // should not happen
        this._pan_end = [x, y];
        this._pinch_end = dist;
        break;
    }
  }

  // returned coordinates can be used for atom picking
  stop() {
    let ret = null;
    if (this._state === STATE.PAN && !this._panned) ret = this._pan_end;
    this._state = STATE.NONE;
    this._rotate_start.copy(this._rotate_end);
    this._pinch_start = this._pinch_end;
    this._pan_start[0] = this._pan_end[0];
    this._pan_start[1] = this._pan_end[1];
    return ret;
  }

  // cam_up (if set) must be orthogonal to the view
  go_to(targ, cam_pos, cam_up, steps) {
    if ((!targ || targ.distanceToSquared(this._target) < 0.001) &&
        (!cam_pos || cam_pos.distanceToSquared(this._camera.position) < 0.1) &&
        (!cam_up || cam_up.distanceToSquared(this._camera.up) < 0.1)) {
      return;
    }
    this._state = STATE.GO;
    steps = (steps || 60) / auto_speed;
    const alphas = [];
    let prev_pos = 0;
    for (let i = 1; i <= steps; ++i) {
      let pos = i / steps;
      // quadratic easing
      pos = pos < 0.5 ? 2 * pos * pos : -2 * pos * (pos-2) - 1;
      alphas.push((pos - prev_pos) / (1 - prev_pos));
      prev_pos = pos;
    }
    this._go_func = function () {
      const a = alphas.shift();
      if (targ) {
        // unspecified cam_pos - _camera stays in the same distance to _target
        if (!cam_pos) this._camera.position.sub(this._target);
        this._target.lerp(targ, a);
        if (!cam_pos) this._camera.position.add(this._target);
      }
      if (cam_pos) this._camera.position.lerp(cam_pos, a);
      if (cam_up) this._camera.up.lerp(cam_up, a);
      if (alphas.length === 0) {
        this._state = STATE.NONE;
        this._go_func = null;
      }
    };
  }
}

// Generated from CCP4/Coot monomer library CIFs.


const AMINO_ACID_TEMPLATES = {
  "ALA": {
    name: "ALA",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nALA ALA ALANINE peptide 13 6 .\n\ndata_comp_ALA\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nALA N N NT3 1 2.468 26.274 12.957\nALA CA C CH1 0 1.178 26.922 13.361\nALA C C C 0 1.439 28.343 13.878\nALA O O O 0 2.486 28.630 14.460\nALA CB C CH3 0 0.480 26.082 14.404\nALA OXT O OC -1 0.604 29.234 13.722\nALA H H H 0 2.921 25.868 13.764\nALA H2 H H 0 3.058 26.917 12.554\nALA H3 H H 0 2.282 25.582 12.318\nALA HA H H 0 0.598 26.983 12.566\nALA HB3 H H 0 1.017 26.056 15.214\nALA HB2 H H 0 0.361 25.178 14.067\nALA HB1 H H 0 -0.389 26.468 14.605\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nALA N n/a CA START\nALA H N . .\nALA H2 N . .\nALA H3 N . .\nALA CA N C .\nALA HA CA . .\nALA CB CA HB3 .\nALA HB1 CB . .\nALA HB2 CB . .\nALA HB3 CB . .\nALA C CA . END\nALA O C . .\nALA OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nALA N CA SINGLE n 1.482 0.0101 1.482 0.0101\nALA CA C SINGLE n 1.533 0.0100 1.533 0.0100\nALA CA CB SINGLE n 1.509 0.0143 1.509 0.0143\nALA C O DOUBLE n 1.247 0.0187 1.247 0.0187\nALA C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nALA N H SINGLE n 1.036 0.0160 0.911 0.0200\nALA N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nALA N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nALA CA HA SINGLE n 1.089 0.0100 0.986 0.0200\nALA CB HB3 SINGLE n 1.089 0.0100 0.972 0.0152\nALA CB HB2 SINGLE n 1.089 0.0100 0.972 0.0152\nALA CB HB1 SINGLE n 1.089 0.0100 0.972 0.0152\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nALA CA N H 109.643 1.50\nALA CA N H2 109.643 1.50\nALA CA N H3 109.643 1.50\nALA H N H2 109.028 2.41\nALA H N H3 109.028 2.41\nALA H2 N H3 109.028 2.41\nALA N CA C 109.627 1.50\nALA N CA CB 109.912 1.50\nALA N CA HA 108.529 1.50\nALA C CA CB 111.490 1.50\nALA C CA HA 108.541 1.50\nALA CB CA HA 108.878 1.50\nALA CA C O 117.159 1.57\nALA CA C OXT 117.159 1.57\nALA O C OXT 125.683 1.50\nALA CA CB HB3 109.546 1.50\nALA CA CB HB2 109.546 1.50\nALA CA CB HB1 109.546 1.50\nALA HB3 CB HB2 109.386 1.50\nALA HB3 CB HB1 109.386 1.50\nALA HB2 CB HB1 109.386 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nALA hh1 N CA CB HB3 60.000 10.0 3\nALA sp3_sp3_1 C CA N H 180.000 10.0 3\nALA sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nALA chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nALA plan-1 C 0.020\nALA plan-1 CA 0.020\nALA plan-1 O 0.020\nALA plan-1 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nALA SMILES ACDLabs 10.04 O=C(O)C(N)C\nALA SMILES_CANONICAL CACTVS 3.341 C[C@H](N)C(O)=O\nALA SMILES CACTVS 3.341 C[CH](N)C(O)=O\nALA SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 C[C@@H](C(=O)O)N\nALA SMILES \"OpenEye OEToolkits\" 1.5.0 CC(C(=O)O)N\nALA InChI InChI 1.03 InChI=1S/C3H7NO2/c1-2(4)3(5)6/h2H,4H2,1H3,(H,5,6)/t2-/m0/s1\nALA InChIKey InChI 1.03 QNAYBMKLOCPYGJ-REOHCLBHSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nALA acedrg 243 \"dictionary generator\"\nALA acedrg_database 11 \"data source\"\nALA rdkit 2017.03.2 \"Chemoinformatics tool\"\nALA refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [2.468, 26.274, 12.957]},
      {name: "CA", element: "C", xyz: [1.178, 26.922, 13.361]},
      {name: "C", element: "C", xyz: [1.439, 28.343, 13.878]},
      {name: "O", element: "O", xyz: [2.486, 28.63, 14.46]},
      {name: "CB", element: "C", xyz: [0.48, 26.082, 14.404]},
      {name: "OXT", element: "O", xyz: [0.604, 29.234, 13.722]},
      {name: "H", element: "H", xyz: [2.921, 25.868, 13.764]},
      {name: "H2", element: "H", xyz: [3.058, 26.917, 12.554]},
      {name: "H3", element: "H", xyz: [2.282, 25.582, 12.318]},
      {name: "HA", element: "H", xyz: [0.598, 26.983, 12.566]},
      {name: "HB3", element: "H", xyz: [1.017, 26.056, 15.214]},
      {name: "HB2", element: "H", xyz: [0.361, 25.178, 14.067]},
      {name: "HB1", element: "H", xyz: [-0.389, 26.468, 14.605]},
    ],
  },
  "ARG": {
    name: "ARG",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nARG ARG ARGININE peptide 27 12 .\n\ndata_comp_ARG\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nARG N N NT3 1 69.985 15.005 89.950\nARG CA C CH1 0 70.216 14.541 91.355\nARG C C C 0 71.708 14.259 91.564\nARG O O O 0 72.388 13.743 90.676\nARG CB C CH2 0 69.385 13.289 91.658\nARG CG C CH2 0 67.879 13.507 91.601\nARG CD C CH2 0 67.094 12.291 92.059\nARG NE N NC1 0 67.243 11.140 91.175\nARG CZ C C 0 66.685 9.948 91.378\nARG NH1 N NC2 0 65.981 9.717 92.472\nARG NH2 N NC2 1 66.835 8.986 90.484\nARG OXT O OC -1 72.264 14.541 92.626\nARG H H H 0 70.044 14.217 89.320\nARG H2 H H 0 70.646 15.658 89.704\nARG H3 H H 0 69.116 15.405 89.879\nARG HA H H 0 69.942 15.262 91.969\nARG HB3 H H 0 69.622 12.968 92.552\nARG HB2 H H 0 69.627 12.591 91.014\nARG HG3 H H 0 67.619 13.723 90.680\nARG HG2 H H 0 67.641 14.271 92.169\nARG HD3 H H 0 66.144 12.528 92.116\nARG HD2 H H 0 67.392 12.041 92.960\nARG HE H H 0 67.731 11.239 90.459\nARG HH11 H H 0 65.222 10.145 92.604\nARG HH12 H H 0 66.271 9.135 93.067\nARG HH21 H H 0 67.581 8.926 90.023\nARG HH22 H H 0 66.187 8.406 90.354\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nARG N n/a CA START\nARG H N . .\nARG H2 N . .\nARG H3 N . .\nARG CA N C .\nARG HA CA . .\nARG CB CA CG .\nARG HB3 CB . .\nARG HB2 CB . .\nARG CG CB CD .\nARG HG3 CG . .\nARG HG2 CG . .\nARG CD CG NE .\nARG HD3 CD . .\nARG HD2 CD . .\nARG NE CD CZ .\nARG HE NE . .\nARG CZ NE NH2 .\nARG NH1 CZ HH12 .\nARG HH11 NH1 . .\nARG HH12 NH1 . .\nARG NH2 CZ HH22 .\nARG HH21 NH2 . .\nARG HH22 NH2 . .\nARG C CA . END\nARG O C . .\nARG OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nARG N CA SINGLE n 1.488 0.0100 1.488 0.0100\nARG CA C SINGLE n 1.533 0.0100 1.533 0.0100\nARG CA CB SINGLE n 1.532 0.0100 1.532 0.0100\nARG C O DOUBLE n 1.247 0.0187 1.247 0.0187\nARG C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nARG CB CG SINGLE n 1.522 0.0100 1.522 0.0100\nARG CG CD SINGLE n 1.517 0.0143 1.517 0.0143\nARG CD NE SINGLE n 1.456 0.0136 1.456 0.0136\nARG NE CZ SINGLE n 1.328 0.0112 1.328 0.0112\nARG CZ NH1 SINGLE n 1.321 0.0100 1.321 0.0100\nARG CZ NH2 DOUBLE n 1.322 0.0100 1.322 0.0100\nARG N H SINGLE n 1.036 0.0160 0.911 0.0200\nARG N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nARG N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nARG CA HA SINGLE n 1.089 0.0100 0.985 0.0200\nARG CB HB3 SINGLE n 1.089 0.0100 0.980 0.0160\nARG CB HB2 SINGLE n 1.089 0.0100 0.980 0.0160\nARG CG HG3 SINGLE n 1.089 0.0100 0.981 0.0160\nARG CG HG2 SINGLE n 1.089 0.0100 0.981 0.0160\nARG CD HD3 SINGLE n 1.089 0.0100 0.981 0.0152\nARG CD HD2 SINGLE n 1.089 0.0100 0.981 0.0152\nARG NE HE SINGLE n 1.016 0.0100 0.872 0.0200\nARG NH1 HH11 SINGLE n 1.016 0.0100 0.881 0.0200\nARG NH1 HH12 SINGLE n 1.016 0.0100 0.881 0.0200\nARG NH2 HH21 SINGLE n 1.016 0.0100 0.879 0.0200\nARG NH2 HH22 SINGLE n 1.016 0.0100 0.879 0.0200\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nARG CA N H 110.062 1.93\nARG CA N H2 110.062 1.93\nARG CA N H3 110.062 1.93\nARG H N H2 109.028 2.41\nARG H N H3 109.028 2.41\nARG H2 N H3 109.028 2.41\nARG N CA C 109.241 1.50\nARG N CA CB 110.374 1.62\nARG N CA HA 108.487 1.50\nARG C CA CB 111.037 2.40\nARG C CA HA 108.824 1.50\nARG CB CA HA 108.967 1.50\nARG CA C O 117.124 1.50\nARG CA C OXT 117.124 1.50\nARG O C OXT 125.752 1.50\nARG CA CB CG 114.117 1.50\nARG CA CB HB3 108.549 1.50\nARG CA CB HB2 108.549 1.50\nARG CG CB HB3 108.775 1.50\nARG CG CB HB2 108.775 1.50\nARG HB3 CB HB2 107.844 1.50\nARG CB CG CD 112.387 3.00\nARG CB CG HG3 109.262 1.50\nARG CB CG HG2 109.262 1.50\nARG CD CG HG3 108.956 1.50\nARG CD CG HG2 108.956 1.50\nARG HG3 CG HG2 107.927 1.57\nARG CG CD NE 112.382 2.90\nARG CG CD HD3 109.197 1.51\nARG CG CD HD2 109.197 1.51\nARG NE CD HD3 109.183 1.50\nARG NE CD HD2 109.183 1.50\nARG HD3 CD HD2 107.877 1.50\nARG CD NE CZ 124.510 1.50\nARG CD NE HE 117.883 1.50\nARG CZ NE HE 117.606 1.50\nARG NE CZ NH1 120.052 1.50\nARG NE CZ NH2 120.052 1.50\nARG NH1 CZ NH2 119.896 1.50\nARG CZ NH1 HH11 119.855 2.01\nARG CZ NH1 HH12 119.855 2.01\nARG HH11 NH1 HH12 120.290 2.09\nARG CZ NH2 HH21 119.855 2.01\nARG CZ NH2 HH22 119.855 2.01\nARG HH21 NH2 HH22 120.290 2.09\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nARG chi1 N CA CB CG -60.000 10.0 3\nARG chi2 CA CB CG CD 180.000 10.0 3\nARG chi3 CB CG CD NE -60.000 10.0 3\nARG chi4 CG CD NE CZ 180.000 10.0 6\nARG chi5 CD NE CZ NH2 180.000 5.0 2\nARG hh1 NE CZ NH1 HH12 180.000 5.0 2\nARG hh2 NE CZ NH2 HH22 0.000 5.0 2\nARG sp3_sp3_1 C CA N H 180.000 10.0 3\nARG sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nARG chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nARG plan-1 C 0.020\nARG plan-1 CA 0.020\nARG plan-1 O 0.020\nARG plan-1 OXT 0.020\nARG plan-2 CD 0.020\nARG plan-2 CZ 0.020\nARG plan-2 HE 0.020\nARG plan-2 NE 0.020\nARG plan-3 CZ 0.020\nARG plan-3 NE 0.020\nARG plan-3 NH1 0.020\nARG plan-3 NH2 0.020\nARG plan-4 CZ 0.020\nARG plan-4 HH11 0.020\nARG plan-4 HH12 0.020\nARG plan-4 NH1 0.020\nARG plan-5 CZ 0.020\nARG plan-5 HH21 0.020\nARG plan-5 HH22 0.020\nARG plan-5 NH2 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nARG SMILES ACDLabs 10.04 O=C(O)C(N)CCCN\\C(=[NH2+])N\nARG SMILES_CANONICAL CACTVS 3.341 N[C@@H](CCCNC(N)=[NH2+])C(O)=O\nARG SMILES CACTVS 3.341 N[CH](CCCNC(N)=[NH2+])C(O)=O\nARG SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 C(C[C@@H](C(=O)O)N)CNC(=[NH2+])N\nARG SMILES \"OpenEye OEToolkits\" 1.5.0 C(CC(C(=O)O)N)CNC(=[NH2+])N\nARG InChI InChI 1.03 InChI=1S/C6H14N4O2/c7-4(5(11)12)2-1-3-10-6(8)9/h4H,1-3,7H2,(H,11,12)(H4,8,9,10)/p+1/t4-/m0/s1\nARG InChIKey InChI 1.03 ODKSFYDXXFIFQN-BYPYZUCNSA-O\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nARG acedrg 243 \"dictionary generator\"\nARG acedrg_database 11 \"data source\"\nARG rdkit 2017.03.2 \"Chemoinformatics tool\"\nARG refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [69.985, 15.005, 89.95]},
      {name: "CA", element: "C", xyz: [70.216, 14.541, 91.355]},
      {name: "C", element: "C", xyz: [71.708, 14.259, 91.564]},
      {name: "O", element: "O", xyz: [72.388, 13.743, 90.676]},
      {name: "CB", element: "C", xyz: [69.385, 13.289, 91.658]},
      {name: "CG", element: "C", xyz: [67.879, 13.507, 91.601]},
      {name: "CD", element: "C", xyz: [67.094, 12.291, 92.059]},
      {name: "NE", element: "N", xyz: [67.243, 11.14, 91.175]},
      {name: "CZ", element: "C", xyz: [66.685, 9.948, 91.378]},
      {name: "NH1", element: "N", xyz: [65.981, 9.717, 92.472]},
      {name: "NH2", element: "N", xyz: [66.835, 8.986, 90.484]},
      {name: "OXT", element: "O", xyz: [72.264, 14.541, 92.626]},
      {name: "H", element: "H", xyz: [70.044, 14.217, 89.32]},
      {name: "H2", element: "H", xyz: [70.646, 15.658, 89.704]},
      {name: "H3", element: "H", xyz: [69.116, 15.405, 89.879]},
      {name: "HA", element: "H", xyz: [69.942, 15.262, 91.969]},
      {name: "HB3", element: "H", xyz: [69.622, 12.968, 92.552]},
      {name: "HB2", element: "H", xyz: [69.627, 12.591, 91.014]},
      {name: "HG3", element: "H", xyz: [67.619, 13.723, 90.68]},
      {name: "HG2", element: "H", xyz: [67.641, 14.271, 92.169]},
      {name: "HD3", element: "H", xyz: [66.144, 12.528, 92.116]},
      {name: "HD2", element: "H", xyz: [67.392, 12.041, 92.96]},
      {name: "HE", element: "H", xyz: [67.731, 11.239, 90.459]},
      {name: "HH11", element: "H", xyz: [65.222, 10.145, 92.604]},
      {name: "HH12", element: "H", xyz: [66.271, 9.135, 93.067]},
      {name: "HH21", element: "H", xyz: [67.581, 8.926, 90.023]},
      {name: "HH22", element: "H", xyz: [66.187, 8.406, 90.354]},
    ],
  },
  "ASN": {
    name: "ASN",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nASN ASN ASPARAGINE peptide 17 9 .\n\ndata_comp_ASN\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nASN N N NT3 1 15.240 16.650 19.952\nASN CA C CH1 0 15.824 17.959 20.384\nASN C C C 0 14.902 18.617 21.419\nASN O O O 0 15.300 18.861 22.558\nASN CB C CH2 0 16.056 18.901 19.197\nASN CG C C 0 17.016 18.357 18.157\nASN OD1 O O 0 17.581 17.277 18.317\nASN ND2 N NH2 0 17.210 19.102 17.079\nASN OXT O OC -1 13.742 18.915 21.135\nASN H H H 0 14.544 16.809 19.238\nASN H2 H H 0 14.833 16.198 20.697\nASN H3 H H 0 15.935 16.090 19.598\nASN HA H H 0 16.698 17.785 20.808\nASN HB3 H H 0 16.406 19.750 19.536\nASN HB2 H H 0 15.195 19.081 18.768\nASN HD21 H H 0 16.674 19.784 16.907\nASN HD22 H H 0 17.876 18.917 16.527\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nASN N n/a CA START\nASN H N . .\nASN H2 N . .\nASN H3 N . .\nASN CA N C .\nASN HA CA . .\nASN CB CA CG .\nASN HB3 CB . .\nASN HB2 CB . .\nASN CG CB ND2 .\nASN OD1 CG . .\nASN ND2 CG HD22 .\nASN HD21 ND2 . .\nASN HD22 ND2 . .\nASN C CA . END\nASN O C . .\nASN OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nASN N CA SINGLE n 1.488 0.0100 1.488 0.0100\nASN CA C SINGLE n 1.533 0.0100 1.533 0.0100\nASN CA CB SINGLE n 1.531 0.0107 1.531 0.0107\nASN C O DOUBLE n 1.247 0.0187 1.247 0.0187\nASN C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nASN CB CG SINGLE n 1.514 0.0100 1.514 0.0100\nASN CG OD1 DOUBLE n 1.229 0.0102 1.229 0.0102\nASN CG ND2 SINGLE n 1.323 0.0100 1.323 0.0100\nASN N H SINGLE n 1.036 0.0160 0.911 0.0200\nASN N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nASN N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nASN CA HA SINGLE n 1.089 0.0100 0.986 0.0200\nASN CB HB3 SINGLE n 1.089 0.0100 0.979 0.0159\nASN CB HB2 SINGLE n 1.089 0.0100 0.979 0.0159\nASN ND2 HD21 SINGLE n 1.016 0.0100 0.884 0.0200\nASN ND2 HD22 SINGLE n 1.016 0.0100 0.884 0.0200\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nASN CA N H 110.062 1.93\nASN CA N H2 110.062 1.93\nASN CA N H3 110.062 1.93\nASN H N H2 109.028 2.41\nASN H N H3 109.028 2.41\nASN H2 N H3 109.028 2.41\nASN N CA C 109.241 1.50\nASN N CA CB 111.766 1.50\nASN N CA HA 108.487 1.50\nASN C CA CB 111.540 2.60\nASN C CA HA 108.824 1.50\nASN CB CA HA 107.983 1.50\nASN CA C O 117.124 1.50\nASN CA C OXT 117.124 1.50\nASN O C OXT 125.752 1.50\nASN CA CB CG 112.981 1.50\nASN CA CB HB3 108.904 1.50\nASN CA CB HB2 108.904 1.50\nASN CG CB HB3 109.076 1.50\nASN CG CB HB2 109.076 1.50\nASN HB3 CB HB2 108.069 1.50\nASN CB CG OD1 120.613 1.50\nASN CB CG ND2 116.821 1.50\nASN OD1 CG ND2 122.566 1.50\nASN CG ND2 HD21 120.022 1.65\nASN CG ND2 HD22 120.022 1.65\nASN HD21 ND2 HD22 119.956 2.38\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nASN chi1 N CA CB CG -60.000 10.0 3\nASN chi2 CA CB CG ND2 180.000 10.0 6\nASN hh1 CB CG ND2 HD22 180.000 10.0 2\nASN sp3_sp3_1 C CA N H 180.000 10.0 3\nASN sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nASN chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nASN plan-1 C 0.020\nASN plan-1 CA 0.020\nASN plan-1 O 0.020\nASN plan-1 OXT 0.020\nASN plan-2 CB 0.020\nASN plan-2 CG 0.020\nASN plan-2 ND2 0.020\nASN plan-2 OD1 0.020\nASN plan-3 CG 0.020\nASN plan-3 HD21 0.020\nASN plan-3 HD22 0.020\nASN plan-3 ND2 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nASN SMILES ACDLabs 12.01 O=C(N)CC(N)C(=O)O\nASN InChI InChI 1.03 InChI=1S/C4H8N2O3/c5-2(4(8)9)1-3(6)7/h2H,1,5H2,(H2,6,7)(H,8,9)/t2-/m0/s1\nASN InChIKey InChI 1.03 DCXYFEDJOCDNAF-REOHCLBHSA-N\nASN SMILES_CANONICAL CACTVS 3.370 N[C@@H](CC(N)=O)C(O)=O\nASN SMILES CACTVS 3.370 N[CH](CC(N)=O)C(O)=O\nASN SMILES_CANONICAL \"OpenEye OEToolkits\" 1.7.2 C([C@@H](C(=O)O)N)C(=O)N\nASN SMILES \"OpenEye OEToolkits\" 1.7.2 C(C(C(=O)O)N)C(=O)N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nASN acedrg 243 \"dictionary generator\"\nASN acedrg_database 11 \"data source\"\nASN rdkit 2017.03.2 \"Chemoinformatics tool\"\nASN refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [15.24, 16.65, 19.952]},
      {name: "CA", element: "C", xyz: [15.824, 17.959, 20.384]},
      {name: "C", element: "C", xyz: [14.902, 18.617, 21.419]},
      {name: "O", element: "O", xyz: [15.3, 18.861, 22.558]},
      {name: "CB", element: "C", xyz: [16.056, 18.901, 19.197]},
      {name: "CG", element: "C", xyz: [17.016, 18.357, 18.157]},
      {name: "OD1", element: "O", xyz: [17.581, 17.277, 18.317]},
      {name: "ND2", element: "N", xyz: [17.21, 19.102, 17.079]},
      {name: "OXT", element: "O", xyz: [13.742, 18.915, 21.135]},
      {name: "H", element: "H", xyz: [14.544, 16.809, 19.238]},
      {name: "H2", element: "H", xyz: [14.833, 16.198, 20.697]},
      {name: "H3", element: "H", xyz: [15.935, 16.09, 19.598]},
      {name: "HA", element: "H", xyz: [16.698, 17.785, 20.808]},
      {name: "HB3", element: "H", xyz: [16.406, 19.75, 19.536]},
      {name: "HB2", element: "H", xyz: [15.195, 19.081, 18.768]},
      {name: "HD21", element: "H", xyz: [16.674, 19.784, 16.907]},
      {name: "HD22", element: "H", xyz: [17.876, 18.917, 16.527]},
    ],
  },
  "ASP": {
    name: "ASP",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nASP ASP \"ASPARTIC ACID\" peptide 15 9 .\n\ndata_comp_ASP\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nASP N N NT3 1 33.498 17.725 39.115\nASP CA C CH1 0 34.953 17.538 38.806\nASP C C C 0 35.108 16.849 37.444\nASP O O O 0 36.213 16.753 36.911\nASP CB C CH2 0 35.671 16.767 39.920\nASP CG C C 0 35.053 15.428 40.299\nASP OD1 O O 0 35.700 14.690 41.067\nASP OD2 O OC -1 33.927 15.137 39.844\nASP OXT O OC -1 34.141 16.373 36.847\nASP H H H 0 33.388 17.948 40.095\nASP H2 H H 0 33.001 16.928 38.913\nASP H3 H H 0 33.156 18.451 38.588\nASP HA H H 0 35.365 18.432 38.746\nASP HB3 H H 0 35.693 17.326 40.723\nASP HB2 H H 0 36.595 16.604 39.641\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nASP N n/a CA START\nASP H N . .\nASP H2 N . .\nASP H3 N . .\nASP CA N C .\nASP HA CA . .\nASP CB CA CG .\nASP HB3 CB . .\nASP HB2 CB . .\nASP CG CB OD2 .\nASP OD1 CG . .\nASP OD2 CG . .\nASP C CA . END\nASP O C . .\nASP OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nASP N CA SINGLE n 1.488 0.0100 1.488 0.0100\nASP CA C SINGLE n 1.533 0.0100 1.533 0.0100\nASP CA CB SINGLE n 1.531 0.0107 1.531 0.0107\nASP C O DOUBLE n 1.247 0.0187 1.247 0.0187\nASP C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nASP CB CG SINGLE n 1.519 0.0109 1.519 0.0109\nASP CG OD1 DOUBLE n 1.247 0.0187 1.247 0.0187\nASP CG OD2 SINGLE n 1.247 0.0187 1.247 0.0187\nASP N H SINGLE n 1.036 0.0160 0.911 0.0200\nASP N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nASP N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nASP CA HA SINGLE n 1.089 0.0100 0.986 0.0200\nASP CB HB3 SINGLE n 1.089 0.0100 0.979 0.0159\nASP CB HB2 SINGLE n 1.089 0.0100 0.979 0.0159\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nASP CA N H 110.062 1.93\nASP CA N H2 110.062 1.93\nASP CA N H3 110.062 1.93\nASP H N H2 109.028 2.41\nASP H N H3 109.028 2.41\nASP H2 N H3 109.028 2.41\nASP N CA C 109.241 1.50\nASP N CA CB 111.338 1.50\nASP N CA HA 108.487 1.50\nASP C CA CB 111.804 2.58\nASP C CA HA 108.824 1.50\nASP CB CA HA 108.666 1.69\nASP CA C O 117.124 1.50\nASP CA C OXT 117.124 1.50\nASP O C OXT 125.752 1.50\nASP CA CB CG 113.398 1.64\nASP CA CB HB3 108.488 2.17\nASP CA CB HB2 108.488 2.17\nASP CG CB HB3 107.840 2.14\nASP CG CB HB2 107.840 2.14\nASP HB3 CB HB2 107.891 1.66\nASP CB CG OD1 117.986 1.50\nASP CB CG OD2 117.986 1.50\nASP OD1 CG OD2 124.027 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nASP chi1 N CA CB CG 60.000 10.0 3\nASP chi2 CA CB CG OD1 180.000 10.0 6\nASP sp3_sp3_1 C CA N H 180.000 10.0 3\nASP sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nASP chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nASP plan-1 C 0.020\nASP plan-1 CA 0.020\nASP plan-1 O 0.020\nASP plan-1 OXT 0.020\nASP plan-2 CB 0.020\nASP plan-2 CG 0.020\nASP plan-2 OD1 0.020\nASP plan-2 OD2 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nASP SMILES ACDLabs 12.01 O=C(O)CC(N)C(=O)O\nASP SMILES_CANONICAL CACTVS 3.370 N[C@@H](CC(O)=O)C(O)=O\nASP SMILES CACTVS 3.370 N[CH](CC(O)=O)C(O)=O\nASP SMILES_CANONICAL \"OpenEye OEToolkits\" 1.7.0 C([C@@H](C(=O)O)N)C(=O)O\nASP SMILES \"OpenEye OEToolkits\" 1.7.0 C(C(C(=O)O)N)C(=O)O\nASP InChI InChI 1.03 InChI=1S/C4H7NO4/c5-2(4(8)9)1-3(6)7/h2H,1,5H2,(H,6,7)(H,8,9)/t2-/m0/s1\nASP InChIKey InChI 1.03 CKLJMWTZIZZHCS-REOHCLBHSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nASP acedrg 243 \"dictionary generator\"\nASP acedrg_database 11 \"data source\"\nASP rdkit 2017.03.2 \"Chemoinformatics tool\"\nASP refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [33.498, 17.725, 39.115]},
      {name: "CA", element: "C", xyz: [34.953, 17.538, 38.806]},
      {name: "C", element: "C", xyz: [35.108, 16.849, 37.444]},
      {name: "O", element: "O", xyz: [36.213, 16.753, 36.911]},
      {name: "CB", element: "C", xyz: [35.671, 16.767, 39.92]},
      {name: "CG", element: "C", xyz: [35.053, 15.428, 40.299]},
      {name: "OD1", element: "O", xyz: [35.7, 14.69, 41.067]},
      {name: "OD2", element: "O", xyz: [33.927, 15.137, 39.844]},
      {name: "OXT", element: "O", xyz: [34.141, 16.373, 36.847]},
      {name: "H", element: "H", xyz: [33.388, 17.948, 40.095]},
      {name: "H2", element: "H", xyz: [33.001, 16.928, 38.913]},
      {name: "H3", element: "H", xyz: [33.156, 18.451, 38.588]},
      {name: "HA", element: "H", xyz: [35.365, 18.432, 38.746]},
      {name: "HB3", element: "H", xyz: [35.693, 17.326, 40.723]},
      {name: "HB2", element: "H", xyz: [36.595, 16.604, 39.641]},
    ],
  },
  "CYS": {
    name: "CYS",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nCYS CYS CYSTEINE peptide 14 7 .\n\ndata_comp_CYS\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nCYS N N NT3 1 22.654 13.555 37.659\nCYS CA C CH1 0 22.403 13.515 39.134\nCYS C C C 0 21.948 14.893 39.631\nCYS O O O 0 22.644 15.893 39.454\nCYS CB C CH2 0 23.652 13.077 39.891\nCYS SG S SH1 0 25.092 14.131 39.578\nCYS OXT O OC -1 20.874 15.033 40.217\nCYS H H H 0 23.565 13.954 37.479\nCYS H2 H H 0 21.983 14.081 37.216\nCYS H3 H H 0 22.628 12.660 37.312\nCYS HA H H 0 21.685 12.863 39.307\nCYS HB3 H H 0 23.876 12.159 39.636\nCYS HB2 H H 0 23.463 13.085 40.852\nCYS HG H HSH1 0 25.867 13.543 40.286\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nCYS N n/a CA START\nCYS H N . .\nCYS H2 N . .\nCYS H3 N . .\nCYS CA N C .\nCYS HA CA . .\nCYS CB CA SG .\nCYS HB3 CB . .\nCYS HB2 CB . .\nCYS SG CB . .\nCYS HG SG . .\nCYS C CA . END\nCYS O C . .\nCYS OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nCYS N CA SINGLE n 1.488 0.0100 1.488 0.0100\nCYS CA C SINGLE n 1.533 0.0100 1.533 0.0100\nCYS CA CB SINGLE n 1.524 0.0100 1.524 0.0100\nCYS C O DOUBLE n 1.247 0.0187 1.247 0.0187\nCYS C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nCYS CB SG SINGLE n 1.812 0.0100 1.812 0.0100\nCYS N H SINGLE n 1.036 0.0160 0.911 0.0200\nCYS N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nCYS N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nCYS CA HA SINGLE n 1.089 0.0100 0.985 0.0200\nCYS CB HB3 SINGLE n 1.089 0.0100 0.979 0.0172\nCYS CB HB2 SINGLE n 1.089 0.0100 0.979 0.0172\nCYS SG HG SINGLE n 1.338 0.0100 1.203 0.0200\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nCYS CA N H 109.671 1.50\nCYS CA N H2 109.671 1.50\nCYS CA N H3 109.671 1.50\nCYS H N H2 109.028 2.41\nCYS H N H3 109.028 2.41\nCYS H2 N H3 109.028 2.41\nCYS N CA C 109.494 1.50\nCYS N CA CB 110.827 1.50\nCYS N CA HA 107.983 1.50\nCYS C CA CB 109.612 2.06\nCYS C CA HA 108.606 1.50\nCYS CB CA HA 108.443 1.50\nCYS CA C O 117.134 1.50\nCYS CA C OXT 117.134 1.50\nCYS O C OXT 125.732 1.50\nCYS CA CB SG 113.455 1.50\nCYS CA CB HB3 109.118 1.50\nCYS CA CB HB2 109.118 1.50\nCYS SG CB HB3 108.544 1.50\nCYS SG CB HB2 108.544 1.50\nCYS HB3 CB HB2 107.930 1.50\nCYS CB SG HG 97.249 3.00\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nCYS chi1 N CA CB SG 60.000 10.0 3\nCYS chi2 CA CB SG HG 180.000 10.0 3\nCYS sp3_sp3_1 C CA N H 180.000 10.0 3\nCYS sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nCYS chir_1 CA N CB C negative\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nCYS plan-1 C 0.020\nCYS plan-1 CA 0.020\nCYS plan-1 O 0.020\nCYS plan-1 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nCYS SMILES ACDLabs 10.04 O=C(O)C(N)CS\nCYS SMILES_CANONICAL CACTVS 3.341 N[C@@H](CS)C(O)=O\nCYS SMILES CACTVS 3.341 N[CH](CS)C(O)=O\nCYS SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 C([C@@H](C(=O)O)N)S\nCYS SMILES \"OpenEye OEToolkits\" 1.5.0 C(C(C(=O)O)N)S\nCYS InChI InChI 1.03 InChI=1S/C3H7NO2S/c4-2(1-7)3(5)6/h2,7H,1,4H2,(H,5,6)/t2-/m0/s1\nCYS InChIKey InChI 1.03 XUJNEKJLAYXESH-REOHCLBHSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nCYS acedrg 243 \"dictionary generator\"\nCYS acedrg_database 11 \"data source\"\nCYS rdkit 2017.03.2 \"Chemoinformatics tool\"\nCYS refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [22.654, 13.555, 37.659]},
      {name: "CA", element: "C", xyz: [22.403, 13.515, 39.134]},
      {name: "C", element: "C", xyz: [21.948, 14.893, 39.631]},
      {name: "O", element: "O", xyz: [22.644, 15.893, 39.454]},
      {name: "CB", element: "C", xyz: [23.652, 13.077, 39.891]},
      {name: "SG", element: "S", xyz: [25.092, 14.131, 39.578]},
      {name: "OXT", element: "O", xyz: [20.874, 15.033, 40.217]},
      {name: "H", element: "H", xyz: [23.565, 13.954, 37.479]},
      {name: "H2", element: "H", xyz: [21.983, 14.081, 37.216]},
      {name: "H3", element: "H", xyz: [22.628, 12.66, 37.312]},
      {name: "HA", element: "H", xyz: [21.685, 12.863, 39.307]},
      {name: "HB3", element: "H", xyz: [23.876, 12.159, 39.636]},
      {name: "HB2", element: "H", xyz: [23.463, 13.085, 40.852]},
      {name: "HG", element: "H", xyz: [25.867, 13.543, 40.286]},
    ],
  },
  "GLN": {
    name: "GLN",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nGLN GLN GLUTAMINE peptide 20 10 .\n\ndata_comp_GLN\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nGLN N N NT3 1 -13.182 34.854 120.932\nGLN CA C CH1 0 -12.158 35.323 119.944\nGLN C C C 0 -10.823 35.559 120.662\nGLN O O O 0 -9.753 35.446 120.063\nGLN CB C CH2 0 -12.640 36.581 119.212\nGLN CG C CH2 0 -13.023 37.743 120.122\nGLN CD C C 0 -13.479 38.947 119.333\nGLN OE1 O O 0 -14.471 38.898 118.609\nGLN NE2 N NH2 0 -12.754 40.046 119.468\nGLN OXT O OC -1 -10.787 35.865 121.854\nGLN H H H 0 -14.102 34.918 120.522\nGLN H2 H H 0 -13.153 35.386 121.732\nGLN H3 H H 0 -13.002 33.938 121.158\nGLN HA H H 0 -12.028 34.608 119.279\nGLN HB3 H H 0 -13.415 36.339 118.664\nGLN HB2 H H 0 -11.929 36.875 118.606\nGLN HG3 H H 0 -12.254 37.994 120.676\nGLN HG2 H H 0 -13.747 37.463 120.721\nGLN HE21 H H 0 -11.872 40.002 119.419\nGLN HE22 H H 0 -13.150 40.823 119.607\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nGLN N n/a CA START\nGLN H N . .\nGLN H2 N . .\nGLN H3 N . .\nGLN CA N C .\nGLN HA CA . .\nGLN CB CA CG .\nGLN HB3 CB . .\nGLN HB2 CB . .\nGLN CG CB CD .\nGLN HG3 CG . .\nGLN HG2 CG . .\nGLN CD CG NE2 .\nGLN OE1 CD . .\nGLN NE2 CD HE22 .\nGLN HE21 NE2 . .\nGLN HE22 NE2 . .\nGLN C CA . END\nGLN O C . .\nGLN OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nGLN N CA SINGLE n 1.488 0.0100 1.488 0.0100\nGLN CA C SINGLE n 1.533 0.0100 1.533 0.0100\nGLN CA CB SINGLE n 1.530 0.0105 1.530 0.0105\nGLN C O DOUBLE n 1.247 0.0187 1.247 0.0187\nGLN C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nGLN CB CG SINGLE n 1.522 0.0131 1.522 0.0131\nGLN CG CD SINGLE n 1.509 0.0100 1.509 0.0100\nGLN CD OE1 DOUBLE n 1.229 0.0102 1.229 0.0102\nGLN CD NE2 SINGLE n 1.323 0.0100 1.323 0.0100\nGLN N H SINGLE n 1.036 0.0160 0.911 0.0200\nGLN N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nGLN N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nGLN CA HA SINGLE n 1.089 0.0100 0.985 0.0200\nGLN CB HB3 SINGLE n 1.089 0.0100 0.980 0.0178\nGLN CB HB2 SINGLE n 1.089 0.0100 0.980 0.0178\nGLN CG HG3 SINGLE n 1.089 0.0100 0.981 0.0185\nGLN CG HG2 SINGLE n 1.089 0.0100 0.981 0.0185\nGLN NE2 HE21 SINGLE n 1.016 0.0100 0.884 0.0200\nGLN NE2 HE22 SINGLE n 1.016 0.0100 0.884 0.0200\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nGLN CA N H 110.062 1.93\nGLN CA N H2 110.062 1.93\nGLN CA N H3 110.062 1.93\nGLN H N H2 109.028 2.41\nGLN H N H3 109.028 2.41\nGLN H2 N H3 109.028 2.41\nGLN N CA C 109.241 1.50\nGLN N CA CB 110.374 1.62\nGLN N CA HA 108.487 1.50\nGLN C CA CB 111.037 2.40\nGLN C CA HA 108.824 1.50\nGLN CB CA HA 108.967 1.50\nGLN CA C O 117.124 1.50\nGLN CA C OXT 117.124 1.50\nGLN O C OXT 125.752 1.50\nGLN CA CB CG 113.607 1.50\nGLN CA CB HB3 108.549 1.50\nGLN CA CB HB2 108.549 1.50\nGLN CG CB HB3 109.107 1.50\nGLN CG CB HB2 109.107 1.50\nGLN HB3 CB HB2 107.844 1.50\nGLN CB CG CD 112.220 2.15\nGLN CB CG HG3 109.204 1.50\nGLN CB CG HG2 109.204 1.50\nGLN CD CG HG3 109.082 1.50\nGLN CD CG HG2 109.082 1.50\nGLN HG3 CG HG2 107.846 1.50\nGLN CG CD OE1 121.405 1.50\nGLN CG CD NE2 116.125 1.50\nGLN OE1 CD NE2 122.470 1.50\nGLN CD NE2 HE21 120.022 1.65\nGLN CD NE2 HE22 120.022 1.65\nGLN HE21 NE2 HE22 119.956 2.38\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nGLN chi1 N CA CB CG 60.000 10.0 3\nGLN chi2 CA CB CG CD 180.000 10.0 3\nGLN chi3 CB CG CD NE2 -120.000 10.0 6\nGLN hh1 CG CD NE2 HE22 180.000 10.0 2\nGLN sp3_sp3_1 C CA N H 180.000 10.0 3\nGLN sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nGLN chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nGLN plan-1 C 0.020\nGLN plan-1 CA 0.020\nGLN plan-1 O 0.020\nGLN plan-1 OXT 0.020\nGLN plan-2 CD 0.020\nGLN plan-2 CG 0.020\nGLN plan-2 NE2 0.020\nGLN plan-2 OE1 0.020\nGLN plan-3 CD 0.020\nGLN plan-3 HE21 0.020\nGLN plan-3 HE22 0.020\nGLN plan-3 NE2 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nGLN SMILES ACDLabs 10.04 O=C(N)CCC(N)C(=O)O\nGLN SMILES_CANONICAL CACTVS 3.341 N[C@@H](CCC(N)=O)C(O)=O\nGLN SMILES CACTVS 3.341 N[CH](CCC(N)=O)C(O)=O\nGLN SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 C(CC(=O)N)[C@@H](C(=O)O)N\nGLN SMILES \"OpenEye OEToolkits\" 1.5.0 C(CC(=O)N)C(C(=O)O)N\nGLN InChI InChI 1.03 InChI=1S/C5H10N2O3/c6-3(5(9)10)1-2-4(7)8/h3H,1-2,6H2,(H2,7,8)(H,9,10)/t3-/m0/s1\nGLN InChIKey InChI 1.03 ZDXPYRJPNDTMRX-VKHMYHEASA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nGLN acedrg 243 \"dictionary generator\"\nGLN acedrg_database 11 \"data source\"\nGLN rdkit 2017.03.2 \"Chemoinformatics tool\"\nGLN refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [-13.182, 34.854, 120.932]},
      {name: "CA", element: "C", xyz: [-12.158, 35.323, 119.944]},
      {name: "C", element: "C", xyz: [-10.823, 35.559, 120.662]},
      {name: "O", element: "O", xyz: [-9.753, 35.446, 120.063]},
      {name: "CB", element: "C", xyz: [-12.64, 36.581, 119.212]},
      {name: "CG", element: "C", xyz: [-13.023, 37.743, 120.122]},
      {name: "CD", element: "C", xyz: [-13.479, 38.947, 119.333]},
      {name: "OE1", element: "O", xyz: [-14.471, 38.898, 118.609]},
      {name: "NE2", element: "N", xyz: [-12.754, 40.046, 119.468]},
      {name: "OXT", element: "O", xyz: [-10.787, 35.865, 121.854]},
      {name: "H", element: "H", xyz: [-14.102, 34.918, 120.522]},
      {name: "H2", element: "H", xyz: [-13.153, 35.386, 121.732]},
      {name: "H3", element: "H", xyz: [-13.002, 33.938, 121.158]},
      {name: "HA", element: "H", xyz: [-12.028, 34.608, 119.279]},
      {name: "HB3", element: "H", xyz: [-13.415, 36.339, 118.664]},
      {name: "HB2", element: "H", xyz: [-11.929, 36.875, 118.606]},
      {name: "HG3", element: "H", xyz: [-12.254, 37.994, 120.676]},
      {name: "HG2", element: "H", xyz: [-13.747, 37.463, 120.721]},
      {name: "HE21", element: "H", xyz: [-11.872, 40.002, 119.419]},
      {name: "HE22", element: "H", xyz: [-13.15, 40.823, 119.607]},
    ],
  },
  "GLU": {
    name: "GLU",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nGLU GLU \"GLUTAMIC ACID\" peptide 18 10 .\n\ndata_comp_GLU\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nGLU N N NT3 1 88.357 -7.802 -10.134\nGLU CA C CH1 0 87.699 -7.178 -11.327\nGLU C C C 0 88.384 -5.844 -11.650\nGLU O O O 0 88.483 -4.961 -10.798\nGLU CB C CH2 0 86.204 -6.964 -11.076\nGLU CG C CH2 0 85.424 -8.250 -10.867\nGLU CD C C 0 83.927 -8.058 -10.695\nGLU OE1 O O 0 83.291 -7.522 -11.624\nGLU OE2 O OC -1 83.402 -8.445 -9.633\nGLU OXT O OC -1 88.850 -5.625 -12.768\nGLU H H H 0 88.037 -7.348 -9.291\nGLU H2 H H 0 89.312 -7.716 -10.198\nGLU H3 H H 0 88.137 -8.736 -10.096\nGLU HA H H 0 87.810 -7.784 -12.095\nGLU HB3 H H 0 85.825 -6.484 -11.843\nGLU HB2 H H 0 86.098 -6.395 -10.285\nGLU HG3 H H 0 85.769 -8.706 -10.071\nGLU HG2 H H 0 85.574 -8.841 -11.635\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nGLU N n/a CA START\nGLU H N . .\nGLU H2 N . .\nGLU H3 N . .\nGLU CA N C .\nGLU HA CA . .\nGLU CB CA CG .\nGLU HB3 CB . .\nGLU HB2 CB . .\nGLU CG CB CD .\nGLU HG3 CG . .\nGLU HG2 CG . .\nGLU CD CG OE2 .\nGLU OE1 CD . .\nGLU OE2 CD . .\nGLU C CA . END\nGLU O C . .\nGLU OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nGLU N CA SINGLE n 1.488 0.0100 1.488 0.0100\nGLU CA C SINGLE n 1.533 0.0100 1.533 0.0100\nGLU CA CB SINGLE n 1.530 0.0105 1.530 0.0105\nGLU C O DOUBLE n 1.247 0.0187 1.247 0.0187\nGLU C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nGLU CB CG SINGLE n 1.518 0.0153 1.518 0.0153\nGLU CG CD SINGLE n 1.519 0.0109 1.519 0.0109\nGLU CD OE1 DOUBLE n 1.247 0.0187 1.247 0.0187\nGLU CD OE2 SINGLE n 1.247 0.0187 1.247 0.0187\nGLU N H SINGLE n 1.036 0.0160 0.911 0.0200\nGLU N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nGLU N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nGLU CA HA SINGLE n 1.089 0.0100 0.985 0.0200\nGLU CB HB3 SINGLE n 1.089 0.0100 0.980 0.0178\nGLU CB HB2 SINGLE n 1.089 0.0100 0.980 0.0178\nGLU CG HG3 SINGLE n 1.089 0.0100 0.981 0.0185\nGLU CG HG2 SINGLE n 1.089 0.0100 0.981 0.0185\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nGLU CA N H 110.062 1.93\nGLU CA N H2 110.062 1.93\nGLU CA N H3 110.062 1.93\nGLU H N H2 109.028 2.41\nGLU H N H3 109.028 2.41\nGLU H2 N H3 109.028 2.41\nGLU N CA C 109.241 1.50\nGLU N CA CB 110.374 1.62\nGLU N CA HA 108.487 1.50\nGLU C CA CB 111.037 2.40\nGLU C CA HA 108.824 1.50\nGLU CB CA HA 108.967 1.50\nGLU CA C O 117.124 1.50\nGLU CA C OXT 117.124 1.50\nGLU O C OXT 125.752 1.50\nGLU CA CB CG 113.445 1.50\nGLU CA CB HB3 108.549 1.50\nGLU CA CB HB2 108.549 1.50\nGLU CG CB HB3 108.890 1.50\nGLU CG CB HB2 108.890 1.50\nGLU HB3 CB HB2 107.844 1.50\nGLU CB CG CD 114.629 2.24\nGLU CB CG HG3 108.906 1.50\nGLU CB CG HG2 108.906 1.50\nGLU CD CG HG3 108.404 1.50\nGLU CD CG HG2 108.404 1.50\nGLU HG3 CG HG2 107.521 1.50\nGLU CG CD OE1 118.214 1.64\nGLU CG CD OE2 118.214 1.64\nGLU OE1 CD OE2 123.571 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nGLU chi1 N CA CB CG -60.000 10.0 3\nGLU chi2 CA CB CG CD 180.000 10.0 3\nGLU chi3 CB CG CD OE1 60.000 10.0 6\nGLU sp3_sp3_1 C CA N H 180.000 10.0 3\nGLU sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nGLU chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nGLU plan-1 C 0.020\nGLU plan-1 CA 0.020\nGLU plan-1 O 0.020\nGLU plan-1 OXT 0.020\nGLU plan-2 CD 0.020\nGLU plan-2 CG 0.020\nGLU plan-2 OE1 0.020\nGLU plan-2 OE2 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nGLU SMILES ACDLabs 12.01 O=C(O)C(N)CCC(=O)O\nGLU SMILES_CANONICAL CACTVS 3.370 N[C@@H](CCC(O)=O)C(O)=O\nGLU SMILES CACTVS 3.370 N[CH](CCC(O)=O)C(O)=O\nGLU SMILES_CANONICAL \"OpenEye OEToolkits\" 1.7.0 C(CC(=O)O)[C@@H](C(=O)O)N\nGLU SMILES \"OpenEye OEToolkits\" 1.7.0 C(CC(=O)O)C(C(=O)O)N\nGLU InChI InChI 1.03 InChI=1S/C5H9NO4/c6-3(5(9)10)1-2-4(7)8/h3H,1-2,6H2,(H,7,8)(H,9,10)/t3-/m0/s1\nGLU InChIKey InChI 1.03 WHUUTDBJXJRKMK-VKHMYHEASA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nGLU acedrg 243 \"dictionary generator\"\nGLU acedrg_database 11 \"data source\"\nGLU rdkit 2017.03.2 \"Chemoinformatics tool\"\nGLU refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [88.357, -7.802, -10.134]},
      {name: "CA", element: "C", xyz: [87.699, -7.178, -11.327]},
      {name: "C", element: "C", xyz: [88.384, -5.844, -11.65]},
      {name: "O", element: "O", xyz: [88.483, -4.961, -10.798]},
      {name: "CB", element: "C", xyz: [86.204, -6.964, -11.076]},
      {name: "CG", element: "C", xyz: [85.424, -8.25, -10.867]},
      {name: "CD", element: "C", xyz: [83.927, -8.058, -10.695]},
      {name: "OE1", element: "O", xyz: [83.291, -7.522, -11.624]},
      {name: "OE2", element: "O", xyz: [83.402, -8.445, -9.633]},
      {name: "OXT", element: "O", xyz: [88.85, -5.625, -12.768]},
      {name: "H", element: "H", xyz: [88.037, -7.348, -9.291]},
      {name: "H2", element: "H", xyz: [89.312, -7.716, -10.198]},
      {name: "H3", element: "H", xyz: [88.137, -8.736, -10.096]},
      {name: "HA", element: "H", xyz: [87.81, -7.784, -12.095]},
      {name: "HB3", element: "H", xyz: [85.825, -6.484, -11.843]},
      {name: "HB2", element: "H", xyz: [86.098, -6.395, -10.285]},
      {name: "HG3", element: "H", xyz: [85.769, -8.706, -10.071]},
      {name: "HG2", element: "H", xyz: [85.574, -8.841, -11.635]},
    ],
  },
  "GLY": {
    name: "GLY",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nGLY GLY GLYCINE peptide 10 5 .\n\ndata_comp_GLY\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nGLY N N NT3 1 25.326 35.536 47.042\nGLY CA C CH2 0 25.534 37.013 46.902\nGLY C C C 0 26.059 37.396 45.528\nGLY O O O 0 27.164 37.016 45.142\nGLY OXT O OC -1 25.390 38.096 44.766\nGLY H H H 0 25.921 35.188 47.780\nGLY H2 H H 0 25.534 35.072 46.227\nGLY H3 H H 0 24.410 35.369 47.273\nGLY HA3 H H 0 26.177 37.314 47.592\nGLY HA2 H H 0 24.673 37.475 47.063\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nGLY N n/a CA START\nGLY H N . .\nGLY H2 N . .\nGLY H3 N . .\nGLY CA N C .\nGLY HA3 CA . .\nGLY HA2 CA . .\nGLY C CA . END\nGLY O C . .\nGLY OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nGLY N CA SINGLE n 1.476 0.0100 1.476 0.0100\nGLY CA C SINGLE n 1.519 0.0106 1.519 0.0106\nGLY C O DOUBLE n 1.247 0.0187 1.247 0.0187\nGLY C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nGLY N H SINGLE n 1.036 0.0160 0.911 0.0200\nGLY N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nGLY N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nGLY CA HA3 SINGLE n 1.089 0.0100 0.990 0.0200\nGLY CA HA2 SINGLE n 1.089 0.0100 0.990 0.0200\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nGLY CA N H 110.311 2.11\nGLY CA N H2 110.311 2.11\nGLY CA N H3 110.311 2.11\nGLY H N H2 109.021 2.83\nGLY H N H3 109.021 2.83\nGLY H2 N H3 109.021 2.83\nGLY N CA C 111.723 1.50\nGLY N CA HA3 109.054 1.50\nGLY N CA HA2 109.054 1.50\nGLY C CA HA3 109.424 1.50\nGLY C CA HA2 109.424 1.50\nGLY HA3 CA HA2 108.229 1.89\nGLY CA C O 117.073 1.50\nGLY CA C OXT 117.073 1.50\nGLY O C OXT 125.855 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nGLY sp3_sp3_1 C CA N H 180.000 10.0 3\nGLY sp2_sp3_1 O C CA HA3 0.000 10.0 6\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nGLY plan-1 C 0.020\nGLY plan-1 CA 0.020\nGLY plan-1 O 0.020\nGLY plan-1 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nGLY SMILES ACDLabs 10.04 O=C(O)CN\nGLY SMILES_CANONICAL CACTVS 3.341 NCC(O)=O\nGLY SMILES CACTVS 3.341 NCC(O)=O\nGLY SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 C(C(=O)O)N\nGLY SMILES \"OpenEye OEToolkits\" 1.5.0 C(C(=O)O)N\nGLY InChI InChI 1.03 InChI=1S/C2H5NO2/c3-1-2(4)5/h1,3H2,(H,4,5)\nGLY InChIKey InChI 1.03 DHMQDGOQFOQNFH-UHFFFAOYSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nGLY acedrg 243 \"dictionary generator\"\nGLY acedrg_database 11 \"data source\"\nGLY rdkit 2017.03.2 \"Chemoinformatics tool\"\nGLY refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [25.326, 35.536, 47.042]},
      {name: "CA", element: "C", xyz: [25.534, 37.013, 46.902]},
      {name: "C", element: "C", xyz: [26.059, 37.396, 45.528]},
      {name: "O", element: "O", xyz: [27.164, 37.016, 45.142]},
      {name: "OXT", element: "O", xyz: [25.39, 38.096, 44.766]},
      {name: "H", element: "H", xyz: [25.921, 35.188, 47.78]},
      {name: "H2", element: "H", xyz: [25.534, 35.072, 46.227]},
      {name: "H3", element: "H", xyz: [24.41, 35.369, 47.273]},
      {name: "HA3", element: "H", xyz: [26.177, 37.314, 47.592]},
      {name: "HA2", element: "H", xyz: [24.673, 37.475, 47.063]},
    ],
  },
  "HIS": {
    name: "HIS",
    cif: "#\ndata_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nHIS     HIS      HISTIDINE     peptide     21     11     .     \n#\ndata_comp_HIS\n#\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nHIS     N       N       NT3     1       33.581      42.701      -4.625      \nHIS     CA      C       CH1     0       33.452      41.647      -5.685      \nHIS     C       C       C       0       33.844      42.232      -7.048      \nHIS     O       O       O       0       33.197      43.147      -7.556      \nHIS     CB      C       CH2     0       32.032      41.065      -5.696      \nHIS     CG      C       CR5     0       31.846      39.908      -6.622      \nHIS     ND1     N       NR5     1       32.506      38.708      -6.467      \nHIS     CD2     C       CR15    0       31.075      39.768      -7.708      \nHIS     CE1     C       CR15    0       32.165      37.891      -7.454      \nHIS     NE2     N       NR5     0       31.308      38.521      -8.228      \nHIS     OXT     O       OC      -1      34.817      41.799      -7.666      \nHIS     H       H       H       0       32.702      43.186      -4.508      \nHIS     H2      H       H       0       34.262      43.341      -4.853      \nHIS     H3      H       H       0       33.820      42.280      -3.796      \nHIS     HA      H       H       0       34.087      40.921      -5.466      \nHIS     HB3     H       H       0       31.404      41.777      -5.948      \nHIS     HB2     H       H       0       31.803      40.781      -4.784      \nHIS     HD1     H       H       0       33.066      38.514      -5.815      \nHIS     HD2     H       H       0       30.481      40.403      -8.057      \nHIS     HE1     H       H       0       32.482      37.013      -7.577      \nHIS     HE2     H       H       0       30.945      38.195      -8.957      \nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\n HIS      N      n/a    CA     START\n HIS      H      N      .      .\n HIS      H2     N      .      .\n HIS      H3     N      .      .\n HIS      CA     N      C      .\n HIS      HA     CA     .      .\n HIS      CB     CA     CG     .\n HIS      HB3    CB     .      .\n HIS      HB2    CB     .      .\n HIS      CG     CB     ND1    .\n HIS      ND1    CG     CE1    .\n HIS      HD1    ND1    .      .\n HIS      CE1    ND1    NE2    .\n HIS      HE1    CE1    .      .\n HIS      NE2    CE1    CD2    .\n HIS      HE2    NE2    .      .\n HIS      CD2    NE2    HD2    .\n HIS      HD2    CD2    .      .\n HIS      C      CA     .      END\n HIS      O      C      .      .\n HIS      OXT    C      .      .\n HIS      CD2    CG     .    ADD\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nHIS           N          CA      SINGLE       n     1.489  0.0100     1.489  0.0100\nHIS          CA           C      SINGLE       n     1.533  0.0100     1.533  0.0100\nHIS          CA          CB      SINGLE       n     1.533  0.0104     1.533  0.0104\nHIS           C           O      DOUBLE       n     1.251  0.0183     1.251  0.0183\nHIS           C         OXT      SINGLE       n     1.251  0.0183     1.251  0.0183\nHIS          CB          CG      SINGLE       n     1.493  0.0146     1.493  0.0146\nHIS          CG         ND1      SINGLE       n     1.378  0.0100     1.378  0.0100\nHIS          CG         CD2      DOUBLE       n     1.338  0.0174     1.338  0.0174\nHIS         ND1         CE1      DOUBLE       n     1.326  0.0133     1.326  0.0133\nHIS         CD2         NE2      SINGLE       n     1.371  0.0154     1.371  0.0154\nHIS         CE1         NE2      SINGLE       n     1.316  0.0157     1.316  0.0157\nHIS           N           H      SINGLE       n     1.036  0.0160     0.902  0.0102\nHIS           N          H2      SINGLE       n     1.036  0.0160     0.902  0.0102\nHIS           N          H3      SINGLE       n     1.036  0.0160     0.902  0.0102\nHIS          CA          HA      SINGLE       n     1.089  0.0100     0.989  0.0200\nHIS          CB         HB3      SINGLE       n     1.089  0.0100     0.982  0.0176\nHIS          CB         HB2      SINGLE       n     1.089  0.0100     0.982  0.0176\nHIS         ND1         HD1      SINGLE       n     1.016  0.0100     0.881  0.0200\nHIS         CD2         HD2      SINGLE       n     1.082  0.0130     0.937  0.0104\nHIS         CE1         HE1      SINGLE       n     1.082  0.0130     0.942  0.0200\nHIS         NE2         HE2      SINGLE       n     1.016  0.0100     0.877  0.0200\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nHIS          CA           N           H     109.992    2.14\nHIS          CA           N          H2     109.992    2.14\nHIS          CA           N          H3     109.992    2.14\nHIS           H           N          H2     109.032    3.00\nHIS           H           N          H3     109.032    3.00\nHIS          H2           N          H3     109.032    3.00\nHIS           N          CA           C     109.292    1.55\nHIS           N          CA          CB     110.573    1.50\nHIS           N          CA          HA     108.019    2.27\nHIS           C          CA          CB     111.874    3.00\nHIS           C          CA          HA     108.290    1.50\nHIS          CB          CA          HA     108.890    2.34\nHIS          CA           C           O     117.058    3.00\nHIS          CA           C         OXT     117.058    3.00\nHIS           O           C         OXT     125.883    1.50\nHIS          CA          CB          CG     113.931    1.83\nHIS          CA          CB         HB3     108.697    1.50\nHIS          CA          CB         HB2     108.697    1.50\nHIS          CG          CB         HB3     108.948    1.50\nHIS          CG          CB         HB2     108.948    1.50\nHIS         HB3          CB         HB2     107.846    2.68\nHIS          CB          CG         ND1     122.940    3.00\nHIS          CB          CG         CD2     131.173    3.00\nHIS         ND1          CG         CD2     105.887    1.50\nHIS          CG         ND1         CE1     109.313    1.50\nHIS          CG         ND1         HD1     125.337    2.60\nHIS         CE1         ND1         HD1     125.350    3.00\nHIS          CG         CD2         NE2     107.589    1.50\nHIS          CG         CD2         HD2     126.688    3.00\nHIS         NE2         CD2         HD2     125.723    3.00\nHIS         ND1         CE1         NE2     108.287    1.50\nHIS         ND1         CE1         HE1     125.729    2.42\nHIS         NE2         CE1         HE1     125.984    1.51\nHIS         CD2         NE2         CE1     108.930    1.50\nHIS         CD2         NE2         HE2     125.575    3.00\nHIS         CE1         NE2         HE2     125.489    3.00\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nHIS                  chi1           N          CA          CB          CG     180.000    10.0     3\nHIS                  chi2          CA          CB          CG         CD2    -120.000    10.0     6\nHIS             sp3_sp3_1           C          CA           N           H     180.000    10.0     3\nHIS            sp2_sp2_17         NE2         CD2          CG         ND1       0.000     5.0     2\nHIS            sp2_sp2_13          CG         CD2         NE2         CE1       0.000     5.0     2\nHIS             sp2_sp2_5         NE2         CE1         ND1          CG       0.000     5.0     2\nHIS             sp2_sp2_9         ND1         CE1         NE2         CD2       0.000     5.0     2\nHIS             sp2_sp2_1         CD2          CG         ND1         CE1       0.000     5.0     2\nHIS             sp2_sp3_1           O           C          CA           N       0.000    10.0     6\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nHIS    chir_1    CA    N    C    CB    positive\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nHIS    plan-1      CB       0.020\nHIS    plan-1      CG       0.020\nHIS    plan-1      ND1      0.020\nHIS    plan-1      CE1      0.020\nHIS    plan-1      CD2      0.020\nHIS    plan-1      NE2      0.020\nHIS    plan-1      HD1      0.020\nHIS    plan-1      HD2      0.020\nHIS    plan-1      HE1      0.020\nHIS    plan-1      HE2      0.020\nHIS    plan-2      C        0.020\nHIS    plan-2      CA       0.020\nHIS    plan-2      O        0.020\nHIS    plan-2      OXT      0.020\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nHIS SMILES           ACDLabs              10.04 \"O=C(O)C(N)Cc1cnc[nH+]1\"\nHIS SMILES_CANONICAL CACTVS               3.341 \"N[C@@H](Cc1c[nH]c[nH+]1)C(O)=O\"\nHIS SMILES           CACTVS               3.341 \"N[CH](Cc1c[nH]c[nH+]1)C(O)=O\"\nHIS SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 \"c1c([nH+]c[nH]1)C[C@@H](C(=O)O)N\"\nHIS SMILES           \"OpenEye OEToolkits\" 1.5.0 \"c1c([nH+]c[nH]1)CC(C(=O)O)N\"\nHIS InChI            InChI                1.03  \"InChI=1S/C6H9N3O2/c7-5(6(10)11)1-4-2-8-3-9-4/h2-3,5H,1,7H2,(H,8,9)(H,10,11)/p+1/t5-/m0/s1\"\nHIS InChIKey         InChI                1.03  HNDVDQJCIGZPNO-YFKPBYRVSA-O\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nHIS acedrg               249         \"dictionary generator\"                  \nHIS acedrg_database      12          \"data source\"                           \nHIS rdkit                2017.03.2   \"Chemoinformatics tool\"\nHIS refmac5              5.8.0267    \"optimization tool\"                     \n",
    atoms: [
      {name: "N", element: "N", xyz: [33.581, 42.701, -4.625]},
      {name: "CA", element: "C", xyz: [33.452, 41.647, -5.685]},
      {name: "C", element: "C", xyz: [33.844, 42.232, -7.048]},
      {name: "O", element: "O", xyz: [33.197, 43.147, -7.556]},
      {name: "CB", element: "C", xyz: [32.032, 41.065, -5.696]},
      {name: "CG", element: "C", xyz: [31.846, 39.908, -6.622]},
      {name: "ND1", element: "N", xyz: [32.506, 38.708, -6.467]},
      {name: "CD2", element: "C", xyz: [31.075, 39.768, -7.708]},
      {name: "CE1", element: "C", xyz: [32.165, 37.891, -7.454]},
      {name: "NE2", element: "N", xyz: [31.308, 38.521, -8.228]},
      {name: "OXT", element: "O", xyz: [34.817, 41.799, -7.666]},
      {name: "H", element: "H", xyz: [32.702, 43.186, -4.508]},
      {name: "H2", element: "H", xyz: [34.262, 43.341, -4.853]},
      {name: "H3", element: "H", xyz: [33.82, 42.28, -3.796]},
      {name: "HA", element: "H", xyz: [34.087, 40.921, -5.466]},
      {name: "HB3", element: "H", xyz: [31.404, 41.777, -5.948]},
      {name: "HB2", element: "H", xyz: [31.803, 40.781, -4.784]},
      {name: "HD1", element: "H", xyz: [33.066, 38.514, -5.815]},
      {name: "HD2", element: "H", xyz: [30.481, 40.403, -8.057]},
      {name: "HE1", element: "H", xyz: [32.482, 37.013, -7.577]},
      {name: "HE2", element: "H", xyz: [30.945, 38.195, -8.957]},
    ],
  },
  "ILE": {
    name: "ILE",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nILE ILE ISOLEUCINE peptide 22 9 .\n\ndata_comp_ILE\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nILE N N NT3 1 52.887 76.421 68.428\nILE CA C CH1 0 53.153 77.786 67.855\nILE C C C 0 51.855 78.335 67.247\nILE O O O 0 51.042 77.595 66.692\nILE CB C CH1 0 54.320 77.763 66.839\nILE CG1 C CH2 0 54.783 79.180 66.479\nILE CG2 C CH3 0 53.984 76.949 65.592\nILE CD1 C CH3 0 56.055 79.232 65.659\nILE OXT O OC -1 51.594 79.537 67.300\nILE H H H 0 53.753 75.918 68.558\nILE H2 H H 0 52.310 75.910 67.854\nILE H3 H H 0 52.459 76.524 69.281\nILE HA H H 0 53.411 78.371 68.590\nILE HB H H 0 55.083 77.317 67.282\nILE HG12 H H 0 54.924 79.684 67.308\nILE HG13 H H 0 54.070 79.627 65.974\nILE HG21 H H 0 53.334 76.260 65.806\nILE HG22 H H 0 54.793 76.529 65.252\nILE HG23 H H 0 53.615 77.535 64.908\nILE HD11 H H 0 56.495 78.364 65.676\nILE HD12 H H 0 56.654 79.903 66.031\nILE HD13 H H 0 55.840 79.467 64.739\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nILE N n/a CA START\nILE H N . .\nILE H2 N . .\nILE H3 N . .\nILE CA N C .\nILE HA CA . .\nILE CB CA CG2 .\nILE HB CB . .\nILE CG1 CB CD1 .\nILE HG13 CG1 . .\nILE HG12 CG1 . .\nILE CD1 CG1 HD13 .\nILE HD11 CD1 . .\nILE HD12 CD1 . .\nILE HD13 CD1 . .\nILE CG2 CB HG23 .\nILE HG21 CG2 . .\nILE HG22 CG2 . .\nILE HG23 CG2 . .\nILE C CA . END\nILE O C . .\nILE OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nILE N CA SINGLE n 1.494 0.0100 1.494 0.0100\nILE CA C SINGLE n 1.533 0.0100 1.533 0.0100\nILE CA CB SINGLE n 1.542 0.0100 1.542 0.0100\nILE C O DOUBLE n 1.247 0.0187 1.247 0.0187\nILE C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nILE CB CG1 SINGLE n 1.531 0.0100 1.531 0.0100\nILE CB CG2 SINGLE n 1.521 0.0135 1.521 0.0135\nILE CG1 CD1 SINGLE n 1.511 0.0200 1.511 0.0200\nILE N H SINGLE n 1.036 0.0160 0.911 0.0200\nILE N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nILE N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nILE CA HA SINGLE n 1.089 0.0100 0.974 0.0200\nILE CB HB SINGLE n 1.089 0.0100 0.989 0.0175\nILE CG1 HG12 SINGLE n 1.089 0.0100 0.981 0.0160\nILE CG1 HG13 SINGLE n 1.089 0.0100 0.981 0.0160\nILE CG2 HG21 SINGLE n 1.089 0.0100 0.973 0.0146\nILE CG2 HG22 SINGLE n 1.089 0.0100 0.973 0.0146\nILE CG2 HG23 SINGLE n 1.089 0.0100 0.973 0.0146\nILE CD1 HD11 SINGLE n 1.089 0.0100 0.973 0.0157\nILE CD1 HD12 SINGLE n 1.089 0.0100 0.973 0.0157\nILE CD1 HD13 SINGLE n 1.089 0.0100 0.973 0.0157\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nILE CA N H 110.089 1.83\nILE CA N H2 110.089 1.83\nILE CA N H3 110.089 1.83\nILE H N H2 109.028 2.41\nILE H N H3 109.028 2.41\nILE H2 N H3 109.028 2.41\nILE N CA C 108.763 1.50\nILE N CA CB 110.820 1.50\nILE N CA HA 108.396 1.50\nILE C CA CB 111.764 1.50\nILE C CA HA 108.542 1.50\nILE CB CA HA 108.383 1.50\nILE CA C O 117.133 1.50\nILE CA C OXT 117.133 1.50\nILE O C OXT 125.734 1.50\nILE CA CB CG1 111.759 1.50\nILE CA CB CG2 110.782 1.50\nILE CA CB HB 107.412 1.50\nILE CG1 CB CG2 111.775 1.50\nILE CG1 CB HB 107.402 1.50\nILE CG2 CB HB 107.601 1.50\nILE CB CG1 CD1 113.965 1.50\nILE CB CG1 HG12 108.703 1.50\nILE CB CG1 HG13 108.703 1.50\nILE CD1 CG1 HG12 108.717 1.50\nILE CD1 CG1 HG13 108.717 1.50\nILE HG12 CG1 HG13 107.862 1.50\nILE CB CG2 HG21 109.662 1.50\nILE CB CG2 HG22 109.662 1.50\nILE CB CG2 HG23 109.662 1.50\nILE HG21 CG2 HG22 109.411 1.50\nILE HG21 CG2 HG23 109.411 1.50\nILE HG22 CG2 HG23 109.411 1.50\nILE CG1 CD1 HD11 109.566 1.50\nILE CG1 CD1 HD12 109.566 1.50\nILE CG1 CD1 HD13 109.566 1.50\nILE HD11 CD1 HD12 109.380 1.50\nILE HD11 CD1 HD13 109.380 1.50\nILE HD12 CD1 HD13 109.380 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nILE chi1 N CA CB CG2 60.000 10.0 3\nILE chi2 CA CB CG1 CD1 180.000 10.0 3\nILE hh1 CA CB CG2 HG23 180.000 10.0 3\nILE hh2 CB CG1 CD1 HD13 180.000 10.0 3\nILE sp3_sp3_1 C CA N H 180.000 10.0 3\nILE sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nILE chir_1 CA N C CB positive\nILE chir_2 CB CA CG1 CG2 positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nILE plan-1 C 0.020\nILE plan-1 CA 0.020\nILE plan-1 O 0.020\nILE plan-1 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nILE SMILES ACDLabs 10.04 O=C(O)C(N)C(C)CC\nILE SMILES_CANONICAL CACTVS 3.341 CC[C@H](C)[C@H](N)C(O)=O\nILE SMILES CACTVS 3.341 CC[CH](C)[CH](N)C(O)=O\nILE SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 CC[C@H](C)[C@@H](C(=O)O)N\nILE SMILES \"OpenEye OEToolkits\" 1.5.0 CCC(C)C(C(=O)O)N\nILE InChI InChI 1.03 InChI=1S/C6H13NO2/c1-3-4(2)5(7)6(8)9/h4-5H,3,7H2,1-2H3,(H,8,9)/t4-,5-/m0/s1\nILE InChIKey InChI 1.03 AGPKZVBTJJNPAG-WHFBIAKZSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nILE acedrg 243 \"dictionary generator\"\nILE acedrg_database 11 \"data source\"\nILE rdkit 2017.03.2 \"Chemoinformatics tool\"\nILE refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [52.887, 76.421, 68.428]},
      {name: "CA", element: "C", xyz: [53.153, 77.786, 67.855]},
      {name: "C", element: "C", xyz: [51.855, 78.335, 67.247]},
      {name: "O", element: "O", xyz: [51.042, 77.595, 66.692]},
      {name: "CB", element: "C", xyz: [54.32, 77.763, 66.839]},
      {name: "CG1", element: "C", xyz: [54.783, 79.18, 66.479]},
      {name: "CG2", element: "C", xyz: [53.984, 76.949, 65.592]},
      {name: "CD1", element: "C", xyz: [56.055, 79.232, 65.659]},
      {name: "OXT", element: "O", xyz: [51.594, 79.537, 67.3]},
      {name: "H", element: "H", xyz: [53.753, 75.918, 68.558]},
      {name: "H2", element: "H", xyz: [52.31, 75.91, 67.854]},
      {name: "H3", element: "H", xyz: [52.459, 76.524, 69.281]},
      {name: "HA", element: "H", xyz: [53.411, 78.371, 68.59]},
      {name: "HB", element: "H", xyz: [55.083, 77.317, 67.282]},
      {name: "HG12", element: "H", xyz: [54.924, 79.684, 67.308]},
      {name: "HG13", element: "H", xyz: [54.07, 79.627, 65.974]},
      {name: "HG21", element: "H", xyz: [53.334, 76.26, 65.806]},
      {name: "HG22", element: "H", xyz: [54.793, 76.529, 65.252]},
      {name: "HG23", element: "H", xyz: [53.615, 77.535, 64.908]},
      {name: "HD11", element: "H", xyz: [56.495, 78.364, 65.676]},
      {name: "HD12", element: "H", xyz: [56.654, 79.903, 66.031]},
      {name: "HD13", element: "H", xyz: [55.84, 79.467, 64.739]},
    ],
  },
  "LEU": {
    name: "LEU",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nLEU LEU LEUCINE peptide 22 9 .\n\ndata_comp_LEU\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nLEU N N NT3 1 16.411 16.084 52.231\nLEU CA C CH1 0 15.165 16.888 52.007\nLEU C C C 0 13.948 15.955 52.035\nLEU O O O 0 12.852 16.354 52.430\nLEU CB C CH2 0 15.242 17.628 50.663\nLEU CG C CH1 0 16.372 18.647 50.461\nLEU CD1 C CH3 0 16.562 19.542 51.683\nLEU CD2 C CH3 0 17.691 17.985 50.060\nLEU OXT O OC -1 14.036 14.785 51.663\nLEU H H H 0 16.696 15.636 51.371\nLEU H2 H H 0 16.257 15.410 52.898\nLEU H3 H H 0 17.109 16.660 52.544\nLEU HA H H 0 15.076 17.536 52.742\nLEU HB3 H H 0 14.394 18.097 50.537\nLEU HB2 H H 0 15.302 16.957 49.954\nLEU HG H H 0 16.103 19.234 49.711\nLEU HD11 H H 0 15.695 19.855 51.993\nLEU HD12 H H 0 17.114 20.307 51.442\nLEU HD13 H H 0 16.998 19.041 52.394\nLEU HD21 H H 0 17.516 17.151 49.591\nLEU HD22 H H 0 18.225 17.802 50.852\nLEU HD23 H H 0 18.186 18.584 49.473\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nLEU N n/a CA START\nLEU H N . .\nLEU H2 N . .\nLEU H3 N . .\nLEU CA N C .\nLEU HA CA . .\nLEU CB CA CG .\nLEU HB3 CB . .\nLEU HB2 CB . .\nLEU CG CB CD2 .\nLEU HG CG . .\nLEU CD1 CG HD13 .\nLEU HD11 CD1 . .\nLEU HD12 CD1 . .\nLEU HD13 CD1 . .\nLEU CD2 CG HD23 .\nLEU HD21 CD2 . .\nLEU HD22 CD2 . .\nLEU HD23 CD2 . .\nLEU C CA . END\nLEU O C . .\nLEU OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nLEU N CA SINGLE n 1.488 0.0100 1.488 0.0100\nLEU CA C SINGLE n 1.533 0.0100 1.533 0.0100\nLEU CA CB SINGLE n 1.532 0.0100 1.532 0.0100\nLEU C O DOUBLE n 1.247 0.0187 1.247 0.0187\nLEU C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nLEU CB CG SINGLE n 1.528 0.0105 1.528 0.0105\nLEU CG CD1 SINGLE n 1.521 0.0151 1.521 0.0151\nLEU CG CD2 SINGLE n 1.521 0.0151 1.521 0.0151\nLEU N H SINGLE n 1.036 0.0160 0.911 0.0200\nLEU N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nLEU N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nLEU CA HA SINGLE n 1.089 0.0100 0.985 0.0200\nLEU CB HB3 SINGLE n 1.089 0.0100 0.978 0.0119\nLEU CB HB2 SINGLE n 1.089 0.0100 0.978 0.0119\nLEU CG HG SINGLE n 1.089 0.0100 0.989 0.0162\nLEU CD1 HD11 SINGLE n 1.089 0.0100 0.973 0.0146\nLEU CD1 HD12 SINGLE n 1.089 0.0100 0.973 0.0146\nLEU CD1 HD13 SINGLE n 1.089 0.0100 0.973 0.0146\nLEU CD2 HD21 SINGLE n 1.089 0.0100 0.973 0.0146\nLEU CD2 HD22 SINGLE n 1.089 0.0100 0.973 0.0146\nLEU CD2 HD23 SINGLE n 1.089 0.0100 0.973 0.0146\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nLEU CA N H 110.062 1.93\nLEU CA N H2 110.062 1.93\nLEU CA N H3 110.062 1.93\nLEU H N H2 109.028 2.41\nLEU H N H3 109.028 2.41\nLEU H2 N H3 109.028 2.41\nLEU N CA C 109.241 1.50\nLEU N CA CB 108.955 1.50\nLEU N CA HA 108.487 1.50\nLEU C CA CB 111.075 1.50\nLEU C CA HA 108.824 1.50\nLEU CB CA HA 109.549 1.50\nLEU CA C O 117.124 1.50\nLEU CA C OXT 117.124 1.50\nLEU O C OXT 125.752 1.50\nLEU CA CB CG 115.442 1.50\nLEU CA CB HB3 108.332 1.50\nLEU CA CB HB2 108.332 1.50\nLEU CG CB HB3 108.478 1.50\nLEU CG CB HB2 108.478 1.50\nLEU HB3 CB HB2 107.542 1.50\nLEU CB CG CD1 110.880 1.50\nLEU CB CG CD2 110.880 1.50\nLEU CB CG HG 108.053 1.50\nLEU CD1 CG CD2 110.507 1.50\nLEU CD1 CG HG 108.052 1.50\nLEU CD2 CG HG 108.052 1.50\nLEU CG CD1 HD11 109.488 1.50\nLEU CG CD1 HD12 109.488 1.50\nLEU CG CD1 HD13 109.488 1.50\nLEU HD11 CD1 HD12 109.411 1.50\nLEU HD11 CD1 HD13 109.411 1.50\nLEU HD12 CD1 HD13 109.411 1.50\nLEU CG CD2 HD21 109.488 1.50\nLEU CG CD2 HD22 109.488 1.50\nLEU CG CD2 HD23 109.488 1.50\nLEU HD21 CD2 HD22 109.411 1.50\nLEU HD21 CD2 HD23 109.411 1.50\nLEU HD22 CD2 HD23 109.411 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nLEU chi1 N CA CB CG -60.000 10.0 3\nLEU chi2 CA CB CG CD1 -45.000 10.0 3\nLEU hh1 CB CG CD1 HD13 -45.000 10.0 3\nLEU hh2 CB CG CD2 HD23 180.000 10.0 3\nLEU sp3_sp3_1 C CA N H 180.000 10.0 3\nLEU sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nLEU chir_1 CA N C CB positive\nLEU chir_2 CG CB CD1 CD2 both\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nLEU plan-1 C 0.020\nLEU plan-1 CA 0.020\nLEU plan-1 O 0.020\nLEU plan-1 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nLEU SMILES ACDLabs 10.04 O=C(O)C(N)CC(C)C\nLEU SMILES_CANONICAL CACTVS 3.341 CC(C)C[C@H](N)C(O)=O\nLEU SMILES CACTVS 3.341 CC(C)C[CH](N)C(O)=O\nLEU SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 CC(C)C[C@@H](C(=O)O)N\nLEU SMILES \"OpenEye OEToolkits\" 1.5.0 CC(C)CC(C(=O)O)N\nLEU InChI InChI 1.03 InChI=1S/C6H13NO2/c1-4(2)3-5(7)6(8)9/h4-5H,3,7H2,1-2H3,(H,8,9)/t5-/m0/s1\nLEU InChIKey InChI 1.03 ROHFNLRQFUQHCH-YFKPBYRVSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nLEU acedrg 243 \"dictionary generator\"\nLEU acedrg_database 11 \"data source\"\nLEU rdkit 2017.03.2 \"Chemoinformatics tool\"\nLEU refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [16.411, 16.084, 52.231]},
      {name: "CA", element: "C", xyz: [15.165, 16.888, 52.007]},
      {name: "C", element: "C", xyz: [13.948, 15.955, 52.035]},
      {name: "O", element: "O", xyz: [12.852, 16.354, 52.43]},
      {name: "CB", element: "C", xyz: [15.242, 17.628, 50.663]},
      {name: "CG", element: "C", xyz: [16.372, 18.647, 50.461]},
      {name: "CD1", element: "C", xyz: [16.562, 19.542, 51.683]},
      {name: "CD2", element: "C", xyz: [17.691, 17.985, 50.06]},
      {name: "OXT", element: "O", xyz: [14.036, 14.785, 51.663]},
      {name: "H", element: "H", xyz: [16.696, 15.636, 51.371]},
      {name: "H2", element: "H", xyz: [16.257, 15.41, 52.898]},
      {name: "H3", element: "H", xyz: [17.109, 16.66, 52.544]},
      {name: "HA", element: "H", xyz: [15.076, 17.536, 52.742]},
      {name: "HB3", element: "H", xyz: [14.394, 18.097, 50.537]},
      {name: "HB2", element: "H", xyz: [15.302, 16.957, 49.954]},
      {name: "HG", element: "H", xyz: [16.103, 19.234, 49.711]},
      {name: "HD11", element: "H", xyz: [15.695, 19.855, 51.993]},
      {name: "HD12", element: "H", xyz: [17.114, 20.307, 51.442]},
      {name: "HD13", element: "H", xyz: [16.998, 19.041, 52.394]},
      {name: "HD21", element: "H", xyz: [17.516, 17.151, 49.591]},
      {name: "HD22", element: "H", xyz: [18.225, 17.802, 50.852]},
      {name: "HD23", element: "H", xyz: [18.186, 18.584, 49.473]},
    ],
  },
  "LYS": {
    name: "LYS",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nLYS LYS LYSINE peptide 25 10 .\n\ndata_comp_LYS\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nLYS N N NT3 1 38.134 40.603 -3.577\nLYS CA C CH1 0 39.079 39.656 -4.250\nLYS C C C 0 38.446 39.121 -5.542\nLYS O O O 0 37.236 39.206 -5.758\nLYS CB C CH2 0 39.474 38.516 -3.303\nLYS CG C CH2 0 38.326 37.709 -2.705\nLYS CD C CH2 0 38.793 36.584 -1.805\nLYS CE C CH2 0 37.658 35.737 -1.267\nLYS NZ N NT3 1 36.721 36.512 -0.417\nLYS OXT O OC -1 39.143 38.584 -6.404\nLYS H H H 0 38.459 40.795 -2.640\nLYS H2 H H 0 37.251 40.226 -3.535\nLYS H3 H H 0 38.102 41.424 -4.074\nLYS HA H H 0 39.892 40.158 -4.490\nLYS HB3 H H 0 39.997 38.898 -2.567\nLYS HB2 H H 0 40.059 37.901 -3.792\nLYS HG3 H H 0 37.789 37.330 -3.432\nLYS HG2 H H 0 37.751 38.313 -2.189\nLYS HD3 H H 0 39.290 36.966 -1.049\nLYS HD2 H H 0 39.407 36.008 -2.307\nLYS HE3 H H 0 38.025 35.001 -0.740\nLYS HE2 H H 0 37.160 35.351 -2.012\nLYS HZ1 H H 0 37.148 37.219 -0.039\nLYS HZ2 H H 0 36.394 35.982 0.242\nLYS HZ3 H H 0 36.030 36.817 -0.920\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nLYS N n/a CA START\nLYS H N . .\nLYS H2 N . .\nLYS H3 N . .\nLYS CA N C .\nLYS HA CA . .\nLYS CB CA CG .\nLYS HB3 CB . .\nLYS HB2 CB . .\nLYS CG CB CD .\nLYS HG3 CG . .\nLYS HG2 CG . .\nLYS CD CG CE .\nLYS HD3 CD . .\nLYS HD2 CD . .\nLYS CE CD NZ .\nLYS HE3 CE . .\nLYS HE2 CE . .\nLYS NZ CE HZ3 .\nLYS HZ1 NZ . .\nLYS HZ2 NZ . .\nLYS HZ3 NZ . .\nLYS C CA . END\nLYS O C . .\nLYS OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nLYS N CA SINGLE n 1.488 0.0100 1.488 0.0100\nLYS CA C SINGLE n 1.533 0.0100 1.533 0.0100\nLYS CA CB SINGLE n 1.532 0.0100 1.532 0.0100\nLYS C O DOUBLE n 1.247 0.0187 1.247 0.0187\nLYS C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nLYS CB CG SINGLE n 1.523 0.0114 1.523 0.0114\nLYS CG CD SINGLE n 1.514 0.0200 1.514 0.0200\nLYS CD CE SINGLE n 1.514 0.0111 1.514 0.0111\nLYS CE NZ SINGLE n 1.482 0.0123 1.482 0.0123\nLYS N H SINGLE n 1.036 0.0160 0.911 0.0200\nLYS N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nLYS N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nLYS CA HA SINGLE n 1.089 0.0100 0.985 0.0200\nLYS CB HB3 SINGLE n 1.089 0.0100 0.980 0.0160\nLYS CB HB2 SINGLE n 1.089 0.0100 0.980 0.0160\nLYS CG HG3 SINGLE n 1.089 0.0100 0.981 0.0163\nLYS CG HG2 SINGLE n 1.089 0.0100 0.981 0.0163\nLYS CD HD3 SINGLE n 1.089 0.0100 0.981 0.0160\nLYS CD HD2 SINGLE n 1.089 0.0100 0.981 0.0160\nLYS CE HE3 SINGLE n 1.089 0.0100 0.976 0.0165\nLYS CE HE2 SINGLE n 1.089 0.0100 0.976 0.0165\nLYS NZ HZ1 SINGLE n 1.036 0.0160 0.907 0.0200\nLYS NZ HZ2 SINGLE n 1.036 0.0160 0.907 0.0200\nLYS NZ HZ3 SINGLE n 1.036 0.0160 0.907 0.0200\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nLYS CA N H 110.062 1.93\nLYS CA N H2 110.062 1.93\nLYS CA N H3 110.062 1.93\nLYS H N H2 109.028 2.41\nLYS H N H3 109.028 2.41\nLYS H2 N H3 109.028 2.41\nLYS N CA C 109.241 1.50\nLYS N CA CB 110.374 1.62\nLYS N CA HA 108.487 1.50\nLYS C CA CB 111.037 2.40\nLYS C CA HA 108.824 1.50\nLYS CB CA HA 108.967 1.50\nLYS CA C O 117.124 1.50\nLYS CA C OXT 117.124 1.50\nLYS O C OXT 125.752 1.50\nLYS CA CB CG 115.311 1.56\nLYS CA CB HB3 108.549 1.50\nLYS CA CB HB2 108.549 1.50\nLYS CG CB HB3 108.650 1.50\nLYS CG CB HB2 108.650 1.50\nLYS HB3 CB HB2 107.844 1.50\nLYS CB CG CD 113.328 2.00\nLYS CB CG HG3 108.601 1.50\nLYS CB CG HG2 108.601 1.50\nLYS CD CG HG3 108.806 1.50\nLYS CD CG HG2 108.806 1.50\nLYS HG3 CG HG2 107.646 1.50\nLYS CG CD CE 113.073 1.98\nLYS CG CD HD3 109.041 1.50\nLYS CG CD HD2 109.041 1.50\nLYS CE CD HD3 108.889 1.50\nLYS CE CD HD2 108.889 1.50\nLYS HD3 CD HD2 107.927 1.57\nLYS CD CE NZ 111.734 1.84\nLYS CD CE HE3 109.576 1.50\nLYS CD CE HE2 109.576 1.50\nLYS NZ CE HE3 108.989 1.50\nLYS NZ CE HE2 108.989 1.50\nLYS HE3 CE HE2 108.067 1.50\nLYS CE NZ HZ1 109.775 1.81\nLYS CE NZ HZ2 109.775 1.81\nLYS CE NZ HZ3 109.775 1.81\nLYS HZ1 NZ HZ2 109.021 2.83\nLYS HZ1 NZ HZ3 109.021 2.83\nLYS HZ2 NZ HZ3 109.021 2.83\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nLYS chi1 N CA CB CG 60.000 10.0 3\nLYS chi2 CA CB CG CD 180.000 10.0 3\nLYS chi3 CB CG CD CE 180.000 10.0 3\nLYS chi4 CG CD CE NZ -60.000 10.0 3\nLYS hh1 CD CE NZ HZ3 180.000 10.0 3\nLYS sp3_sp3_1 C CA N H 180.000 10.0 3\nLYS sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nLYS chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nLYS plan-1 C 0.020\nLYS plan-1 CA 0.020\nLYS plan-1 O 0.020\nLYS plan-1 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nLYS SMILES ACDLabs 10.04 O=C(O)C(N)CCCC[NH3+]\nLYS SMILES_CANONICAL CACTVS 3.341 N[C@@H](CCCC[NH3+])C(O)=O\nLYS SMILES CACTVS 3.341 N[CH](CCCC[NH3+])C(O)=O\nLYS SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 C(CC[NH3+])C[C@@H](C(=O)O)N\nLYS SMILES \"OpenEye OEToolkits\" 1.5.0 C(CC[NH3+])CC(C(=O)O)N\nLYS InChI InChI 1.03 InChI=1S/C6H14N2O2/c7-4-2-1-3-5(8)6(9)10/h5H,1-4,7-8H2,(H,9,10)/p+1/t5-/m0/s1\nLYS InChIKey InChI 1.03 KDXKERNSBIXSRK-YFKPBYRVSA-O\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nLYS acedrg 243 \"dictionary generator\"\nLYS acedrg_database 11 \"data source\"\nLYS rdkit 2017.03.2 \"Chemoinformatics tool\"\nLYS refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [38.134, 40.603, -3.577]},
      {name: "CA", element: "C", xyz: [39.079, 39.656, -4.25]},
      {name: "C", element: "C", xyz: [38.446, 39.121, -5.542]},
      {name: "O", element: "O", xyz: [37.236, 39.206, -5.758]},
      {name: "CB", element: "C", xyz: [39.474, 38.516, -3.303]},
      {name: "CG", element: "C", xyz: [38.326, 37.709, -2.705]},
      {name: "CD", element: "C", xyz: [38.793, 36.584, -1.805]},
      {name: "CE", element: "C", xyz: [37.658, 35.737, -1.267]},
      {name: "NZ", element: "N", xyz: [36.721, 36.512, -0.417]},
      {name: "OXT", element: "O", xyz: [39.143, 38.584, -6.404]},
      {name: "H", element: "H", xyz: [38.459, 40.795, -2.64]},
      {name: "H2", element: "H", xyz: [37.251, 40.226, -3.535]},
      {name: "H3", element: "H", xyz: [38.102, 41.424, -4.074]},
      {name: "HA", element: "H", xyz: [39.892, 40.158, -4.49]},
      {name: "HB3", element: "H", xyz: [39.997, 38.898, -2.567]},
      {name: "HB2", element: "H", xyz: [40.059, 37.901, -3.792]},
      {name: "HG3", element: "H", xyz: [37.789, 37.33, -3.432]},
      {name: "HG2", element: "H", xyz: [37.751, 38.313, -2.189]},
      {name: "HD3", element: "H", xyz: [39.29, 36.966, -1.049]},
      {name: "HD2", element: "H", xyz: [39.407, 36.008, -2.307]},
      {name: "HE3", element: "H", xyz: [38.025, 35.001, -0.74]},
      {name: "HE2", element: "H", xyz: [37.16, 35.351, -2.012]},
      {name: "HZ1", element: "H", xyz: [37.148, 37.219, -0.039]},
      {name: "HZ2", element: "H", xyz: [36.394, 35.982, 0.242]},
      {name: "HZ3", element: "H", xyz: [36.03, 36.817, -0.92]},
    ],
  },
  "MET": {
    name: "MET",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nMET MET METHIONINE peptide 20 9 .\n\ndata_comp_MET\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nMET N N NT3 1 16.037 15.646 51.828\nMET CA C CH1 0 15.071 16.764 51.610\nMET C C C 0 13.643 16.205 51.599\nMET O O O 0 12.690 16.897 51.959\nMET CB C CH2 0 15.363 17.484 50.287\nMET CG C CH2 0 16.318 18.656 50.431\nMET SD S S2 0 17.944 18.169 51.065\nMET CE C CH3 0 18.820 17.872 49.530\nMET OXT O OC -1 13.412 15.053 51.231\nMET H H H 0 16.981 15.997 51.742\nMET H2 H H 0 15.894 14.957 51.174\nMET H3 H H 0 15.912 15.283 52.708\nMET HA H H 0 15.157 17.399 52.358\nMET HB3 H H 0 14.521 17.810 49.907\nMET HB2 H H 0 15.743 16.840 49.657\nMET HG3 H H 0 15.926 19.317 51.041\nMET HG2 H H 0 16.435 19.085 49.557\nMET HE3 H H 0 19.747 17.685 49.721\nMET HE2 H H 0 18.758 18.654 48.968\nMET HE1 H H 0 18.426 17.117 49.077\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nMET N CA SINGLE n 1.488 0.0100 1.488 0.0100\nMET CA C SINGLE n 1.533 0.0100 1.533 0.0100\nMET CA CB SINGLE n 1.532 0.0100 1.532 0.0100\nMET C O DOUBLE n 1.247 0.0187 1.247 0.0187\nMET C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nMET CB CG SINGLE n 1.517 0.0200 1.517 0.0200\nMET CG SD SINGLE n 1.811 0.0200 1.811 0.0200\nMET SD CE SINGLE n 1.792 0.0100 1.792 0.0100\nMET N H SINGLE n 1.036 0.0160 0.911 0.0200\nMET N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nMET N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nMET CA HA SINGLE n 1.089 0.0100 0.985 0.0200\nMET CB HB3 SINGLE n 1.089 0.0100 0.978 0.0200\nMET CB HB2 SINGLE n 1.089 0.0100 0.978 0.0200\nMET CG HG3 SINGLE n 1.089 0.0100 0.981 0.0122\nMET CG HG2 SINGLE n 1.089 0.0100 0.981 0.0122\nMET CE HE3 SINGLE n 1.089 0.0100 0.965 0.0170\nMET CE HE2 SINGLE n 1.089 0.0100 0.965 0.0170\nMET CE HE1 SINGLE n 1.089 0.0100 0.965 0.0170\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nMET N n/a CA START\nMET H N . .\nMET H2 N . .\nMET H3 N . .\nMET CA N C .\nMET HA CA . .\nMET CB CA CG .\nMET HB3 CB . .\nMET HB2 CB . .\nMET CG CB SD .\nMET HG3 CG . .\nMET HG2 CG . .\nMET SD CG CE .\nMET CE SD HE3 .\nMET HE1 CE . .\nMET HE2 CE . .\nMET HE3 CE . .\nMET C CA . END\nMET O C . .\nMET OXT C . .\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nMET CA N H 110.062 1.93\nMET CA N H2 110.062 1.93\nMET CA N H3 110.062 1.93\nMET H N H2 109.028 2.41\nMET H N H3 109.028 2.41\nMET H2 N H3 109.028 2.41\nMET N CA C 109.241 1.50\nMET N CA CB 110.906 1.50\nMET N CA HA 108.487 1.50\nMET C CA CB 109.344 1.50\nMET C CA HA 108.824 1.50\nMET CB CA HA 109.670 1.50\nMET CA C O 117.124 1.50\nMET CA C OXT 117.124 1.50\nMET O C OXT 125.752 1.50\nMET CA CB CG 113.476 1.50\nMET CA CB HB3 108.666 1.50\nMET CA CB HB2 108.666 1.50\nMET CG CB HB3 108.955 1.50\nMET CG CB HB2 108.955 1.50\nMET HB3 CB HB2 107.698 1.50\nMET CB CG SD 112.576 2.44\nMET CB CG HG3 109.206 1.50\nMET CB CG HG2 109.206 1.50\nMET SD CG HG3 108.861 1.50\nMET SD CG HG2 108.861 1.50\nMET HG3 CG HG2 107.939 1.50\nMET CG SD CE 100.595 1.50\nMET SD CE HE3 109.425 1.50\nMET SD CE HE2 109.425 1.50\nMET SD CE HE1 109.425 1.50\nMET HE3 CE HE2 109.509 1.50\nMET HE3 CE HE1 109.509 1.50\nMET HE2 CE HE1 109.509 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nMET chi1 N CA CB CG -90.000 10.0 3\nMET chi2 CA CB CG SD 60.000 10.0 3\nMET chi3 CB CG SD CE 90.000 10.0 3\nMET hh1 CG SD CE HE3 180.000 10.0 3\nMET sp3_sp3_1 C CA N H 180.000 10.0 3\nMET sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nMET chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nMET plan-1 C 0.020\nMET plan-1 CA 0.020\nMET plan-1 O 0.020\nMET plan-1 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nMET SMILES ACDLabs 10.04 O=C(O)C(N)CCSC\nMET SMILES_CANONICAL CACTVS 3.341 CSCC[C@H](N)C(O)=O\nMET SMILES CACTVS 3.341 CSCC[CH](N)C(O)=O\nMET SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 CSCC[C@@H](C(=O)O)N\nMET SMILES \"OpenEye OEToolkits\" 1.5.0 CSCCC(C(=O)O)N\nMET InChI InChI 1.03 InChI=1S/C5H11NO2S/c1-9-3-2-4(6)5(7)8/h4H,2-3,6H2,1H3,(H,7,8)/t4-/m0/s1\nMET InChIKey InChI 1.03 FFEARJCKVFRZRR-BYPYZUCNSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nMET acedrg 243 \"dictionary generator\"\nMET acedrg_database 11 \"data source\"\nMET rdkit 2017.03.2 \"Chemoinformatics tool\"\nMET refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [16.037, 15.646, 51.828]},
      {name: "CA", element: "C", xyz: [15.071, 16.764, 51.61]},
      {name: "C", element: "C", xyz: [13.643, 16.205, 51.599]},
      {name: "O", element: "O", xyz: [12.69, 16.897, 51.959]},
      {name: "CB", element: "C", xyz: [15.363, 17.484, 50.287]},
      {name: "CG", element: "C", xyz: [16.318, 18.656, 50.431]},
      {name: "SD", element: "S", xyz: [17.944, 18.169, 51.065]},
      {name: "CE", element: "C", xyz: [18.82, 17.872, 49.53]},
      {name: "OXT", element: "O", xyz: [13.412, 15.053, 51.231]},
      {name: "H", element: "H", xyz: [16.981, 15.997, 51.742]},
      {name: "H2", element: "H", xyz: [15.894, 14.957, 51.174]},
      {name: "H3", element: "H", xyz: [15.912, 15.283, 52.708]},
      {name: "HA", element: "H", xyz: [15.157, 17.399, 52.358]},
      {name: "HB3", element: "H", xyz: [14.521, 17.81, 49.907]},
      {name: "HB2", element: "H", xyz: [15.743, 16.84, 49.657]},
      {name: "HG3", element: "H", xyz: [15.926, 19.317, 51.041]},
      {name: "HG2", element: "H", xyz: [16.435, 19.085, 49.557]},
      {name: "HE3", element: "H", xyz: [19.747, 17.685, 49.721]},
      {name: "HE2", element: "H", xyz: [18.758, 18.654, 48.968]},
      {name: "HE1", element: "H", xyz: [18.426, 17.117, 49.077]},
    ],
  },
  "PHE": {
    name: "PHE",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nPHE PHE PHENYLALANINE peptide 23 12 .\n\ndata_comp_PHE\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nPHE N N NT3 1 3.243 22.325 5.999\nPHE CA C CH1 0 4.243 21.255 5.719\nPHE C C C 0 5.572 21.900 5.306\nPHE O O O 0 5.668 22.539 4.258\nPHE CB C CH2 0 3.717 20.305 4.638\nPHE CG C CR6 0 4.583 19.097 4.377\nPHE CD1 C CR16 0 4.770 18.133 5.361\nPHE CD2 C CR16 0 5.216 18.920 3.151\nPHE CE1 C CR16 0 5.567 17.019 5.125\nPHE CE2 C CR16 0 6.013 17.806 2.917\nPHE CZ C CR16 0 6.188 16.857 3.903\nPHE OXT O OC -1 6.574 21.796 6.014\nPHE H H H 0 3.095 22.874 5.164\nPHE H2 H H 0 3.568 22.893 6.702\nPHE H3 H H 0 2.414 21.925 6.270\nPHE HA H H 0 4.392 20.737 6.550\nPHE HB3 H H 0 3.618 20.812 3.805\nPHE HB2 H H 0 2.825 19.999 4.907\nPHE HD1 H H 0 4.348 18.236 6.199\nPHE HD2 H H 0 5.102 19.564 2.470\nPHE HE1 H H 0 5.684 16.373 5.803\nPHE HE2 H H 0 6.436 17.699 2.079\nPHE HZ H H 0 6.729 16.101 3.743\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nPHE N n/a CA START\nPHE H N . .\nPHE H2 N . .\nPHE H3 N . .\nPHE CA N C .\nPHE HA CA . .\nPHE CB CA CG .\nPHE HB3 CB . .\nPHE HB2 CB . .\nPHE CG CB CD1 .\nPHE CD1 CG CE1 .\nPHE HD1 CD1 . .\nPHE CE1 CD1 CZ .\nPHE HE1 CE1 . .\nPHE CZ CE1 CE2 .\nPHE HZ CZ . .\nPHE CE2 CZ CD2 .\nPHE HE2 CE2 . .\nPHE CD2 CE2 HD2 .\nPHE HD2 CD2 . .\nPHE C CA . END\nPHE O C . .\nPHE OXT C . .\nPHE CD2 CG . ADD\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nPHE N CA SINGLE n 1.487 0.0100 1.487 0.0100\nPHE CA C SINGLE n 1.533 0.0100 1.533 0.0100\nPHE CA CB SINGLE n 1.531 0.0100 1.531 0.0100\nPHE C O DOUBLE n 1.247 0.0187 1.247 0.0187\nPHE C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nPHE CB CG SINGLE n 1.508 0.0100 1.508 0.0100\nPHE CG CD1 DOUBLE y 1.385 0.0111 1.385 0.0111\nPHE CG CD2 SINGLE y 1.385 0.0111 1.385 0.0111\nPHE CD1 CE1 SINGLE y 1.386 0.0100 1.386 0.0100\nPHE CD2 CE2 DOUBLE y 1.386 0.0100 1.386 0.0100\nPHE CE1 CZ DOUBLE y 1.376 0.0124 1.376 0.0124\nPHE CE2 CZ SINGLE y 1.376 0.0124 1.376 0.0124\nPHE N H SINGLE n 1.036 0.0160 0.911 0.0200\nPHE N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nPHE N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nPHE CA HA SINGLE n 1.089 0.0100 0.991 0.0200\nPHE CB HB3 SINGLE n 1.089 0.0100 0.980 0.0164\nPHE CB HB2 SINGLE n 1.089 0.0100 0.980 0.0164\nPHE CD1 HD1 SINGLE n 1.082 0.0130 0.944 0.0174\nPHE CD2 HD2 SINGLE n 1.082 0.0130 0.944 0.0174\nPHE CE1 HE1 SINGLE n 1.082 0.0130 0.944 0.0175\nPHE CE2 HE2 SINGLE n 1.082 0.0130 0.944 0.0175\nPHE CZ HZ SINGLE n 1.082 0.0130 0.944 0.0161\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nPHE CA N H 109.646 1.54\nPHE CA N H2 109.646 1.54\nPHE CA N H3 109.646 1.54\nPHE H N H2 109.028 2.41\nPHE H N H3 109.028 2.41\nPHE H2 N H3 109.028 2.41\nPHE N CA C 109.448 1.50\nPHE N CA CB 110.494 1.50\nPHE N CA HA 108.601 1.50\nPHE C CA CB 111.331 2.53\nPHE C CA HA 108.450 1.50\nPHE CB CA HA 108.690 1.50\nPHE CA C O 117.228 2.13\nPHE CA C OXT 117.228 2.13\nPHE O C OXT 125.543 1.50\nPHE CA CB CG 114.745 1.55\nPHE CA CB HB3 108.434 1.50\nPHE CA CB HB2 108.434 1.50\nPHE CG CB HB3 108.862 1.50\nPHE CG CB HB2 108.862 1.50\nPHE HB3 CB HB2 107.782 1.50\nPHE CB CG CD1 120.970 1.50\nPHE CB CG CD2 120.970 1.50\nPHE CD1 CG CD2 118.060 1.50\nPHE CG CD1 CE1 120.624 1.50\nPHE CG CD1 HD1 119.591 1.50\nPHE CE1 CD1 HD1 119.786 1.50\nPHE CG CD2 CE2 120.624 1.50\nPHE CG CD2 HD2 119.591 1.50\nPHE CE2 CD2 HD2 119.786 1.50\nPHE CD1 CE1 CZ 120.325 1.50\nPHE CD1 CE1 HE1 119.792 1.50\nPHE CZ CE1 HE1 119.883 1.50\nPHE CD2 CE2 CZ 120.325 1.50\nPHE CD2 CE2 HE2 119.792 1.50\nPHE CZ CE2 HE2 119.883 1.50\nPHE CE1 CZ CE2 120.043 1.50\nPHE CE1 CZ HZ 119.979 1.50\nPHE CE2 CZ HZ 119.979 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nPHE chi1 N CA CB CG 180.000 10.0 3\nPHE chi2 CA CB CG CD1 60.000 10.0 6\nPHE CONST_1 CB CG CD1 CE1 180.000 10.0 2\nPHE CONST_2 CG CD1 CE1 CZ 0.000 10.0 2\nPHE CONST_3 CZ CE2 CD2 CG 0.000 10.0 2\nPHE CONST_4 CD1 CE1 CZ CE2 0.000 10.0 2\nPHE CONST_5 CE1 CZ CE2 CD2 0.000 10.0 2\nPHE sp3_sp3_1 C CA N H 180.000 10.0 3\nPHE const_21 CE2 CD2 CG CD1 0.000 10.0 2\nPHE sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nPHE chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nPHE plan-1 CB 0.020\nPHE plan-1 CD1 0.020\nPHE plan-1 CD2 0.020\nPHE plan-1 CE1 0.020\nPHE plan-1 CE2 0.020\nPHE plan-1 CG 0.020\nPHE plan-1 CZ 0.020\nPHE plan-1 HD1 0.020\nPHE plan-1 HD2 0.020\nPHE plan-1 HE1 0.020\nPHE plan-1 HE2 0.020\nPHE plan-1 HZ 0.020\nPHE plan-2 C 0.020\nPHE plan-2 CA 0.020\nPHE plan-2 O 0.020\nPHE plan-2 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nPHE SMILES ACDLabs 10.04 O=C(O)C(N)Cc1ccccc1\nPHE SMILES_CANONICAL CACTVS 3.341 N[C@@H](Cc1ccccc1)C(O)=O\nPHE SMILES CACTVS 3.341 N[CH](Cc1ccccc1)C(O)=O\nPHE SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 c1ccc(cc1)C[C@@H](C(=O)O)N\nPHE SMILES \"OpenEye OEToolkits\" 1.5.0 c1ccc(cc1)CC(C(=O)O)N\nPHE InChI InChI 1.03 InChI=1S/C9H11NO2/c10-8(9(11)12)6-7-4-2-1-3-5-7/h1-5,8H,6,10H2,(H,11,12)/t8-/m0/s1\nPHE InChIKey InChI 1.03 COLNVLDHVKWLRT-QMMMGPOBSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nPHE acedrg 243 \"dictionary generator\"\nPHE acedrg_database 11 \"data source\"\nPHE rdkit 2017.03.2 \"Chemoinformatics tool\"\nPHE refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [3.243, 22.325, 5.999]},
      {name: "CA", element: "C", xyz: [4.243, 21.255, 5.719]},
      {name: "C", element: "C", xyz: [5.572, 21.9, 5.306]},
      {name: "O", element: "O", xyz: [5.668, 22.539, 4.258]},
      {name: "CB", element: "C", xyz: [3.717, 20.305, 4.638]},
      {name: "CG", element: "C", xyz: [4.583, 19.097, 4.377]},
      {name: "CD1", element: "C", xyz: [4.77, 18.133, 5.361]},
      {name: "CD2", element: "C", xyz: [5.216, 18.92, 3.151]},
      {name: "CE1", element: "C", xyz: [5.567, 17.019, 5.125]},
      {name: "CE2", element: "C", xyz: [6.013, 17.806, 2.917]},
      {name: "CZ", element: "C", xyz: [6.188, 16.857, 3.903]},
      {name: "OXT", element: "O", xyz: [6.574, 21.796, 6.014]},
      {name: "H", element: "H", xyz: [3.095, 22.874, 5.164]},
      {name: "H2", element: "H", xyz: [3.568, 22.893, 6.702]},
      {name: "H3", element: "H", xyz: [2.414, 21.925, 6.27]},
      {name: "HA", element: "H", xyz: [4.392, 20.737, 6.55]},
      {name: "HB3", element: "H", xyz: [3.618, 20.812, 3.805]},
      {name: "HB2", element: "H", xyz: [2.825, 19.999, 4.907]},
      {name: "HD1", element: "H", xyz: [4.348, 18.236, 6.199]},
      {name: "HD2", element: "H", xyz: [5.102, 19.564, 2.47]},
      {name: "HE1", element: "H", xyz: [5.684, 16.373, 5.803]},
      {name: "HE2", element: "H", xyz: [6.436, 17.699, 2.079]},
      {name: "HZ", element: "H", xyz: [6.729, 16.101, 3.743]},
    ],
  },
  "PRO": {
    name: "PRO",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nPRO PRO PROLINE P-peptide 16 8 .\n\ndata_comp_PRO\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nPRO N N NT1 0 39.073 37.583 83.044\nPRO CA C CH1 0 38.586 38.620 82.115\nPRO C C C 0 37.233 39.220 82.536\nPRO O O O 0 36.343 38.438 82.819\nPRO CB C CH2 0 38.468 37.896 80.764\nPRO CG C CH2 0 38.228 36.459 81.147\nPRO CD C CH2 0 39.062 36.266 82.395\nPRO OXT O OC -1 37.151 40.435 82.556\nPRO H H H 0 38.548 37.515 83.758\nPRO HA H H 0 39.264 39.337 82.043\nPRO HB3 H H 0 39.295 37.986 80.244\nPRO HB2 H H 0 37.720 38.248 80.233\nPRO HG3 H H 0 38.519 35.854 80.435\nPRO HG2 H H 0 37.280 36.300 81.332\nPRO HD3 H H 0 38.664 35.594 82.979\nPRO HD2 H H 0 39.968 35.985 82.168\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nPRO N n/a CA START\nPRO CA N C .\nPRO HA CA . .\nPRO CB CA CG .\nPRO HB3 CB . .\nPRO HB2 CB . .\nPRO CG CB CD .\nPRO HG3 CG . .\nPRO HG2 CG . .\nPRO CD CG HD2 .\nPRO HD3 CD . .\nPRO HD2 CD . .\nPRO C CA . END\nPRO O C . .\nPRO OXT C . .\nPRO H N . .\nPRO CD N . ADD\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nPRO N CA SINGLE n 1.468 0.0148 1.468 0.0148\nPRO N CD SINGLE n 1.468 0.0152 1.468 0.0152\nPRO CA C SINGLE n 1.536 0.0100 1.536 0.0100\nPRO CA CB SINGLE n 1.534 0.0126 1.534 0.0126\nPRO C O DOUBLE n 1.218 0.0200 1.218 0.0200\nPRO C OXT SINGLE n 1.218 0.0200 1.218 0.0200\nPRO CB CG SINGLE n 1.508 0.0200 1.508 0.0200\nPRO CG CD SINGLE n 1.515 0.0118 1.515 0.0118\nPRO N H SINGLE n 1.036 0.0160 0.887 0.0200\nPRO CA HA SINGLE n 1.089 0.0100 0.990 0.0121\nPRO CB HB3 SINGLE n 1.089 0.0100 0.981 0.0193\nPRO CB HB2 SINGLE n 1.089 0.0100 0.981 0.0193\nPRO CG HG3 SINGLE n 1.089 0.0100 0.979 0.0132\nPRO CG HG2 SINGLE n 1.089 0.0100 0.979 0.0132\nPRO CD HD3 SINGLE n 1.089 0.0100 0.975 0.0100\nPRO CD HD2 SINGLE n 1.089 0.0100 0.975 0.0100\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nPRO CA N CD 109.056 3.00\nPRO CA N H 109.307 3.00\nPRO CD N H 106.136 2.25\nPRO N CA C 111.420 2.45\nPRO N CA CB 103.430 2.23\nPRO N CA HA 109.296 1.50\nPRO C CA CB 110.031 2.42\nPRO C CA HA 110.011 1.50\nPRO CB CA HA 109.388 1.50\nPRO CA C O 117.013 1.95\nPRO CA C OXT 117.013 1.95\nPRO O C OXT 125.975 1.50\nPRO CA CB CG 103.507 1.50\nPRO CA CB HB3 111.018 1.50\nPRO CA CB HB2 111.018 1.50\nPRO CG CB HB3 110.886 1.50\nPRO CG CB HB2 110.886 1.50\nPRO HB3 CB HB2 108.922 1.50\nPRO CB CG CD 104.503 1.95\nPRO CB CG HG3 110.864 1.50\nPRO CB CG HG2 110.864 1.50\nPRO CD CG HG3 110.804 1.50\nPRO CD CG HG2 110.804 1.50\nPRO HG3 CG HG2 108.899 1.50\nPRO N CD CG 105.071 2.33\nPRO N CD HD3 110.738 1.50\nPRO N CD HD2 110.738 1.50\nPRO CG CD HD3 110.867 1.50\nPRO CG CD HD2 110.867 1.50\nPRO HD3 CD HD2 108.731 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nPRO chi1 N CA CB CG 30.000 10.0 3\nPRO chi2 CA CB CG CD -30.000 10.0 3\nPRO chi3 CB CG CD N 30.000 10.0 3\nPRO sp3_sp3_1 CB CA N CD 60.000 10.0 3\nPRO sp3_sp3_34 CG CD N CA 180.000 10.0 3\nPRO sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nPRO chir_1 CA N C CB positive\nPRO chir_2 N CA CD H both\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nPRO plan-1 C 0.020\nPRO plan-1 CA 0.020\nPRO plan-1 O 0.020\nPRO plan-1 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nPRO SMILES ACDLabs 10.04 O=C(O)C1NCCC1\nPRO SMILES_CANONICAL CACTVS 3.341 OC(=O)[C@@H]1CCCN1\nPRO SMILES CACTVS 3.341 OC(=O)[CH]1CCCN1\nPRO SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 C1C[C@H](NC1)C(=O)O\nPRO SMILES \"OpenEye OEToolkits\" 1.5.0 C1CC(NC1)C(=O)O\nPRO InChI InChI 1.03 InChI=1S/C5H9NO2/c7-5(8)4-2-1-3-6-4/h4,6H,1-3H2,(H,7,8)/t4-/m0/s1\nPRO InChIKey InChI 1.03 ONIBWKKTOPOVIA-BYPYZUCNSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nPRO acedrg 243 \"dictionary generator\"\nPRO acedrg_database 11 \"data source\"\nPRO rdkit 2017.03.2 \"Chemoinformatics tool\"\nPRO refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [39.073, 37.583, 83.044]},
      {name: "CA", element: "C", xyz: [38.586, 38.62, 82.115]},
      {name: "C", element: "C", xyz: [37.233, 39.22, 82.536]},
      {name: "O", element: "O", xyz: [36.343, 38.438, 82.819]},
      {name: "CB", element: "C", xyz: [38.468, 37.896, 80.764]},
      {name: "CG", element: "C", xyz: [38.228, 36.459, 81.147]},
      {name: "CD", element: "C", xyz: [39.062, 36.266, 82.395]},
      {name: "OXT", element: "O", xyz: [37.151, 40.435, 82.556]},
      {name: "H", element: "H", xyz: [38.548, 37.515, 83.758]},
      {name: "HA", element: "H", xyz: [39.264, 39.337, 82.043]},
      {name: "HB3", element: "H", xyz: [39.295, 37.986, 80.244]},
      {name: "HB2", element: "H", xyz: [37.72, 38.248, 80.233]},
      {name: "HG3", element: "H", xyz: [38.519, 35.854, 80.435]},
      {name: "HG2", element: "H", xyz: [37.28, 36.3, 81.332]},
      {name: "HD3", element: "H", xyz: [38.664, 35.594, 82.979]},
      {name: "HD2", element: "H", xyz: [39.968, 35.985, 82.168]},
    ],
  },
  "SER": {
    name: "SER",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nSER SER SERINE peptide 14 7 .\n\ndata_comp_SER\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nSER N N NT3 1 88.171 -7.587 -9.891\nSER CA C CH1 0 87.807 -7.240 -11.306\nSER C C C 0 88.531 -5.961 -11.748\nSER O O O 0 88.854 -5.094 -10.935\nSER CB C CH2 0 86.313 -7.100 -11.465\nSER OG O OH1 0 85.652 -8.309 -11.123\nSER OXT O OC -1 88.805 -5.770 -12.932\nSER H H H 0 87.512 -7.174 -9.245\nSER H2 H H 0 89.055 -7.274 -9.678\nSER H3 H H 0 88.150 -8.542 -9.791\nSER HA H H 0 88.114 -7.984 -11.890\nSER HB3 H H 0 86.105 -6.865 -12.397\nSER HB2 H H 0 85.989 -6.373 -10.886\nSER HG H H 0 85.553 -8.334 -10.283\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nSER N n/a CA START\nSER H N . .\nSER H2 N . .\nSER H3 N . .\nSER CA N C .\nSER HA CA . .\nSER CB CA OG .\nSER HB3 CB . .\nSER HB2 CB . .\nSER OG CB HG .\nSER HG OG . .\nSER C CA . END\nSER O C . .\nSER OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nSER N CA SINGLE n 1.487 0.0100 1.487 0.0100\nSER CA C SINGLE n 1.533 0.0100 1.533 0.0100\nSER CA CB SINGLE n 1.507 0.0177 1.507 0.0177\nSER C O DOUBLE n 1.247 0.0187 1.247 0.0187\nSER C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nSER CB OG SINGLE n 1.420 0.0140 1.420 0.0140\nSER N H SINGLE n 1.036 0.0160 0.911 0.0200\nSER N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nSER N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nSER CA HA SINGLE n 1.089 0.0100 0.995 0.0200\nSER CB HB3 SINGLE n 1.089 0.0100 0.984 0.0200\nSER CB HB2 SINGLE n 1.089 0.0100 0.984 0.0200\nSER OG HG SINGLE n 0.970 0.0120 0.846 0.0200\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nSER CA N H 109.619 1.50\nSER CA N H2 109.619 1.50\nSER CA N H3 109.619 1.50\nSER H N H2 109.028 2.41\nSER H N H3 109.028 2.41\nSER H2 N H3 109.028 2.41\nSER N CA C 109.829 1.50\nSER N CA CB 110.990 1.50\nSER N CA HA 108.049 1.50\nSER C CA CB 111.379 1.50\nSER C CA HA 108.255 1.50\nSER CB CA HA 108.518 1.50\nSER CA C O 117.181 1.50\nSER CA C OXT 117.181 1.50\nSER O C OXT 125.637 1.50\nSER CA CB OG 110.825 1.50\nSER CA CB HB3 109.305 1.50\nSER CA CB HB2 109.305 1.50\nSER OG CB HB3 109.411 1.50\nSER OG CB HB2 109.411 1.50\nSER HB3 CB HB2 108.070 1.50\nSER CB OG HG 108.529 2.94\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nSER chi1 N CA CB OG -60.000 10.0 3\nSER hh1 CA CB OG HG 90.000 10.0 3\nSER sp3_sp3_1 C CA N H 180.000 10.0 3\nSER sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nSER chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nSER plan-1 C 0.020\nSER plan-1 CA 0.020\nSER plan-1 O 0.020\nSER plan-1 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nSER SMILES ACDLabs 10.04 O=C(O)C(N)CO\nSER SMILES_CANONICAL CACTVS 3.341 N[C@@H](CO)C(O)=O\nSER SMILES CACTVS 3.341 N[CH](CO)C(O)=O\nSER SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 C([C@@H](C(=O)O)N)O\nSER SMILES \"OpenEye OEToolkits\" 1.5.0 C(C(C(=O)O)N)O\nSER InChI InChI 1.03 InChI=1S/C3H7NO3/c4-2(1-5)3(6)7/h2,5H,1,4H2,(H,6,7)/t2-/m0/s1\nSER InChIKey InChI 1.03 MTCFGRXMJLQNBG-REOHCLBHSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nSER acedrg 243 \"dictionary generator\"\nSER acedrg_database 11 \"data source\"\nSER rdkit 2017.03.2 \"Chemoinformatics tool\"\nSER refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [88.171, -7.587, -9.891]},
      {name: "CA", element: "C", xyz: [87.807, -7.24, -11.306]},
      {name: "C", element: "C", xyz: [88.531, -5.961, -11.748]},
      {name: "O", element: "O", xyz: [88.854, -5.094, -10.935]},
      {name: "CB", element: "C", xyz: [86.313, -7.1, -11.465]},
      {name: "OG", element: "O", xyz: [85.652, -8.309, -11.123]},
      {name: "OXT", element: "O", xyz: [88.805, -5.77, -12.932]},
      {name: "H", element: "H", xyz: [87.512, -7.174, -9.245]},
      {name: "H2", element: "H", xyz: [89.055, -7.274, -9.678]},
      {name: "H3", element: "H", xyz: [88.15, -8.542, -9.791]},
      {name: "HA", element: "H", xyz: [88.114, -7.984, -11.89]},
      {name: "HB3", element: "H", xyz: [86.105, -6.865, -12.397]},
      {name: "HB2", element: "H", xyz: [85.989, -6.373, -10.886]},
      {name: "HG", element: "H", xyz: [85.553, -8.334, -10.283]},
    ],
  },
  "THR": {
    name: "THR",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nTHR THR THREONINE peptide 17 8 .\n\ndata_comp_THR\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nTHR N N NT3 1 36.297 32.044 31.823\nTHR CA C CH1 0 35.038 31.219 31.795\nTHR C C C 0 35.076 30.251 30.605\nTHR O O O 0 35.114 30.669 29.448\nTHR CB C CH1 0 33.786 32.108 31.748\nTHR OG1 O OH1 0 33.891 33.073 32.797\nTHR CG2 C CH3 0 32.492 31.332 31.881\nTHR OXT O OC -1 35.069 29.032 30.779\nTHR H H H 0 36.079 33.017 31.985\nTHR H2 H H 0 36.786 31.972 30.998\nTHR H3 H H 0 36.853 31.731 32.541\nTHR HA H H 0 35.011 30.688 32.624\nTHR HB H H 0 33.780 32.582 30.882\nTHR HG1 H H 0 33.884 32.686 33.553\nTHR HG21 H H 0 32.667 30.468 32.297\nTHR HG22 H H 0 32.104 31.193 30.999\nTHR HG23 H H 0 31.864 31.833 32.433\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nTHR N n/a CA START\nTHR H N . .\nTHR H2 N . .\nTHR H3 N . .\nTHR CA N C .\nTHR HA CA . .\nTHR CB CA CG2 .\nTHR HB CB . .\nTHR OG1 CB HG1 .\nTHR HG1 OG1 . .\nTHR CG2 CB HG23 .\nTHR HG21 CG2 . .\nTHR HG22 CG2 . .\nTHR HG23 CG2 . .\nTHR C CA . END\nTHR O C . .\nTHR OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nTHR N CA SINGLE n 1.488 0.0100 1.488 0.0100\nTHR CA C SINGLE n 1.533 0.0100 1.533 0.0100\nTHR CA CB SINGLE n 1.534 0.0100 1.534 0.0100\nTHR C O DOUBLE n 1.247 0.0187 1.247 0.0187\nTHR C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nTHR CB OG1 SINGLE n 1.428 0.0100 1.428 0.0100\nTHR CB CG2 SINGLE n 1.513 0.0100 1.513 0.0100\nTHR N H SINGLE n 1.036 0.0160 0.911 0.0200\nTHR N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nTHR N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nTHR CA HA SINGLE n 1.089 0.0100 0.985 0.0200\nTHR CB HB SINGLE n 1.089 0.0100 0.987 0.0200\nTHR OG1 HG1 SINGLE n 0.970 0.0120 0.848 0.0200\nTHR CG2 HG21 SINGLE n 1.089 0.0100 0.974 0.0145\nTHR CG2 HG22 SINGLE n 1.089 0.0100 0.974 0.0145\nTHR CG2 HG23 SINGLE n 1.089 0.0100 0.974 0.0145\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nTHR CA N H 109.889 1.50\nTHR CA N H2 109.889 1.50\nTHR CA N H3 109.889 1.50\nTHR H N H2 109.028 2.41\nTHR H N H3 109.028 2.41\nTHR H2 N H3 109.028 2.41\nTHR N CA C 109.414 1.50\nTHR N CA CB 111.125 1.50\nTHR N CA HA 108.031 1.50\nTHR C CA CB 111.511 2.91\nTHR C CA HA 108.600 1.50\nTHR CB CA HA 108.620 1.50\nTHR CA C O 117.003 1.50\nTHR CA C OXT 117.003 1.50\nTHR O C OXT 125.994 1.50\nTHR CA CB OG1 108.093 2.62\nTHR CA CB CG2 112.909 1.50\nTHR CA CB HB 108.271 1.50\nTHR OG1 CB CG2 109.779 2.11\nTHR OG1 CB HB 108.878 1.50\nTHR CG2 CB HB 108.799 1.50\nTHR CB OG1 HG1 109.608 2.55\nTHR CB CG2 HG21 109.564 1.50\nTHR CB CG2 HG22 109.564 1.50\nTHR CB CG2 HG23 109.564 1.50\nTHR HG21 CG2 HG22 109.425 1.50\nTHR HG21 CG2 HG23 109.425 1.50\nTHR HG22 CG2 HG23 109.425 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nTHR chi1 N CA CB CG2 180.000 10.0 3\nTHR hh1 CA CB OG1 HG1 -60.000 10.0 3\nTHR hh2 CA CB CG2 HG23 -60.000 10.0 3\nTHR sp3_sp3_1 C CA N H 180.000 10.0 3\nTHR sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nTHR chir_1 CA N C CB positive\nTHR chir_2 CB OG1 CA CG2 negative\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nTHR plan-1 C 0.020\nTHR plan-1 CA 0.020\nTHR plan-1 O 0.020\nTHR plan-1 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nTHR SMILES ACDLabs 10.04 O=C(O)C(N)C(O)C\nTHR SMILES_CANONICAL CACTVS 3.341 C[C@@H](O)[C@H](N)C(O)=O\nTHR SMILES CACTVS 3.341 C[CH](O)[CH](N)C(O)=O\nTHR SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 C[C@H]([C@@H](C(=O)O)N)O\nTHR SMILES \"OpenEye OEToolkits\" 1.5.0 CC(C(C(=O)O)N)O\nTHR InChI InChI 1.03 InChI=1S/C4H9NO3/c1-2(6)3(5)4(7)8/h2-3,6H,5H2,1H3,(H,7,8)/t2-,3+/m1/s1\nTHR InChIKey InChI 1.03 AYFVYJQAPQTCCC-GBXIJSLDSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nTHR acedrg 243 \"dictionary generator\"\nTHR acedrg_database 11 \"data source\"\nTHR rdkit 2017.03.2 \"Chemoinformatics tool\"\nTHR refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [36.297, 32.044, 31.823]},
      {name: "CA", element: "C", xyz: [35.038, 31.219, 31.795]},
      {name: "C", element: "C", xyz: [35.076, 30.251, 30.605]},
      {name: "O", element: "O", xyz: [35.114, 30.669, 29.448]},
      {name: "CB", element: "C", xyz: [33.786, 32.108, 31.748]},
      {name: "OG1", element: "O", xyz: [33.891, 33.073, 32.797]},
      {name: "CG2", element: "C", xyz: [32.492, 31.332, 31.881]},
      {name: "OXT", element: "O", xyz: [35.069, 29.032, 30.779]},
      {name: "H", element: "H", xyz: [36.079, 33.017, 31.985]},
      {name: "H2", element: "H", xyz: [36.786, 31.972, 30.998]},
      {name: "H3", element: "H", xyz: [36.853, 31.731, 32.541]},
      {name: "HA", element: "H", xyz: [35.011, 30.688, 32.624]},
      {name: "HB", element: "H", xyz: [33.78, 32.582, 30.882]},
      {name: "HG1", element: "H", xyz: [33.884, 32.686, 33.553]},
      {name: "HG21", element: "H", xyz: [32.667, 30.468, 32.297]},
      {name: "HG22", element: "H", xyz: [32.104, 31.193, 30.999]},
      {name: "HG23", element: "H", xyz: [31.864, 31.833, 32.433]},
    ],
  },
  "TRP": {
    name: "TRP",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nTRP TRP TRYPTOPHAN peptide 27 15 .\n\ndata_comp_TRP\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nTRP N N NT3 1 74.645 60.516 32.853\nTRP CA C CH1 0 74.539 61.804 32.094\nTRP C C C 0 73.630 61.616 30.872\nTRP O O O 0 73.006 62.565 30.396\nTRP CB C CH2 0 75.928 62.312 31.683\nTRP CG C CR5 0 76.819 62.667 32.834\nTRP CD1 C CR15 0 77.980 62.047 33.195\nTRP CD2 C CR56 0 76.627 63.736 33.778\nTRP NE1 N NR5 0 78.522 62.650 34.298\nTRP CE2 C CR56 0 77.716 63.690 34.679\nTRP CE3 C CR16 0 75.647 64.724 33.953\nTRP CZ2 C CR16 0 77.845 64.595 35.736\nTRP CZ3 C CR16 0 75.776 65.618 34.997\nTRP CH2 C CR16 0 76.862 65.552 35.876\nTRP OXT O OC -1 73.502 60.514 30.339\nTRP H H H 0 75.294 59.898 32.386\nTRP H2 H H 0 73.786 60.089 32.905\nTRP H3 H H 0 74.955 60.689 33.744\nTRP HA H H 0 74.133 62.475 32.691\nTRP HB3 H H 0 75.810 63.102 31.116\nTRP HB2 H H 0 76.362 61.620 31.143\nTRP HD1 H H 0 78.360 61.303 32.753\nTRP HE1 H H 0 79.266 62.408 34.695\nTRP HE3 H H 0 74.910 64.776 33.365\nTRP HZ2 H H 0 78.577 64.551 36.327\nTRP HZ3 H H 0 75.120 66.286 35.121\nTRP HH2 H H 0 76.925 66.175 36.579\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nTRP N n/a CA START\nTRP H N . .\nTRP H2 N . .\nTRP H3 N . .\nTRP CA N C .\nTRP HA CA . .\nTRP CB CA CG .\nTRP HB3 CB . .\nTRP HB2 CB . .\nTRP CG CB CD1 .\nTRP CD1 CG NE1 .\nTRP HD1 CD1 . .\nTRP NE1 CD1 CE2 .\nTRP HE1 NE1 . .\nTRP CE2 NE1 CD2 .\nTRP CD2 CE2 CE3 .\nTRP CE3 CD2 CZ3 .\nTRP HE3 CE3 . .\nTRP CZ3 CE3 CH2 .\nTRP HZ3 CZ3 . .\nTRP CH2 CZ3 CZ2 .\nTRP HH2 CH2 . .\nTRP CZ2 CH2 HZ2 .\nTRP HZ2 CZ2 . .\nTRP C CA . END\nTRP O C . .\nTRP OXT C . .\nTRP CD2 CG . ADD\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nTRP N CA SINGLE n 1.488 0.0100 1.488 0.0100\nTRP CA C SINGLE n 1.533 0.0100 1.533 0.0100\nTRP CA CB SINGLE n 1.534 0.0118 1.534 0.0118\nTRP C O DOUBLE n 1.247 0.0187 1.247 0.0187\nTRP C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nTRP CB CG SINGLE n 1.498 0.0100 1.498 0.0100\nTRP CG CD1 DOUBLE y 1.365 0.0100 1.365 0.0100\nTRP CG CD2 SINGLE y 1.439 0.0100 1.439 0.0100\nTRP CD1 NE1 SINGLE y 1.369 0.0100 1.369 0.0100\nTRP CD2 CE2 DOUBLE y 1.411 0.0100 1.411 0.0100\nTRP CD2 CE3 SINGLE y 1.399 0.0100 1.399 0.0100\nTRP NE1 CE2 SINGLE y 1.370 0.0100 1.370 0.0100\nTRP CE2 CZ2 SINGLE y 1.394 0.0100 1.394 0.0100\nTRP CE3 CZ3 DOUBLE y 1.377 0.0100 1.377 0.0100\nTRP CZ2 CH2 DOUBLE y 1.376 0.0100 1.376 0.0100\nTRP CZ3 CH2 SINGLE y 1.395 0.0112 1.395 0.0112\nTRP N H SINGLE n 1.036 0.0160 0.911 0.0200\nTRP N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nTRP N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nTRP CA HA SINGLE n 1.089 0.0100 0.986 0.0200\nTRP CB HB3 SINGLE n 1.089 0.0100 0.979 0.0197\nTRP CB HB2 SINGLE n 1.089 0.0100 0.979 0.0197\nTRP CD1 HD1 SINGLE n 1.082 0.0130 0.945 0.0191\nTRP NE1 HE1 SINGLE n 1.016 0.0100 0.877 0.0200\nTRP CE3 HE3 SINGLE n 1.082 0.0130 0.944 0.0200\nTRP CZ2 HZ2 SINGLE n 1.082 0.0130 0.942 0.0188\nTRP CZ3 HZ3 SINGLE n 1.082 0.0130 0.944 0.0181\nTRP CH2 HH2 SINGLE n 1.082 0.0130 0.941 0.0181\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nTRP CA N H 109.321 1.91\nTRP CA N H2 109.321 1.91\nTRP CA N H3 109.321 1.91\nTRP H N H2 109.028 2.41\nTRP H N H3 109.028 2.41\nTRP H2 N H3 109.028 2.41\nTRP N CA C 109.666 1.50\nTRP N CA CB 110.562 1.50\nTRP N CA HA 108.030 1.50\nTRP C CA CB 111.644 1.50\nTRP C CA HA 108.922 1.50\nTRP CB CA HA 108.128 1.50\nTRP CA C O 117.134 1.50\nTRP CA C OXT 117.134 1.50\nTRP O C OXT 125.731 1.50\nTRP CA CB CG 113.843 1.64\nTRP CA CB HB3 108.266 1.50\nTRP CA CB HB2 108.266 1.50\nTRP CG CB HB3 109.029 1.50\nTRP CG CB HB2 109.029 1.50\nTRP HB3 CB HB2 107.759 1.50\nTRP CB CG CD1 127.068 1.62\nTRP CB CG CD2 126.820 1.50\nTRP CD1 CG CD2 106.112 1.50\nTRP CG CD1 NE1 110.404 1.50\nTRP CG CD1 HD1 125.159 1.59\nTRP NE1 CD1 HD1 124.437 1.50\nTRP CG CD2 CE2 106.987 1.50\nTRP CG CD2 CE3 134.307 1.50\nTRP CE2 CD2 CE3 118.706 1.50\nTRP CD1 NE1 CE2 109.042 1.50\nTRP CD1 NE1 HE1 125.328 1.77\nTRP CE2 NE1 HE1 125.630 1.60\nTRP CD2 CE2 NE1 107.455 1.50\nTRP CD2 CE2 CZ2 122.250 1.50\nTRP NE1 CE2 CZ2 130.294 1.50\nTRP CD2 CE3 CZ3 118.817 1.50\nTRP CD2 CE3 HE3 120.505 1.50\nTRP CZ3 CE3 HE3 120.678 1.50\nTRP CE2 CZ2 CH2 117.385 1.50\nTRP CE2 CZ2 HZ2 121.137 1.50\nTRP CH2 CZ2 HZ2 121.477 1.50\nTRP CE3 CZ3 CH2 121.212 1.50\nTRP CE3 CZ3 HZ3 119.471 1.50\nTRP CH2 CZ3 HZ3 119.316 1.50\nTRP CZ2 CH2 CZ3 121.628 1.50\nTRP CZ2 CH2 HH2 119.132 1.50\nTRP CZ3 CH2 HH2 119.240 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nTRP chi1 N CA CB CG -60.000 10.0 3\nTRP chi2 CA CB CG CD1 120.000 10.0 6\nTRP CONST_1 CB CG CD1 NE1 180.000 10.0 2\nTRP CONST_2 CG CD1 NE1 CE2 0.000 10.0 2\nTRP CONST_3 NE1 CE2 CD2 CE3 180.000 10.0 2\nTRP CONST_4 CE2 CD2 CE3 CZ3 0.000 10.0 2\nTRP CONST_5 CD1 NE1 CE2 CD2 0.000 10.0 2\nTRP CONST_6 CD2 CE3 CZ3 CH2 0.000 10.0 2\nTRP CONST_7 CZ3 CH2 CZ2 CE2 0.000 10.0 2\nTRP CONST_8 CE3 CZ3 CH2 CZ2 0.000 10.0 2\nTRP sp3_sp3_1 C CA N H 180.000 10.0 3\nTRP const_33 CE2 CD2 CG CD1 0.000 10.0 2\nTRP const_17 CD2 CE2 CZ2 CH2 0.000 10.0 2\nTRP sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nTRP chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nTRP plan-1 CB 0.020\nTRP plan-1 CD1 0.020\nTRP plan-1 CD2 0.020\nTRP plan-1 CE2 0.020\nTRP plan-1 CE3 0.020\nTRP plan-1 CG 0.020\nTRP plan-1 CH2 0.020\nTRP plan-1 CZ2 0.020\nTRP plan-1 CZ3 0.020\nTRP plan-1 HD1 0.020\nTRP plan-1 HE1 0.020\nTRP plan-1 HE3 0.020\nTRP plan-1 HH2 0.020\nTRP plan-1 HZ2 0.020\nTRP plan-1 HZ3 0.020\nTRP plan-1 NE1 0.020\nTRP plan-2 C 0.020\nTRP plan-2 CA 0.020\nTRP plan-2 O 0.020\nTRP plan-2 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nTRP SMILES ACDLabs 10.04 O=C(O)C(N)Cc2c1ccccc1nc2\nTRP SMILES_CANONICAL CACTVS 3.341 N[C@@H](Cc1c[nH]c2ccccc12)C(O)=O\nTRP SMILES CACTVS 3.341 N[CH](Cc1c[nH]c2ccccc12)C(O)=O\nTRP SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 c1ccc2c(c1)c(c[nH]2)C[C@@H](C(=O)O)N\nTRP SMILES \"OpenEye OEToolkits\" 1.5.0 c1ccc2c(c1)c(c[nH]2)CC(C(=O)O)N\nTRP InChI InChI 1.03 InChI=1S/C11H12N2O2/c12-9(11(14)15)5-7-6-13-10-4-2-1-3-8(7)10/h1-4,6,9,13H,5,12H2,(H,14,15)/t9-/m0/s1\nTRP InChIKey InChI 1.03 QIVBCDIJIAJPQS-VIFPVBQESA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nTRP acedrg 243 \"dictionary generator\"\nTRP acedrg_database 11 \"data source\"\nTRP rdkit 2017.03.2 \"Chemoinformatics tool\"\nTRP refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [74.645, 60.516, 32.853]},
      {name: "CA", element: "C", xyz: [74.539, 61.804, 32.094]},
      {name: "C", element: "C", xyz: [73.63, 61.616, 30.872]},
      {name: "O", element: "O", xyz: [73.006, 62.565, 30.396]},
      {name: "CB", element: "C", xyz: [75.928, 62.312, 31.683]},
      {name: "CG", element: "C", xyz: [76.819, 62.667, 32.834]},
      {name: "CD1", element: "C", xyz: [77.98, 62.047, 33.195]},
      {name: "CD2", element: "C", xyz: [76.627, 63.736, 33.778]},
      {name: "NE1", element: "N", xyz: [78.522, 62.65, 34.298]},
      {name: "CE2", element: "C", xyz: [77.716, 63.69, 34.679]},
      {name: "CE3", element: "C", xyz: [75.647, 64.724, 33.953]},
      {name: "CZ2", element: "C", xyz: [77.845, 64.595, 35.736]},
      {name: "CZ3", element: "C", xyz: [75.776, 65.618, 34.997]},
      {name: "CH2", element: "C", xyz: [76.862, 65.552, 35.876]},
      {name: "OXT", element: "O", xyz: [73.502, 60.514, 30.339]},
      {name: "H", element: "H", xyz: [75.294, 59.898, 32.386]},
      {name: "H2", element: "H", xyz: [73.786, 60.089, 32.905]},
      {name: "H3", element: "H", xyz: [74.955, 60.689, 33.744]},
      {name: "HA", element: "H", xyz: [74.133, 62.475, 32.691]},
      {name: "HB3", element: "H", xyz: [75.81, 63.102, 31.116]},
      {name: "HB2", element: "H", xyz: [76.362, 61.62, 31.143]},
      {name: "HD1", element: "H", xyz: [78.36, 61.303, 32.753]},
      {name: "HE1", element: "H", xyz: [79.266, 62.408, 34.695]},
      {name: "HE3", element: "H", xyz: [74.91, 64.776, 33.365]},
      {name: "HZ2", element: "H", xyz: [78.577, 64.551, 36.327]},
      {name: "HZ3", element: "H", xyz: [75.12, 66.286, 35.121]},
      {name: "HH2", element: "H", xyz: [76.925, 66.175, 36.579]},
    ],
  },
  "TYR": {
    name: "TYR",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nTYR TYR TYROSINE peptide 24 13 .\n\ndata_comp_TYR\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nTYR N N NT3 1 5.084 5.154 15.883\nTYR CA C CH1 0 5.320 6.447 16.603\nTYR C C C 0 4.814 7.615 15.747\nTYR O O O 0 3.916 8.354 16.150\nTYR CB C CH2 0 6.804 6.622 16.936\nTYR CG C CR6 0 7.370 5.590 17.880\nTYR CD1 C CR16 0 6.952 5.526 19.203\nTYR CD2 C CR16 0 8.317 4.666 17.456\nTYR CE1 C CR16 0 7.464 4.579 20.081\nTYR CE2 C CR16 0 8.838 3.712 18.320\nTYR CZ C CR6 0 8.410 3.668 19.638\nTYR OH O OH1 0 8.918 2.729 20.505\nTYR OXT O OC -1 5.294 7.841 14.636\nTYR H H H 0 5.781 5.035 15.162\nTYR H2 H H 0 4.211 5.151 15.482\nTYR H3 H H 0 5.139 4.423 16.503\nTYR HA H H 0 4.805 6.434 17.449\nTYR HB3 H H 0 6.926 7.510 17.333\nTYR HB2 H H 0 7.313 6.601 16.098\nTYR HD1 H H 0 6.310 6.142 19.515\nTYR HD2 H H 0 8.615 4.687 16.561\nTYR HE1 H H 0 7.169 4.555 20.976\nTYR HE2 H H 0 9.481 3.095 18.012\nTYR HH H H 0 9.348 2.046 20.205\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nTYR N n/a CA START\nTYR H N . .\nTYR H2 N . .\nTYR H3 N . .\nTYR CA N C .\nTYR HA CA . .\nTYR CB CA CG .\nTYR HB3 CB . .\nTYR HB2 CB . .\nTYR CG CB CD1 .\nTYR CD1 CG CE1 .\nTYR HD1 CD1 . .\nTYR CE1 CD1 CZ .\nTYR HE1 CE1 . .\nTYR CZ CE1 CE2 .\nTYR OH CZ HH .\nTYR HH OH . .\nTYR CE2 CZ CD2 .\nTYR HE2 CE2 . .\nTYR CD2 CE2 HD2 .\nTYR HD2 CD2 . .\nTYR C CA . END\nTYR O C . .\nTYR OXT C . .\nTYR CD2 CG . ADD\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nTYR N CA SINGLE n 1.487 0.0100 1.487 0.0100\nTYR CA C SINGLE n 1.533 0.0100 1.533 0.0100\nTYR CA CB SINGLE n 1.531 0.0100 1.531 0.0100\nTYR C O DOUBLE n 1.247 0.0187 1.247 0.0187\nTYR C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nTYR CB CG SINGLE n 1.508 0.0100 1.508 0.0100\nTYR CG CD1 DOUBLE y 1.385 0.0110 1.385 0.0110\nTYR CG CD2 SINGLE y 1.385 0.0110 1.385 0.0110\nTYR CD1 CE1 SINGLE y 1.385 0.0100 1.385 0.0100\nTYR CD2 CE2 DOUBLE y 1.385 0.0100 1.385 0.0100\nTYR CE1 CZ DOUBLE y 1.383 0.0100 1.383 0.0100\nTYR CE2 CZ SINGLE y 1.383 0.0100 1.383 0.0100\nTYR CZ OH SINGLE n 1.374 0.0155 1.374 0.0155\nTYR N H SINGLE n 1.036 0.0160 0.911 0.0200\nTYR N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nTYR N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nTYR CA HA SINGLE n 1.089 0.0100 0.991 0.0200\nTYR CB HB3 SINGLE n 1.089 0.0100 0.980 0.0164\nTYR CB HB2 SINGLE n 1.089 0.0100 0.980 0.0164\nTYR CD1 HD1 SINGLE n 1.082 0.0130 0.943 0.0173\nTYR CD2 HD2 SINGLE n 1.082 0.0130 0.943 0.0173\nTYR CE1 HE1 SINGLE n 1.082 0.0130 0.943 0.0169\nTYR CE2 HE2 SINGLE n 1.082 0.0130 0.943 0.0169\nTYR OH HH SINGLE n 0.966 0.0059 0.861 0.0200\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nTYR CA N H 109.646 1.54\nTYR CA N H2 109.646 1.54\nTYR CA N H3 109.646 1.54\nTYR H N H2 109.028 2.41\nTYR H N H3 109.028 2.41\nTYR H2 N H3 109.028 2.41\nTYR N CA C 109.448 1.50\nTYR N CA CB 110.494 1.50\nTYR N CA HA 108.601 1.50\nTYR C CA CB 111.331 2.53\nTYR C CA HA 108.450 1.50\nTYR CB CA HA 108.690 1.50\nTYR CA C O 117.228 2.13\nTYR CA C OXT 117.228 2.13\nTYR O C OXT 125.543 1.50\nTYR CA CB CG 114.745 1.55\nTYR CA CB HB3 108.434 1.50\nTYR CA CB HB2 108.434 1.50\nTYR CG CB HB3 108.862 1.50\nTYR CG CB HB2 108.862 1.50\nTYR HB3 CB HB2 107.782 1.50\nTYR CB CG CD1 121.083 1.50\nTYR CB CG CD2 121.083 1.50\nTYR CD1 CG CD2 117.834 1.50\nTYR CG CD1 CE1 121.472 1.50\nTYR CG CD1 HD1 119.317 1.50\nTYR CE1 CD1 HD1 119.210 1.50\nTYR CG CD2 CE2 121.472 1.50\nTYR CG CD2 HD2 119.317 1.50\nTYR CE2 CD2 HD2 119.210 1.50\nTYR CD1 CE1 CZ 119.825 1.50\nTYR CD1 CE1 HE1 120.168 1.50\nTYR CZ CE1 HE1 120.006 1.50\nTYR CD2 CE2 CZ 119.825 1.50\nTYR CD2 CE2 HE2 120.168 1.50\nTYR CZ CE2 HE2 120.006 1.50\nTYR CE1 CZ CE2 119.571 1.50\nTYR CE1 CZ OH 120.215 3.00\nTYR CE2 CZ OH 120.215 3.00\nTYR CZ OH HH 120.000 3.00\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nTYR chi1 N CA CB CG -60.000 10.0 3\nTYR chi2 CA CB CG CD1 -60.000 10.0 6\nTYR CONST_1 CB CG CD1 CE1 180.000 10.0 2\nTYR CONST_2 CG CD1 CE1 CZ 0.000 10.0 2\nTYR CONST_3 CZ CE2 CD2 CG 0.000 10.0 2\nTYR CONST_4 CD1 CE1 CZ CE2 0.000 10.0 2\nTYR CONST_5 CE1 CZ CE2 CD2 0.000 10.0 2\nTYR hh1 CE1 CZ OH HH 0.000 10.0 2\nTYR sp3_sp3_1 C CA N H 180.000 10.0 3\nTYR const_21 CE2 CD2 CG CD1 0.000 10.0 2\nTYR sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nTYR chir_1 CA N C CB positive\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nTYR plan-1 CB 0.020\nTYR plan-1 CD1 0.020\nTYR plan-1 CD2 0.020\nTYR plan-1 CE1 0.020\nTYR plan-1 CE2 0.020\nTYR plan-1 CG 0.020\nTYR plan-1 CZ 0.020\nTYR plan-1 HD1 0.020\nTYR plan-1 HD2 0.020\nTYR plan-1 HE1 0.020\nTYR plan-1 HE2 0.020\nTYR plan-1 OH 0.020\nTYR plan-2 C 0.020\nTYR plan-2 CA 0.020\nTYR plan-2 O 0.020\nTYR plan-2 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nTYR SMILES ACDLabs 10.04 O=C(O)C(N)Cc1ccc(O)cc1\nTYR SMILES_CANONICAL CACTVS 3.341 N[C@@H](Cc1ccc(O)cc1)C(O)=O\nTYR SMILES CACTVS 3.341 N[CH](Cc1ccc(O)cc1)C(O)=O\nTYR SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 c1cc(ccc1C[C@@H](C(=O)O)N)O\nTYR SMILES \"OpenEye OEToolkits\" 1.5.0 c1cc(ccc1CC(C(=O)O)N)O\nTYR InChI InChI 1.03 InChI=1S/C9H11NO3/c10-8(9(12)13)5-6-1-3-7(11)4-2-6/h1-4,8,11H,5,10H2,(H,12,13)/t8-/m0/s1\nTYR InChIKey InChI 1.03 OUYCCCASQSFEME-QMMMGPOBSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nTYR acedrg 243 \"dictionary generator\"\nTYR acedrg_database 11 \"data source\"\nTYR rdkit 2017.03.2 \"Chemoinformatics tool\"\nTYR refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [5.084, 5.154, 15.883]},
      {name: "CA", element: "C", xyz: [5.32, 6.447, 16.603]},
      {name: "C", element: "C", xyz: [4.814, 7.615, 15.747]},
      {name: "O", element: "O", xyz: [3.916, 8.354, 16.15]},
      {name: "CB", element: "C", xyz: [6.804, 6.622, 16.936]},
      {name: "CG", element: "C", xyz: [7.37, 5.59, 17.88]},
      {name: "CD1", element: "C", xyz: [6.952, 5.526, 19.203]},
      {name: "CD2", element: "C", xyz: [8.317, 4.666, 17.456]},
      {name: "CE1", element: "C", xyz: [7.464, 4.579, 20.081]},
      {name: "CE2", element: "C", xyz: [8.838, 3.712, 18.32]},
      {name: "CZ", element: "C", xyz: [8.41, 3.668, 19.638]},
      {name: "OH", element: "O", xyz: [8.918, 2.729, 20.505]},
      {name: "OXT", element: "O", xyz: [5.294, 7.841, 14.636]},
      {name: "H", element: "H", xyz: [5.781, 5.035, 15.162]},
      {name: "H2", element: "H", xyz: [4.211, 5.151, 15.482]},
      {name: "H3", element: "H", xyz: [5.139, 4.423, 16.503]},
      {name: "HA", element: "H", xyz: [4.805, 6.434, 17.449]},
      {name: "HB3", element: "H", xyz: [6.926, 7.51, 17.333]},
      {name: "HB2", element: "H", xyz: [7.313, 6.601, 16.098]},
      {name: "HD1", element: "H", xyz: [6.31, 6.142, 19.515]},
      {name: "HD2", element: "H", xyz: [8.615, 4.687, 16.561]},
      {name: "HE1", element: "H", xyz: [7.169, 4.555, 20.976]},
      {name: "HE2", element: "H", xyz: [9.481, 3.095, 18.012]},
      {name: "HH", element: "H", xyz: [9.348, 2.046, 20.205]},
    ],
  },
  "VAL": {
    name: "VAL",
    cif: "data_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nVAL VAL VALINE peptide 19 8 .\n\ndata_comp_VAL\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nVAL N N NT3 1 11.278 2.949 48.508\nVAL CA C CH1 0 10.388 4.150 48.581\nVAL C C C 0 9.851 4.282 50.012\nVAL O O O 0 9.223 3.310 50.476\nVAL CB C CH1 0 9.239 4.075 47.552\nVAL CG1 C CH3 0 8.374 5.332 47.574\nVAL CG2 C CH3 0 9.760 3.787 46.147\nVAL OXT O OC -1 10.082 5.352 50.610\nVAL H H H 0 11.876 3.042 47.827\nVAL H2 H H 0 10.781 2.198 48.364\nVAL H3 H H 0 11.744 2.848 49.285\nVAL HA H H 0 10.926 4.938 48.382\nVAL HB H H 0 8.664 3.315 47.815\nVAL HG11 H H 0 8.939 6.112 47.715\nVAL HG12 H H 0 7.728 5.268 48.298\nVAL HG13 H H 0 7.899 5.427 46.730\nVAL HG21 H H 0 10.535 4.348 45.967\nVAL HG22 H H 0 9.067 3.971 45.491\nVAL HG23 H H 0 10.020 2.851 46.085\n\nloop_\n_chem_comp_tree.comp_id\n_chem_comp_tree.atom_id\n_chem_comp_tree.atom_back\n_chem_comp_tree.atom_forward\n_chem_comp_tree.connect_type\nVAL N n/a CA START\nVAL H N . .\nVAL H2 N . .\nVAL H3 N . .\nVAL CA N C .\nVAL HA CA . .\nVAL CB CA CG2 .\nVAL HB CB . .\nVAL CG1 CB HG13 .\nVAL HG11 CG1 . .\nVAL HG12 CG1 . .\nVAL HG13 CG1 . .\nVAL CG2 CB HG23 .\nVAL HG21 CG2 . .\nVAL HG22 CG2 . .\nVAL HG23 CG2 . .\nVAL C CA . END\nVAL O C . .\nVAL OXT C . .\n\nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nVAL N CA SINGLE n 1.494 0.0100 1.494 0.0100\nVAL CA C SINGLE n 1.533 0.0100 1.533 0.0100\nVAL CA CB SINGLE n 1.541 0.0100 1.541 0.0100\nVAL C O DOUBLE n 1.247 0.0187 1.247 0.0187\nVAL C OXT SINGLE n 1.247 0.0187 1.247 0.0187\nVAL CB CG1 SINGLE n 1.521 0.0135 1.521 0.0135\nVAL CB CG2 SINGLE n 1.521 0.0135 1.521 0.0135\nVAL N H SINGLE n 1.036 0.0160 0.911 0.0200\nVAL N H2 SINGLE n 1.036 0.0160 0.911 0.0200\nVAL N H3 SINGLE n 1.036 0.0160 0.911 0.0200\nVAL CA HA SINGLE n 1.089 0.0100 0.974 0.0200\nVAL CB HB SINGLE n 1.089 0.0100 0.989 0.0175\nVAL CG1 HG11 SINGLE n 1.089 0.0100 0.973 0.0146\nVAL CG1 HG12 SINGLE n 1.089 0.0100 0.973 0.0146\nVAL CG1 HG13 SINGLE n 1.089 0.0100 0.973 0.0146\nVAL CG2 HG21 SINGLE n 1.089 0.0100 0.973 0.0146\nVAL CG2 HG22 SINGLE n 1.089 0.0100 0.973 0.0146\nVAL CG2 HG23 SINGLE n 1.089 0.0100 0.973 0.0146\n\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nVAL CA N H 110.089 1.83\nVAL CA N H2 110.089 1.83\nVAL CA N H3 110.089 1.83\nVAL H N H2 109.028 2.41\nVAL H N H3 109.028 2.41\nVAL H2 N H3 109.028 2.41\nVAL N CA C 108.763 1.50\nVAL N CA CB 111.441 1.50\nVAL N CA HA 108.396 1.50\nVAL C CA CB 111.388 1.50\nVAL C CA HA 108.542 1.50\nVAL CB CA HA 108.631 1.50\nVAL CA C O 117.133 1.50\nVAL CA C OXT 117.133 1.50\nVAL O C OXT 125.734 1.50\nVAL CA CB CG1 111.772 1.50\nVAL CA CB CG2 111.772 1.50\nVAL CA CB HB 107.252 1.50\nVAL CG1 CB CG2 110.676 1.50\nVAL CG1 CB HB 107.603 1.50\nVAL CG2 CB HB 107.603 1.50\nVAL CB CG1 HG11 109.507 1.50\nVAL CB CG1 HG12 109.507 1.50\nVAL CB CG1 HG13 109.507 1.50\nVAL HG11 CG1 HG12 109.411 1.50\nVAL HG11 CG1 HG13 109.411 1.50\nVAL HG12 CG1 HG13 109.411 1.50\nVAL CB CG2 HG21 109.507 1.50\nVAL CB CG2 HG22 109.507 1.50\nVAL CB CG2 HG23 109.507 1.50\nVAL HG21 CG2 HG22 109.411 1.50\nVAL HG21 CG2 HG23 109.411 1.50\nVAL HG22 CG2 HG23 109.411 1.50\n\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nVAL chi1 N CA CB CG2 -60.000 10.0 3\nVAL hh1 CA CB CG1 HG13 180.000 10.0 3\nVAL hh2 CA CB CG2 HG23 -60.000 10.0 3\nVAL sp3_sp3_1 C CA N H 180.000 10.0 3\nVAL sp2_sp3_1 O C CA N 0.000 10.0 6\n\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nVAL chir_1 CA N C CB positive\nVAL chir_2 CB CA CG1 CG2 both\n\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nVAL plan-1 C 0.020\nVAL plan-1 CA 0.020\nVAL plan-1 O 0.020\nVAL plan-1 OXT 0.020\n\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nVAL SMILES ACDLabs 10.04 O=C(O)C(N)C(C)C\nVAL SMILES_CANONICAL CACTVS 3.341 CC(C)[C@H](N)C(O)=O\nVAL SMILES CACTVS 3.341 CC(C)[CH](N)C(O)=O\nVAL SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0 CC(C)[C@@H](C(=O)O)N\nVAL SMILES \"OpenEye OEToolkits\" 1.5.0 CC(C)C(C(=O)O)N\nVAL InChI InChI 1.03 InChI=1S/C5H11NO2/c1-3(2)4(6)5(7)8/h3-4H,6H2,1-2H3,(H,7,8)/t4-/m0/s1\nVAL InChIKey InChI 1.03 KZSNJWFQEVHDMF-BYPYZUCNSA-N\n\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nVAL acedrg 243 \"dictionary generator\"\nVAL acedrg_database 11 \"data source\"\nVAL rdkit 2017.03.2 \"Chemoinformatics tool\"\nVAL refmac5 5.8.0238 \"optimization tool\"\n",
    atoms: [
      {name: "N", element: "N", xyz: [11.278, 2.949, 48.508]},
      {name: "CA", element: "C", xyz: [10.388, 4.15, 48.581]},
      {name: "C", element: "C", xyz: [9.851, 4.282, 50.012]},
      {name: "O", element: "O", xyz: [9.223, 3.31, 50.476]},
      {name: "CB", element: "C", xyz: [9.239, 4.075, 47.552]},
      {name: "CG1", element: "C", xyz: [8.374, 5.332, 47.574]},
      {name: "CG2", element: "C", xyz: [9.76, 3.787, 46.147]},
      {name: "OXT", element: "O", xyz: [10.082, 5.352, 50.61]},
      {name: "H", element: "H", xyz: [11.876, 3.042, 47.827]},
      {name: "H2", element: "H", xyz: [10.781, 2.198, 48.364]},
      {name: "H3", element: "H", xyz: [11.744, 2.848, 49.285]},
      {name: "HA", element: "H", xyz: [10.926, 4.938, 48.382]},
      {name: "HB", element: "H", xyz: [8.664, 3.315, 47.815]},
      {name: "HG11", element: "H", xyz: [8.939, 6.112, 47.715]},
      {name: "HG12", element: "H", xyz: [7.728, 5.268, 48.298]},
      {name: "HG13", element: "H", xyz: [7.899, 5.427, 46.73]},
      {name: "HG21", element: "H", xyz: [10.535, 4.348, 45.967]},
      {name: "HG22", element: "H", xyz: [9.067, 3.971, 45.491]},
      {name: "HG23", element: "H", xyz: [10.02, 2.851, 46.085]},
    ],
  },
};

const NUCLEOTIDE_TEMPLATES = {
  "A": {
    name: "A",
    cif: "#\ndata_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nA     A       \"ADENOSINE-5'-MONOPHOSPHATE\"     RNA     35     23     .     \n#\ndata_comp_A\n#\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nA       OP3     O       OP      -1      22.184      9.416       -6.467      \nA       P       P       P       0       23.061      10.073      -7.517      \nA       OP1     O       O       0       22.426      10.079      -8.894      \nA       OP2     O       OP      -1      24.478      9.532       -7.523      \nA       \"O5'\"   O       O2      0       23.184      11.622      -7.081      \nA       \"C5'\"   C       CH2     0       23.997      12.510      -7.889      \nA       \"C4'\"   C       CH1     0       23.959      13.900      -7.302      \nA       \"O4'\"   O       O2      0       24.489      13.865      -5.952      \nA       \"C3'\"   C       CH1     0       24.795      14.957      -8.033      \nA       \"O3'\"   O       OH1     0       24.040      15.590      -9.060      \nA       \"C2'\"   C       CH1     0       25.162      15.917      -6.899      \nA       \"O2'\"   O       OH1     0       24.142      16.849      -6.609      \nA       \"C1'\"   C       CH1     0       25.367      14.950      -5.735      \nA       N9      N       NR5     0       26.737      14.457      -5.612      \nA       C8      C       CR15    0       27.206      13.184      -5.839      \nA       N7      N       NRD5    0       28.493      13.056      -5.636      \nA       C5      C       CR56    0       28.908      14.321      -5.248      \nA       C6      C       CR6     0       30.172      14.840      -4.890      \nA       N6      N       NH2     0       31.287      14.114      -4.866      \nA       N1      N       NRD6    0       30.240      16.155      -4.553      \nA       C2      C       CR16    0       29.111      16.881      -4.579      \nA       N3      N       NRD6    0       27.874      16.499      -4.898      \nA       C4      C       CR56    0       27.833      15.193      -5.227      \nA       \"H5'\"   H       H       0       23.653      12.531      -8.815      \nA       \"H5''\"  H       H       0       24.931      12.185      -7.909      \nA       \"H4'\"   H       H       0       23.023      14.194      -7.269      \nA       \"H3'\"   H       H       0       25.613      14.544      -8.414      \nA       \"HO3'\"  H       H       0       24.512      16.204      -9.407      \nA       \"H2'\"   H       H       0       26.008      16.394      -7.110      \nA       \"HO2'\"  H       H       0       24.469      17.486      -6.152      \nA       \"H1'\"   H       H       0       25.116      15.407      -4.901      \nA       H8      H       H       0       26.656      12.471      -6.115      \nA       H61     H       H       0       31.972      14.381      -4.386      \nA       H62     H       H       0       31.333      13.371      -5.331      \nA       H2      H       H       0       29.207      17.789      -4.337      \nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nA       OP3           P      SINGLE       n     1.517  0.0192     1.517  0.0192\nA         P         OP1      DOUBLE       n     1.517  0.0192     1.517  0.0192\nA         P         OP2      SINGLE       n     1.517  0.0192     1.517  0.0192\nA         P       \"O5'\"      SINGLE       n     1.614  0.0178     1.614  0.0178\nA     \"O5'\"       \"C5'\"      SINGLE       n     1.450  0.0166     1.450  0.0166\nA     \"C5'\"       \"C4'\"      SINGLE       n     1.509  0.0100     1.509  0.0100\nA     \"C4'\"       \"O4'\"      SINGLE       n     1.451  0.0100     1.451  0.0100\nA     \"C4'\"       \"C3'\"      SINGLE       n     1.535  0.0100     1.535  0.0100\nA     \"O4'\"       \"C1'\"      SINGLE       n     1.409  0.0100     1.409  0.0100\nA     \"C3'\"       \"O3'\"      SINGLE       n     1.422  0.0100     1.422  0.0100\nA     \"C3'\"       \"C2'\"      SINGLE       n     1.531  0.0100     1.531  0.0100\nA     \"C2'\"       \"O2'\"      SINGLE       n     1.411  0.0100     1.411  0.0100\nA     \"C2'\"       \"C1'\"      SINGLE       n     1.525  0.0100     1.525  0.0100\nA     \"C1'\"          N9      SINGLE       n     1.458  0.0100     1.458  0.0100\nA        N9          C8      SINGLE       y     1.372  0.0100     1.372  0.0100\nA        N9          C4      SINGLE       y     1.374  0.0101     1.374  0.0101\nA        C8          N7      DOUBLE       y     1.310  0.0100     1.310  0.0100\nA        N7          C5      SINGLE       y     1.388  0.0100     1.388  0.0100\nA        C5          C6      SINGLE       y     1.408  0.0100     1.408  0.0100\nA        C5          C4      DOUBLE       y     1.381  0.0100     1.381  0.0100\nA        C6          N6      SINGLE       n     1.330  0.0100     1.330  0.0100\nA        C6          N1      DOUBLE       y     1.354  0.0100     1.354  0.0100\nA        N1          C2      SINGLE       y     1.339  0.0100     1.339  0.0100\nA        C2          N3      DOUBLE       y     1.330  0.0100     1.330  0.0100\nA        N3          C4      SINGLE       y     1.343  0.0100     1.343  0.0100\nA     \"C5'\"       \"H5'\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nA     \"C5'\"      \"H5''\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nA     \"C4'\"       \"H4'\"      SINGLE       n     1.089  0.0100     0.981  0.0200\nA     \"C3'\"       \"H3'\"      SINGLE       n     1.089  0.0100     0.992  0.0200\nA     \"O3'\"      \"HO3'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nA     \"C2'\"       \"H2'\"      SINGLE       n     1.089  0.0100     0.994  0.0200\nA     \"O2'\"      \"HO2'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nA     \"C1'\"       \"H1'\"      SINGLE       n     1.089  0.0100     0.984  0.0200\nA        C8          H8      SINGLE       n     1.082  0.0130     0.942  0.0170\nA        N6         H61      SINGLE       n     1.016  0.0100     0.877  0.0200\nA        N6         H62      SINGLE       n     1.016  0.0100     0.877  0.0200\nA        C2          H2      SINGLE       n     1.082  0.0130     0.945  0.0200\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nA       OP3           P         OP1     112.864    1.69\nA       OP3           P         OP2     112.864    1.69\nA       OP3           P       \"O5'\"     105.808    2.07\nA       OP1           P         OP2     112.864    1.69\nA       OP1           P       \"O5'\"     105.808    2.07\nA       OP2           P       \"O5'\"     105.808    2.07\nA         P       \"O5'\"       \"C5'\"     118.783    1.50\nA     \"O5'\"       \"C5'\"       \"C4'\"     109.342    1.50\nA     \"O5'\"       \"C5'\"       \"H5'\"     109.845    1.50\nA     \"O5'\"       \"C5'\"      \"H5''\"     109.845    1.50\nA     \"C4'\"       \"C5'\"       \"H5'\"     109.624    1.50\nA     \"C4'\"       \"C5'\"      \"H5''\"     109.624    1.50\nA     \"H5'\"       \"C5'\"      \"H5''\"     108.472    1.50\nA     \"C5'\"       \"C4'\"       \"O4'\"     109.123    1.50\nA     \"C5'\"       \"C4'\"       \"C3'\"     116.008    1.52\nA     \"C5'\"       \"C4'\"       \"H4'\"     108.268    1.50\nA     \"O4'\"       \"C4'\"       \"C3'\"     105.388    1.50\nA     \"O4'\"       \"C4'\"       \"H4'\"     108.947    1.50\nA     \"C3'\"       \"C4'\"       \"H4'\"     109.363    1.86\nA     \"C4'\"       \"O4'\"       \"C1'\"     109.903    1.50\nA     \"C4'\"       \"C3'\"       \"O3'\"     111.281    2.46\nA     \"C4'\"       \"C3'\"       \"C2'\"     102.602    1.50\nA     \"C4'\"       \"C3'\"       \"H3'\"     110.452    2.54\nA     \"O3'\"       \"C3'\"       \"C2'\"     111.581    2.83\nA     \"O3'\"       \"C3'\"       \"H3'\"     110.380    1.67\nA     \"C2'\"       \"C3'\"       \"H3'\"     110.504    1.75\nA     \"C3'\"       \"O3'\"      \"HO3'\"     108.744    3.00\nA     \"C3'\"       \"C2'\"       \"O2'\"     112.782    2.45\nA     \"C3'\"       \"C2'\"       \"C1'\"     101.239    1.50\nA     \"C3'\"       \"C2'\"       \"H2'\"     110.596    1.51\nA     \"O2'\"       \"C2'\"       \"C1'\"     111.715    2.69\nA     \"O2'\"       \"C2'\"       \"H2'\"     110.448    1.97\nA     \"C1'\"       \"C2'\"       \"H2'\"     110.636    1.70\nA     \"C2'\"       \"O2'\"      \"HO2'\"     109.103    2.13\nA     \"O4'\"       \"C1'\"       \"C2'\"     106.047    1.50\nA     \"O4'\"       \"C1'\"          N9     108.477    1.50\nA     \"O4'\"       \"C1'\"       \"H1'\"     109.807    1.50\nA     \"C2'\"       \"C1'\"          N9     113.824    1.50\nA     \"C2'\"       \"C1'\"       \"H1'\"     109.015    1.50\nA        N9       \"C1'\"       \"H1'\"     109.561    1.50\nA     \"C1'\"          N9          C8     126.848    1.91\nA     \"C1'\"          N9          C4     127.459    1.80\nA        C8          N9          C4     105.693    1.50\nA        N9          C8          N7     113.469    1.50\nA        N9          C8          H8     123.206    1.50\nA        N7          C8          H8     123.326    1.50\nA        C8          N7          C5     104.739    1.50\nA        N7          C5          C6     132.250    1.50\nA        N7          C5          C4     110.483    1.50\nA        C6          C5          C4     117.267    1.50\nA        C5          C6          N6     123.792    1.50\nA        C5          C6          N1     117.409    1.50\nA        N6          C6          N1     118.799    1.50\nA        C6          N6         H61     119.723    1.50\nA        C6          N6         H62     119.723    1.50\nA       H61          N6         H62     120.554    1.88\nA        C6          N1          C2     118.521    1.50\nA        N1          C2          N3     129.332    1.50\nA        N1          C2          H2     115.313    1.50\nA        N3          C2          H2     115.355    1.50\nA        C2          N3          C4     110.982    1.50\nA        N9          C4          C5     105.616    1.50\nA        N9          C4          N3     127.895    1.50\nA        C5          C4          N3     126.489    1.50\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nA       C2e-chi         \"O4'\"     \"C1'\"     N9        C4        210.000       10.000    6     \nA       C2e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     340.700       6.300     1     \nA       C2e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     32.800        4.900     1     \nA       C2e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     326.9         3.600     1     \nA       C2e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     22.600        4.500     1     \nA       C2e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     357.700       6.100     1     \nA       C3e-chi         \"O4'\"     \"C1'\"     N9        C4        210.000       10.000    6     \nA       C3e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     2.8           6.100     1     \nA       C3e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     335.00        4.900     1     \nA       C3e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     35.9          2.800     1     \nA       C3e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     324.700       3.100     1     \nA       C3e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     20.500        5.100     1     \nA       alpha           \"C5'\"     \"O5'\"     P         OP3       -60.000       10.00     3     \nA       beta            P         \"O5'\"     \"C5'\"     \"C4'\"     180.000       10.00     3     \nA       epsi            \"C4'\"     \"C3'\"     \"O3'\"     \"HO3'\"    180.000       10.00     3     \nA       gamma           \"O5'\"     \"C5'\"     \"C4'\"     \"C3'\"     180.000       10.00     3     \nA       sp3_sp3_52      \"C3'\"     \"C2'\"     \"O2'\"     \"HO2'\"    180.000       10.00     3     \nA              const_14          N7          C8          N9       \"C1'\"     180.000    10.0     2\nA              const_26          C5          C4          N9       \"C1'\"     180.000    10.0     2\nA              const_17          N9          C8          N7          C5       0.000    10.0     2\nA              const_20          C6          C5          N7          C8     180.000    10.0     2\nA       const_sp2_sp2_4          N7          C5          C6          N6       0.000     5.0     2\nA              const_21          N9          C4          C5          N7       0.000    10.0     2\nA             sp2_sp2_1          C5          C6          N6         H61     180.000     5.0     2\nA       const_sp2_sp2_6          N6          C6          N1          C2     180.000     5.0     2\nA       const_sp2_sp2_7          N3          C2          N1          C6       0.000     5.0     2\nA       const_sp2_sp2_9          N1          C2          N3          C4       0.000     5.0     2\nA              const_12          N9          C4          N3          C2     180.000    10.0     2\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nA  chir_1    P    \"O5'\"    OP3    OP2    both\nA  chir_2    \"C4'\"    \"O4'\"    \"C3'\"    \"C5'\"    negative\nA  chir_3    \"C3'\"    \"O3'\"    \"C4'\"    \"C2'\"    positive\nA  chir_4    \"C2'\"    \"O2'\"    \"C1'\"    \"C3'\"    negative\nA  chir_5    \"C1'\"    \"O4'\"    N9    \"C2'\"    negative\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nA  plan-1       \"C1'\"   0.020\nA  plan-1          C2   0.020\nA  plan-1          C4   0.020\nA  plan-1          C5   0.020\nA  plan-1          C6   0.020\nA  plan-1          C8   0.020\nA  plan-1          H2   0.020\nA  plan-1          H8   0.020\nA  plan-1          N1   0.020\nA  plan-1          N3   0.020\nA  plan-1          N6   0.020\nA  plan-1          N7   0.020\nA  plan-1          N9   0.020\nA  plan-2          C6   0.020\nA  plan-2         H61   0.020\nA  plan-2         H62   0.020\nA  plan-2          N6   0.020\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nA           SMILES              ACDLabs 10.04                                                                                                                       O=P(O)(O)OCC3OC(n2cnc1c(ncnc12)N)C(O)C3O\nA SMILES_CANONICAL               CACTVS 3.341                                                                                                   Nc1ncnc2n(cnc12)[C@@H]3O[C@H](CO[P](O)(O)=O)[C@@H](O)[C@H]3O\nA           SMILES               CACTVS 3.341                                                                                                         Nc1ncnc2n(cnc12)[CH]3O[CH](CO[P](O)(O)=O)[CH](O)[CH]3O\nA SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0                                                                                               c1nc(c2c(n1)n(cn2)[C@H]3[C@@H]([C@@H]([C@H](O3)COP(=O)(O)O)O)O)N\nA           SMILES \"OpenEye OEToolkits\" 1.5.0                                                                                                                 c1nc(c2c(n1)n(cn2)C3C(C(C(O3)COP(=O)(O)O)O)O)N\nA            InChI                InChI  1.03 InChI=1S/C10H14N5O7P/c11-8-5-9(13-2-12-8)15(3-14-5)10-7(17)6(16)4(22-10)1-21-23(18,19)20/h2-4,6-7,10,16-17H,1H2,(H2,11,12,13)(H2,18,19,20)/t4-,6-,7-,10-/m1/s1\nA         InChIKey                InChI  1.03                                                                                                                                    UDMBCSSLTHHNCD-KQYNXXCUSA-N\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nA   acedrg               243         \"dictionary generator\"                  \nA   acedrg_database      11          \"data source\"                           \nA   rdkit                2017.03.2   \"Chemoinformatics tool\"\nA   refmac5              5.8.0238    \"optimization tool\"                     \n",
    atoms: [
      {name: "OP3", element: "O", xyz: [22.184, 9.416, -6.467]},
      {name: "P", element: "P", xyz: [23.061, 10.073, -7.517]},
      {name: "OP1", element: "O", xyz: [22.426, 10.079, -8.894]},
      {name: "OP2", element: "O", xyz: [24.478, 9.532, -7.523]},
      {name: "O5'", element: "O", xyz: [23.184, 11.622, -7.081]},
      {name: "C5'", element: "C", xyz: [23.997, 12.510, -7.889]},
      {name: "C4'", element: "C", xyz: [23.959, 13.900, -7.302]},
      {name: "O4'", element: "O", xyz: [24.489, 13.865, -5.952]},
      {name: "C3'", element: "C", xyz: [24.795, 14.957, -8.033]},
      {name: "O3'", element: "O", xyz: [24.040, 15.590, -9.06]},
      {name: "C2'", element: "C", xyz: [25.162, 15.917, -6.899]},
      {name: "O2'", element: "O", xyz: [24.142, 16.849, -6.609]},
      {name: "C1'", element: "C", xyz: [25.367, 14.950, -5.735]},
      {name: "N9", element: "N", xyz: [26.737, 14.457, -5.612]},
      {name: "C8", element: "C", xyz: [27.206, 13.184, -5.839]},
      {name: "N7", element: "N", xyz: [28.493, 13.056, -5.636]},
      {name: "C5", element: "C", xyz: [28.908, 14.321, -5.248]},
      {name: "C6", element: "C", xyz: [30.172, 14.840, -4.89]},
      {name: "N6", element: "N", xyz: [31.287, 14.114, -4.866]},
      {name: "N1", element: "N", xyz: [30.240, 16.155, -4.553]},
      {name: "C2", element: "C", xyz: [29.111, 16.881, -4.579]},
      {name: "N3", element: "N", xyz: [27.874, 16.499, -4.898]},
      {name: "C4", element: "C", xyz: [27.833, 15.193, -5.227]},
      {name: "H5'", element: "H", xyz: [23.653, 12.531, -8.815]},
      {name: "H5''", element: "H", xyz: [24.931, 12.185, -7.909]},
      {name: "H4'", element: "H", xyz: [23.023, 14.194, -7.269]},
      {name: "H3'", element: "H", xyz: [25.613, 14.544, -8.414]},
      {name: "HO3'", element: "H", xyz: [24.512, 16.204, -9.407]},
      {name: "H2'", element: "H", xyz: [26.008, 16.394, -7.11]},
      {name: "HO2'", element: "H", xyz: [24.469, 17.486, -6.152]},
      {name: "H1'", element: "H", xyz: [25.116, 15.407, -4.901]},
      {name: "H8", element: "H", xyz: [26.656, 12.471, -6.115]},
      {name: "H61", element: "H", xyz: [31.972, 14.381, -4.386]},
      {name: "H62", element: "H", xyz: [31.333, 13.371, -5.331]},
      {name: "H2", element: "H", xyz: [29.207, 17.789, -4.337]},
    ],
  },
  "C": {
    name: "C",
    cif: "#\ndata_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nC     C       \"CYTIDINE-5'-MONOPHOSPHATE\"     RNA     33     21     .     \n#\ndata_comp_C\n#\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nC       OP3     O       OP      -1      26.264      21.286      -11.211     \nC       P       P       P       0       27.065      20.768      -12.391     \nC       OP1     O       O       0       26.731      21.481      -13.688     \nC       OP2     O       OP      -1      27.015      19.258      -12.520     \nC       \"O5'\"   O       O2      0       28.604      21.132      -12.071     \nC       \"C5'\"   C       CH2     0       28.962      22.520      -11.845     \nC       \"C4'\"   C       CH1     0       30.463      22.648      -11.735     \nC       \"O4'\"   O       O2      0       30.967      21.749      -10.719     \nC       \"C3'\"   C       CH1     0       31.273      22.268      -12.980     \nC       \"O3'\"   O       OH1     0       31.285      23.333      -13.923     \nC       \"C2'\"   C       CH1     0       32.660      21.973      -12.387     \nC       \"O2'\"   O       OH1     0       33.494      23.113      -12.311     \nC       \"C1'\"   C       CH1     0       32.329      21.476      -10.970     \nC       N1      N       NR6     0       32.565      20.011      -10.805     \nC       C2      C       CR6     0       33.589      19.539      -9.963      \nC       O2      O       O       0       34.302      20.347      -9.344      \nC       N3      N       NRD6    0       33.778      18.197      -9.840      \nC       C4      C       CR6     0       33.005      17.329      -10.512     \nC       N4      N       NH2     0       33.237      16.032      -10.352     \nC       C5      C       CR16    0       31.965      17.787      -11.373     \nC       C6      C       CR16    0       31.786      19.115      -11.490     \nC       \"H5'\"   H       H       0       28.541      22.842      -11.010     \nC       \"H5''\"  H       H       0       28.636      23.077      -12.594     \nC       \"H4'\"   H       H       0       30.676      23.570      -11.475     \nC       \"H3'\"   H       H       0       30.904      21.447      -13.396     \nC       \"HO3'\"  H       H       0       31.819      23.134      -14.553     \nC       \"H2'\"   H       H       0       33.101      21.267      -12.901     \nC       \"HO2'\"  H       H       0       33.087      23.744      -11.913     \nC       \"H1'\"   H       H       0       32.871      21.976      -10.317     \nC       H41     H       H       0       33.920      15.764      -9.869      \nC       H42     H       H       0       32.707      15.443      -10.731     \nC       H5      H       H       0       31.420      17.183      -11.847     \nC       H6      H       H       0       31.112      19.446      -12.046     \nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nC       OP3           P      SINGLE       n     1.517  0.0192     1.517  0.0192\nC         P         OP1      DOUBLE       n     1.517  0.0192     1.517  0.0192\nC         P         OP2      SINGLE       n     1.517  0.0192     1.517  0.0192\nC         P       \"O5'\"      SINGLE       n     1.614  0.0178     1.614  0.0178\nC     \"O5'\"       \"C5'\"      SINGLE       n     1.450  0.0166     1.450  0.0166\nC     \"C5'\"       \"C4'\"      SINGLE       n     1.509  0.0100     1.509  0.0100\nC     \"C4'\"       \"O4'\"      SINGLE       n     1.451  0.0111     1.451  0.0111\nC     \"C4'\"       \"C3'\"      SINGLE       n     1.535  0.0100     1.535  0.0100\nC     \"O4'\"       \"C1'\"      SINGLE       n     1.411  0.0100     1.411  0.0100\nC     \"C3'\"       \"O3'\"      SINGLE       n     1.422  0.0100     1.422  0.0100\nC     \"C3'\"       \"C2'\"      SINGLE       n     1.533  0.0109     1.533  0.0109\nC     \"C2'\"       \"O2'\"      SINGLE       n     1.412  0.0100     1.412  0.0100\nC     \"C2'\"       \"C1'\"      SINGLE       n     1.532  0.0100     1.532  0.0100\nC     \"C1'\"          N1      SINGLE       n     1.487  0.0100     1.487  0.0100\nC        N1          C2      SINGLE       y     1.397  0.0100     1.397  0.0100\nC        N1          C6      SINGLE       y     1.364  0.0108     1.364  0.0108\nC        C2          O2      DOUBLE       n     1.241  0.0100     1.241  0.0100\nC        C2          N3      SINGLE       y     1.355  0.0119     1.355  0.0119\nC        N3          C4      DOUBLE       y     1.339  0.0110     1.339  0.0110\nC        C4          N4      SINGLE       n     1.325  0.0109     1.325  0.0109\nC        C4          C5      SINGLE       y     1.422  0.0123     1.422  0.0123\nC        C5          C6      DOUBLE       y     1.342  0.0100     1.342  0.0100\nC     \"C5'\"       \"H5'\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nC     \"C5'\"      \"H5''\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nC     \"C4'\"       \"H4'\"      SINGLE       n     1.089  0.0100     0.981  0.0200\nC     \"C3'\"       \"H3'\"      SINGLE       n     1.089  0.0100     0.992  0.0200\nC     \"O3'\"      \"HO3'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nC     \"C2'\"       \"H2'\"      SINGLE       n     1.089  0.0100     0.978  0.0200\nC     \"O2'\"      \"HO2'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nC     \"C1'\"       \"H1'\"      SINGLE       n     1.089  0.0100     0.985  0.0100\nC        N4         H41      SINGLE       n     1.016  0.0100     0.877  0.0200\nC        N4         H42      SINGLE       n     1.016  0.0100     0.877  0.0200\nC        C5          H5      SINGLE       n     1.082  0.0130     0.941  0.0174\nC        C6          H6      SINGLE       n     1.082  0.0130     0.935  0.0143\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nC       OP3           P         OP1     112.864    1.69\nC       OP3           P         OP2     112.864    1.69\nC       OP3           P       \"O5'\"     105.808    2.07\nC       OP1           P         OP2     112.864    1.69\nC       OP1           P       \"O5'\"     105.808    2.07\nC       OP2           P       \"O5'\"     105.808    2.07\nC         P       \"O5'\"       \"C5'\"     118.783    1.50\nC     \"O5'\"       \"C5'\"       \"C4'\"     109.342    1.50\nC     \"O5'\"       \"C5'\"       \"H5'\"     109.845    1.50\nC     \"O5'\"       \"C5'\"      \"H5''\"     109.845    1.50\nC     \"C4'\"       \"C5'\"       \"H5'\"     109.624    1.50\nC     \"C4'\"       \"C5'\"      \"H5''\"     109.624    1.50\nC     \"H5'\"       \"C5'\"      \"H5''\"     108.472    1.50\nC     \"C5'\"       \"C4'\"       \"O4'\"     109.615    1.50\nC     \"C5'\"       \"C4'\"       \"C3'\"     116.008    1.52\nC     \"C5'\"       \"C4'\"       \"H4'\"     108.268    1.50\nC     \"O4'\"       \"C4'\"       \"C3'\"     104.439    1.50\nC     \"O4'\"       \"C4'\"       \"H4'\"     108.698    1.50\nC     \"C3'\"       \"C4'\"       \"H4'\"     109.363    1.86\nC     \"C4'\"       \"O4'\"       \"C1'\"     109.578    1.50\nC     \"C4'\"       \"C3'\"       \"O3'\"     111.281    2.46\nC     \"C4'\"       \"C3'\"       \"C2'\"     102.071    1.50\nC     \"C4'\"       \"C3'\"       \"H3'\"     110.452    2.54\nC     \"O3'\"       \"C3'\"       \"C2'\"     111.993    3.00\nC     \"O3'\"       \"C3'\"       \"H3'\"     110.380    1.67\nC     \"C2'\"       \"C3'\"       \"H3'\"     110.108    1.66\nC     \"C3'\"       \"O3'\"      \"HO3'\"     108.744    3.00\nC     \"C3'\"       \"C2'\"       \"O2'\"     112.861    2.52\nC     \"C3'\"       \"C2'\"       \"C1'\"     101.269    1.50\nC     \"C3'\"       \"C2'\"       \"H2'\"     110.799    1.82\nC     \"O2'\"       \"C2'\"       \"C1'\"     109.476    3.00\nC     \"O2'\"       \"C2'\"       \"H2'\"     111.022    1.77\nC     \"C1'\"       \"C2'\"       \"H2'\"     110.760    1.63\nC     \"C2'\"       \"O2'\"      \"HO2'\"     109.449    1.85\nC     \"O4'\"       \"C1'\"       \"C2'\"     106.825    1.50\nC     \"O4'\"       \"C1'\"          N1     108.667    1.50\nC     \"O4'\"       \"C1'\"       \"H1'\"     109.327    1.50\nC     \"C2'\"       \"C1'\"          N1     112.859    1.50\nC     \"C2'\"       \"C1'\"       \"H1'\"     109.776    1.83\nC        N1       \"C1'\"       \"H1'\"     109.166    1.50\nC     \"C1'\"          N1          C2     118.189    2.26\nC     \"C1'\"          N1          C6     121.301    1.52\nC        C2          N1          C6     120.510    1.50\nC        N1          C2          O2     118.710    1.50\nC        N1          C2          N3     118.927    1.50\nC        O2          C2          N3     122.370    1.50\nC        C2          N3          C4     120.266    1.50\nC        N3          C4          N4     117.855    1.50\nC        N3          C4          C5     121.269    1.50\nC        N4          C4          C5     120.876    1.50\nC        C4          N4         H41     119.818    1.59\nC        C4          N4         H42     119.818    1.59\nC       H41          N4         H42     120.363    1.85\nC        C4          C5          C6     117.808    1.50\nC        C4          C5          H5     121.350    1.50\nC        C6          C5          H5     120.848    1.50\nC        N1          C6          C5     121.215    1.50\nC        N1          C6          H6     118.510    1.50\nC        C5          C6          H6     120.275    1.75\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nC       C2e-chi         \"O4'\"     \"C1'\"     N1        C2        210.000       10.000    6     \nC       C2e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     340.700       6.300     1     \nC       C2e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     32.800        4.900     1     \nC       C2e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     326.9         3.600     1     \nC       C2e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     22.600        4.500     1     \nC       C2e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     357.700       6.100     1     \nC       C3e-chi         \"O4'\"     \"C1'\"     N1        C2        210.000       10.000    6     \nC       C3e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     2.8           6.100     1     \nC       C3e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     335.00        4.900     1     \nC       C3e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     35.9          2.800     1     \nC       C3e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     324.700       3.100     1     \nC       C3e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     20.500        5.100     1     \nC       alpha           \"C5'\"     \"O5'\"     P         OP3       -60.000       10.00     3     \nC       beta            P         \"O5'\"     \"C5'\"     \"C4'\"     180.000       10.00     3     \nC       epsi            \"C4'\"     \"C3'\"     \"O3'\"     \"HO3'\"    180.000       10.00     3     \nC       gamma           \"O5'\"     \"C5'\"     \"C4'\"     \"C3'\"     180.000       10.00     3     \nC       sp3_sp3_52      \"C3'\"     \"C2'\"     \"O2'\"     \"HO2'\"    180.000       10.00     3     \nC       const_sp2_sp2_4          O2          C2          N1       \"C1'\"       0.000     5.0     2\nC              const_18          C5          C6          N1       \"C1'\"     180.000    10.0     2\nC       const_sp2_sp2_6          O2          C2          N3          C4     180.000     5.0     2\nC       const_sp2_sp2_8          N4          C4          N3          C2     180.000     5.0     2\nC             sp2_sp2_3          N3          C4          N4         H41       0.000     5.0     2\nC              const_11          N4          C4          C5          C6     180.000    10.0     2\nC              const_13          C4          C5          C6          N1       0.000    10.0     2\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nC  chir_1    P    \"O5'\"    OP3    OP2    both\nC  chir_2    \"C4'\"    \"O4'\"    \"C3'\"    \"C5'\"    negative\nC  chir_3    \"C3'\"    \"O3'\"    \"C4'\"    \"C2'\"    positive\nC  chir_4    \"C2'\"    \"O2'\"    \"C1'\"    \"C3'\"    negative\nC  chir_5    \"C1'\"    \"O4'\"    N1    \"C2'\"    negative\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nC  plan-1       \"C1'\"   0.020\nC  plan-1          C2   0.020\nC  plan-1          C4   0.020\nC  plan-1          C5   0.020\nC  plan-1          C6   0.020\nC  plan-1          H5   0.020\nC  plan-1          H6   0.020\nC  plan-1          N1   0.020\nC  plan-1          N3   0.020\nC  plan-1          N4   0.020\nC  plan-1          O2   0.020\nC  plan-2          C4   0.020\nC  plan-2         H41   0.020\nC  plan-2         H42   0.020\nC  plan-2          N4   0.020\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nC           SMILES              ACDLabs 10.04                                                                                                            O=C1N=C(N)C=CN1C2OC(C(O)C2O)COP(=O)(O)O\nC SMILES_CANONICAL               CACTVS 3.341                                                                                      NC1=NC(=O)N(C=C1)[C@@H]2O[C@H](CO[P](O)(O)=O)[C@@H](O)[C@H]2O\nC           SMILES               CACTVS 3.341                                                                                            NC1=NC(=O)N(C=C1)[CH]2O[CH](CO[P](O)(O)=O)[CH](O)[CH]2O\nC SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0                                                                                      C1=CN(C(=O)N=C1N)[C@H]2[C@@H]([C@@H]([C@H](O2)COP(=O)(O)O)O)O\nC           SMILES \"OpenEye OEToolkits\" 1.5.0                                                                                                        C1=CN(C(=O)N=C1N)C2C(C(C(O2)COP(=O)(O)O)O)O\nC            InChI                InChI  1.03 InChI=1S/C9H14N3O8P/c10-5-1-2-12(9(15)11-5)8-7(14)6(13)4(20-8)3-19-21(16,17)18/h1-2,4,6-8,13-14H,3H2,(H2,10,11,15)(H2,16,17,18)/t4-,6-,7-,8-/m1/s1\nC         InChIKey                InChI  1.03                                                                                                                        IERHLVCPSMICTF-XVFCMESISA-N\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nC   acedrg               243         \"dictionary generator\"                  \nC   acedrg_database      11          \"data source\"                           \nC   rdkit                2017.03.2   \"Chemoinformatics tool\"\nC   refmac5              5.8.0238    \"optimization tool\"                     \n",
    atoms: [
      {name: "OP3", element: "O", xyz: [26.264, 21.286, -11.211]},
      {name: "P", element: "P", xyz: [27.065, 20.768, -12.391]},
      {name: "OP1", element: "O", xyz: [26.731, 21.481, -13.688]},
      {name: "OP2", element: "O", xyz: [27.015, 19.258, -12.52]},
      {name: "O5'", element: "O", xyz: [28.604, 21.132, -12.071]},
      {name: "C5'", element: "C", xyz: [28.962, 22.520, -11.845]},
      {name: "C4'", element: "C", xyz: [30.463, 22.648, -11.735]},
      {name: "O4'", element: "O", xyz: [30.967, 21.749, -10.719]},
      {name: "C3'", element: "C", xyz: [31.273, 22.268, -12.98]},
      {name: "O3'", element: "O", xyz: [31.285, 23.333, -13.923]},
      {name: "C2'", element: "C", xyz: [32.660, 21.973, -12.387]},
      {name: "O2'", element: "O", xyz: [33.494, 23.113, -12.311]},
      {name: "C1'", element: "C", xyz: [32.329, 21.476, -10.97]},
      {name: "N1", element: "N", xyz: [32.565, 20.011, -10.805]},
      {name: "C2", element: "C", xyz: [33.589, 19.539, -9.963]},
      {name: "O2", element: "O", xyz: [34.302, 20.347, -9.344]},
      {name: "N3", element: "N", xyz: [33.778, 18.197, -9.84]},
      {name: "C4", element: "C", xyz: [33.005, 17.329, -10.512]},
      {name: "N4", element: "N", xyz: [33.237, 16.032, -10.352]},
      {name: "C5", element: "C", xyz: [31.965, 17.787, -11.373]},
      {name: "C6", element: "C", xyz: [31.786, 19.115, -11.49]},
      {name: "H5'", element: "H", xyz: [28.541, 22.842, -11.01]},
      {name: "H5''", element: "H", xyz: [28.636, 23.077, -12.594]},
      {name: "H4'", element: "H", xyz: [30.676, 23.570, -11.475]},
      {name: "H3'", element: "H", xyz: [30.904, 21.447, -13.396]},
      {name: "HO3'", element: "H", xyz: [31.819, 23.134, -14.553]},
      {name: "H2'", element: "H", xyz: [33.101, 21.267, -12.901]},
      {name: "HO2'", element: "H", xyz: [33.087, 23.744, -11.913]},
      {name: "H1'", element: "H", xyz: [32.871, 21.976, -10.317]},
      {name: "H41", element: "H", xyz: [33.920, 15.764, -9.869]},
      {name: "H42", element: "H", xyz: [32.707, 15.443, -10.731]},
      {name: "H5", element: "H", xyz: [31.420, 17.183, -11.847]},
      {name: "H6", element: "H", xyz: [31.112, 19.446, -12.046]},
    ],
  },
  "G": {
    name: "G",
    cif: "#\ndata_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nG     G       \"GUANOSINE-5'-MONOPHOSPHATE\"     RNA     36     24     .     \n#\ndata_comp_G\n#\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nG       OP3     O       OP      -1      34.040      3.415       -1.077      \nG       P       P       P       0       34.210      4.003       0.312       \nG       OP1     O       O       0       34.487      5.494       0.290       \nG       OP2     O       OP      -1      35.203      3.231       1.161       \nG       \"O5'\"   O       O2      0       32.781      3.831       1.041       \nG       \"C5'\"   C       CH2     0       32.260      2.493       1.252       \nG       \"C4'\"   C       CH1     0       30.851      2.571       1.788       \nG       \"O4'\"   O       O2      0       30.831      3.382       2.990       \nG       \"C3'\"   C       CH1     0       29.808      3.223       0.875       \nG       \"O3'\"   O       OH1     0       29.289      2.285       -0.060      \nG       \"C2'\"   C       CH1     0       28.754      3.698       1.881       \nG       \"O2'\"   O       OH1     0       27.799      2.707       2.202       \nG       \"C1'\"   C       CH1     0       29.604      4.073       3.097       \nG       N9      N       NR5     0       29.861      5.508       3.212       \nG       C8      C       CR15    0       31.057      6.172       3.071       \nG       N7      N       NRD5    0       30.958      7.468       3.239       \nG       C5      C       CR56    0       29.612      7.676       3.509       \nG       C6      C       CR6     0       28.906      8.880       3.777       \nG       O6      O       O       0       29.357      10.033      3.827       \nG       N1      N       NR16    0       27.544      8.645       3.999       \nG       C2      C       CR6     0       26.939      7.407       3.968       \nG       N2      N       NH2     0       25.620      7.371       4.205       \nG       N3      N       NRD6    0       27.601      6.273       3.716       \nG       C4      C       CR56    0       28.926      6.478       3.499       \nG       \"H5'\"   H       H       0       32.833      2.008       1.895       \nG       \"H5''\"  H       H       0       32.261      1.995       0.397       \nG       \"H4'\"   H       H       0       30.559      1.662       2.015       \nG       \"H3'\"   H       H       0       30.200      3.999       0.398       \nG       \"HO3'\"  H       H       0       28.659      2.653       -0.495      \nG       \"H2'\"   H       H       0       28.286      4.500       1.527       \nG       \"HO2'\"  H       H       0       28.188      2.026       2.527       \nG       \"H1'\"   H       H       0       29.136      3.771       3.909       \nG       H8      H       H       0       31.870      5.740       2.872       \nG       H1      H       H       0       27.031      9.361       4.176       \nG       H21     H       H       0       25.105      6.850       3.723       \nG       H22     H       H       0       25.277      7.868       4.840       \nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nG       OP3           P      SINGLE       n     1.517  0.0192     1.517  0.0192\nG         P         OP1      DOUBLE       n     1.517  0.0192     1.517  0.0192\nG         P         OP2      SINGLE       n     1.517  0.0192     1.517  0.0192\nG         P       \"O5'\"      SINGLE       n     1.614  0.0178     1.614  0.0178\nG     \"O5'\"       \"C5'\"      SINGLE       n     1.450  0.0166     1.450  0.0166\nG     \"C5'\"       \"C4'\"      SINGLE       n     1.509  0.0100     1.509  0.0100\nG     \"C4'\"       \"O4'\"      SINGLE       n     1.451  0.0100     1.451  0.0100\nG     \"C4'\"       \"C3'\"      SINGLE       n     1.535  0.0100     1.535  0.0100\nG     \"O4'\"       \"C1'\"      SINGLE       n     1.409  0.0100     1.409  0.0100\nG     \"C3'\"       \"O3'\"      SINGLE       n     1.422  0.0100     1.422  0.0100\nG     \"C3'\"       \"C2'\"      SINGLE       n     1.531  0.0100     1.531  0.0100\nG     \"C2'\"       \"O2'\"      SINGLE       n     1.411  0.0100     1.411  0.0100\nG     \"C2'\"       \"C1'\"      SINGLE       n     1.525  0.0100     1.525  0.0100\nG     \"C1'\"          N9      SINGLE       n     1.458  0.0100     1.458  0.0100\nG        N9          C8      SINGLE       y     1.372  0.0100     1.372  0.0100\nG        N9          C4      SINGLE       y     1.375  0.0100     1.375  0.0100\nG        C8          N7      DOUBLE       y     1.312  0.0100     1.312  0.0100\nG        N7          C5      SINGLE       y     1.390  0.0100     1.390  0.0100\nG        C5          C6      SINGLE       y     1.417  0.0103     1.417  0.0103\nG        C5          C4      DOUBLE       y     1.377  0.0100     1.377  0.0100\nG        C6          O6      DOUBLE       n     1.239  0.0100     1.239  0.0100\nG        C6          N1      SINGLE       y     1.396  0.0107     1.396  0.0107\nG        N1          C2      SINGLE       y     1.374  0.0100     1.374  0.0100\nG        C2          N2      SINGLE       n     1.340  0.0101     1.340  0.0101\nG        C2          N3      DOUBLE       y     1.333  0.0104     1.333  0.0104\nG        N3          C4      SINGLE       y     1.355  0.0100     1.355  0.0100\nG     \"C5'\"       \"H5'\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nG     \"C5'\"      \"H5''\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nG     \"C4'\"       \"H4'\"      SINGLE       n     1.089  0.0100     0.981  0.0200\nG     \"C3'\"       \"H3'\"      SINGLE       n     1.089  0.0100     0.992  0.0200\nG     \"O3'\"      \"HO3'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nG     \"C2'\"       \"H2'\"      SINGLE       n     1.089  0.0100     0.994  0.0200\nG     \"O2'\"      \"HO2'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nG     \"C1'\"       \"H1'\"      SINGLE       n     1.089  0.0100     0.984  0.0200\nG        C8          H8      SINGLE       n     1.082  0.0130     0.942  0.0170\nG        N1          H1      SINGLE       n     1.016  0.0100     0.897  0.0200\nG        N2         H21      SINGLE       n     1.016  0.0100     0.877  0.0200\nG        N2         H22      SINGLE       n     1.016  0.0100     0.877  0.0200\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nG       OP3           P         OP1     112.864    1.69\nG       OP3           P         OP2     112.864    1.69\nG       OP3           P       \"O5'\"     105.808    2.07\nG       OP1           P         OP2     112.864    1.69\nG       OP1           P       \"O5'\"     105.808    2.07\nG       OP2           P       \"O5'\"     105.808    2.07\nG         P       \"O5'\"       \"C5'\"     118.783    1.50\nG     \"O5'\"       \"C5'\"       \"C4'\"     109.342    1.50\nG     \"O5'\"       \"C5'\"       \"H5'\"     109.845    1.50\nG     \"O5'\"       \"C5'\"      \"H5''\"     109.845    1.50\nG     \"C4'\"       \"C5'\"       \"H5'\"     109.624    1.50\nG     \"C4'\"       \"C5'\"      \"H5''\"     109.624    1.50\nG     \"H5'\"       \"C5'\"      \"H5''\"     108.472    1.50\nG     \"C5'\"       \"C4'\"       \"O4'\"     109.123    1.50\nG     \"C5'\"       \"C4'\"       \"C3'\"     116.008    1.52\nG     \"C5'\"       \"C4'\"       \"H4'\"     108.268    1.50\nG     \"O4'\"       \"C4'\"       \"C3'\"     105.388    1.50\nG     \"O4'\"       \"C4'\"       \"H4'\"     108.947    1.50\nG     \"C3'\"       \"C4'\"       \"H4'\"     109.363    1.86\nG     \"C4'\"       \"O4'\"       \"C1'\"     109.903    1.50\nG     \"C4'\"       \"C3'\"       \"O3'\"     111.281    2.46\nG     \"C4'\"       \"C3'\"       \"C2'\"     102.602    1.50\nG     \"C4'\"       \"C3'\"       \"H3'\"     110.452    2.54\nG     \"O3'\"       \"C3'\"       \"C2'\"     111.581    2.83\nG     \"O3'\"       \"C3'\"       \"H3'\"     110.380    1.67\nG     \"C2'\"       \"C3'\"       \"H3'\"     110.504    1.75\nG     \"C3'\"       \"O3'\"      \"HO3'\"     108.744    3.00\nG     \"C3'\"       \"C2'\"       \"O2'\"     112.782    2.45\nG     \"C3'\"       \"C2'\"       \"C1'\"     101.239    1.50\nG     \"C3'\"       \"C2'\"       \"H2'\"     110.596    1.51\nG     \"O2'\"       \"C2'\"       \"C1'\"     111.715    2.69\nG     \"O2'\"       \"C2'\"       \"H2'\"     110.448    1.97\nG     \"C1'\"       \"C2'\"       \"H2'\"     110.636    1.70\nG     \"C2'\"       \"O2'\"      \"HO2'\"     109.103    2.13\nG     \"O4'\"       \"C1'\"       \"C2'\"     106.047    1.50\nG     \"O4'\"       \"C1'\"          N9     108.477    1.50\nG     \"O4'\"       \"C1'\"       \"H1'\"     109.807    1.50\nG     \"C2'\"       \"C1'\"          N9     113.824    1.50\nG     \"C2'\"       \"C1'\"       \"H1'\"     109.015    1.50\nG        N9       \"C1'\"       \"H1'\"     109.561    1.50\nG     \"C1'\"          N9          C8     126.829    1.91\nG     \"C1'\"          N9          C4     127.440    1.80\nG        C8          N9          C4     105.731    1.50\nG        N9          C8          N7     113.507    1.50\nG        N9          C8          H8     123.187    1.50\nG        N7          C8          H8     123.307    1.50\nG        C8          N7          C5     104.778    1.50\nG        N7          C5          C6     130.030    1.50\nG        N7          C5          C4     110.574    1.50\nG        C6          C5          C4     119.397    1.50\nG        C5          C6          O6     128.244    1.50\nG        C5          C6          N1     111.367    1.50\nG        O6          C6          N1     120.389    1.50\nG        C6          N1          C2     125.351    1.50\nG        C6          N1          H1     116.978    2.44\nG        C2          N1          H1     117.677    2.71\nG        N1          C2          N2     116.576    1.50\nG        N1          C2          N3     123.602    1.50\nG        N2          C2          N3     119.821    1.50\nG        C2          N2         H21     119.868    1.50\nG        C2          N2         H22     119.868    1.50\nG       H21          N2         H22     120.263    1.96\nG        C2          N3          C4     112.066    1.50\nG        N9          C4          C5     105.411    1.50\nG        N9          C4          N3     126.378    1.50\nG        C5          C4          N3     128.211    1.50\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nG       C2e-chi         \"O4'\"     \"C1'\"     N9        C4        210.000       10.000    6     \nG       C2e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     340.700       6.300     1     \nG       C2e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     32.800        4.900     1     \nG       C2e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     326.9         3.600     1     \nG       C2e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     22.600        4.500     1     \nG       C2e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     357.700       6.100     1     \nG       C3e-chi         \"O4'\"     \"C1'\"     N9        C4        210.000       10.000    6     \nG       C3e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     2.8           6.100     1     \nG       C3e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     335.00        4.900     1     \nG       C3e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     35.9          2.800     1     \nG       C3e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     324.700       3.100     1     \nG       C3e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     20.500        5.100     1     \nG       alpha           \"C5'\"     \"O5'\"     P         OP3       -60.000       10.00     3     \nG       beta            P         \"O5'\"     \"C5'\"     \"C4'\"     180.000       10.00     3     \nG       epsi            \"C4'\"     \"C3'\"     \"O3'\"     \"HO3'\"    180.000       10.00     3     \nG       gamma           \"O5'\"     \"C5'\"     \"C4'\"     \"C3'\"     180.000       10.00     3     \nG       sp3_sp3_52      \"C3'\"     \"C2'\"     \"O2'\"     \"HO2'\"    180.000       10.00     3     \nG              const_18          N7          C8          N9       \"C1'\"     180.000    10.0     2\nG              const_30          C5          C4          N9       \"C1'\"     180.000    10.0     2\nG              const_21          N9          C8          N7          C5       0.000    10.0     2\nG              const_24          C6          C5          N7          C8     180.000    10.0     2\nG       const_sp2_sp2_4          N7          C5          C6          O6       0.000     5.0     2\nG              const_25          N9          C4          C5          N7       0.000    10.0     2\nG       const_sp2_sp2_7          O6          C6          N1          C2     180.000     5.0     2\nG              const_11          N2          C2          N1          C6     180.000    10.0     2\nG             sp2_sp2_1          N1          C2          N2         H21     180.000     5.0     2\nG              const_14          N2          C2          N3          C4     180.000    10.0     2\nG              const_16          N9          C4          N3          C2     180.000    10.0     2\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nG  chir_1    P    \"O5'\"    OP3    OP2    both\nG  chir_2    \"C4'\"    \"O4'\"    \"C3'\"    \"C5'\"    negative\nG  chir_3    \"C3'\"    \"O3'\"    \"C4'\"    \"C2'\"    positive\nG  chir_4    \"C2'\"    \"O2'\"    \"C1'\"    \"C3'\"    negative\nG  chir_5    \"C1'\"    \"O4'\"    N9    \"C2'\"    negative\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nG  plan-1       \"C1'\"   0.020\nG  plan-1          C2   0.020\nG  plan-1          C4   0.020\nG  plan-1          C5   0.020\nG  plan-1          C6   0.020\nG  plan-1          C8   0.020\nG  plan-1          H1   0.020\nG  plan-1          H8   0.020\nG  plan-1          N1   0.020\nG  plan-1          N2   0.020\nG  plan-1          N3   0.020\nG  plan-1          N7   0.020\nG  plan-1          N9   0.020\nG  plan-1          O6   0.020\nG  plan-2          C2   0.020\nG  plan-2         H21   0.020\nG  plan-2         H22   0.020\nG  plan-2          N2   0.020\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nG           SMILES              ACDLabs 10.04                                                                                                                      O=C1c2ncn(c2N=C(N)N1)C3OC(C(O)C3O)COP(=O)(O)O\nG SMILES_CANONICAL               CACTVS 3.341                                                                                                  NC1=Nc2n(cnc2C(=O)N1)[C@@H]3O[C@H](CO[P](O)(O)=O)[C@@H](O)[C@H]3O\nG           SMILES               CACTVS 3.341                                                                                                        NC1=Nc2n(cnc2C(=O)N1)[CH]3O[CH](CO[P](O)(O)=O)[CH](O)[CH]3O\nG SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0                                                                                                  c1nc2c(n1[C@H]3[C@@H]([C@@H]([C@H](O3)COP(=O)(O)O)O)O)N=C(NC2=O)N\nG           SMILES \"OpenEye OEToolkits\" 1.5.0                                                                                                                    c1nc2c(n1C3C(C(C(O3)COP(=O)(O)O)O)O)N=C(NC2=O)N\nG            InChI                InChI  1.03 InChI=1S/C10H14N5O8P/c11-10-13-7-4(8(18)14-10)12-2-15(7)9-6(17)5(16)3(23-9)1-22-24(19,20)21/h2-3,5-6,9,16-17H,1H2,(H2,19,20,21)(H3,11,13,14,18)/t3-,5-,6-,9-/m1/s1\nG         InChIKey                InChI  1.03                                                                                                                                        RQFCJASXJCIDSX-UUOKFMHZSA-N\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nG   acedrg               243         \"dictionary generator\"                  \nG   acedrg_database      11          \"data source\"                           \nG   rdkit                2017.03.2   \"Chemoinformatics tool\"\nG   refmac5              5.8.0238    \"optimization tool\"                     \n",
    atoms: [
      {name: "OP3", element: "O", xyz: [34.040, 3.415, -1.077]},
      {name: "P", element: "P", xyz: [34.210, 4.003, 0.312]},
      {name: "OP1", element: "O", xyz: [34.487, 5.494, 0.290]},
      {name: "OP2", element: "O", xyz: [35.203, 3.231, 1.161]},
      {name: "O5'", element: "O", xyz: [32.781, 3.831, 1.041]},
      {name: "C5'", element: "C", xyz: [32.260, 2.493, 1.252]},
      {name: "C4'", element: "C", xyz: [30.851, 2.571, 1.788]},
      {name: "O4'", element: "O", xyz: [30.831, 3.382, 2.990]},
      {name: "C3'", element: "C", xyz: [29.808, 3.223, 0.875]},
      {name: "O3'", element: "O", xyz: [29.289, 2.285, -0.06]},
      {name: "C2'", element: "C", xyz: [28.754, 3.698, 1.881]},
      {name: "O2'", element: "O", xyz: [27.799, 2.707, 2.202]},
      {name: "C1'", element: "C", xyz: [29.604, 4.073, 3.097]},
      {name: "N9", element: "N", xyz: [29.861, 5.508, 3.212]},
      {name: "C8", element: "C", xyz: [31.057, 6.172, 3.071]},
      {name: "N7", element: "N", xyz: [30.958, 7.468, 3.239]},
      {name: "C5", element: "C", xyz: [29.612, 7.676, 3.509]},
      {name: "C6", element: "C", xyz: [28.906, 8.880, 3.777]},
      {name: "O6", element: "O", xyz: [29.357, 10.033, 3.827]},
      {name: "N1", element: "N", xyz: [27.544, 8.645, 3.999]},
      {name: "C2", element: "C", xyz: [26.939, 7.407, 3.968]},
      {name: "N2", element: "N", xyz: [25.620, 7.371, 4.205]},
      {name: "N3", element: "N", xyz: [27.601, 6.273, 3.716]},
      {name: "C4", element: "C", xyz: [28.926, 6.478, 3.499]},
      {name: "H5'", element: "H", xyz: [32.833, 2.008, 1.895]},
      {name: "H5''", element: "H", xyz: [32.261, 1.995, 0.397]},
      {name: "H4'", element: "H", xyz: [30.559, 1.662, 2.015]},
      {name: "H3'", element: "H", xyz: [30.200, 3.999, 0.398]},
      {name: "HO3'", element: "H", xyz: [28.659, 2.653, -0.495]},
      {name: "H2'", element: "H", xyz: [28.286, 4.500, 1.527]},
      {name: "HO2'", element: "H", xyz: [28.188, 2.026, 2.527]},
      {name: "H1'", element: "H", xyz: [29.136, 3.771, 3.909]},
      {name: "H8", element: "H", xyz: [31.870, 5.740, 2.872]},
      {name: "H1", element: "H", xyz: [27.031, 9.361, 4.176]},
      {name: "H21", element: "H", xyz: [25.105, 6.850, 3.723]},
      {name: "H22", element: "H", xyz: [25.277, 7.868, 4.840]},
    ],
  },
  "U": {
    name: "U",
    cif: "#\ndata_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nU     U       \"URIDINE-5'-MONOPHOSPHATE\"     RNA     32     21     .     \n#\ndata_comp_U\n#\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nU       OP3     O       OP      -1      28.643      1.174       0.256       \nU       P       P       P       0       28.819      1.986       -1.013      \nU       OP1     O       O       0       28.329      1.258       -2.251      \nU       OP2     O       OP      -1      30.224      2.536       -1.171      \nU       \"O5'\"   O       O2      0       27.859      3.273       -0.849      \nU       \"C5'\"   C       CH2     0       26.439      3.063       -0.635      \nU       \"C4'\"   C       CH1     0       25.718      4.389       -0.671      \nU       \"O4'\"   O       O2      0       26.311      5.305       0.281       \nU       \"C3'\"   C       CH1     0       25.778      5.166       -1.991      \nU       \"O3'\"   O       OH1     0       24.835      4.654       -2.925      \nU       \"C2'\"   C       CH1     0       25.458      6.596       -1.533      \nU       \"O2'\"   O       OH1     0       24.071      6.867       -1.498      \nU       \"C1'\"   C       CH1     0       26.019      6.633       -0.106      \nU       N1      N       NR6     0       27.258      7.450       0.002       \nU       C2      C       CR6     0       27.205      8.658       0.693       \nU       O2      O       O       0       26.192      9.093       1.231       \nU       N3      N       NR16     0       28.393      9.351       0.740       \nU       C4      C       CR6     0       29.603      8.978       0.180       \nU       O4      O       O       0       30.583      9.712       0.310       \nU       C5      C       CR16    0       29.578      7.725       -0.520      \nU       C6      C       CR16    0       28.433      7.023       -0.585      \nU       \"H5'\"   H       H       0       26.293      2.630       0.242       \nU       \"H5''\"  H       H       0       26.078      2.471       -1.340      \nU       \"H4'\"   H       H       0       24.781      4.238       -0.422      \nU       \"H3'\"   H       H       0       26.692      5.130       -2.374      \nU       \"HO3'\"  H       H       0       24.819      5.164       -3.604      \nU       \"H2'\"   H       H       0       25.919      7.246       -2.101      \nU       \"HO2'\"  H       H       0       23.948      7.707       -1.488      \nU       \"H1'\"   H       H       0       25.334      6.986       0.500       \nU       H3      H       H       0       28.372      10.124      1.182       \nU       H5      H       H       0       30.354      7.400       -0.928      \nU       H6      H       H       0       28.431      6.206       -1.045      \nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nU       OP3           P      SINGLE       n     1.517  0.0192     1.517  0.0192\nU         P         OP1      DOUBLE       n     1.517  0.0192     1.517  0.0192\nU         P         OP2      SINGLE       n     1.517  0.0192     1.517  0.0192\nU         P       \"O5'\"      SINGLE       n     1.614  0.0178     1.614  0.0178\nU     \"O5'\"       \"C5'\"      SINGLE       n     1.450  0.0166     1.450  0.0166\nU     \"C5'\"       \"C4'\"      SINGLE       n     1.509  0.0100     1.509  0.0100\nU     \"C4'\"       \"O4'\"      SINGLE       n     1.451  0.0111     1.451  0.0111\nU     \"C4'\"       \"C3'\"      SINGLE       n     1.535  0.0100     1.535  0.0100\nU     \"O4'\"       \"C1'\"      SINGLE       n     1.412  0.0100     1.412  0.0100\nU     \"C3'\"       \"O3'\"      SINGLE       n     1.422  0.0100     1.422  0.0100\nU     \"C3'\"       \"C2'\"      SINGLE       n     1.533  0.0109     1.533  0.0109\nU     \"C2'\"       \"O2'\"      SINGLE       n     1.412  0.0100     1.412  0.0100\nU     \"C2'\"       \"C1'\"      SINGLE       n     1.529  0.0100     1.529  0.0100\nU     \"C1'\"          N1      SINGLE       n     1.476  0.0133     1.476  0.0133\nU        N1          C2      SINGLE       y     1.383  0.0100     1.383  0.0100\nU        N1          C6      SINGLE       y     1.375  0.0106     1.375  0.0106\nU        C2          O2      DOUBLE       n     1.224  0.0111     1.224  0.0111\nU        C2          N3      SINGLE       y     1.372  0.0112     1.372  0.0112\nU        N3          C4      SINGLE       y     1.381  0.0100     1.381  0.0100\nU        C4          O4      DOUBLE       n     1.231  0.0100     1.231  0.0100\nU        C4          C5      SINGLE       y     1.434  0.0100     1.434  0.0100\nU        C5          C6      DOUBLE       y     1.342  0.0100     1.342  0.0100\nU     \"C5'\"       \"H5'\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nU     \"C5'\"      \"H5''\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nU     \"C4'\"       \"H4'\"      SINGLE       n     1.089  0.0100     0.981  0.0200\nU     \"C3'\"       \"H3'\"      SINGLE       n     1.089  0.0100     0.992  0.0200\nU     \"O3'\"      \"HO3'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nU     \"C2'\"       \"H2'\"      SINGLE       n     1.089  0.0100     0.978  0.0200\nU     \"O2'\"      \"HO2'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nU     \"C1'\"       \"H1'\"      SINGLE       n     1.089  0.0100     0.981  0.0118\nU        N3          H3      SINGLE       n     1.016  0.0100     0.889  0.0200\nU        C5          H5      SINGLE       n     1.082  0.0130     0.935  0.0100\nU        C6          H6      SINGLE       n     1.082  0.0130     0.938  0.0107\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nU       OP3           P         OP1     112.864    1.69\nU       OP3           P         OP2     112.864    1.69\nU       OP3           P       \"O5'\"     105.808    2.07\nU       OP1           P         OP2     112.864    1.69\nU       OP1           P       \"O5'\"     105.808    2.07\nU       OP2           P       \"O5'\"     105.808    2.07\nU         P       \"O5'\"       \"C5'\"     118.783    1.50\nU     \"O5'\"       \"C5'\"       \"C4'\"     109.342    1.50\nU     \"O5'\"       \"C5'\"       \"H5'\"     109.845    1.50\nU     \"O5'\"       \"C5'\"      \"H5''\"     109.845    1.50\nU     \"C4'\"       \"C5'\"       \"H5'\"     109.624    1.50\nU     \"C4'\"       \"C5'\"      \"H5''\"     109.624    1.50\nU     \"H5'\"       \"C5'\"      \"H5''\"     108.472    1.50\nU     \"C5'\"       \"C4'\"       \"O4'\"     109.615    1.50\nU     \"C5'\"       \"C4'\"       \"C3'\"     116.008    1.52\nU     \"C5'\"       \"C4'\"       \"H4'\"     108.268    1.50\nU     \"O4'\"       \"C4'\"       \"C3'\"     104.439    1.50\nU     \"O4'\"       \"C4'\"       \"H4'\"     108.698    1.50\nU     \"C3'\"       \"C4'\"       \"H4'\"     109.363    1.86\nU     \"C4'\"       \"O4'\"       \"C1'\"     109.578    1.50\nU     \"C4'\"       \"C3'\"       \"O3'\"     111.281    2.46\nU     \"C4'\"       \"C3'\"       \"C2'\"     102.071    1.50\nU     \"C4'\"       \"C3'\"       \"H3'\"     110.452    2.54\nU     \"O3'\"       \"C3'\"       \"C2'\"     111.993    3.00\nU     \"O3'\"       \"C3'\"       \"H3'\"     110.380    1.67\nU     \"C2'\"       \"C3'\"       \"H3'\"     110.108    1.66\nU     \"C3'\"       \"O3'\"      \"HO3'\"     108.744    3.00\nU     \"C3'\"       \"C2'\"       \"O2'\"     112.861    2.52\nU     \"C3'\"       \"C2'\"       \"C1'\"     101.269    1.50\nU     \"C3'\"       \"C2'\"       \"H2'\"     110.799    1.82\nU     \"O2'\"       \"C2'\"       \"C1'\"     109.476    3.00\nU     \"O2'\"       \"C2'\"       \"H2'\"     111.022    1.77\nU     \"C1'\"       \"C2'\"       \"H2'\"     110.760    1.63\nU     \"C2'\"       \"O2'\"      \"HO2'\"     109.449    1.85\nU     \"O4'\"       \"C1'\"       \"C2'\"     106.825    1.50\nU     \"O4'\"       \"C1'\"          N1     108.667    1.50\nU     \"O4'\"       \"C1'\"       \"H1'\"     109.327    1.50\nU     \"C2'\"       \"C1'\"          N1     112.859    1.50\nU     \"C2'\"       \"C1'\"       \"H1'\"     109.776    1.83\nU        N1       \"C1'\"       \"H1'\"     109.166    1.50\nU     \"C1'\"          N1          C2     117.109    1.50\nU     \"C1'\"          N1          C6     121.471    1.52\nU        C2          N1          C6     121.419    1.50\nU        N1          C2          O2     122.841    1.50\nU        N1          C2          N3     114.848    1.50\nU        O2          C2          N3     122.311    1.50\nU        C2          N3          C4     126.992    1.50\nU        C2          N3          H3     115.772    1.79\nU        C4          N3          H3     117.236    1.73\nU        N3          C4          O4     119.401    1.50\nU        N3          C4          C5     114.659    1.50\nU        O4          C4          C5     125.940    1.50\nU        C4          C5          C6     119.525    1.50\nU        C4          C5          H5     120.151    1.50\nU        C6          C5          H5     120.325    1.50\nU        N1          C6          C5     122.557    1.50\nU        N1          C6          H6     118.477    1.50\nU        C5          C6          H6     118.966    1.50\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nU       C2e-chi         \"O4'\"     \"C1'\"     N1        C2        210.000       10.000    6     \nU       C2e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     340.700       6.300     1     \nU       C2e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     32.800        4.900     1     \nU       C2e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     326.9         3.600     1     \nU       C2e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     22.600        4.500     1     \nU       C2e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     357.700       6.100     1     \nU       C3e-chi         \"O4'\"     \"C1'\"     N1        C2        210.000       10.000    6     \nU       C3e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     2.8           6.100     1     \nU       C3e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     335.00        4.900     1     \nU       C3e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     35.9          2.800     1     \nU       C3e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     324.700       3.100     1     \nU       C3e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     20.500        5.100     1     \nU       alpha           \"C5'\"     \"O5'\"     P         OP3       -60.000       10.00     3     \nU       beta            P         \"O5'\"     \"C5'\"     \"C4'\"     180.000       10.00     3     \nU       epsi            \"C4'\"     \"C3'\"     \"O3'\"     \"HO3'\"    180.000       10.00     3     \nU       gamma           \"O5'\"     \"C5'\"     \"C4'\"     \"C3'\"     180.000       10.00     3     \nU       sp3_sp3_52      \"C3'\"     \"C2'\"     \"O2'\"     \"HO2'\"    180.000       10.00     3     \nU       const_sp2_sp2_4          O2          C2          N1       \"C1'\"       0.000     5.0     2\nU              const_22          C5          C6          N1       \"C1'\"     180.000    10.0     2\nU       const_sp2_sp2_7          O2          C2          N3          C4     180.000     5.0     2\nU              const_11          O4          C4          N3          C2     180.000    10.0     2\nU              const_15          O4          C4          C5          C6     180.000    10.0     2\nU              const_17          C4          C5          C6          N1       0.000    10.0     2\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nU  chir_1    P    \"O5'\"    OP3    OP2    both\nU  chir_2    \"C4'\"    \"O4'\"    \"C3'\"    \"C5'\"    negative\nU  chir_3    \"C3'\"    \"O3'\"    \"C4'\"    \"C2'\"    positive\nU  chir_4    \"C2'\"    \"O2'\"    \"C1'\"    \"C3'\"    negative\nU  chir_5    \"C1'\"    \"O4'\"    N1    \"C2'\"    negative\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nU  plan-1       \"C1'\"   0.020\nU  plan-1          C2   0.020\nU  plan-1          C4   0.020\nU  plan-1          C5   0.020\nU  plan-1          C6   0.020\nU  plan-1          H3   0.020\nU  plan-1          H5   0.020\nU  plan-1          H6   0.020\nU  plan-1          N1   0.020\nU  plan-1          N3   0.020\nU  plan-1          O2   0.020\nU  plan-1          O4   0.020\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nU           SMILES              ACDLabs 10.04                                                                                                         O=C1NC(=O)N(C=C1)C2OC(C(O)C2O)COP(=O)(O)O\nU SMILES_CANONICAL               CACTVS 3.341                                                                                      O[C@H]1[C@@H](O)[C@@H](O[C@@H]1CO[P](O)(O)=O)N2C=CC(=O)NC2=O\nU           SMILES               CACTVS 3.341                                                                                             O[CH]1[CH](O)[CH](O[CH]1CO[P](O)(O)=O)N2C=CC(=O)NC2=O\nU SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0                                                                                     C1=CN(C(=O)NC1=O)[C@H]2[C@@H]([C@@H]([C@H](O2)COP(=O)(O)O)O)O\nU           SMILES \"OpenEye OEToolkits\" 1.5.0                                                                                                       C1=CN(C(=O)NC1=O)C2C(C(C(O2)COP(=O)(O)O)O)O\nU            InChI                InChI  1.03 InChI=1S/C9H13N2O9P/c12-5-1-2-11(9(15)10-5)8-7(14)6(13)4(20-8)3-19-21(16,17)18/h1-2,4,6-8,13-14H,3H2,(H,10,12,15)(H2,16,17,18)/t4-,6-,7-,8-/m1/s1\nU         InChIKey                InChI  1.03                                                                                                                       DJJCXFVJDGTHFX-XVFCMESISA-N\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nU   acedrg               243         \"dictionary generator\"                  \nU   acedrg_database      11          \"data source\"                           \nU   rdkit                2017.03.2   \"Chemoinformatics tool\"\nU   refmac5              5.8.0238    \"optimization tool\"                     \n",
    atoms: [
      {name: "OP3", element: "O", xyz: [28.643, 1.174, 0.256]},
      {name: "P", element: "P", xyz: [28.819, 1.986, -1.013]},
      {name: "OP1", element: "O", xyz: [28.329, 1.258, -2.251]},
      {name: "OP2", element: "O", xyz: [30.224, 2.536, -1.171]},
      {name: "O5'", element: "O", xyz: [27.859, 3.273, -0.849]},
      {name: "C5'", element: "C", xyz: [26.439, 3.063, -0.635]},
      {name: "C4'", element: "C", xyz: [25.718, 4.389, -0.671]},
      {name: "O4'", element: "O", xyz: [26.311, 5.305, 0.281]},
      {name: "C3'", element: "C", xyz: [25.778, 5.166, -1.991]},
      {name: "O3'", element: "O", xyz: [24.835, 4.654, -2.925]},
      {name: "C2'", element: "C", xyz: [25.458, 6.596, -1.533]},
      {name: "O2'", element: "O", xyz: [24.071, 6.867, -1.498]},
      {name: "C1'", element: "C", xyz: [26.019, 6.633, -0.106]},
      {name: "N1", element: "N", xyz: [27.258, 7.450, 0.002]},
      {name: "C2", element: "C", xyz: [27.205, 8.658, 0.693]},
      {name: "O2", element: "O", xyz: [26.192, 9.093, 1.231]},
      {name: "N3", element: "N", xyz: [28.393, 9.351, 0.740]},
      {name: "C4", element: "C", xyz: [29.603, 8.978, 0.180]},
      {name: "O4", element: "O", xyz: [30.583, 9.712, 0.310]},
      {name: "C5", element: "C", xyz: [29.578, 7.725, -0.52]},
      {name: "C6", element: "C", xyz: [28.433, 7.023, -0.585]},
      {name: "H5'", element: "H", xyz: [26.293, 2.630, 0.242]},
      {name: "H5''", element: "H", xyz: [26.078, 2.471, -1.34]},
      {name: "H4'", element: "H", xyz: [24.781, 4.238, -0.422]},
      {name: "H3'", element: "H", xyz: [26.692, 5.130, -2.374]},
      {name: "HO3'", element: "H", xyz: [24.819, 5.164, -3.604]},
      {name: "H2'", element: "H", xyz: [25.919, 7.246, -2.101]},
      {name: "HO2'", element: "H", xyz: [23.948, 7.707, -1.488]},
      {name: "H1'", element: "H", xyz: [25.334, 6.986, 0.500]},
      {name: "H3", element: "H", xyz: [28.372, 10.124, 1.182]},
      {name: "H5", element: "H", xyz: [30.354, 7.400, -0.928]},
      {name: "H6", element: "H", xyz: [28.431, 6.206, -1.045]},
    ],
  },
  "DA": {
    name: "DA",
    cif: "#\ndata_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nDA    DA        \"2'-DEOXYADENOSINE-5'-MONOPHOSPHATE\"     DNA     34     22     .     \n#\ndata_comp_DA\n#\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nDA      OP3     O       OP      -1      -6.497      8.522       9.951       \nDA      P       P       P       0       -5.346      9.062       9.122       \nDA      OP1     O       O       0       -4.898      10.441      9.565       \nDA      OP2     O       OP      -1      -5.605      8.977       7.630       \nDA      \"O5'\"   O       O2      0       -4.097      8.080       9.408       \nDA      \"C5'\"   C       CH2     0       -3.640      7.912       10.774      \nDA      \"C4'\"   C       CH1     0       -2.470      6.958       10.801      \nDA      \"O4'\"   O       O2      0       -2.888      5.686       10.260      \nDA      \"C3'\"   C       CH1     0       -1.251      7.408       9.993       \nDA      \"O3'\"   O       OH1     0       -0.049      7.159       10.716      \nDA      \"C2'\"   C       CH2     0       -1.324      6.542       8.739       \nDA      \"C1'\"   C       CH1     0       -1.962      5.267       9.263       \nDA      N9      N       NR5     0       -2.687      4.489       8.258       \nDA      C8      C       CR15    0       -3.753      4.911       7.501       \nDA      N7      N       NRD5    0       -4.206      3.997       6.680       \nDA      C5      C       CR56    0       -3.393      2.896       6.907       \nDA      C6      C       CR6     0       -3.368      1.602       6.342       \nDA      N6      N       NH2     0       -4.214      1.192       5.400       \nDA      N1      N       NRD6    0       -2.423      0.736       6.793       \nDA      C2      C       CR16    0       -1.573      1.156       7.744       \nDA      N3      N       NRD6    0       -1.504      2.345       8.344       \nDA      C4      C       CR56    0       -2.450      3.184       7.880       \nDA      \"H5'\"   H       H       0       -4.373      7.554       11.332      \nDA      \"H5''\"  H       H       0       -3.363      8.786       11.145      \nDA      \"H4'\"   H       H       0       -2.203      6.829       11.743      \nDA      \"H3'\"   H       H       0       -1.322      8.365       9.759       \nDA      \"HO3'\"  H       H       0       0.583       7.601       10.361      \nDA      \"H2'\"   H       H       0       -0.433      6.369       8.376       \nDA      \"H2''\"  H       H       0       -1.875      6.962       8.051       \nDA      \"H1'\"   H       H       0       -1.264      4.700       9.685       \nDA      H8      H       H       0       -4.120      5.776       7.565       \nDA      H61     H       H       0       -4.304      0.334       5.236       \nDA      H62     H       H       0       -4.679      1.782       4.946       \nDA      H2      H       H       0       -0.933      0.520       8.026       \nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nDA        OP3           P      SINGLE       n     1.517  0.0192     1.517  0.0192\nDA          P         OP1      DOUBLE       n     1.517  0.0192     1.517  0.0192\nDA          P         OP2      SINGLE       n     1.517  0.0192     1.517  0.0192\nDA          P       \"O5'\"      SINGLE       n     1.614  0.0178     1.614  0.0178\nDA      \"O5'\"       \"C5'\"      SINGLE       n     1.450  0.0166     1.450  0.0166\nDA      \"C5'\"       \"C4'\"      SINGLE       n     1.509  0.0100     1.509  0.0100\nDA      \"C4'\"       \"O4'\"      SINGLE       n     1.442  0.0100     1.442  0.0100\nDA      \"C4'\"       \"C3'\"      SINGLE       n     1.526  0.0115     1.526  0.0115\nDA      \"O4'\"       \"C1'\"      SINGLE       n     1.425  0.0100     1.425  0.0100\nDA      \"C3'\"       \"O3'\"      SINGLE       n     1.424  0.0100     1.424  0.0100\nDA      \"C3'\"       \"C2'\"      SINGLE       n     1.526  0.0101     1.526  0.0101\nDA      \"C2'\"       \"C1'\"      SINGLE       n     1.521  0.0118     1.521  0.0118\nDA      \"C1'\"          N9      SINGLE       n     1.462  0.0111     1.462  0.0111\nDA         N9          C8      SINGLE       y     1.373  0.0100     1.373  0.0100\nDA         N9          C4      SINGLE       y     1.377  0.0100     1.377  0.0100\nDA         C8          N7      DOUBLE       y     1.310  0.0100     1.310  0.0100\nDA         N7          C5      SINGLE       y     1.388  0.0100     1.388  0.0100\nDA         C5          C6      SINGLE       y     1.408  0.0100     1.408  0.0100\nDA         C5          C4      DOUBLE       y     1.381  0.0100     1.381  0.0100\nDA         C6          N6      SINGLE       n     1.330  0.0100     1.330  0.0100\nDA         C6          N1      DOUBLE       y     1.354  0.0100     1.354  0.0100\nDA         N1          C2      SINGLE       y     1.339  0.0100     1.339  0.0100\nDA         C2          N3      DOUBLE       y     1.330  0.0100     1.330  0.0100\nDA         N3          C4      SINGLE       y     1.343  0.0100     1.343  0.0100\nDA      \"C5'\"       \"H5'\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nDA      \"C5'\"      \"H5''\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nDA      \"C4'\"       \"H4'\"      SINGLE       n     1.089  0.0100     0.987  0.0170\nDA      \"C3'\"       \"H3'\"      SINGLE       n     1.089  0.0100     0.988  0.0189\nDA      \"O3'\"      \"HO3'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nDA      \"C2'\"       \"H2'\"      SINGLE       n     1.089  0.0100     0.977  0.0113\nDA      \"C2'\"      \"H2''\"      SINGLE       n     1.089  0.0100     0.977  0.0113\nDA      \"C1'\"       \"H1'\"      SINGLE       n     1.089  0.0100     0.993  0.0101\nDA         C8          H8      SINGLE       n     1.082  0.0130     0.942  0.0170\nDA         N6         H61      SINGLE       n     1.016  0.0100     0.877  0.0200\nDA         N6         H62      SINGLE       n     1.016  0.0100     0.877  0.0200\nDA         C2          H2      SINGLE       n     1.082  0.0130     0.945  0.0200\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nDA        OP3           P         OP1     112.864    1.69\nDA        OP3           P         OP2     112.864    1.69\nDA        OP3           P       \"O5'\"     105.808    2.07\nDA        OP1           P         OP2     112.864    1.69\nDA        OP1           P       \"O5'\"     105.808    2.07\nDA        OP2           P       \"O5'\"     105.808    2.07\nDA          P       \"O5'\"       \"C5'\"     118.783    1.50\nDA      \"O5'\"       \"C5'\"       \"C4'\"     109.342    1.50\nDA      \"O5'\"       \"C5'\"       \"H5'\"     109.845    1.50\nDA      \"O5'\"       \"C5'\"      \"H5''\"     109.845    1.50\nDA      \"C4'\"       \"C5'\"       \"H5'\"     109.624    1.50\nDA      \"C4'\"       \"C5'\"      \"H5''\"     109.624    1.50\nDA      \"H5'\"       \"C5'\"      \"H5''\"     108.472    1.50\nDA      \"C5'\"       \"C4'\"       \"O4'\"     109.123    1.50\nDA      \"C5'\"       \"C4'\"       \"C3'\"     114.866    1.63\nDA      \"C5'\"       \"C4'\"       \"H4'\"     108.268    1.50\nDA      \"O4'\"       \"C4'\"       \"C3'\"     105.506    1.50\nDA      \"O4'\"       \"C4'\"       \"H4'\"     108.947    1.50\nDA      \"C3'\"       \"C4'\"       \"H4'\"     109.069    1.50\nDA      \"C4'\"       \"O4'\"       \"C1'\"     108.795    1.50\nDA      \"C4'\"       \"C3'\"       \"O3'\"     110.527    2.37\nDA      \"C4'\"       \"C3'\"       \"C2'\"     102.433    1.50\nDA      \"C4'\"       \"C3'\"       \"H3'\"     110.775    1.50\nDA      \"O3'\"       \"C3'\"       \"C2'\"     111.424    1.96\nDA      \"O3'\"       \"C3'\"       \"H3'\"     110.713    1.50\nDA      \"C2'\"       \"C3'\"       \"H3'\"     110.846    1.50\nDA      \"C3'\"       \"O3'\"      \"HO3'\"     109.026    2.38\nDA      \"C3'\"       \"C2'\"       \"C1'\"     102.663    1.50\nDA      \"C3'\"       \"C2'\"       \"H2'\"     111.194    1.50\nDA      \"C3'\"       \"C2'\"      \"H2''\"     111.194    1.50\nDA      \"C1'\"       \"C2'\"       \"H2'\"     111.213    1.50\nDA      \"C1'\"       \"C2'\"      \"H2''\"     111.213    1.50\nDA      \"H2'\"       \"C2'\"      \"H2''\"     109.148    1.50\nDA      \"O4'\"       \"C1'\"       \"C2'\"     106.035    1.50\nDA      \"O4'\"       \"C1'\"          N9     108.236    1.50\nDA      \"O4'\"       \"C1'\"       \"H1'\"     109.059    1.50\nDA      \"C2'\"       \"C1'\"          N9     114.190    1.67\nDA      \"C2'\"       \"C1'\"       \"H1'\"     109.272    1.50\nDA         N9       \"C1'\"       \"H1'\"     109.282    1.50\nDA      \"C1'\"          N9          C8     127.636    2.81\nDA      \"C1'\"          N9          C4     126.671    2.93\nDA         C8          N9          C4     105.693    1.50\nDA         N9          C8          N7     113.469    1.50\nDA         N9          C8          H8     123.206    1.50\nDA         N7          C8          H8     123.326    1.50\nDA         C8          N7          C5     104.739    1.50\nDA         N7          C5          C6     132.250    1.50\nDA         N7          C5          C4     110.483    1.50\nDA         C6          C5          C4     117.267    1.50\nDA         C5          C6          N6     123.792    1.50\nDA         C5          C6          N1     117.409    1.50\nDA         N6          C6          N1     118.799    1.50\nDA         C6          N6         H61     119.723    1.50\nDA         C6          N6         H62     119.723    1.50\nDA        H61          N6         H62     120.554    1.88\nDA         C6          N1          C2     118.521    1.50\nDA         N1          C2          N3     129.332    1.50\nDA         N1          C2          H2     115.313    1.50\nDA         N3          C2          H2     115.355    1.50\nDA         C2          N3          C4     110.982    1.50\nDA         N9          C4          C5     105.616    1.50\nDA         N9          C4          N3     127.895    1.50\nDA         C5          C4          N3     126.489    1.50\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nDA      C2e-chi         \"O4'\"     \"C1'\"     N9        C4        210.000       10.000    6     \nDA      C2e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     340.700       6.300     1     \nDA      C2e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     32.800        4.900     1     \nDA      C2e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     326.9         3.600     1     \nDA      C2e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     22.600        4.500     1     \nDA      C2e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     357.700       6.100     1     \nDA      C3e-chi         \"O4'\"     \"C1'\"     N9        C4        210.000       10.000    6     \nDA      C3e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     2.8           6.100     1     \nDA      C3e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     335.00        4.900     1     \nDA      C3e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     35.9          2.800     1     \nDA      C3e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     324.700       3.100     1     \nDA      C3e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     20.500        5.100     1     \nDA      alpha           \"C5'\"     \"O5'\"     P         OP3       -60.000       10.00     3     \nDA      beta            P         \"O5'\"     \"C5'\"     \"C4'\"     180.000       10.00     3     \nDA      epsi            \"C4'\"     \"C3'\"     \"O3'\"     \"HO3'\"    180.000       10.00     3     \nDA      gamma           \"O5'\"     \"C5'\"     \"C4'\"     \"C3'\"     180.000       10.00     3     \nDA              const_14          N7          C8          N9       \"C1'\"     180.000    10.0     2\nDA              const_26          C5          C4          N9       \"C1'\"     180.000    10.0     2\nDA              const_17          N9          C8          N7          C5       0.000    10.0     2\nDA              const_20          C6          C5          N7          C8     180.000    10.0     2\nDA       const_sp2_sp2_4          N7          C5          C6          N6       0.000     5.0     2\nDA              const_21          N9          C4          C5          N7       0.000    10.0     2\nDA             sp2_sp2_1          C5          C6          N6         H61     180.000     5.0     2\nDA       const_sp2_sp2_6          N6          C6          N1          C2     180.000     5.0     2\nDA       const_sp2_sp2_7          N3          C2          N1          C6       0.000     5.0     2\nDA       const_sp2_sp2_9          N1          C2          N3          C4       0.000     5.0     2\nDA              const_12          N9          C4          N3          C2     180.000    10.0     2\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nDA   chir_1    P    \"O5'\"    OP3    OP2    both\nDA   chir_2    \"C4'\"    \"O4'\"    \"C3'\"    \"C5'\"    negative\nDA   chir_3    \"C3'\"    \"O3'\"    \"C4'\"    \"C2'\"    positive\nDA   chir_4    \"C1'\"    \"O4'\"    N9    \"C2'\"    negative\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nDA   plan-1       \"C1'\"   0.020\nDA   plan-1          C2   0.020\nDA   plan-1          C4   0.020\nDA   plan-1          C5   0.020\nDA   plan-1          C6   0.020\nDA   plan-1          C8   0.020\nDA   plan-1          H2   0.020\nDA   plan-1          H8   0.020\nDA   plan-1          N1   0.020\nDA   plan-1          N3   0.020\nDA   plan-1          N6   0.020\nDA   plan-1          N7   0.020\nDA   plan-1          N9   0.020\nDA   plan-2          C6   0.020\nDA   plan-2         H61   0.020\nDA   plan-2         H62   0.020\nDA   plan-2          N6   0.020\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nDA           SMILES              ACDLabs 10.04                                                                                                          O=P(O)(O)OCC3OC(n2cnc1c(ncnc12)N)CC3O\nDA SMILES_CANONICAL               CACTVS 3.341                                                                                         Nc1ncnc2n(cnc12)[C@H]3C[C@H](O)[C@@H](CO[P](O)(O)=O)O3\nDA           SMILES               CACTVS 3.341                                                                                             Nc1ncnc2n(cnc12)[CH]3C[CH](O)[CH](CO[P](O)(O)=O)O3\nDA SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0                                                                                       c1nc(c2c(n1)n(cn2)[C@H]3C[C@@H]([C@H](O3)COP(=O)(O)O)O)N\nDA           SMILES \"OpenEye OEToolkits\" 1.5.0                                                                                                    c1nc(c2c(n1)n(cn2)C3CC(C(O3)COP(=O)(O)O)O)N\nDA            InChI                InChI  1.03 InChI=1S/C10H14N5O6P/c11-9-8-10(13-3-12-9)15(4-14-8)7-1-5(16)6(21-7)2-20-22(17,18)19/h3-7,16H,1-2H2,(H2,11,12,13)(H2,17,18,19)/t5-,6+,7+/m0/s1\nDA         InChIKey                InChI  1.03                                                                                                                    KHWCHTKSEGGWEX-RRKCRQDMSA-N\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nDA  acedrg               243         \"dictionary generator\"                  \nDA  acedrg_database      11          \"data source\"                           \nDA  rdkit                2017.03.2   \"Chemoinformatics tool\"\nDA  refmac5              5.8.0238    \"optimization tool\"                     \n",
    atoms: [
      {name: "OP3", element: "O", xyz: [-6.497, 8.522, 9.951]},
      {name: "P", element: "P", xyz: [-5.346, 9.062, 9.122]},
      {name: "OP1", element: "O", xyz: [-4.898, 10.441, 9.565]},
      {name: "OP2", element: "O", xyz: [-5.605, 8.977, 7.630]},
      {name: "O5'", element: "O", xyz: [-4.097, 8.080, 9.408]},
      {name: "C5'", element: "C", xyz: [-3.64, 7.912, 10.774]},
      {name: "C4'", element: "C", xyz: [-2.47, 6.958, 10.801]},
      {name: "O4'", element: "O", xyz: [-2.888, 5.686, 10.260]},
      {name: "C3'", element: "C", xyz: [-1.251, 7.408, 9.993]},
      {name: "O3'", element: "O", xyz: [-0.049, 7.159, 10.716]},
      {name: "C2'", element: "C", xyz: [-1.324, 6.542, 8.739]},
      {name: "C1'", element: "C", xyz: [-1.962, 5.267, 9.263]},
      {name: "N9", element: "N", xyz: [-2.687, 4.489, 8.258]},
      {name: "C8", element: "C", xyz: [-3.753, 4.911, 7.501]},
      {name: "N7", element: "N", xyz: [-4.206, 3.997, 6.680]},
      {name: "C5", element: "C", xyz: [-3.393, 2.896, 6.907]},
      {name: "C6", element: "C", xyz: [-3.368, 1.602, 6.342]},
      {name: "N6", element: "N", xyz: [-4.214, 1.192, 5.400]},
      {name: "N1", element: "N", xyz: [-2.423, 0.736, 6.793]},
      {name: "C2", element: "C", xyz: [-1.573, 1.156, 7.744]},
      {name: "N3", element: "N", xyz: [-1.504, 2.345, 8.344]},
      {name: "C4", element: "C", xyz: [-2.45, 3.184, 7.880]},
      {name: "H5'", element: "H", xyz: [-4.373, 7.554, 11.332]},
      {name: "H5''", element: "H", xyz: [-3.363, 8.786, 11.145]},
      {name: "H4'", element: "H", xyz: [-2.203, 6.829, 11.743]},
      {name: "H3'", element: "H", xyz: [-1.322, 8.365, 9.759]},
      {name: "HO3'", element: "H", xyz: [0.583, 7.601, 10.361]},
      {name: "H2'", element: "H", xyz: [-0.433, 6.369, 8.376]},
      {name: "H2''", element: "H", xyz: [-1.875, 6.962, 8.051]},
      {name: "H1'", element: "H", xyz: [-1.264, 4.700, 9.685]},
      {name: "H8", element: "H", xyz: [-4.12, 5.776, 7.565]},
      {name: "H61", element: "H", xyz: [-4.304, 0.334, 5.236]},
      {name: "H62", element: "H", xyz: [-4.679, 1.782, 4.946]},
      {name: "H2", element: "H", xyz: [-0.933, 0.520, 8.026]},
    ],
  },
  "DC": {
    name: "DC",
    cif: "#\ndata_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nDC    DC        \"2'-DEOXYCYTIDINE-5'-MONOPHOSPHATE\"     DNA     32     20     .     \n#\ndata_comp_DC\n#\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nDC      OP3     O       OP      -1      4.759       -6.216      1.740       \nDC      P       P       P       0       5.427       -6.783      0.501       \nDC      OP1     O       O       0       5.450       -8.300      0.487       \nDC      OP2     O       OP      -1      6.788       -6.171      0.232       \nDC      \"O5'\"   O       O2      0       4.494       -6.346      -0.742      \nDC      \"C5'\"   C       CH2     0       3.097       -6.734      -0.736      \nDC      \"C4'\"   C       CH1     0       2.438       -6.261      -2.009      \nDC      \"O4'\"   O       O2      0       2.537       -4.821      -2.097      \nDC      \"C3'\"   C       CH1     0       3.044       -6.825      -3.297      \nDC      \"O3'\"   O       OH1     0       2.035       -7.363      -4.147      \nDC      \"C2'\"   C       CH2     0       3.705       -5.618      -3.951      \nDC      \"C1'\"   C       CH1     0       2.890       -4.454      -3.414      \nDC      N1      N       NR6     0       3.622       -3.158      -3.358      \nDC      C2      C       CR6     0       3.233       -2.087      -4.185      \nDC      O2      O       O       0       2.273       -2.221      -4.961      \nDC      N3      N       NRD6    0       3.923       -0.917      -4.114      \nDC      C4      C       CR6     0       4.961       -0.779      -3.274      \nDC      N4      N       NH2     0       5.596       0.387       -3.250      \nDC      C5      C       CR16    0       5.371       -1.854      -2.432      \nDC      C6      C       CR16    0       4.683       -3.007      -2.507      \nDC      \"H5'\"   H       H       0       2.640       -6.331      0.044       \nDC      \"H5''\"  H       H       0       3.022       -7.718      -0.669      \nDC      \"H4'\"   H       H       0       1.482       -6.507      -1.967      \nDC      \"H3'\"   H       H       0       3.719       -7.516      -3.087      \nDC      \"HO3'\"  H       H       0       1.460       -6.765      -4.330      \nDC      \"H2'\"   H       H       0       3.647       -5.668      -4.930      \nDC      \"H2''\"  H       H       0       4.648       -5.546      -3.691      \nDC      \"H1'\"   H       H       0       2.063       -4.358      -3.951      \nDC      H41     H       H       0       5.385       1.014       -3.827      \nDC      H42     H       H       0       6.226       0.528       -2.656      \nDC      H5      H       H       0       6.097       -1.763      -1.841      \nDC      H6      H       H       0       4.929       -3.731      -1.969      \nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nDC        OP3           P      SINGLE       n     1.517  0.0192     1.517  0.0192\nDC          P         OP1      DOUBLE       n     1.517  0.0192     1.517  0.0192\nDC          P         OP2      SINGLE       n     1.517  0.0192     1.517  0.0192\nDC          P       \"O5'\"      SINGLE       n     1.614  0.0178     1.614  0.0178\nDC      \"O5'\"       \"C5'\"      SINGLE       n     1.450  0.0166     1.450  0.0166\nDC      \"C5'\"       \"C4'\"      SINGLE       n     1.509  0.0100     1.509  0.0100\nDC      \"C4'\"       \"O4'\"      SINGLE       n     1.445  0.0100     1.445  0.0100\nDC      \"C4'\"       \"C3'\"      SINGLE       n     1.526  0.0115     1.526  0.0115\nDC      \"O4'\"       \"C1'\"      SINGLE       n     1.413  0.0100     1.413  0.0100\nDC      \"C3'\"       \"O3'\"      SINGLE       n     1.424  0.0100     1.424  0.0100\nDC      \"C3'\"       \"C2'\"      SINGLE       n     1.522  0.0100     1.522  0.0100\nDC      \"C2'\"       \"C1'\"      SINGLE       n     1.520  0.0100     1.520  0.0100\nDC      \"C1'\"          N1      SINGLE       n     1.480  0.0115     1.480  0.0115\nDC         N1          C2      SINGLE       y     1.397  0.0100     1.397  0.0100\nDC         N1          C6      SINGLE       y     1.360  0.0118     1.360  0.0118\nDC         C2          O2      DOUBLE       n     1.241  0.0100     1.241  0.0100\nDC         C2          N3      SINGLE       y     1.355  0.0119     1.355  0.0119\nDC         N3          C4      DOUBLE       y     1.339  0.0110     1.339  0.0110\nDC         C4          N4      SINGLE       n     1.325  0.0109     1.325  0.0109\nDC         C4          C5      SINGLE       y     1.422  0.0123     1.422  0.0123\nDC         C5          C6      DOUBLE       y     1.342  0.0100     1.342  0.0100\nDC      \"C5'\"       \"H5'\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nDC      \"C5'\"      \"H5''\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nDC      \"C4'\"       \"H4'\"      SINGLE       n     1.089  0.0100     0.987  0.0170\nDC      \"C3'\"       \"H3'\"      SINGLE       n     1.089  0.0100     0.988  0.0189\nDC      \"O3'\"      \"HO3'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nDC      \"C2'\"       \"H2'\"      SINGLE       n     1.089  0.0100     0.982  0.0200\nDC      \"C2'\"      \"H2''\"      SINGLE       n     1.089  0.0100     0.982  0.0200\nDC      \"C1'\"       \"H1'\"      SINGLE       n     1.089  0.0100     0.991  0.0103\nDC         N4         H41      SINGLE       n     1.016  0.0100     0.877  0.0200\nDC         N4         H42      SINGLE       n     1.016  0.0100     0.877  0.0200\nDC         C5          H5      SINGLE       n     1.082  0.0130     0.941  0.0174\nDC         C6          H6      SINGLE       n     1.082  0.0130     0.935  0.0143\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nDC        OP3           P         OP1     112.864    1.69\nDC        OP3           P         OP2     112.864    1.69\nDC        OP3           P       \"O5'\"     105.808    2.07\nDC        OP1           P         OP2     112.864    1.69\nDC        OP1           P       \"O5'\"     105.808    2.07\nDC        OP2           P       \"O5'\"     105.808    2.07\nDC          P       \"O5'\"       \"C5'\"     118.783    1.50\nDC      \"O5'\"       \"C5'\"       \"C4'\"     109.342    1.50\nDC      \"O5'\"       \"C5'\"       \"H5'\"     109.845    1.50\nDC      \"O5'\"       \"C5'\"      \"H5''\"     109.845    1.50\nDC      \"C4'\"       \"C5'\"       \"H5'\"     109.624    1.50\nDC      \"C4'\"       \"C5'\"      \"H5''\"     109.624    1.50\nDC      \"H5'\"       \"C5'\"      \"H5''\"     108.472    1.50\nDC      \"C5'\"       \"C4'\"       \"O4'\"     109.615    1.50\nDC      \"C5'\"       \"C4'\"       \"C3'\"     114.866    1.63\nDC      \"C5'\"       \"C4'\"       \"H4'\"     108.268    1.50\nDC      \"O4'\"       \"C4'\"       \"C3'\"     105.770    1.50\nDC      \"O4'\"       \"C4'\"       \"H4'\"     108.698    1.50\nDC      \"C3'\"       \"C4'\"       \"H4'\"     109.069    1.50\nDC      \"C4'\"       \"O4'\"       \"C1'\"     109.692    1.50\nDC      \"C4'\"       \"C3'\"       \"O3'\"     110.527    2.37\nDC      \"C4'\"       \"C3'\"       \"C2'\"     102.800    1.50\nDC      \"C4'\"       \"C3'\"       \"H3'\"     110.775    1.50\nDC      \"O3'\"       \"C3'\"       \"C2'\"     110.636    2.59\nDC      \"O3'\"       \"C3'\"       \"H3'\"     110.713    1.50\nDC      \"C2'\"       \"C3'\"       \"H3'\"     110.862    1.50\nDC      \"C3'\"       \"O3'\"      \"HO3'\"     109.026    2.38\nDC      \"C3'\"       \"C2'\"       \"C1'\"     102.834    1.50\nDC      \"C3'\"       \"C2'\"       \"H2'\"     111.310    1.50\nDC      \"C3'\"       \"C2'\"      \"H2''\"     111.310    1.50\nDC      \"C1'\"       \"C2'\"       \"H2'\"     111.187    1.50\nDC      \"C1'\"       \"C2'\"      \"H2''\"     111.187    1.50\nDC      \"H2'\"       \"C2'\"      \"H2''\"     108.952    1.50\nDC      \"O4'\"       \"C1'\"       \"C2'\"     106.308    1.50\nDC      \"O4'\"       \"C1'\"          N1     107.584    1.50\nDC      \"O4'\"       \"C1'\"       \"H1'\"     109.550    1.50\nDC      \"C2'\"       \"C1'\"          N1     114.268    1.50\nDC      \"C2'\"       \"C1'\"       \"H1'\"     109.741    1.50\nDC         N1       \"C1'\"       \"H1'\"     109.342    1.50\nDC      \"C1'\"          N1          C2     118.777    1.50\nDC      \"C1'\"          N1          C6     120.713    1.50\nDC         C2          N1          C6     120.510    1.50\nDC         N1          C2          O2     118.710    1.50\nDC         N1          C2          N3     118.927    1.50\nDC         O2          C2          N3     122.370    1.50\nDC         C2          N3          C4     120.266    1.50\nDC         N3          C4          N4     117.855    1.50\nDC         N3          C4          C5     121.269    1.50\nDC         N4          C4          C5     120.876    1.50\nDC         C4          N4         H41     119.818    1.59\nDC         C4          N4         H42     119.818    1.59\nDC        H41          N4         H42     120.363    1.85\nDC         C4          C5          C6     117.808    1.50\nDC         C4          C5          H5     121.350    1.50\nDC         C6          C5          H5     120.848    1.50\nDC         N1          C6          C5     121.215    1.50\nDC         N1          C6          H6     118.510    1.50\nDC         C5          C6          H6     120.275    1.75\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nDC      C2e-chi         \"O4'\"     \"C1'\"     N1        C2        210.000       10.000    6     \nDC      C2e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     340.700       6.300     1     \nDC      C2e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     32.800        4.900     1     \nDC      C2e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     326.9         3.600     1     \nDC      C2e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     22.600        4.500     1     \nDC      C2e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     357.700       6.100     1     \nDC      C3e-chi         \"O4'\"     \"C1'\"     N1        C2        210.000       10.000    6     \nDC      C3e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     2.8           6.100     1     \nDC      C3e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     335.00        4.900     1     \nDC      C3e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     35.9          2.800     1     \nDC      C3e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     324.700       3.100     1     \nDC      C3e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     20.500        5.100     1     \nDC      alpha           \"C5'\"     \"O5'\"     P         OP3       -60.000       10.00     3     \nDC      beta            P         \"O5'\"     \"C5'\"     \"C4'\"     180.000       10.00     3     \nDC      epsi            \"C4'\"     \"C3'\"     \"O3'\"     \"HO3'\"    180.000       10.00     3     \nDC      gamma           \"O5'\"     \"C5'\"     \"C4'\"     \"C3'\"     180.000       10.00     3     \nDC       const_sp2_sp2_4          O2          C2          N1       \"C1'\"       0.000     5.0     2\nDC              const_18          C5          C6          N1       \"C1'\"     180.000    10.0     2\nDC       const_sp2_sp2_6          O2          C2          N3          C4     180.000     5.0     2\nDC       const_sp2_sp2_8          N4          C4          N3          C2     180.000     5.0     2\nDC             sp2_sp2_3          N3          C4          N4         H41       0.000     5.0     2\nDC              const_11          N4          C4          C5          C6     180.000    10.0     2\nDC              const_13          C4          C5          C6          N1       0.000    10.0     2\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nDC   chir_1    P    \"O5'\"    OP3    OP2    both\nDC   chir_2    \"C4'\"    \"O4'\"    \"C3'\"    \"C5'\"    negative\nDC   chir_3    \"C3'\"    \"O3'\"    \"C4'\"    \"C2'\"    positive\nDC   chir_4    \"C1'\"    \"O4'\"    N1    \"C2'\"    negative\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nDC   plan-1       \"C1'\"   0.020\nDC   plan-1          C2   0.020\nDC   plan-1          C4   0.020\nDC   plan-1          C5   0.020\nDC   plan-1          C6   0.020\nDC   plan-1          H5   0.020\nDC   plan-1          H6   0.020\nDC   plan-1          N1   0.020\nDC   plan-1          N3   0.020\nDC   plan-1          N4   0.020\nDC   plan-1          O2   0.020\nDC   plan-2          C4   0.020\nDC   plan-2         H41   0.020\nDC   plan-2         H42   0.020\nDC   plan-2          N4   0.020\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nDC           SMILES              ACDLabs 10.04                                                                                                      O=C1N=C(N)C=CN1C2OC(C(O)C2)COP(=O)(O)O\nDC SMILES_CANONICAL               CACTVS 3.341                                                                                     NC1=NC(=O)N(C=C1)[C@H]2C[C@H](O)[C@@H](CO[P](O)(O)=O)O2\nDC           SMILES               CACTVS 3.341                                                                                         NC1=NC(=O)N(C=C1)[CH]2C[CH](O)[CH](CO[P](O)(O)=O)O2\nDC SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0                                                                                         C1[C@@H]([C@H](O[C@H]1N2C=CC(=NC2=O)N)COP(=O)(O)O)O\nDC           SMILES \"OpenEye OEToolkits\" 1.5.0                                                                                                      C1C(C(OC1N2C=CC(=NC2=O)N)COP(=O)(O)O)O\nDC            InChI                InChI  1.03 InChI=1S/C9H14N3O7P/c10-7-1-2-12(9(14)11-7)8-3-5(13)6(19-8)4-18-20(15,16)17/h1-2,5-6,8,13H,3-4H2,(H2,10,11,14)(H2,15,16,17)/t5-,6+,8+/m0/s1\nDC         InChIKey                InChI  1.03                                                                                                                 NCMVOABPESMRCP-SHYZEUOFSA-N\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nDC  acedrg               243         \"dictionary generator\"                  \nDC  acedrg_database      11          \"data source\"                           \nDC  rdkit                2017.03.2   \"Chemoinformatics tool\"\nDC  refmac5              5.8.0238    \"optimization tool\"                     \n",
    atoms: [
      {name: "OP3", element: "O", xyz: [4.759, -6.216, 1.740]},
      {name: "P", element: "P", xyz: [5.427, -6.783, 0.501]},
      {name: "OP1", element: "O", xyz: [5.450, -8.3, 0.487]},
      {name: "OP2", element: "O", xyz: [6.788, -6.171, 0.232]},
      {name: "O5'", element: "O", xyz: [4.494, -6.346, -0.742]},
      {name: "C5'", element: "C", xyz: [3.097, -6.734, -0.736]},
      {name: "C4'", element: "C", xyz: [2.438, -6.261, -2.009]},
      {name: "O4'", element: "O", xyz: [2.537, -4.821, -2.097]},
      {name: "C3'", element: "C", xyz: [3.044, -6.825, -3.297]},
      {name: "O3'", element: "O", xyz: [2.035, -7.363, -4.147]},
      {name: "C2'", element: "C", xyz: [3.705, -5.618, -3.951]},
      {name: "C1'", element: "C", xyz: [2.890, -4.454, -3.414]},
      {name: "N1", element: "N", xyz: [3.622, -3.158, -3.358]},
      {name: "C2", element: "C", xyz: [3.233, -2.087, -4.185]},
      {name: "O2", element: "O", xyz: [2.273, -2.221, -4.961]},
      {name: "N3", element: "N", xyz: [3.923, -0.917, -4.114]},
      {name: "C4", element: "C", xyz: [4.961, -0.779, -3.274]},
      {name: "N4", element: "N", xyz: [5.596, 0.387, -3.25]},
      {name: "C5", element: "C", xyz: [5.371, -1.854, -2.432]},
      {name: "C6", element: "C", xyz: [4.683, -3.007, -2.507]},
      {name: "H5'", element: "H", xyz: [2.640, -6.331, 0.044]},
      {name: "H5''", element: "H", xyz: [3.022, -7.718, -0.669]},
      {name: "H4'", element: "H", xyz: [1.482, -6.507, -1.967]},
      {name: "H3'", element: "H", xyz: [3.719, -7.516, -3.087]},
      {name: "HO3'", element: "H", xyz: [1.460, -6.765, -4.33]},
      {name: "H2'", element: "H", xyz: [3.647, -5.668, -4.93]},
      {name: "H2''", element: "H", xyz: [4.648, -5.546, -3.691]},
      {name: "H1'", element: "H", xyz: [2.063, -4.358, -3.951]},
      {name: "H41", element: "H", xyz: [5.385, 1.014, -3.827]},
      {name: "H42", element: "H", xyz: [6.226, 0.528, -2.656]},
      {name: "H5", element: "H", xyz: [6.097, -1.763, -1.841]},
      {name: "H6", element: "H", xyz: [4.929, -3.731, -1.969]},
    ],
  },
  "DG": {
    name: "DG",
    cif: "#\ndata_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nDG    DG        \"2'-DEOXYGUANOSINE-5'-MONOPHOSPHATE\"     DNA     35     23     .     \n#\ndata_comp_DG\n#\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nDG      OP3     O       OP      -1      0.424       -8.734      -9.816      \nDG      P       P       P       0       0.296       -8.811      -11.326     \nDG      OP1     O       O       0       -0.898      -9.631      -11.775     \nDG      OP2     O       OP      -1      1.587       -9.229      -12.005     \nDG      \"O5'\"   O       O2      0       0.007       -7.303      -11.822     \nDG      \"C5'\"   C       CH2     0       -1.170      -6.617      -11.324     \nDG      \"C4'\"   C       CH1     0       -1.206      -5.213      -11.876     \nDG      \"O4'\"   O       O2      0       -0.018      -4.512      -11.450     \nDG      \"C3'\"   C       CH1     0       -1.259      -5.123      -13.404     \nDG      \"O3'\"   O       OH1     0       -2.248      -4.188      -13.827     \nDG      \"C2'\"   C       CH2     0       0.144       -4.654      -13.783     \nDG      \"C1'\"   C       CH1     0       0.565       -3.849      -12.566     \nDG      N9      N       NR5     0       2.012       -3.775      -12.354     \nDG      C8      C       CR15    0       2.857       -4.830      -12.111     \nDG      N7      N       NRD5    0       4.108       -4.471      -11.958     \nDG      C5      C       CR56    0       4.088       -3.091      -12.106     \nDG      C6      C       CR6     0       5.150       -2.149      -12.042     \nDG      O6      O       O       0       6.352       -2.369      -11.834     \nDG      N1      N       NR16    0       4.698       -0.841      -12.249     \nDG      C2      C       CR6     0       3.388       -0.485      -12.487     \nDG      N2      N       NH2     0       3.138       0.820       -12.662     \nDG      N3      N       NRD6    0       2.387       -1.368      -12.548     \nDG      C4      C       CR56    0       2.803       -2.647      -12.350     \nDG      \"H5'\"   H       H       0       -1.147      -6.585      -10.336     \nDG      \"H5''\"  H       H       0       -1.985      -7.104      -11.602     \nDG      \"H4'\"   H       H       0       -1.996      -4.756      -11.498     \nDG      \"H3'\"   H       H       0       -1.441      -6.012      -13.795     \nDG      \"HO3'\"  H       H       0       -2.096      -3.427      -13.481     \nDG      \"H2'\"   H       H       0       0.125       -4.097      -14.586     \nDG      \"H2''\"  H       H       0       0.741       -5.412      -13.932     \nDG      \"H1'\"   H       H       0       0.190       -2.932      -12.632     \nDG      H8      H       H       0       2.565       -5.725      -12.063     \nDG      H1      H       H       0       5.314       -0.188      -12.222     \nDG      H21     H       H       0       2.584       1.078       -13.291     \nDG      H22     H       H       0       3.528       1.412       -12.146     \nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nDG        OP3           P      SINGLE       n     1.517  0.0192     1.517  0.0192\nDG          P         OP1      DOUBLE       n     1.517  0.0192     1.517  0.0192\nDG          P         OP2      SINGLE       n     1.517  0.0192     1.517  0.0192\nDG          P       \"O5'\"      SINGLE       n     1.614  0.0178     1.614  0.0178\nDG      \"O5'\"       \"C5'\"      SINGLE       n     1.450  0.0166     1.450  0.0166\nDG      \"C5'\"       \"C4'\"      SINGLE       n     1.509  0.0100     1.509  0.0100\nDG      \"C4'\"       \"O4'\"      SINGLE       n     1.442  0.0100     1.442  0.0100\nDG      \"C4'\"       \"C3'\"      SINGLE       n     1.526  0.0115     1.526  0.0115\nDG      \"O4'\"       \"C1'\"      SINGLE       n     1.425  0.0100     1.425  0.0100\nDG      \"C3'\"       \"O3'\"      SINGLE       n     1.424  0.0100     1.424  0.0100\nDG      \"C3'\"       \"C2'\"      SINGLE       n     1.526  0.0101     1.526  0.0101\nDG      \"C2'\"       \"C1'\"      SINGLE       n     1.521  0.0118     1.521  0.0118\nDG      \"C1'\"          N9      SINGLE       n     1.462  0.0111     1.462  0.0111\nDG         N9          C8      SINGLE       y     1.373  0.0100     1.373  0.0100\nDG         N9          C4      SINGLE       y     1.375  0.0100     1.375  0.0100\nDG         C8          N7      DOUBLE       y     1.312  0.0100     1.312  0.0100\nDG         N7          C5      SINGLE       y     1.390  0.0100     1.390  0.0100\nDG         C5          C6      SINGLE       y     1.417  0.0103     1.417  0.0103\nDG         C5          C4      DOUBLE       y     1.377  0.0100     1.377  0.0100\nDG         C6          O6      DOUBLE       n     1.239  0.0100     1.239  0.0100\nDG         C6          N1      SINGLE       y     1.396  0.0107     1.396  0.0107\nDG         N1          C2      SINGLE       y     1.374  0.0100     1.374  0.0100\nDG         C2          N2      SINGLE       n     1.340  0.0101     1.340  0.0101\nDG         C2          N3      DOUBLE       y     1.333  0.0104     1.333  0.0104\nDG         N3          C4      SINGLE       y     1.355  0.0100     1.355  0.0100\nDG      \"C5'\"       \"H5'\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nDG      \"C5'\"      \"H5''\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nDG      \"C4'\"       \"H4'\"      SINGLE       n     1.089  0.0100     0.987  0.0170\nDG      \"C3'\"       \"H3'\"      SINGLE       n     1.089  0.0100     0.988  0.0189\nDG      \"O3'\"      \"HO3'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nDG      \"C2'\"       \"H2'\"      SINGLE       n     1.089  0.0100     0.977  0.0113\nDG      \"C2'\"      \"H2''\"      SINGLE       n     1.089  0.0100     0.977  0.0113\nDG      \"C1'\"       \"H1'\"      SINGLE       n     1.089  0.0100     0.993  0.0101\nDG         C8          H8      SINGLE       n     1.082  0.0130     0.942  0.0170\nDG         N1          H1      SINGLE       n     1.016  0.0100     0.897  0.0200\nDG         N2         H21      SINGLE       n     1.016  0.0100     0.877  0.0200\nDG         N2         H22      SINGLE       n     1.016  0.0100     0.877  0.0200\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nDG        OP3           P         OP1     112.864    1.69\nDG        OP3           P         OP2     112.864    1.69\nDG        OP3           P       \"O5'\"     105.808    2.07\nDG        OP1           P         OP2     112.864    1.69\nDG        OP1           P       \"O5'\"     105.808    2.07\nDG        OP2           P       \"O5'\"     105.808    2.07\nDG          P       \"O5'\"       \"C5'\"     118.783    1.50\nDG      \"O5'\"       \"C5'\"       \"C4'\"     109.342    1.50\nDG      \"O5'\"       \"C5'\"       \"H5'\"     109.845    1.50\nDG      \"O5'\"       \"C5'\"      \"H5''\"     109.845    1.50\nDG      \"C4'\"       \"C5'\"       \"H5'\"     109.624    1.50\nDG      \"C4'\"       \"C5'\"      \"H5''\"     109.624    1.50\nDG      \"H5'\"       \"C5'\"      \"H5''\"     108.472    1.50\nDG      \"C5'\"       \"C4'\"       \"O4'\"     109.123    1.50\nDG      \"C5'\"       \"C4'\"       \"C3'\"     114.866    1.63\nDG      \"C5'\"       \"C4'\"       \"H4'\"     108.268    1.50\nDG      \"O4'\"       \"C4'\"       \"C3'\"     105.506    1.50\nDG      \"O4'\"       \"C4'\"       \"H4'\"     108.947    1.50\nDG      \"C3'\"       \"C4'\"       \"H4'\"     109.069    1.50\nDG      \"C4'\"       \"O4'\"       \"C1'\"     108.795    1.50\nDG      \"C4'\"       \"C3'\"       \"O3'\"     110.527    2.37\nDG      \"C4'\"       \"C3'\"       \"C2'\"     102.433    1.50\nDG      \"C4'\"       \"C3'\"       \"H3'\"     110.775    1.50\nDG      \"O3'\"       \"C3'\"       \"C2'\"     111.424    1.96\nDG      \"O3'\"       \"C3'\"       \"H3'\"     110.713    1.50\nDG      \"C2'\"       \"C3'\"       \"H3'\"     110.846    1.50\nDG      \"C3'\"       \"O3'\"      \"HO3'\"     109.026    2.38\nDG      \"C3'\"       \"C2'\"       \"C1'\"     102.663    1.50\nDG      \"C3'\"       \"C2'\"       \"H2'\"     111.194    1.50\nDG      \"C3'\"       \"C2'\"      \"H2''\"     111.194    1.50\nDG      \"C1'\"       \"C2'\"       \"H2'\"     111.213    1.50\nDG      \"C1'\"       \"C2'\"      \"H2''\"     111.213    1.50\nDG      \"H2'\"       \"C2'\"      \"H2''\"     109.148    1.50\nDG      \"O4'\"       \"C1'\"       \"C2'\"     106.035    1.50\nDG      \"O4'\"       \"C1'\"          N9     108.236    1.50\nDG      \"O4'\"       \"C1'\"       \"H1'\"     109.059    1.50\nDG      \"C2'\"       \"C1'\"          N9     114.190    1.67\nDG      \"C2'\"       \"C1'\"       \"H1'\"     109.272    1.50\nDG         N9       \"C1'\"       \"H1'\"     109.282    1.50\nDG      \"C1'\"          N9          C8     127.617    2.81\nDG      \"C1'\"          N9          C4     126.652    2.93\nDG         C8          N9          C4     105.731    1.50\nDG         N9          C8          N7     113.507    1.50\nDG         N9          C8          H8     123.187    1.50\nDG         N7          C8          H8     123.307    1.50\nDG         C8          N7          C5     104.778    1.50\nDG         N7          C5          C6     130.030    1.50\nDG         N7          C5          C4     110.574    1.50\nDG         C6          C5          C4     119.397    1.50\nDG         C5          C6          O6     128.244    1.50\nDG         C5          C6          N1     111.367    1.50\nDG         O6          C6          N1     120.389    1.50\nDG         C6          N1          C2     125.351    1.50\nDG         C6          N1          H1     116.978    2.44\nDG         C2          N1          H1     117.677    2.71\nDG         N1          C2          N2     116.576    1.50\nDG         N1          C2          N3     123.602    1.50\nDG         N2          C2          N3     119.821    1.50\nDG         C2          N2         H21     119.868    1.50\nDG         C2          N2         H22     119.868    1.50\nDG        H21          N2         H22     120.263    1.96\nDG         C2          N3          C4     112.066    1.50\nDG         N9          C4          C5     105.411    1.50\nDG         N9          C4          N3     126.378    1.50\nDG         C5          C4          N3     128.211    1.50\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nDG      C2e-chi         \"O4'\"     \"C1'\"     N9        C4        210.000       10.000    6     \nDG      C2e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     340.700       6.300     1     \nDG      C2e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     32.800        4.900     1     \nDG      C2e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     326.9         3.600     1     \nDG      C2e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     22.600        4.500     1     \nDG      C2e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     357.700       6.100     1     \nDG      C3e-chi         \"O4'\"     \"C1'\"     N9        C4        210.000       10.000    6     \nDG      C3e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     2.8           6.100     1     \nDG      C3e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     335.00        4.900     1     \nDG      C3e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     35.9          2.800     1     \nDG      C3e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     324.700       3.100     1     \nDG      C3e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     20.500        5.100     1     \nDG      alpha           \"C5'\"     \"O5'\"     P         OP3       -60.000       10.00     3     \nDG      beta            P         \"O5'\"     \"C5'\"     \"C4'\"     180.000       10.00     3     \nDG      epsi            \"C4'\"     \"C3'\"     \"O3'\"     \"HO3'\"    180.000       10.00     3     \nDG      gamma           \"O5'\"     \"C5'\"     \"C4'\"     \"C3'\"     180.000       10.00     3     \nDG              const_18          N7          C8          N9       \"C1'\"     180.000    10.0     2\nDG              const_30          C5          C4          N9       \"C1'\"     180.000    10.0     2\nDG              const_21          N9          C8          N7          C5       0.000    10.0     2\nDG              const_24          C6          C5          N7          C8     180.000    10.0     2\nDG       const_sp2_sp2_4          N7          C5          C6          O6       0.000     5.0     2\nDG              const_25          N9          C4          C5          N7       0.000    10.0     2\nDG       const_sp2_sp2_7          O6          C6          N1          C2     180.000     5.0     2\nDG              const_11          N2          C2          N1          C6     180.000    10.0     2\nDG             sp2_sp2_1          N1          C2          N2         H21     180.000     5.0     2\nDG              const_14          N2          C2          N3          C4     180.000    10.0     2\nDG              const_16          N9          C4          N3          C2     180.000    10.0     2\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nDG   chir_1    P    \"O5'\"    OP3    OP2    both\nDG   chir_2    \"C4'\"    \"O4'\"    \"C3'\"    \"C5'\"    negative\nDG   chir_3    \"C3'\"    \"O3'\"    \"C4'\"    \"C2'\"    positive\nDG   chir_4    \"C1'\"    \"O4'\"    N9    \"C2'\"    negative\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nDG   plan-1       \"C1'\"   0.020\nDG   plan-1          C2   0.020\nDG   plan-1          C4   0.020\nDG   plan-1          C5   0.020\nDG   plan-1          C6   0.020\nDG   plan-1          C8   0.020\nDG   plan-1          H1   0.020\nDG   plan-1          H8   0.020\nDG   plan-1          N1   0.020\nDG   plan-1          N2   0.020\nDG   plan-1          N3   0.020\nDG   plan-1          N7   0.020\nDG   plan-1          N9   0.020\nDG   plan-1          O6   0.020\nDG   plan-2          C2   0.020\nDG   plan-2         H21   0.020\nDG   plan-2         H22   0.020\nDG   plan-2          N2   0.020\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nDG           SMILES              ACDLabs 10.04                                                                                                          O=C1c2ncn(c2N=C(N)N1)C3OC(C(O)C3)COP(=O)(O)O\nDG SMILES_CANONICAL               CACTVS 3.341                                                                                           NC1=Nc2n(cnc2C(=O)N1)[C@H]3C[C@H](O)[C@@H](CO[P](O)(O)=O)O3\nDG           SMILES               CACTVS 3.341                                                                                               NC1=Nc2n(cnc2C(=O)N1)[CH]3C[CH](O)[CH](CO[P](O)(O)=O)O3\nDG SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0                                                                                             c1nc2c(n1[C@H]3C[C@@H]([C@H](O3)COP(=O)(O)O)O)N=C(NC2=O)N\nDG           SMILES \"OpenEye OEToolkits\" 1.5.0                                                                                                          c1nc2c(n1C3CC(C(O3)COP(=O)(O)O)O)N=C(NC2=O)N\nDG            InChI                InChI  1.03 InChI=1S/C10H14N5O7P/c11-10-13-8-7(9(17)14-10)12-3-15(8)6-1-4(16)5(22-6)2-21-23(18,19)20/h3-6,16H,1-2H2,(H2,18,19,20)(H3,11,13,14,17)/t4-,5+,6+/m0/s1\nDG         InChIKey                InChI  1.03                                                                                                                           LTFMZDNNPPEQNG-KVQBGUIXSA-N\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nDG  acedrg               243         \"dictionary generator\"                  \nDG  acedrg_database      11          \"data source\"                           \nDG  rdkit                2017.03.2   \"Chemoinformatics tool\"\nDG  refmac5              5.8.0238    \"optimization tool\"                     \n",
    atoms: [
      {name: "OP3", element: "O", xyz: [0.424, -8.734, -9.816]},
      {name: "P", element: "P", xyz: [0.296, -8.811, -11.326]},
      {name: "OP1", element: "O", xyz: [-0.898, -9.631, -11.775]},
      {name: "OP2", element: "O", xyz: [1.587, -9.229, -12.005]},
      {name: "O5'", element: "O", xyz: [0.007, -7.303, -11.822]},
      {name: "C5'", element: "C", xyz: [-1.17, -6.617, -11.324]},
      {name: "C4'", element: "C", xyz: [-1.206, -5.213, -11.876]},
      {name: "O4'", element: "O", xyz: [-0.018, -4.512, -11.45]},
      {name: "C3'", element: "C", xyz: [-1.259, -5.123, -13.404]},
      {name: "O3'", element: "O", xyz: [-2.248, -4.188, -13.827]},
      {name: "C2'", element: "C", xyz: [0.144, -4.654, -13.783]},
      {name: "C1'", element: "C", xyz: [0.565, -3.849, -12.566]},
      {name: "N9", element: "N", xyz: [2.012, -3.775, -12.354]},
      {name: "C8", element: "C", xyz: [2.857, -4.83, -12.111]},
      {name: "N7", element: "N", xyz: [4.108, -4.471, -11.958]},
      {name: "C5", element: "C", xyz: [4.088, -3.091, -12.106]},
      {name: "C6", element: "C", xyz: [5.150, -2.149, -12.042]},
      {name: "O6", element: "O", xyz: [6.352, -2.369, -11.834]},
      {name: "N1", element: "N", xyz: [4.698, -0.841, -12.249]},
      {name: "C2", element: "C", xyz: [3.388, -0.485, -12.487]},
      {name: "N2", element: "N", xyz: [3.138, 0.820, -12.662]},
      {name: "N3", element: "N", xyz: [2.387, -1.368, -12.548]},
      {name: "C4", element: "C", xyz: [2.803, -2.647, -12.35]},
      {name: "H5'", element: "H", xyz: [-1.147, -6.585, -10.336]},
      {name: "H5''", element: "H", xyz: [-1.985, -7.104, -11.602]},
      {name: "H4'", element: "H", xyz: [-1.996, -4.756, -11.498]},
      {name: "H3'", element: "H", xyz: [-1.441, -6.012, -13.795]},
      {name: "HO3'", element: "H", xyz: [-2.096, -3.427, -13.481]},
      {name: "H2'", element: "H", xyz: [0.125, -4.097, -14.586]},
      {name: "H2''", element: "H", xyz: [0.741, -5.412, -13.932]},
      {name: "H1'", element: "H", xyz: [0.190, -2.932, -12.632]},
      {name: "H8", element: "H", xyz: [2.565, -5.725, -12.063]},
      {name: "H1", element: "H", xyz: [5.314, -0.188, -12.222]},
      {name: "H21", element: "H", xyz: [2.584, 1.078, -13.291]},
      {name: "H22", element: "H", xyz: [3.528, 1.412, -12.146]},
    ],
  },
  "DT": {
    name: "DT",
    cif: "#\ndata_comp_list\nloop_\n_chem_comp.id\n_chem_comp.three_letter_code\n_chem_comp.name\n_chem_comp.group\n_chem_comp.number_atoms_all\n_chem_comp.number_atoms_nh\n_chem_comp.desc_level\nDT    DT        \"THYMIDINE-5'-MONOPHOSPHATE\"     DNA     34     21     .     \n#\ndata_comp_DT\n#\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\n_chem_comp_atom.type_energy\n_chem_comp_atom.charge\n_chem_comp_atom.x\n_chem_comp_atom.y\n_chem_comp_atom.z\nDT      OP3     O       OP      -1      -9.033      1.811       3.710       \nDT      P       P       P       0       -8.813      3.246       4.151       \nDT      OP1     O       O       0       -9.790      3.689       5.223       \nDT      OP2     O       OP      -1      -8.738      4.214       2.986       \nDT      \"O5'\"   O       O2      0       -7.356      3.277       4.843       \nDT      \"C5'\"   C       CH2     0       -7.098      2.397       5.967       \nDT      \"C4'\"   C       CH1     0       -5.688      2.610       6.462       \nDT      \"O4'\"   O       O2      0       -4.754      2.345       5.391       \nDT      \"C3'\"   C       CH1     0       -5.391      4.024       6.970       \nDT      \"O3'\"   O       OH1     0       -4.766      3.989       8.251       \nDT      \"C2'\"   C       CH2     0       -4.437      4.599       5.930       \nDT      \"C1'\"   C       CH1     0       -3.760      3.359       5.367       \nDT      N1      N       NR6     0       -3.270      3.502       3.966       \nDT      C2      C       CR6     0       -1.905      3.474       3.713       \nDT      O2      O       O       0       -1.053      3.332       4.583       \nDT      N3      N       NR16    0       -1.559      3.618       2.388       \nDT      C4      C       CR6     0       -2.414      3.786       1.310       \nDT      O4      O       O       0       -1.948      3.903       0.172       \nDT      C5      C       CR6     0       -3.824      3.809       1.640       \nDT      C7      C       CH3     0       -4.824      3.988       0.535       \nDT      C6      C       CR16    0       -4.178      3.669       2.932       \nDT      \"H5'\"   H       H       0       -7.213      1.455       5.689       \nDT      \"H5''\"  H       H       0       -7.738      2.588       6.696       \nDT      \"H4'\"   H       H       0       -5.520      1.964       7.190       \nDT      \"H3'\"   H       H       0       -6.221      4.559       7.010       \nDT      \"HO3'\"  H       H       0       -4.051      3.531       8.213       \nDT      \"H2'\"   H       H       0       -3.782      5.203       6.342       \nDT      \"H2''\"  H       H       0       -4.926      5.088       5.233       \nDT      \"H1'\"   H       H       0       -3.014      3.092       5.967       \nDT      H3      H       H       0       -0.682      3.600       2.215       \nDT      H71     H       H       0       -5.705      3.724       0.845       \nDT      H72     H       H       0       -4.574      3.437       -0.224      \nDT      H73     H       H       0       -4.846      4.920       0.263       \nDT      H6      H       H       0       -5.103      3.686       3.152       \nloop_\n_chem_comp_bond.comp_id\n_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.type\n_chem_comp_bond.aromatic\n_chem_comp_bond.value_dist_nucleus\n_chem_comp_bond.value_dist_nucleus_esd\n_chem_comp_bond.value_dist\n_chem_comp_bond.value_dist_esd\nDT        OP3           P      SINGLE       n     1.517  0.0192     1.517  0.0192\nDT          P         OP1      DOUBLE       n     1.517  0.0192     1.517  0.0192\nDT          P         OP2      SINGLE       n     1.517  0.0192     1.517  0.0192\nDT          P       \"O5'\"      SINGLE       n     1.614  0.0178     1.614  0.0178\nDT      \"O5'\"       \"C5'\"      SINGLE       n     1.450  0.0166     1.450  0.0166\nDT      \"C5'\"       \"C4'\"      SINGLE       n     1.509  0.0100     1.509  0.0100\nDT      \"C4'\"       \"O4'\"      SINGLE       n     1.445  0.0100     1.445  0.0100\nDT      \"C4'\"       \"C3'\"      SINGLE       n     1.526  0.0115     1.526  0.0115\nDT      \"O4'\"       \"C1'\"      SINGLE       n     1.422  0.0100     1.422  0.0100\nDT      \"C3'\"       \"O3'\"      SINGLE       n     1.424  0.0100     1.424  0.0100\nDT      \"C3'\"       \"C2'\"      SINGLE       n     1.522  0.0100     1.522  0.0100\nDT      \"C2'\"       \"C1'\"      SINGLE       n     1.523  0.0130     1.523  0.0130\nDT      \"C1'\"          N1      SINGLE       n     1.477  0.0139     1.477  0.0139\nDT         N1          C2      SINGLE       y     1.379  0.0100     1.379  0.0100\nDT         N1          C6      SINGLE       y     1.380  0.0107     1.380  0.0107\nDT         C2          O2      DOUBLE       n     1.224  0.0111     1.224  0.0111\nDT         C2          N3      SINGLE       y     1.373  0.0100     1.373  0.0100\nDT         N3          C4      SINGLE       y     1.383  0.0100     1.383  0.0100\nDT         C4          O4      DOUBLE       n     1.234  0.0141     1.234  0.0141\nDT         C4          C5      SINGLE       y     1.446  0.0100     1.446  0.0100\nDT         C5          C7      SINGLE       n     1.500  0.0100     1.500  0.0100\nDT         C5          C6      DOUBLE       y     1.343  0.0112     1.343  0.0112\nDT      \"C5'\"       \"H5'\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nDT      \"C5'\"      \"H5''\"      SINGLE       n     1.089  0.0100     0.989  0.0200\nDT      \"C4'\"       \"H4'\"      SINGLE       n     1.089  0.0100     0.987  0.0170\nDT      \"C3'\"       \"H3'\"      SINGLE       n     1.089  0.0100     0.988  0.0189\nDT      \"O3'\"      \"HO3'\"      SINGLE       n     0.970  0.0120     0.849  0.0200\nDT      \"C2'\"       \"H2'\"      SINGLE       n     1.089  0.0100     0.982  0.0200\nDT      \"C2'\"      \"H2''\"      SINGLE       n     1.089  0.0100     0.982  0.0200\nDT      \"C1'\"       \"H1'\"      SINGLE       n     1.089  0.0100     0.996  0.0200\nDT         N3          H3      SINGLE       n     1.016  0.0100     0.893  0.0200\nDT         C7         H71      SINGLE       n     1.089  0.0100     0.971  0.0135\nDT         C7         H72      SINGLE       n     1.089  0.0100     0.971  0.0135\nDT         C7         H73      SINGLE       n     1.089  0.0100     0.971  0.0135\nDT         C6          H6      SINGLE       n     1.082  0.0130     0.951  0.0200\nloop_\n_chem_comp_angle.comp_id\n_chem_comp_angle.atom_id_1\n_chem_comp_angle.atom_id_2\n_chem_comp_angle.atom_id_3\n_chem_comp_angle.value_angle\n_chem_comp_angle.value_angle_esd\nDT        OP3           P         OP1     112.864    1.69\nDT        OP3           P         OP2     112.864    1.69\nDT        OP3           P       \"O5'\"     105.808    2.07\nDT        OP1           P         OP2     112.864    1.69\nDT        OP1           P       \"O5'\"     105.808    2.07\nDT        OP2           P       \"O5'\"     105.808    2.07\nDT          P       \"O5'\"       \"C5'\"     118.783    1.50\nDT      \"O5'\"       \"C5'\"       \"C4'\"     109.342    1.50\nDT      \"O5'\"       \"C5'\"       \"H5'\"     109.845    1.50\nDT      \"O5'\"       \"C5'\"      \"H5''\"     109.845    1.50\nDT      \"C4'\"       \"C5'\"       \"H5'\"     109.624    1.50\nDT      \"C4'\"       \"C5'\"      \"H5''\"     109.624    1.50\nDT      \"H5'\"       \"C5'\"      \"H5''\"     108.472    1.50\nDT      \"C5'\"       \"C4'\"       \"O4'\"     109.615    1.50\nDT      \"C5'\"       \"C4'\"       \"C3'\"     114.866    1.63\nDT      \"C5'\"       \"C4'\"       \"H4'\"     108.268    1.50\nDT      \"O4'\"       \"C4'\"       \"C3'\"     105.770    1.50\nDT      \"O4'\"       \"C4'\"       \"H4'\"     108.698    1.50\nDT      \"C3'\"       \"C4'\"       \"H4'\"     109.069    1.50\nDT      \"C4'\"       \"O4'\"       \"C1'\"     109.692    1.50\nDT      \"C4'\"       \"C3'\"       \"O3'\"     110.527    2.37\nDT      \"C4'\"       \"C3'\"       \"C2'\"     102.800    1.50\nDT      \"C4'\"       \"C3'\"       \"H3'\"     110.775    1.50\nDT      \"O3'\"       \"C3'\"       \"C2'\"     110.636    2.59\nDT      \"O3'\"       \"C3'\"       \"H3'\"     110.713    1.50\nDT      \"C2'\"       \"C3'\"       \"H3'\"     110.862    1.50\nDT      \"C3'\"       \"O3'\"      \"HO3'\"     109.026    2.38\nDT      \"C3'\"       \"C2'\"       \"C1'\"     102.834    1.50\nDT      \"C3'\"       \"C2'\"       \"H2'\"     111.310    1.50\nDT      \"C3'\"       \"C2'\"      \"H2''\"     111.310    1.50\nDT      \"C1'\"       \"C2'\"       \"H2'\"     111.187    1.50\nDT      \"C1'\"       \"C2'\"      \"H2''\"     111.187    1.50\nDT      \"H2'\"       \"C2'\"      \"H2''\"     108.952    1.50\nDT      \"O4'\"       \"C1'\"       \"C2'\"     106.308    1.50\nDT      \"O4'\"       \"C1'\"          N1     107.584    1.50\nDT      \"O4'\"       \"C1'\"       \"H1'\"     109.550    1.50\nDT      \"C2'\"       \"C1'\"          N1     114.268    1.50\nDT      \"C2'\"       \"C1'\"       \"H1'\"     109.741    1.50\nDT         N1       \"C1'\"       \"H1'\"     109.342    1.50\nDT      \"C1'\"          N1          C2     118.265    1.50\nDT      \"C1'\"          N1          C6     120.492    1.50\nDT         C2          N1          C6     121.243    1.50\nDT         N1          C2          O2     122.872    1.50\nDT         N1          C2          N3     114.786    1.50\nDT         O2          C2          N3     122.342    1.50\nDT         C2          N3          C4     127.106    1.50\nDT         C2          N3          H3     115.584    1.79\nDT         C4          N3          H3     117.311    1.81\nDT         N3          C4          O4     119.787    1.50\nDT         N3          C4          C5     115.265    1.50\nDT         O4          C4          C5     124.948    1.50\nDT         C4          C5          C7     118.650    1.50\nDT         C4          C5          C6     118.305    1.50\nDT         C7          C5          C6     123.045    1.50\nDT         C5          C7         H71     109.652    1.50\nDT         C5          C7         H72     109.652    1.50\nDT         C5          C7         H73     109.652    1.50\nDT        H71          C7         H72     109.348    1.50\nDT        H71          C7         H73     109.348    1.50\nDT        H72          C7         H73     109.348    1.50\nDT         N1          C6          C5     123.296    1.50\nDT         N1          C6          H6     117.926    1.56\nDT         C5          C6          H6     118.779    1.68\nloop_\n_chem_comp_tor.comp_id\n_chem_comp_tor.id\n_chem_comp_tor.atom_id_1\n_chem_comp_tor.atom_id_2\n_chem_comp_tor.atom_id_3\n_chem_comp_tor.atom_id_4\n_chem_comp_tor.value_angle\n_chem_comp_tor.value_angle_esd\n_chem_comp_tor.period\nDT      C2e-chi         \"O4'\"     \"C1'\"     N1        C2        210.000       10.000    6     \nDT      C2e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     340.700       6.300     1     \nDT      C2e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     32.800        4.900     1     \nDT      C2e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     326.9         3.600     1     \nDT      C2e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     22.600        4.500     1     \nDT      C2e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     357.700       6.100     1     \nDT      C3e-chi         \"O4'\"     \"C1'\"     N1        C2        210.000       10.000    6     \nDT      C3e-nyu0        \"C4'\"     \"O4'\"     \"C1'\"     \"C2'\"     2.8           6.100     1     \nDT      C3e-nyu1        \"O4'\"     \"C1'\"     \"C2'\"     \"C3'\"     335.00        4.900     1     \nDT      C3e-nyu2        \"C1'\"     \"C2'\"     \"C3'\"     \"C4'\"     35.9          2.800     1     \nDT      C3e-nyu3        \"C2'\"     \"C3'\"     \"C4'\"     \"O4'\"     324.700       3.100     1     \nDT      C3e-nyu4        \"C3'\"     \"C4'\"     \"O4'\"     \"C1'\"     20.500        5.100     1     \nDT      alpha           \"C5'\"     \"O5'\"     P         OP3       -60.000       10.00     3     \nDT      beta            P         \"O5'\"     \"C5'\"     \"C4'\"     180.000       10.00     3     \nDT      epsi            \"C4'\"     \"C3'\"     \"O3'\"     \"HO3'\"    180.000       10.00     3     \nDT      gamma           \"O5'\"     \"C5'\"     \"C4'\"     \"C3'\"     180.000       10.00     3     \nDT       const_sp2_sp2_4          O2          C2          N1       \"C1'\"       0.000     5.0     2\nDT              const_22          C5          C6          N1       \"C1'\"     180.000    10.0     2\nDT       const_sp2_sp2_7          O2          C2          N3          C4     180.000     5.0     2\nDT              const_11          O4          C4          N3          C2     180.000    10.0     2\nDT              const_16          O4          C4          C5          C7       0.000    10.0     2\nDT             sp2_sp3_7          C4          C5          C7         H71     150.000    10.0     6\nDT              const_19          C7          C5          C6          N1     180.000    10.0     2\nloop_\n_chem_comp_chir.comp_id\n_chem_comp_chir.id\n_chem_comp_chir.atom_id_centre\n_chem_comp_chir.atom_id_1\n_chem_comp_chir.atom_id_2\n_chem_comp_chir.atom_id_3\n_chem_comp_chir.volume_sign\nDT   chir_1    P    \"O5'\"    OP3    OP2    both\nDT   chir_2    \"C4'\"    \"O4'\"    \"C3'\"    \"C5'\"    negative\nDT   chir_3    \"C3'\"    \"O3'\"    \"C4'\"    \"C2'\"    positive\nDT   chir_4    \"C1'\"    \"O4'\"    N1    \"C2'\"    negative\nloop_\n_chem_comp_plane_atom.comp_id\n_chem_comp_plane_atom.plane_id\n_chem_comp_plane_atom.atom_id\n_chem_comp_plane_atom.dist_esd\nDT   plan-1       \"C1'\"   0.020\nDT   plan-1          C2   0.020\nDT   plan-1          C4   0.020\nDT   plan-1          C5   0.020\nDT   plan-1          C6   0.020\nDT   plan-1          C7   0.020\nDT   plan-1          H3   0.020\nDT   plan-1          H6   0.020\nDT   plan-1          N1   0.020\nDT   plan-1          N3   0.020\nDT   plan-1          O2   0.020\nDT   plan-1          O4   0.020\nloop_\n_pdbx_chem_comp_descriptor.comp_id\n_pdbx_chem_comp_descriptor.type\n_pdbx_chem_comp_descriptor.program\n_pdbx_chem_comp_descriptor.program_version\n_pdbx_chem_comp_descriptor.descriptor\nDT           SMILES              ACDLabs 10.04                                                                                                      O=C1NC(=O)N(C=C1C)C2OC(C(O)C2)COP(=O)(O)O\nDT SMILES_CANONICAL               CACTVS 3.341                                                                                       CC1=CN([C@H]2C[C@H](O)[C@@H](CO[P](O)(O)=O)O2)C(=O)NC1=O\nDT           SMILES               CACTVS 3.341                                                                                           CC1=CN([CH]2C[CH](O)[CH](CO[P](O)(O)=O)O2)C(=O)NC1=O\nDT SMILES_CANONICAL \"OpenEye OEToolkits\" 1.5.0                                                                                         CC1=CN(C(=O)NC1=O)[C@H]2C[C@@H]([C@H](O2)COP(=O)(O)O)O\nDT           SMILES \"OpenEye OEToolkits\" 1.5.0                                                                                                      CC1=CN(C(=O)NC1=O)C2CC(C(O2)COP(=O)(O)O)O\nDT            InChI                InChI  1.03 InChI=1S/C10H15N2O8P/c1-5-3-12(10(15)11-9(5)14)8-2-6(13)7(20-8)4-19-21(16,17)18/h3,6-8,13H,2,4H2,1H3,(H,11,14,15)(H2,16,17,18)/t6-,7+,8+/m0/s1\nDT         InChIKey                InChI  1.03                                                                                                                    GYOZYWVXFNDGLU-XLPZGREQSA-N\nloop_\n_pdbx_chem_comp_description_generator.comp_id\n_pdbx_chem_comp_description_generator.program_name\n_pdbx_chem_comp_description_generator.program_version\n_pdbx_chem_comp_description_generator.descriptor\nDT  acedrg               243         \"dictionary generator\"                  \nDT  acedrg_database      11          \"data source\"                           \nDT  rdkit                2017.03.2   \"Chemoinformatics tool\"\nDT  refmac5              5.8.0238    \"optimization tool\"                     \n",
    atoms: [
      {name: "OP3", element: "O", xyz: [-9.033, 1.811, 3.710]},
      {name: "P", element: "P", xyz: [-8.813, 3.246, 4.151]},
      {name: "OP1", element: "O", xyz: [-9.79, 3.689, 5.223]},
      {name: "OP2", element: "O", xyz: [-8.738, 4.214, 2.986]},
      {name: "O5'", element: "O", xyz: [-7.356, 3.277, 4.843]},
      {name: "C5'", element: "C", xyz: [-7.098, 2.397, 5.967]},
      {name: "C4'", element: "C", xyz: [-5.688, 2.610, 6.462]},
      {name: "O4'", element: "O", xyz: [-4.754, 2.345, 5.391]},
      {name: "C3'", element: "C", xyz: [-5.391, 4.024, 6.970]},
      {name: "O3'", element: "O", xyz: [-4.766, 3.989, 8.251]},
      {name: "C2'", element: "C", xyz: [-4.437, 4.599, 5.930]},
      {name: "C1'", element: "C", xyz: [-3.76, 3.359, 5.367]},
      {name: "N1", element: "N", xyz: [-3.27, 3.502, 3.966]},
      {name: "C2", element: "C", xyz: [-1.905, 3.474, 3.713]},
      {name: "O2", element: "O", xyz: [-1.053, 3.332, 4.583]},
      {name: "N3", element: "N", xyz: [-1.559, 3.618, 2.388]},
      {name: "C4", element: "C", xyz: [-2.414, 3.786, 1.310]},
      {name: "O4", element: "O", xyz: [-1.948, 3.903, 0.172]},
      {name: "C5", element: "C", xyz: [-3.824, 3.809, 1.640]},
      {name: "C7", element: "C", xyz: [-4.824, 3.988, 0.535]},
      {name: "C6", element: "C", xyz: [-4.178, 3.669, 2.932]},
      {name: "H5'", element: "H", xyz: [-7.213, 1.455, 5.689]},
      {name: "H5''", element: "H", xyz: [-7.738, 2.588, 6.696]},
      {name: "H4'", element: "H", xyz: [-5.52, 1.964, 7.190]},
      {name: "H3'", element: "H", xyz: [-6.221, 4.559, 7.010]},
      {name: "HO3'", element: "H", xyz: [-4.051, 3.531, 8.213]},
      {name: "H2'", element: "H", xyz: [-3.782, 5.203, 6.342]},
      {name: "H2''", element: "H", xyz: [-4.926, 5.088, 5.233]},
      {name: "H1'", element: "H", xyz: [-3.014, 3.092, 5.967]},
      {name: "H3", element: "H", xyz: [-0.682, 3.600, 2.215]},
      {name: "H71", element: "H", xyz: [-5.705, 3.724, 0.845]},
      {name: "H72", element: "H", xyz: [-4.574, 3.437, -0.224]},
      {name: "H73", element: "H", xyz: [-4.846, 4.920, 0.263]},
      {name: "H6", element: "H", xyz: [-5.103, 3.686, 3.152]},
    ],
  },
};

function nucleotideTemplate(resname) {
  return NUCLEOTIDE_TEMPLATES[resname.toUpperCase()] || null;
}

function aminoAcidTemplate(resname) {
  return AMINO_ACID_TEMPLATES[resname.toUpperCase()] || null;
}

const EPS = 1e-6;
const PROTEIN_BACKBONE = new Set(['N', 'CA', 'C', 'O', 'OXT', 'OT1', 'OT2']);
const AMINO_ACID_MUTATION_TARGETS = [
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
  'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
];
const RNA_BASE_TARGETS = ['A', 'C', 'G', 'U'];
const DNA_BASE_TARGETS = ['A', 'C', 'G', 'T'];
const RNA_RESNAMES = new Set(RNA_BASE_TARGETS);
const DNA_RESNAMES = new Set(['DA', 'DC', 'DG', 'DT']);
const PHOSPHATE_ATOMS = new Set(['P', 'OP1', 'OP2', 'OP3', 'O1P', 'O2P', 'O3P']);
const SUGAR_TO_DNA = '\u2192 DNA';
const SUGAR_TO_RNA = '\u2192 RNA';

function normalize_atom_name(name) {
  return name.toUpperCase().replace(/\*/g, '\'');
}

function residue_kind(resname) {
  const name = resname.toUpperCase();
  if (AMINO_ACID_MUTATION_TARGETS.indexOf(name) !== -1) return 'protein';
  if (RNA_RESNAMES.has(name)) return 'rna';
  if (DNA_RESNAMES.has(name)) return 'dna';
  return null;
}

function is_preserved_nucleotide_atom(name) {
  const norm = normalize_atom_name(name);
  return norm.indexOf('\'') !== -1 || PHOSPHATE_ATOMS.has(norm);
}

function base_atom_name(source_resname) {
  const name = source_resname.toUpperCase();
  if (name === 'A' || name === 'G' || name === 'DA' || name === 'DG') return 'N9';
  return 'N1';
}

function nucleotide_target_resname(source_resname, target) {
  const source_kind = residue_kind(source_resname);
  const upper = target.toUpperCase();
  if (source_kind === 'rna') {
    if (RNA_RESNAMES.has(upper)) return upper;
    if (upper === 'T') throw Error('RNA mutation target T is not supported.');
    if (upper.length === 2 && upper.startsWith('D') && DNA_RESNAMES.has(upper)) {
      throw Error('Cannot mutate RNA residue to DNA base ' + upper + '.');
    }
    throw Error('Unsupported RNA mutation target ' + target + '.');
  }
  if (source_kind === 'dna') {
    if (DNA_RESNAMES.has(upper)) return upper;
    const mapped = 'D' + upper;
    if (DNA_RESNAMES.has(mapped)) return mapped;
    if (upper === 'U') throw Error('DNA mutation target U is not supported.');
    throw Error('Unsupported DNA mutation target ' + target + '.');
  }
  return upper;
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function length(v) {
  return Math.sqrt(dot(v, v));
}

function normalize(v, what) {
  const len = length(v);
  if (!(len > EPS)) throw Error('Cannot define ' + what + '.');
  return [v[0] / len, v[1] / len, v[2] / len];
}

function reject(v, axis) {
  return sub(v, scale(axis, dot(v, axis)));
}

function build_backbone_frame(n, ca, c) {
  let x = normalize(sub(c, ca), 'backbone frame');
  let y = reject(sub(n, ca), x);
  y = normalize(y, 'backbone frame');
  const z = normalize(cross(x, y), 'backbone frame');
  x = normalize(cross(y, z), 'backbone frame');
  return {origin: ca, x: x, y: y, z: z};
}

function build_sidechain_frame(n, ca, c, cb) {
  let x = normalize(sub(cb, ca), 'CA-CB direction');
  const plane_normal = normalize(cross(sub(c, ca), sub(n, ca)), 'backbone plane');
  let y = cross(plane_normal, x);
  if (length(y) <= EPS) {
    y = reject(sub(n, ca), x);
  }
  y = normalize(y, 'sidechain frame');
  const z = normalize(cross(x, y), 'sidechain frame');
  x = normalize(cross(y, z), 'sidechain frame');
  return {origin: ca, x: x, y: y, z: z};
}

function build_anchor_frame(a, origin, c, what) {
  let x = normalize(sub(a, origin), what);
  let y = reject(sub(c, origin), x);
  y = normalize(y, what);
  const z = normalize(cross(x, y), what);
  x = normalize(cross(y, z), what);
  return {origin: origin, x: x, y: y, z: z};
}

function transform_point(point, from, to) {
  const delta = sub(point, from.origin);
  const local = [dot(delta, from.x), dot(delta, from.y), dot(delta, from.z)];
  return add(to.origin,
             add(scale(to.x, local[0]),
                 add(scale(to.y, local[1]), scale(to.z, local[2]))));
}

function atom_by_name(atoms, name) {
  const wanted = normalize_atom_name(name);
  return atoms.find((atom) => normalize_atom_name(atom.name) === wanted) || null;
}

function heavy_amino_template_atoms(resname) {
  const template = aminoAcidTemplate(resname);
  if (template == null) throw Error('No template is available for ' + resname + '.');
  return template.atoms.filter((atom) => atom.element !== 'H' && atom.element !== 'D');
}

function heavy_nucleotide_template_atoms(resname) {
  const template = nucleotideTemplate(resname);
  if (template == null) throw Error('No template is available for ' + resname + '.');
  return template.atoms.filter((atom) => atom.element !== 'H' && atom.element !== 'D');
}

function pseudo_cb_xyz(residue_atoms) {
  const ala_atoms = heavy_amino_template_atoms('ALA');
  const source_n = atom_by_name(residue_atoms, 'N');
  const source_ca = atom_by_name(residue_atoms, 'CA');
  const source_c = atom_by_name(residue_atoms, 'C');
  const ala_n = atom_by_name(ala_atoms, 'N');
  const ala_ca = atom_by_name(ala_atoms, 'CA');
  const ala_c = atom_by_name(ala_atoms, 'C');
  const ala_cb = atom_by_name(ala_atoms, 'CB');
  if (!source_n || !source_ca || !source_c || !ala_n || !ala_ca || !ala_c || !ala_cb) {
    throw Error('Cannot derive pseudo-CB for mutation.');
  }
  const from = build_backbone_frame(ala_n.xyz, ala_ca.xyz, ala_c.xyz);
  const to = build_backbone_frame(source_n.xyz, source_ca.xyz, source_c.xyz);
  return transform_point(ala_cb.xyz, from, to);
}

function representative_atom(residue_atoms) {
  return atom_by_name(residue_atoms, 'C1\'')  ||
         atom_by_name(residue_atoms, 'CA')  ||
         residue_atoms[0];
}

function mutation_label(residue_atoms) {
  return '/' + residue_atoms[0].seqid + ' ' + residue_atoms[0].resname + '/' + residue_atoms[0].chain;
}

function plan_protein_mutation(residue_atoms, target) {
  const template_atoms = heavy_amino_template_atoms(target);
  const source_n = atom_by_name(residue_atoms, 'N');
  const source_ca = atom_by_name(residue_atoms, 'CA');
  const source_c = atom_by_name(residue_atoms, 'C');
  if (!source_n || !source_ca || !source_c) {
    throw Error('Mutation requires protein backbone atoms N, CA and C.');
  }

  const source_cb_atom = atom_by_name(residue_atoms, 'CB') ;
  const source_cb = source_cb_atom ? source_cb_atom.xyz : pseudo_cb_xyz(residue_atoms);
  const template_n = atom_by_name(template_atoms, 'N');
  const template_ca = atom_by_name(template_atoms, 'CA');
  const template_c = atom_by_name(template_atoms, 'C');
  const template_cb = atom_by_name(template_atoms, 'CB');
  if (!template_n || !template_ca || !template_c) {
    throw Error('Target template for ' + target + ' is incomplete.');
  }

  const remove_atoms = residue_atoms.filter((atom) => !PROTEIN_BACKBONE.has(atom.name));
  const add_atoms = [];
  let focus = source_ca.xyz;
  if (target !== 'GLY') {
    if (!template_cb) throw Error('Target template for ' + target + ' lacks CB.');
    const from = build_sidechain_frame(template_n.xyz, template_ca.xyz, template_c.xyz, template_cb.xyz);
    const to = build_sidechain_frame(source_n.xyz, source_ca.xyz, source_c.xyz, source_cb);
    for (const atom of template_atoms) {
      if (PROTEIN_BACKBONE.has(atom.name)) continue;
      const xyz = transform_point(atom.xyz, from, to);
      add_atoms.push({name: atom.name, element: atom.element, xyz: xyz});
      if (atom.name === 'CB') focus = xyz;
    }
  }

  const ref_atom = representative_atom(residue_atoms);
  return {
    source_resname: residue_atoms[0].resname,
    target_resname: target,
    label: mutation_label(residue_atoms),
    remove_atoms: remove_atoms,
    add_atoms: add_atoms,
    focus: focus,
    occupancy: ref_atom.occ,
    b_iso: ref_atom.b,
  };
}

function plan_nucleotide_mutation(residue_atoms, source_kind,
                                  target_label) {
  const target = nucleotide_target_resname(residue_atoms[0].resname, target_label);
  const template_atoms = heavy_nucleotide_template_atoms(target);
  const source_o4 = atom_by_name(residue_atoms, 'O4\'');
  const source_c1 = atom_by_name(residue_atoms, 'C1\'');
  const source_c2 = atom_by_name(residue_atoms, 'C2\'');
  const template_o4 = atom_by_name(template_atoms, 'O4\'');
  const template_c1 = atom_by_name(template_atoms, 'C1\'');
  const template_c2 = atom_by_name(template_atoms, 'C2\'');
  if (!source_o4 || !source_c1 || !source_c2) {
    throw Error('Base mutation requires sugar atoms O4\', C1\' and C2\'.');
  }
  if (!template_o4 || !template_c1 || !template_c2) {
    throw Error('Target template for ' + target + ' is incomplete.');
  }

  const from = build_anchor_frame(template_o4.xyz, template_c1.xyz, template_c2.xyz,
                                  'nucleotide sugar frame');
  const to = build_anchor_frame(source_o4.xyz, source_c1.xyz, source_c2.xyz,
                                'nucleotide sugar frame');
  const remove_atoms = residue_atoms.filter((atom) => !is_preserved_nucleotide_atom(atom.name));
  const add_atoms = [];
  const focus_name = base_atom_name(target);
  let focus = source_c1.xyz;
  for (const atom of template_atoms) {
    if (is_preserved_nucleotide_atom(atom.name)) continue;
    const xyz = transform_point(atom.xyz, from, to);
    add_atoms.push({name: atom.name, element: atom.element, xyz: xyz});
    if (normalize_atom_name(atom.name) === focus_name) focus = xyz;
  }

  const ref_atom = representative_atom(residue_atoms);
  return {
    source_resname: residue_atoms[0].resname,
    target_resname: target,
    label: mutation_label(residue_atoms),
    remove_atoms: remove_atoms,
    add_atoms: add_atoms,
    focus: focus,
    occupancy: ref_atom.occ,
    b_iso: ref_atom.b,
  };
}

function sugar_switch_resname(source) {
  const upper = source.toUpperCase();
  if (upper === 'A') return 'DA';
  if (upper === 'C') return 'DC';
  if (upper === 'G') return 'DG';
  if (upper === 'U') return 'DT';
  if (upper === 'DA') return 'A';
  if (upper === 'DC') return 'C';
  if (upper === 'DG') return 'G';
  if (upper === 'DT') return 'U';
  throw Error('No sugar switch mapping for ' + source + '.');
}

function plan_sugar_switch(residue_atoms, source_kind) {
  const source_resname = residue_atoms[0].resname;
  const target_resname = sugar_switch_resname(source_resname);

  const remove_atoms = [];
  const add_atoms = [];

  const source_c2 = atom_by_name(residue_atoms, "C2'");
  if (!source_c2) throw Error('Sugar switch requires C2\' atom.');
  let focus = source_c2.xyz;

  if (source_kind === 'rna') {
    // RNA → DNA: remove O2'
    const o2_atom = atom_by_name(residue_atoms, "O2'");
    if (o2_atom) remove_atoms.push(o2_atom);
  } else {
    // DNA → RNA: add O2' from RNA template
    const template_atoms = heavy_nucleotide_template_atoms(target_resname);
    const template_o2 = atom_by_name(template_atoms, "O2'");
    if (!template_o2) throw Error('RNA template for ' + target_resname + ' lacks O2\'.');

    const source_o4 = atom_by_name(residue_atoms, "O4'");
    const source_c1 = atom_by_name(residue_atoms, "C1'");
    const template_o4 = atom_by_name(template_atoms, "O4'");
    const template_c1 = atom_by_name(template_atoms, "C1'");
    const template_c2 = atom_by_name(template_atoms, "C2'");
    if (!source_o4 || !source_c1) {
      throw Error('Sugar switch requires O4\', C1\' and C2\' atoms.');
    }
    if (!template_o4 || !template_c1 || !template_c2) {
      throw Error('Template for ' + target_resname + ' is incomplete.');
    }

    const from = build_anchor_frame(template_o4.xyz, template_c1.xyz, template_c2.xyz,
                                    'nucleotide sugar frame');
    const to = build_anchor_frame(source_o4.xyz, source_c1.xyz, source_c2.xyz,
                                  'nucleotide sugar frame');
    const xyz = transform_point(template_o2.xyz, from, to);
    add_atoms.push({name: "O2'", element: 'O', xyz: xyz});
    focus = xyz;
  }

  const ref_atom = representative_atom(residue_atoms);
  return {
    source_resname: source_resname,
    target_resname: target_resname,
    label: mutation_label(residue_atoms),
    remove_atoms: remove_atoms,
    add_atoms: add_atoms,
    focus: focus,
    occupancy: ref_atom.occ,
    b_iso: ref_atom.b,
  };
}

function mutation_targets_for_residue(residue_atoms) {
  if (residue_atoms.length === 0) return [];
  const kind = residue_kind(residue_atoms[0].resname);
  if (kind === 'protein') return AMINO_ACID_MUTATION_TARGETS.slice();
  if (kind === 'rna') return [...RNA_BASE_TARGETS, SUGAR_TO_DNA];
  if (kind === 'dna') return [...DNA_BASE_TARGETS, SUGAR_TO_RNA];
  return [];
}

function plan_residue_mutation(residue_atoms, target_resname) {
  if (residue_atoms.length === 0) throw Error('Residue is empty.');
  if (residue_atoms.some((atom) => !atom.is_main_conformer())) {
    throw Error('Mutation of alternate conformers is not supported yet.');
  }
  const kind = residue_kind(residue_atoms[0].resname);
  if (kind === 'protein') {
    return plan_protein_mutation(residue_atoms, target_resname.toUpperCase());
  }
  if (kind === 'rna' || kind === 'dna') {
    if (target_resname === SUGAR_TO_DNA || target_resname === SUGAR_TO_RNA) {
      return plan_sugar_switch(residue_atoms, kind);
    }
    return plan_nucleotide_mutation(residue_atoms, kind, target_resname);
  }
  throw Error('Mutation is supported only for standard amino-acid and nucleic-acid residues.');
}

function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }






































































const ColorSchemes$1 = {
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


const INIT_HUD_TEXT = 'This is GemmiMol not Coot. ' +
  '<a href="#" onclick="V.toggle_help(); return false;">H shows help.</a>';

// options handled by select_next()

const COLOR_PROPS = ['element', 'B-factor', 'pLDDT', 'occupancy',
                     'index', 'chain', 'secondary structure'];
const RENDER_STYLES = ['sticks', 'lines', 'backbone', 'cartoon', 'cartoon+sticks',
                       'ribbon', 'ball&stick'];
const LIGAND_STYLES = ['ball&stick', 'sticks', 'lines'];
const WATER_STYLES = ['sphere', 'cross', 'invisible'];
const MAP_STYLES = ['marching cubes', 'squarish'/*, 'snapped MC'*/];
const LABEL_FONTS = ['bold 14px', '14px', '16px', 'bold 16px'];
function rainbow_value(v, vmin, vmax) {
  const c = new Color(0xe0e0e0);
  if (vmin < vmax) {
    const ratio = (v - vmin) / (vmax - vmin);
    const hue = (240 - (240 * ratio)) / 360;
    c.setHSL(hue, 1.0, 0.5);
  }
  return c;
}

function color_by(prop, atoms, elem_colors,
                  hue_shift) {
  let color_func;
  const last_atom = atoms[atoms.length-1];
  if (prop === 'index') {
    color_func = function (atom) {
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
    color_func = function (atom) {
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
    color_func = function (atom) {
      let i = 0;
      while (i < 3 && atom.b < steps[i]) {
        ++i;
      }
      return colors[i];
    };
  } else if (prop === 'occupancy') {
    color_func = function (atom) {
      return rainbow_value(atom.occ, 0, 1);
    };
  } else if (prop === 'chain') {
    color_func = function (atom) {
      return rainbow_value(atom.chain_index, 0, last_atom.chain_index);
    };
  } else if (prop === 'secondary structure') {
    const ss_colors = {
      Helix: new Color(0xD64A4A),
      Strand: new Color(0xD4A62A),
      Coil: new Color(0x70A5C8),
    };
    color_func = function (atom) {
      return ss_colors[atom.ss] || ss_colors.Coil;
    };
  } else { // element
    if (hue_shift === 0) {
      color_func = function (atom) {
        return elem_colors[atom.element] || elem_colors.def;
      };
    } else {
      const c_hsl = { h: 0, s: 0, l: 0 };
      elem_colors['C'].getHSL(c_hsl);
      const c_col = new Color(0, 0, 0);
      c_col.setHSL(c_hsl.h + hue_shift, c_hsl.s, c_hsl.l);
      color_func = function (atom) {
        const el = atom.element;
        return el === 'C' ? c_col : (elem_colors[el] || elem_colors.def);
      };
    }
  }
  return atoms.map(color_func);
}

function scale_by_height(value, size) { // for scaling bond_line
  return value * size[1] / 700;
}

function tokenize_cif_row(line) {
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

function monomer_cif_names(text) {
  const names = new Set();
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

function is_standalone_monomer_cif(text) {
  return text.indexOf('_atom_site.') === -1 && monomer_cif_names(text).length !== 0;
}

function download_filename(name, format) {
  const base = ((name || '').trim().replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')) || 'model';
  return base + (format === 'pdb' ? '.pdb' : '.cif');
}

class MapBag {
  
  
  
  
  
  
  
  

  constructor(map, config, is_diff_map) {
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
  
  
  
  
  
  
  
  
  
  
  
  

  constructor(model, config, win_size) {
    this.model = model;
    this.label = '(model #' + ++ModelBag.ctor_counter + ')';
    this.visible = true;
    this.hue_shift = 0;
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

  add_bonds(polymers, ligands, ball_size) {
    const visible_atoms = this.get_visible_atoms();
    const colors = color_by(this.conf.color_prop, visible_atoms,
                            this.conf.colors, this.hue_shift);
    const vertex_arr = [];
    const color_arr = [];
    const bond_type_arr = [];
    const metal_vertex_arr = [];
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
      // wheels (discs) as round caps
      this.objects.push(makeWheels(sphere_arr, sphere_color_arr, linewidth));
    }
    if (water_sphere_arr.length !== 0) {
      this.objects.push(makeBalls(water_sphere_arr, water_sphere_color_arr,
                                  this.conf.ball_size));
    }

    sphere_arr.forEach(function (v) { this.atom_array.push(v); }, this);
    water_sphere_arr.forEach(function (v) { this.atom_array.push(v); }, this);
  }

  add_sticks(polymers, ligands, radius,
             atom_filter) {
    const visible_atoms = this.get_visible_atoms();
    const colors = color_by(this.conf.color_prop, visible_atoms,
                            this.conf.colors, this.hue_shift);
    const vertex_arr = [];
    const color_arr = [];
    const bond_type_arr = [];
    const metal_vertex_arr = [];
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

  bond_normal(atom, other) {
    const first = atom.i_seq < other.i_seq ? atom : other;
    const second = atom.i_seq < other.i_seq ? other : atom;
    const dir = [
      second.xyz[0] - first.xyz[0],
      second.xyz[1] - first.xyz[1],
      second.xyz[2] - first.xyz[2],
    ];
    const ref = (Math.abs(dir[2]) < Math.abs(dir[1])) ? [0, 0, 1] : [0, 1, 0];
    let normal = [
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

  bond_half_end(atom, other, radius) {
    const dir = [
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

  add_offset_stick(vertex_arr, color_arr, bond_type_arr,
                   atom, other, color, bond_type,
                   offset_scale, radius) {
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

  extend_stick_segment(start, end, radius) {
    const dir = [
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    ];
    const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if (len < 1e-6) return [start, end];
    const overlap = Math.min(radius * 0.35, len * 0.12);
    const unit = [dir[0] / len, dir[1] / len, dir[2] / len];
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
    const colors = color_by(this.conf.color_prop, visible_atoms,
                            this.conf.colors, this.hue_shift);
    const vertex_arr = [];
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

  add_ribbon(smoothness) {
    const segments = this.model.extract_trace();
    const res_map = this.model.get_residues();
    const visible_atoms = [].concat.apply([], segments);
    const colors = color_by(this.conf.color_prop, visible_atoms,
                            this.conf.colors, this.hue_shift);
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

  add_cartoon(smoothness) {
    const segments = this.model.extract_trace();
    const res_map = this.model.get_residues();
    const visible_atoms = [].concat.apply([], segments);
    const colors = color_by(this.conf.color_prop, visible_atoms,
                            this.conf.colors, this.hue_shift);
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
function touch_info(evt) {
  const touches = evt.touches;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return {pageX: (touches[0].pageX + touches[1].pageX) / 2,
          pageY: (touches[0].pageY + touches[1].pageY) / 2,
          dist: Math.sqrt(dx * dx + dy * dy)};
}

// makes sense only for full-window viewer
function parse_url_fragment() {
  const ret  = {};
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


class Viewer {
  
  
  





  
  //nav: object | null;
  
  
  
  
  

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  constructor(options) {
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
      render_style: RENDER_STYLES[0],
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
               typeof (globalThis ).Gemmi === 'function') {
      this.gemmi_factory = (globalThis ).Gemmi;
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
      this.camera = new OrthographicCamera() ;
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
    this.container = get_elem('viewer');
    this.help_el = get_elem('help');
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
    if (this.hud_el) {
      if (this.hud_el.innerHTML === '') this.hud_el.innerHTML = INIT_HUD_TEXT;
      this.initial_hud_html = this.hud_el.innerHTML;
    }

    try {
      this.renderer = new WebGLRenderer({antialias: true});
    } catch (e2) {
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
    if (options.focusable) {
      el.tabIndex = 0;
    }
    this.create_metals_menu();
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

    this.mousemove = function (event) {
      event.preventDefault();
      //event.stopPropagation();
      self.controls.move(self.relX(event), self.relY(event));
    };

    this.mouseup = function (event) {
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
    const el = document.createElement('div');
    el.style.display = 'none';
    el.style.fontSize = '18px';
    el.style.color = '#ddd';
    el.style.backgroundColor = 'rgba(0,0,0,0.6)';
    el.style.position = 'absolute';
    el.style.top = '10px';
    el.style.right = '10px';
    el.style.padding = '3px 10px';
    el.style.borderRadius = '5px';
    el.style.letterSpacing = '0.08em';
    el.style.fontWeight = 'bold';
    el.style.pointerEvents = 'none';
    this.container.appendChild(el);
    this.structure_name_el = el;
  }

  set_structure_name(name) {
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

  pick_atom(coords, camera) {
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
  relX(evt) {
    return 2 * (evt.pageX - this.window_offset[0]) / this.window_size[0] - 1;
  }

  relY(evt) {
    return 1 - 2 * (evt.pageY - this.window_offset[1]) / this.window_size[1];
  }

  hud(text, type) {
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
    } else {
      console.log('hud:', text);
    }
  }

  redraw_center(force) {
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

  redraw_maps(force) {
    this.redraw_center(force);
    const r = this.config.map_radius;
    for (const map_bag of this.map_bags) {
      if (force || this.target.distanceToSquared(map_bag.block_ctr) > r/100) {
        this.redraw_map(map_bag);
      }
    }
  }

  remove_and_dispose(obj) {
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

  clear_el_objects(map_bag) {
    for (const o of map_bag.el_objects) {
      this.remove_and_dispose(o);
    }
    map_bag.el_objects = [];
  }

  clear_model_objects(model_bag) {
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

  blob_source_map_bag(negate, prefer_diff=false) {
    const find_bag = (predicate) =>
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
    const centers = this.blob_hits.map((hit) => ({xyz: this.blob_target_xyz(hit)} ));
    const colors = centers.map(() => marker_color);
    const wheel_size = 3 * scale_by_height(this.config.bond_line, this.window_size);
    const wheels = makeWheels(centers, colors, wheel_size);
    this.blob_objects.push(wheels);
    this.scene.add(wheels);

    const vertex_arr = [];
    const color_arr = [];
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

  make_objects_translucent(objects) {
    for (const obj of objects) {
      const o = obj ;
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

  set_material_opacity(material, opacity) {
    material.transparent = true;
    if (material.fragmentShader) {
      material.fragmentShader = material.fragmentShader.replace(
        /gl_FragColor\s*=\s*vec4\(([^,]+),\s*1\.0\)/g,
        'gl_FragColor = vec4($1, ' + opacity.toFixed(1) + ')'
      );
      material.needsUpdate = true;
    }
  }

  set_model_objects(model_bag) {
    model_bag.objects = [];
    model_bag.atom_array = [];
    let ligand_balls = null;
    const ligand_sticks = (model_bag.conf.ligand_style === 'sticks');
    if (model_bag.conf.ligand_style === 'ball&stick' && this.has_frag_depth()) {
      ligand_balls = this.config.ball_size;
    }
    switch (model_bag.conf.render_style) {
      case 'lines':
        if (ligand_balls === null && !ligand_sticks) {
          model_bag.add_bonds(true, true);
        } else if (ligand_sticks) {
          model_bag.add_bonds(true, false);
          model_bag.add_sticks(false, true, this.config.stick_radius);
        } else {
          model_bag.add_bonds(true, false);
          model_bag.add_bonds(false, true, ligand_balls);
        }
        break;
      case 'sticks':
        if (!this.has_frag_depth()) {
          this.hud('Stick rendering is not working in this browser' +
                   '\ndue to lack of suppport for EXT_frag_depth', 'ERR');
          return;
        }
        model_bag.add_sticks(true, true, this.config.stick_radius);
        break;
      case 'ball&stick':
        if (!this.has_frag_depth()) {
          this.hud('Ball-and-stick rendering is not working in this browser' +
                   '\ndue to lack of suppport for EXT_frag_depth', 'ERR');
          return;
        }
        if (ligand_balls === null) {
          model_bag.add_bonds(true, false, this.config.ball_size);
          model_bag.add_bonds(false, true);
        } else {
          model_bag.add_bonds(true, true, this.config.ball_size);
        }
        break;
      case 'backbone':
        model_bag.add_trace();
        if (ligand_sticks) {
          model_bag.add_sticks(false, true, this.config.stick_radius);
        } else {
          model_bag.add_bonds(false, true, ligand_balls);
        }
        break;
      case 'ribbon':
        model_bag.add_ribbon(8);
        if (ligand_sticks) {
          model_bag.add_sticks(false, true, this.config.stick_radius);
        } else {
          model_bag.add_bonds(false, true, ligand_balls);
        }
        break;
      case 'cartoon':
        model_bag.add_cartoon(8);
        if (ligand_sticks) {
          model_bag.add_sticks(false, true, this.config.stick_radius);
        } else {
          model_bag.add_bonds(false, true, ligand_balls);
        }
        break;
      case 'cartoon+sticks':
        model_bag.add_cartoon(8);
        model_bag.add_sticks(true, false, this.config.stick_radius,
                             (atom) => !atom.is_backbone());
        if (ligand_sticks) {
          model_bag.add_sticks(false, true, this.config.stick_radius);
        } else {
          model_bag.add_bonds(false, true, ligand_balls);
        }
        model_bag.atom_array = model_bag.get_visible_atoms();
        break;
    }
    for (const o of model_bag.objects) {
      this.scene.add(o);
    }
  }

  // Add/remove label if `show` is specified, toggle otherwise.
  toggle_label(pick, show) {
    if (pick.atom == null) return;
    const symop = pick.bag && pick.bag.symop ? ' ' + pick.bag.symop : '';
    const text = pick.atom.short_label() + symop;
    const uid = text; // we assume that the labels inside one model are unique
    const is_shown = (uid in this.labels);
    if (show === undefined) show = !is_shown;
    if (show) {
      if (is_shown) return;
      const atom_style = pick.atom.is_ligand ? 'ligand_style' : 'render_style';
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

  toggle_map_visibility(map_bag) {
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

  redraw_map(map_bag) {
    this.clear_el_objects(map_bag);
    if (map_bag.visible) {
      map_bag.map.block.clear();
      this.add_el_objects(map_bag);
    }
  }

  toggle_model_visibility(model_bag, visible) {
    model_bag = model_bag || this.selected.bag;
    if (model_bag == null) return;
    model_bag.visible = visible == null ? !model_bag.visible : visible;
    this.redraw_model(model_bag);
    this.request_render();
  }

  redraw_model(model_bag) {
    this.clear_model_objects(model_bag);
    if (model_bag.visible) {
      this.set_model_objects(model_bag);
    }
  }

  redraw_models() {
    for (const model_bag of this.model_bags) {
      this.redraw_model(model_bag);
    }
  }

  add_el_objects(map_bag) {
    if (!map_bag.visible || this.config.map_radius <= 0) return;
    if (map_bag.map.block.empty()) {
      const t = this.target;
      map_bag.block_ctr.copy(t);
      map_bag.map.prepare_isosurface(this.config.map_radius, [t.x, t.y, t.z]);
    }
    for (const mtype of map_bag.types) {
      const isolevel = (mtype === 'map_neg' ? -1 : 1) * map_bag.isolevel;
      const iso = map_bag.map.isomesh_in_block(isolevel, this.config.map_style);
      if (iso == null) continue;
      const obj = makeChickenWire(iso, {
        color: this.config.colors[mtype],
        linewidth: this.config.map_line,
      });
      map_bag.el_objects.push(obj);
      this.scene.add(obj);
    }
  }

  change_isolevel_by(map_idx, delta) {
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
  }

  change_map_radius(delta) {
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

  change_slab_width_by(delta) {
    const slab_width = this.controls.slab_width;
    slab_width[0] = Math.max(slab_width[0] + delta, 0.01);
    slab_width[1] = Math.max(slab_width[1] + delta, 0.01);
    this.update_camera();
    const final_width = this.camera.far - this.camera.near;
    this.hud('clip width: ' + final_width.toPrecision(3));
  }

  change_zoom_by_factor(mult) {
    this.camera.zoom *= mult;
    this.update_camera();
    this.hud('zoom: ' + this.camera.zoom.toPrecision(3));
  }

  change_bond_line(delta) {
    this.config.bond_line = Math.max(this.config.bond_line + delta, 0.1);
    this.redraw_models();
    this.hud('bond width: ' + scale_by_height(this.config.bond_line,
                                              this.window_size).toFixed(1));
  }

  change_stick_radius(delta) {
    this.config.stick_radius = Math.max(this.config.stick_radius + delta, 0.01);
    this.config.stick_radius =
      Math.round(this.config.stick_radius * 1000) / 1000;
    this.redraw_models();
    this.hud('stick radius: ' + this.config.stick_radius.toFixed(3));
  }

  change_map_line(delta) {
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

  shift_clip(delta) {
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
    const pos = [this.target.x, this.target.y, this.target.z];
    const radius = this.config.map_radius;
    const images = gemmi.get_nearby_sym_ops(structure, pos, radius);
    if (images.size() === 0) {
      this.hud('No symmetry mates within map radius ' + radius +
               '\u00C5 (use [ and ] to change the map radius)');
      images.delete();
      return;
    }
    const n = images.size();
    const shown_symops = [];
    for (let i = 0; i < n; i++) {
      const image = images.get(i);
      const sym_st = gemmi.get_sym_image(structure, image);
      const model = modelFromGemmiStructure(gemmi, sym_st, bag.model.bond_data);
      sym_st.delete();
      const sym_bag = new ModelBag(model, this.config, this.window_size);
      sym_bag.hue_shift = 0;
      sym_bag.symop = image.symmetry_code(true);
      shown_symops.push(sym_bag.symop);
      sym_bag.visible = true;
      this.model_bags.push(sym_bag);
      this.set_model_objects(sym_bag);
      this.make_objects_translucent(sym_bag.objects);
      this.sym_model_bags.push(sym_bag);
      // draw cross-symmetry bonds (e.g. metal coordination) from struct_conn
      if (gemmi.CrossSymBonds) {
        const csb = new gemmi.CrossSymBonds();
        csb.find(structure, image);
        const csb_len = csb.bond_data_size();
        if (csb_len > 0) {
          const csb_ptr = csb.bond_data_ptr();
          const csb_data = new Int32Array(gemmi.HEAPU8.buffer, csb_ptr, csb_len).slice();
          const vertex_arr = [];
          const color_arr = [];
          const stick_radius = Math.max(this.config.stick_radius,
                                        this.config.ball_size * 0.5);
          for (let j = 0; j < csb_data.length; j += 3) {
            const a1 = bag.model.atoms[csb_data[j]];
            const a2 = model.atoms[csb_data[j+1]];
            if (!a1 || !a2) continue;
            const c1 = color_by(bag.conf.color_prop, [a1], bag.conf.colors, bag.hue_shift);
            const c2 = color_by(sym_bag.conf.color_prop, [a2], sym_bag.conf.colors, sym_bag.hue_shift);
            const mid = [
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
    input.addEventListener('keydown', (evt) => {
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
    select.addEventListener('keydown', (evt) => {
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
    select.addEventListener('keydown', (evt) => {
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
    select.addEventListener('keydown', (evt) => {
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
    select.addEventListener('keydown', (evt) => {
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
    select.addEventListener('keydown', (evt) => {
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
    select.addEventListener('keydown', (evt) => {
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
    select.addEventListener('keydown', (evt) => {
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
      const scope = select.value ;
      if (scope === 'atom' || scope === 'residue' || scope === 'chain') {
        this.delete_selected(scope);
      } else if (scope === 'trim_ala') {
        this.trim_selected_to_alanine();
      }
      select.value = '';
    });
    select.addEventListener('keydown', (evt) => {
      evt.stopPropagation();
    });
    return select;
  }

  create_mutate_select() {
    const select = document.createElement('select');
    select.style.padding = '3px 6px';
    select.style.borderRadius = '4px';
    select.style.border = '1px solid #666';
    select.style.backgroundColor = 'rgba(0, 28, 56, 0.9)';
    select.style.color = '#d6e8ff';
    select.style.fontSize = '13px';
    select.style.display = 'none';
    const header = document.createElement('option');
    header.textContent = 'Mutate';
    header.value = '';
    header.selected = true;
    select.appendChild(header);
    select.addEventListener('change', () => {
      if (select.value !== '') this.mutate_selected_residue(select.value);
      select.value = '';
    });
    select.addEventListener('keydown', (evt) => {
      evt.stopPropagation();
    });
    return select;
  }

  active_model_bag(preferred) {
    if (preferred != null) return preferred;
    if (this.selected.bag != null && this.model_bags.indexOf(this.selected.bag) !== -1) {
      return this.selected.bag;
    }
    return this.model_bags[0] || null;
  }

  create_metals_menu() {
    if (typeof document === 'undefined' || this.container == null) return;
    const overlay = _optionalChain([this, 'access', _ => _.hud_el, 'optionalAccess', _2 => _2.parentElement]);
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
  }

  update_blob_select(select) {
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

  update_place_select(select) {
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

  update_empty_blobs_select(select) {
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

  collect_nav_items(bag, filter) {
    const seen = new Set();
    const items = [];
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

  update_nav_select(select, label,
                    bag,
                    items) {
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

  find_connection_residue_atoms(bag, chain, seqid) {
    return bag.model.get_residues()[seqid + '/' + chain] || [];
  }

  find_connection_atom(residue_atoms, atom_name, altloc) {
    let fallback = null;
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

  collect_site_nav_items(bag) {
    const ctx = bag.gemmi_selection;
    if (ctx == null || bag.symop !== '') return [];
    const sites = ctx.structure.sites;
    if (sites == null) return [];
    const items = [];
    try {
      for (let i = 0; i < sites.size(); i++) {
        const site = sites.get(i);
        if (site == null) continue;
        try {
          const atom_indices = [];
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

  collect_connection_nav_items(bag) {
    const ctx = bag.gemmi_selection;
    if (ctx == null || bag.symop !== '') return [];
    const connections = ctx.structure.connections;
    if (connections == null) return [];
    const items = [];
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
          const partner_data





 = [];
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
          const atom_indices = [];
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

  update_site_select(select, bag,
                     items) {
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

  update_connection_select(select, bag,
                           items) {
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

  focus_site_item(bag, item) {
    if (item.atom_indices.length === 0) return;
    let x = 0, y = 0, z = 0;
    let count = 0;
    let anchor = null;
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

  focus_connection_item(bag, item) {
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

  update_download_select(select,
                         bag) {
    if (select == null) return;
    const ctx = this.download_target_context(bag);
    select.disabled = (ctx == null);
    select.style.display = (ctx == null) ? 'none' : '';
    select.value = '';
  }

  update_delete_select(select) {
    if (select == null) return;
    const editable_bag = this.editable_model_bag();
    const edit = this.current_edit_target();
    select.disabled = (edit == null);
    select.style.display = (editable_bag == null) ? 'none' : '';
    select.value = '';
  }

  update_mutate_select(select) {
    if (select == null) return;
    const editable_bag = this.editable_model_bag();
    const edit = this.current_edit_target();
    select.innerHTML = '';
    const header = document.createElement('option');
    let targets = [];
    if (edit != null) {
      const residue_atoms = edit.bag.model.get_residues()[edit.atom.resid()] || [edit.atom];
      targets = mutation_targets_for_residue(residue_atoms);
    }
    header.textContent = targets.length === 0 ? 'Mutate' : 'Mutate';
    header.value = '';
    header.selected = true;
    select.appendChild(header);
    for (const target of targets) {
      const opt = document.createElement('option');
      opt.textContent = target;
      opt.value = target;
      select.appendChild(opt);
    }
    select.disabled = (edit == null || targets.length === 0);
    select.style.display = (editable_bag == null) ? 'none' : '';
    select.value = '';
  }

  unresolved_monomer_message() {
    const unresolved = this.last_bonding_info ? this.last_bonding_info.unresolved_monomers : [];
    if (unresolved == null || unresolved.length === 0) return null;
    let msg = 'Missing monomer dictionar' + (unresolved.length === 1 ? 'y' : 'ies') +
      ': ' + unresolved.join(', ') + '.';
    msg += ' Drop companion CIF to show ligand bonds.';
    return msg;
  }

  drop_complete_message(names) {
    let msg = 'loaded ' + names.join(', ');
    const warning = this.unresolved_monomer_message();
    if (warning != null) msg += '. ' + warning;
    return msg;
  }

  show_blobs(negate, prefer_diff=false,
             search_sigma, mask_waters=false) {
    const map_bag = this.blob_source_map_bag(negate, prefer_diff);
    if (map_bag == null) {
      this.hud('No suitable map is loaded for blob search.', 'ERR');
      return;
    }
    const ctx = this.blob_search_context();
    const sigma = _nullishCoalesce(search_sigma, () => ( map_bag.isolevel));
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

  hide_blobs(quiet=false) {
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

  focus_blob(index) {
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

  blob_target_xyz(hit) {
    if (!this.blob_negate && this.blob_map_bag != null && this.blob_map_bag.is_diff_map) {
      return hit.peak_pos;
    }
    return hit.centroid;
  }

  choose_build_chain_name(ctx) {
    const gm = ctx.structure.at(ctx.model_index);
    const used = new Set();
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

  ensure_build_chain(bag, ctx) {
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

  next_build_seqid(chain) {
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

  refresh_model_from_structure(bag, center) {
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

  refresh_model_from_structure_with_bonds(bag, center) {
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

  place_selected_blob(kind) {
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
    let placed_label;
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

  download_target_context(preferred_bag) {
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
    const target = [this.target.x, this.target.y, this.target.z] ;
    let best = null;
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

  download_model(format) {
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

  deletion_scope(scope,
                 bag, atom) {
    let atoms;
    let label;
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
      center: atoms.length === 0 ? atom.xyz : [x / atoms.length, y / atoms.length, z / atoms.length] ,
    };
  }

  deletion_cid(scope,
               ctx, atom) {
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

  remove_from_structure_by_cid(ctx, cid) {
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

  find_gemmi_residue(ctx, atom) {
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

  should_keep_atom_for_alanine(atom) {
    return [
      'N', 'CA', 'C', 'O', 'OXT', 'OT1', 'OT2', 'CB',
      'H', 'H1', 'H2', 'H3', 'HA', 'HA2', 'HA3',
      'HB', 'HB1', 'HB2', 'HB3', '1HB', '2HB', '3HB',
      'D', 'D1', 'D2', 'D3', 'DA', 'DA2', 'DA3',
      'DB', 'DB1', 'DB2', 'DB3', '1DB', '2DB', '3DB',
    ].indexOf(atom.name) !== -1;
  }

  trim_scope_to_alanine(bag, atom) {
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
      center: [x / residue_atoms.length, y / residue_atoms.length, z / residue_atoms.length] ,
    };
  }

  clear_labels_for_bag(bag) {
    for (const uid in this.labels) {
      if (this.labels[uid].bag !== bag) continue;
      this.remove_and_dispose(this.labels[uid].o.mesh);
      delete this.labels[uid];
    }
  }

  apply_deletion_result(bag, center) {
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

  delete_selected(scope) {
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

  mutate_selected_residue(target_resname) {
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

  update_help() {
    const el = this.help_el;
    if (!el) return;
    el.innerHTML = [this.MOUSE_HELP, this.KEYBOARD_HELP,
                    this.ABOUT_HELP, this.fps_text].join('\n\n');
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

  select_next(info, key, options, back) {
    const old_idx = options.indexOf(this.config[key]);
    const len = options.length;
    const new_idx = (old_idx + (back ? len - 1 : 1)) % len;
    this.config[key] = options[new_idx];
    let html = info + ':';
    for (let i = 0; i < len; i++) {
      const tag = (i === new_idx ? 'u' : 's');
      html += ' <' + tag + '>' + options[i] + '</' + tag + '>';
    }
    this.hud(html, 'HTML');
  }

  keydown(evt) {
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
    kb[66] = function ( evt) {
      const schemes = Object.keys(this.ColorSchemes);
      this.select_next('color scheme', 'color_scheme', schemes, evt.shiftKey);
      this.set_colors();
    };
    // c
    kb[67] = function ( evt) {
      this.select_next('coloring by', 'color_prop', COLOR_PROPS, evt.shiftKey);
      this.redraw_models();
    };
    // e
    kb[69] = function () {
      const fog = this.scene.fog;
      const has_fog = (fog.far === 1);
      fog.far = (has_fog ? 1e9 : 1);
      this.hud((has_fog ? 'dis': 'en') + 'able fog');
      this.redraw_all();
    };
    // h
    kb[72] = this.toggle_help;
    // i
    kb[73] = function ( evt) {
      this.hud('toggled spinning');
      this.controls.toggle_auto(evt.shiftKey);
    };
    // k
    kb[75] = function () {
      this.hud('toggled rocking');
      this.controls.toggle_auto(0.0);
    };
    // m
    kb[77] = function ( evt) {
      this.change_zoom_by_factor(evt.shiftKey ? 1.2 : 1.03);
    };
    // n
    kb[78] = function ( evt) {
      this.change_zoom_by_factor(1 / (evt.shiftKey ? 1.2 : 1.03));
    };
    // q
    kb[81] = function ( evt) {
      this.select_next('label font', 'label_font', LABEL_FONTS, evt.shiftKey);
      this.redraw_labels();
    };
    // r
    kb[82] = function ( evt) {
      if (evt.shiftKey) {
        this.hud('redraw!');
        this.redraw_all();
      } else {
        this.hud('recentered');
        this.recenter();
      }
    };
    // w
    kb[87] = function ( evt) {
      this.select_next('map style', 'map_style', MAP_STYLES, evt.shiftKey);
      this.redraw_maps(true);
    };
    // add, equals/firefox, equal sign
    kb[107] = kb[61] = kb[187] = function ( evt) {
      this.change_isolevel_by(evt.shiftKey ? 1 : 0, 0.1);
    };
    // subtract, minus/firefox, dash
    kb[109] = kb[173] = kb[189] = function ( evt) {
      this.change_isolevel_by(evt.shiftKey ? 1 : 0, -0.1);
    };
    // [
    kb[219] = function () { this.change_map_radius(-2); };
    // ]
    kb[221] = function () { this.change_map_radius(2); };
    // shift, ctrl, alt, altgr
    kb[16] = kb[17] = kb[18] = kb[225] = function () {};
    // slash, single quote
    kb[191] = kb[222] = false;  // -> preventDefault()

    this.key_bindings = kb;
  }

  set_real_space_key_bindings() {
    const kb = this.key_bindings;
    // Home
    kb[36] = function ( evt) {
      if (evt.shiftKey) {
        this.change_map_line(0.1);
      } else {
        this.change_stick_radius(0.01);
      }
    };
    // End
    kb[35] = function ( evt) {
      if (evt.shiftKey) {
        this.change_map_line(-0.1);
      } else {
        this.change_stick_radius(-0.01);
      }
    };
    // Space
    kb[32] = function ( evt) {
      this.center_next_residue(evt.shiftKey);
    };
    // d
    kb[68] = function () {
      this.change_slab_width_by(-0.1);
    };
    // f
    kb[70] = function ( evt) {
      if (evt.shiftKey) {
        this.toggle_full_screen();
      } else {
        this.change_slab_width_by(0.1);
      }
    };
    // l
    kb[76] = function ( evt) {
      this.select_next('ligands as', 'ligand_style', LIGAND_STYLES, evt.shiftKey);
      this.redraw_models();
    };
    // p
    kb[80] = function ( evt) {
      if (evt.shiftKey) {
        this.permalink();
      } else {
        this.go_to_nearest_Ca();
      }
    };
    // s
    kb[83] = function ( evt) {
      this.select_next('rendering as', 'render_style', RENDER_STYLES, evt.shiftKey);
      this.redraw_models();
    };
    // t
    kb[84] = function ( evt) {
      this.select_next('waters as', 'water_style', WATER_STYLES, evt.shiftKey);
      this.redraw_models();
    };
    // u
    kb[85] = function () {
      this.hud('toggled unit cell box');
      this.toggle_cell_box();
    };
    // v
    kb[86] = function () {
      this.toggle_inactive_models();
    };
    // y
    kb[89] = function () {
      this.config.hydrogens = !this.config.hydrogens;
      const n_h = this.current_model_hydrogen_count();
      this.hud((this.config.hydrogens ? 'show' : 'hide') +
               ' hydrogens (' + n_h + ' H/D atom' + (n_h === 1 ? '' : 's') +
               ' in model)');
      this.redraw_models();
    };
    // backslash
    kb[220] = function () {
      this.toggle_symmetry();
    };
    // comma
    kb[188] = function ( evt) {
      if (evt.shiftKey) this.shift_clip(1);
    };
    // period
    kb[190] = function ( evt) {
      if (evt.shiftKey) this.shift_clip(-1);
    };
  }

  mousedown(event) {
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

  dblclick(event) {
    if (event.button !== 0) return;
    if (this.decor.selection) {
      this.remove_and_dispose(this.decor.selection);
      this.decor.selection = null;
    }
    const mouse = [this.relX(event), this.relY(event)];
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

  touchstart(event) {
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

  touchmove(event) {
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

  wheel(evt) {
    evt.preventDefault();
    evt.stopPropagation();
    this.mousewheel_action(evt.deltaY, evt);
    this.request_render();
  }

  // overrided in ReciprocalViewer
  mousewheel_action(delta, evt) {
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
  recenter(xyz, cam, steps) {
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

  center_next_residue(back) {
    const bag = this.selected.bag;
    if (bag == null) return;
    const atom = bag.model.next_residue(this.selected.atom, back);
    if (atom != null) {
      this.select_atom({bag, atom}, {steps: 30});
    }
  }

  select_atom(pick, options={}) {
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

  select_residue(bag, atom, options={}) {
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

  selection_atom_indices(cid, model_bag) {
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

  selection_atoms(cid, model_bag) {
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

  selection_anchor(bag, atoms) {
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

  center_on_selection(cid, options={}) {
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

  select_by_cid(cid, options={}) {
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
    if (!this.controls.is_going()) {
      this.redraw_maps();
      if (tied && !tied.scheduled) tied.redraw_maps();
    }
    this.renderer.render(this.scene, this.camera);
    if (tied && !tied.scheduled) tied.renderer.render(tied.scene, tied.camera);
    //if (this.nav) {
    //  this.nav.renderer.render(this.nav.scene, this.camera);
    //}
    this.scheduled = false;
    if (this.controls.is_moving()) {
      this.request_render();
    }
  }

  request_render() {
    if (typeof window !== 'undefined' && !this.scheduled) {
      this.scheduled = true;
      window.requestAnimationFrame(this.render.bind(this));
    }
  }

  add_model(model, options={}) {
    const model_bag = new ModelBag(model, this.config, this.window_size);
    model_bag.hue_shift = options.hue_shift || 0.06 * this.model_bags.length;
    model_bag.gemmi_selection = options.gemmi_selection || null;
    this.model_bags.push(model_bag);
    this.set_model_objects(model_bag);
    this.update_nav_menus();
    this.request_render();
  }

  add_map(map, is_diff_map) {
    const map_bag = new MapBag(map, this.config, is_diff_map);
    this.map_bags.push(map_bag);
    this.add_el_objects(map_bag);
    this.update_nav_menus();
    this.request_render();
  }

  load_file(url, options,
            callback,
            error_callback ) {
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
      req.addEventListener('progress', function (evt) {
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

  set_dropzone(zone, callback) {
    const self = this;
    zone.addEventListener('dragstart', function (e) {
      e.preventDefault();
    });
    zone.addEventListener('dragover', function (e) {
      e.stopPropagation();
      e.preventDefault();
      if (e.dataTransfer != null) e.dataTransfer.dropEffect = 'copy';
      self.hud('ready for file drop...');
    });
    zone.addEventListener('drop', function (e) {
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
  pick_pdb_and_map(file) {
    const self = this;
    const reader = new FileReader();
    if (/\.(pdb|ent|cif|mmcif|mcif|mmjson)$/i.test(file.name)) {
      return new Promise(function (resolve, reject) {
        reader.onloadend = function (evt) {
          if (evt.target == null || evt.target.readyState != 2) return;
          const buffer = evt.target.result ;
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
      return new Promise(function (resolve, reject) {
        reader.onloadend = function (evt) {
          if (evt.target == null || evt.target.readyState != 2) return;
          const after_load = (map_format === 'ccp4') ?
            self.resolve_gemmi().then(function (gemmi) {
              if (gemmi == null) throw Error('Gemmi is required for CCP4 map loading.');
              self.load_map_from_buffer(evt.target.result ,
                                        {format: map_format}, gemmi);
            }) :
            Promise.resolve().then(function () {
              self.load_map_from_buffer(evt.target.result ,
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

  set_view(options) {
    const frag = parse_url_fragment();
    if (frag.zoom) this.camera.zoom = frag.zoom;
    this.recenter(frag.xyz || (options && options.center), frag.eye, 1);
  }

  cache_monomer_cif_text(text) {
    const names = monomer_cif_names(text);
    for (const name of names) {
      this.monomer_cif_cache[name] = Promise.resolve(text);
    }
    return names;
  }

  refresh_bonding_for_cached_monomers(names) {
    if (names.length === 0) return Promise.resolve(0);
    const wanted = new Set(names.map((name) => name.toUpperCase()));
    const groups = new Map();
    for (const bag of this.model_bags) {
      const ctx = bag.gemmi_selection;
      if (bag.symop !== '' || ctx == null) continue;
      const group = groups.get(ctx.structure);
      if (group) group.bags.push(bag);
      else groups.set(ctx.structure, {gemmi: ctx.gemmi, bags: [bag]});
    }
    const refresh_groups = Array.from(groups.values()).filter((group) => {
      const missing = group.gemmi.get_missing_monomer_names(group.bags[0].gemmi_selection.structure)
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
      const ctx = group.bags[0].gemmi_selection;
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

  fetch_monomer_cif(resname) {
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

  fetch_monomer_cifs(resnames) {
    const unique = Array.from(new Set(resnames.filter(Boolean))).sort();
    return Promise.all(unique.map(this.fetch_monomer_cif, this)).then(function (cif_texts) {
      return cif_texts.filter(function (v) { return v != null; });
    });
  }

  resolve_gemmi(explicit_module) {
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

  load_coordinate_buffer(buffer, name, explicit_gemmi) {
    const self = this;
    return this.resolve_gemmi(explicit_gemmi).then(function (gemmi) {
      if (!gemmi) throw Error('Gemmi is required for coordinate loading.');
      return self.load_structure_from_buffer(gemmi, buffer, name);
    });
  }

  // Load molecular model from PDB file and centers the view
  load_pdb_from_text(text, name='model.pdb', explicit_gemmi) {
    const self = this;
    return this.resolve_gemmi(explicit_gemmi).then(function (gemmi) {
      if (!gemmi) throw Error('Gemmi is required for coordinate loading.');
      const buffer = new TextEncoder().encode(text).buffer;
      return self.load_structure_from_buffer(gemmi, buffer, name);
    });
  }

  load_structure_from_buffer(gemmi, buffer, name) {
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

  load_pdb(url, options,
           callback) {
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

   load_pdb_candidates(urls, options,
                              callback) {
    const self = this;
    const gemmi = options && options.gemmi;
    const failed = [];

    function try_next(index) {
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

  load_map(url, options,
           callback) {
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

  load_map_from_buffer(buffer, options, gemmi) {
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
  load_maps(url1, url2,
            options, callback) {
    const format = options.format || 'ccp4';
    const self = this;
    this.load_map(url1, {diff_map: false, format: format}, function () {
      self.load_map(url2, {diff_map: true, format: format}, callback);
    });
  }

  // Load a model (PDB), normal map and a difference map - in this order.
  load_pdb_and_maps(pdb, map1, map2,
                    options, callback) {
    const self = this;
    this.load_pdb(pdb, options, function () {
      self.load_maps(map1, map2, options, callback);
    });
  }

  // for backward compatibility:
  load_ccp4_maps(url1, url2, callback) {
    this.load_maps(url1, url2, {format: 'ccp4'}, callback);
  }
  load_pdb_and_ccp4_maps(pdb, map1, map2,
                         callback) {
    this.load_pdb_and_maps(pdb, map1, map2, {format: 'ccp4'}, callback);
  }

  // pdb_id here should be lowercase ('1abc')
  load_from_pdbe(pdb_id, callback) {
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
  load_from_rcsb(pdb_id, callback) {
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
  'H = toggle help',
  'S = general style',
  'L = ligand style',
  'T = water style',
  'C = coloring',
  'B = bg color',
  'E = toggle fog',
  'Q = label font',
  '+/- = sigma level',
  ']/[ = map radius',
  'D/F = clip width',
  '&lt;/> = move clip',
  'M/N = zoom',
  'U = unitcell box',
  '\\ = toggle symmetry',
  'Y = hydrogens',
  'V = inactive models',
  'R = center view',
  'W = wireframe style',
  'I = spin',
  'K = rock',
  'Home/End = stick width',
  'P = nearest Cα',
  'Ctrl+G = go to CID',
  'Delete menu = selected atom/residue/chain',
  'Shift+P = permalink',
  '(Shift+)space = next res.',
  'Shift+F = full screen',
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

Viewer.prototype.ColorSchemes = ColorSchemes$1;

function to_col(num) { return new Color(num); }

const ColorSchemes = {
  'solarized dark': {
    bg: new Color(0x002b36),
    fg: new Color(0xfdf6e3),
    map_den: new Color(0xeee8d5),
    center: new Color(0xfdf6e3),
    lattices: [0xdc322f, 0x2aa198, 0x268bd2, 0x859900,
               0xd33682, 0xb58900, 0x6c71c4, 0xcb4b16].map(to_col),
    axes: [0xffaaaa, 0xaaffaa, 0xaaaaff].map(to_col),
  },
  'solarized light': {
    bg: new Color(0xfdf6e3),
    fg: new Color(0x002b36),
    map_den: new Color(0x073642),
    center: new Color(0x002b36),
    lattices: [0xdc322f, 0x2aa198, 0x268bd2, 0x859900,
               0xd33682, 0xb58900, 0x6c71c4, 0xcb4b16].map(to_col),
    axes: [0xffaaaa, 0xaaffaa, 0xaaaaff].map(to_col),
  },
};

// options handled by Viewer#select_next()
const SPOT_SEL = ['all', 'unindexed', '#1']; //extended when needed
const SHOW_AXES = ['two', 'three', 'none'];
const SPOT_SHAPES = ['wheel', 'square'];

// Modified ElMap for handling output of dials.rs_mapper.
// rs_mapper outputs map in ccp4 format, but we need to rescale it,
// shift it so the box is centered at 0,0,0,
// and the translational symmetry doesn't apply.
class ReciprocalSpaceMap extends ElMap {
  

  constructor(buf, gemmi) {
    super();
    this.box_size = [1, 1, 1];
    this.from_ccp4(buf, false, gemmi);
    if (this.unit_cell == null) return;
    // unit of the map from dials.rs_mapper is (100A)^-1, we scale it to A^-1
    // We assume the "unit cell" is cubic -- as it is in rs_mapper.
    const uc = this.unit_cell;
    this.box_size = [uc.a / 100, uc.b / 100, uc.c / 100];
    this.unit_cell = null;
  }

  prepare_isosurface(radius, center) {
    const grid = this.grid;
    if (grid == null) return;
    const b = this.box_size;
    const lo_bounds = [];
    const hi_bounds = [];
    for (let n = 0; n < 3; n++) {
      let lo = Math.floor(grid.dim[n] * ((center[n] - radius) / b[n] + 0.5));
      let hi = Math.floor(grid.dim[n] * ((center[n] + radius) / b[n] + 0.5));
      lo = Math.min(Math.max(0, lo), grid.dim[n] - 1);
      hi = Math.min(Math.max(0, hi), grid.dim[n] - 1);
      if (lo === hi) return;
      lo_bounds.push(lo);
      hi_bounds.push(hi);
    }

    const points = [];
    const values = [];
    for (let i = lo_bounds[0]; i <= hi_bounds[0]; i++) {
      for (let j = lo_bounds[1]; j <= hi_bounds[1]; j++) {
        for (let k = lo_bounds[2]; k <= hi_bounds[2]; k++) {
          points.push([(i / grid.dim[0] - 0.5) * b[0],
                       (j / grid.dim[1] - 0.5) * b[1],
                       (k / grid.dim[2] - 0.5) * b[2]]);
          const index = grid.grid2index_unchecked(i, j, k);
          values.push(grid.values[index]);
        }
      }
    }

    const size = [hi_bounds[0] - lo_bounds[0] + 1,
                        hi_bounds[1] - lo_bounds[1] + 1,
                        hi_bounds[2] - lo_bounds[2] + 1];
    this.block.set(points, values, size);
  }
}

ReciprocalSpaceMap.prototype.unit = '';

function find_max_dist(pos) {
  let max_sq = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const sq = pos[i]*pos[i] + pos[i+1]*pos[i+1] + pos[i+2]*pos[i+2];
    if (sq > max_sq) max_sq = sq;
  }
  return Math.sqrt(max_sq);
}

function max_val(arr) {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  return max;
}



function parse_csv(text) {
  const lines = text.split('\n').filter(function (line) {
    return line.length > 0 && line[0] !== '#';
  });
  const pos = new Float32Array(lines.length * 3);
  const lattice_ids = [];
  for (let i = 0; i < lines.length; i++) {
    const nums = lines[i].split(',').map(Number);
    for (let j = 0; j < 3; j++) {
      pos[3*i+j] = nums[j];
    }
    lattice_ids.push(nums[3]);
  }
  return { pos, lattice_ids };
}

function minus_ones(n) {
  return new Array(n).fill(-1);
}

function parse_json(text) {
  const d = JSON.parse(text);
  const n = d.rlp.length;
  let pos;
  if (n > 0 && d.rlp[0] instanceof Array) { // deprecated format
    pos = new Float32Array(3*n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 3; j++) {
        pos[3*i+j] = d.rlp[i][j];
      }
    }
  } else { // flat array - new format
    pos = new Float32Array(d.rlp);
  }
  const lattice_ids = d.experiment_id || minus_ones(n);
  return { pos, lattice_ids };
}

const point_vert = `
attribute vec3 color;
attribute float group;
uniform float show_only;
uniform float r2_max;
uniform float r2_min;
uniform float size;
varying vec3 vcolor;
void main() {
  vcolor = color;
  float r2 = dot(position, position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  if (r2 < r2_min || r2 >= r2_max || (show_only != -2.0 && show_only != group))
    gl_Position.x = 2.0;
  gl_PointSize = size;
}`;

const round_point_frag = `
${fog_pars_fragment}
varying vec3 vcolor;
void main() {
  // not sure how reliable is such rounding of points
  vec2 diff = gl_PointCoord - vec2(0.5, 0.5);
  float dist_sq = 4.0 * dot(diff, diff);
  if (dist_sq >= 1.0) discard;
  float alpha = 1.0 - dist_sq * dist_sq * dist_sq;
  gl_FragColor = vec4(vcolor, alpha);
${fog_end_fragment}
}`;

const square_point_frag = `
${fog_pars_fragment}
varying vec3 vcolor;
void main() {
  gl_FragColor = vec4(vcolor, 1.0);
${fog_end_fragment}
}`;









class ReciprocalViewer extends Viewer {
  
  
  
  
  
  
  
  
  

  constructor(options = {}) {
    options.color_scheme = 'solarized dark';
    super(options);
    this.default_camera_pos = [100, 0, 0];
    this.axes = null;
    this.points = null;
    this.max_dist = -1;
    this.d_min = -1;
    this.d_max_inv = 0;
    this.config.show_only = SPOT_SEL[0];
    this.config.show_axes = SHOW_AXES[0];
    this.config.spot_shape = SPOT_SHAPES[0];
    this.config.center_cube_size = 0.001;
    this.set_reciprocal_key_bindings();
    if (typeof document !== 'undefined') {
      this.set_dropzone(this.renderer.domElement,
                        this.file_drop_callback.bind(this));
    }
    this.point_material = new ShaderMaterial({
      uniforms: makeUniforms({
        size: 3,
        show_only: -2,
        r2_max: 100,
        r2_min: 0,
      }),
      vertexShader: point_vert,
      fragmentShader: round_point_frag,
      fog: true,
      transparent: true,
      type: 'um_point',
    });
  }

  set_reciprocal_key_bindings() {
    const kb = this.key_bindings;
    // a
    kb[65] = function (evt) {
      this.select_next('axes', 'show_axes', SHOW_AXES, evt.shiftKey);
      this.set_axes();
    };
    // d
    kb[68] = function () { this.change_slab_width_by(-0.01); };
    // f
    kb[70] = function (evt) {
      if (evt.shiftKey) {
        this.toggle_full_screen();
      } else {
        this.change_slab_width_by(0.01);
      }
    };
    // p
    kb[80] = function () { this.permalink(); };
    // s
    kb[83] = function (evt) {
      this.select_next('spot shape', 'spot_shape', SPOT_SHAPES, evt.shiftKey);
      if (this.config.spot_shape === 'wheel') {
        this.point_material.fragmentShader = round_point_frag;
      } else {
        this.point_material.fragmentShader = square_point_frag;
      }
      this.point_material.needsUpdate = true;
    };
    // u
    kb[85] = function () {
      if (this.map_bags.length === 0) {
        this.hud('Reciprocal-space density map not loaded.');
        return;
      }
      this.hud('toggled map box');
      this.toggle_cell_box();
    };
    // v
    kb[86] = function (evt) {
      this.select_next('show', 'show_only', SPOT_SEL, evt.shiftKey);
      const idx = SPOT_SEL.indexOf(this.config.show_only);
      this.point_material.uniforms.show_only.value = idx - 2;
    };
    // x
    kb[88] = function (evt) {
      if (evt.shiftKey) {
        this.change_map_line(0.1);
      } else {
        this.change_point_size(0.5);
      }
    };
    // z
    kb[90] = function (evt) {
      if (evt.shiftKey) {
        this.change_map_line(-0.1);
      } else {
        this.change_point_size(-0.5);
      }
    };
    // comma
    kb[188] = function (evt) { if (evt.shiftKey) this.shift_clip(0.1); };
    // period
    kb[190] = function (evt) { if (evt.shiftKey) this.shift_clip(-0.1); };
    // <-
    kb[37] = function () { this.change_dmin(0.05); };
    // ->
    kb[39] = function () { this.change_dmin(-0.05); };
    // up arrow
    kb[38] = function () { this.change_dmax(0.025); };
    // down arrow
    kb[40] = function () { this.change_dmax(-0.025); };
    // add, equals/firefox, equal sign
    kb[107] = kb[61] = kb[187] = function () {
      this.change_isolevel_by(0, 0.01);
    };
    // subtract, minus/firefox, dash
    kb[109] = kb[173] = kb[189] = function () {
      this.change_isolevel_by(0, -0.01);
    };
    // [
    kb[219] = function () { this.change_map_radius(-1e-3); };
    // ]
    kb[221] = function () { this.change_map_radius(0.001); };
  }

  file_drop_callback(file) {
    const self = this;
    const reader = new FileReader();
    if (/\.(map|ccp4)$/.test(file.name)) {
      reader.onloadend = function (evt) {
        if (evt.target.readyState == 2) {
          self.load_map_from_ab(evt.target.result );
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = function (evt) {
        self.load_from_string(evt.target.result , {});
      };
      reader.readAsText(file);
    }
  }

  load_data(url, options = {}) {
    const self = this;
    this.load_file(url, {binary: false, progress: true}, function (req) {
      const ok = self.load_from_string(req.responseText, options);
      if (ok && options.callback) options.callback();
    });
  }

  load_from_string(text, options) {
    if (text[0] === '{') {
      this.data = parse_json(text);
    } else if (text[0] === '#') {
      this.data = parse_csv(text);
    } else {
      this.hud('Unrecognized file type.');
      return false;
    }
    this.max_dist = find_max_dist(this.data.pos);
    this.d_min = 1 / this.max_dist;
    const last_group = max_val(this.data.lattice_ids);
    SPOT_SEL.splice(3);
    for (let i = 1; i <= last_group; i++) {
      SPOT_SEL.push('#' + (i + 1));
    }
    this.set_axes();
    this.set_points(this.data);
    this.camera.zoom = 0.5 * (this.camera.top - this.camera.bottom);
    // default scale is set to 100 - same as default_camera_pos
    const d = 1.01 * this.max_dist;
    this.controls.slab_width = [d, d, 100];
    this.set_view(options);
    this.hud('Loaded ' + this.data.pos.length + ' spots.');
    return true;
  }

  load_map_from_ab(buffer) {
    const self = this;
    this.resolve_gemmi().then(function (gemmi) {
      if (gemmi == null) throw Error('Gemmi is required for CCP4 map loading.');
      if (self.map_bags.length > 0) {
        const old_map = self.map_bags.pop();
        if (old_map != null) {
          self.clear_el_objects(old_map);
          old_map.map.dispose();
        }
      }
      const map = new ReciprocalSpaceMap(buffer, gemmi);
      const map_range = map.box_size[0] / 2;
      self.config.map_radius = Math.round(map_range / 2 * 100) / 100;
      self.config.max_map_radius = Math.round(1.5 * map_range * 100) / 100;
      self.config.default_isolevel = 2.0;
      self.add_map(map, false);
      const map_dmin = 1 / map_range;
      let msg = 'Loaded density map (' + map_dmin.toFixed(2) + 'Å).\n';
      if (self.points !== null && map_dmin > self.d_min) {
        msg += 'Adjusted spot clipping. ';
        self.change_dmin(map_dmin - self.d_min);
      }
      self.hud(msg + 'Use +/- to change the isolevel.');
    }, function (e) {
      self.hud(e.message, 'ERR');
    });
  }

  set_axes() {
    if (this.axes != null) {
      this.remove_and_dispose(this.axes);
      this.axes = null;
    }
    if (this.config.show_axes === 'none') return;
    const axis_length = 1.2 * this.max_dist;
    const vertices = [];
    addXyzCross(vertices, [0, 0, 0], axis_length);
    const ca = this.config.colors.axes;
    const colors = [ca[0], ca[0], ca[1], ca[1], ca[2], ca[2]];
    if (this.config.show_axes === 'two') {
      vertices.splice(4);
      colors.splice(4);
    }
    const material = makeLineMaterial({
      win_size: this.window_size,
      linewidth: 3,
    });
    this.axes = makeLineSegments(material, vertices, colors);
    this.scene.add(this.axes);
  }

  set_points(data) {
    if (this.points != null) {
      this.remove_and_dispose(this.points);
      this.points = null;
    }
    if (data == null || data.lattice_ids == null || data.pos == null) return;
    const color_arr = new Float32Array(3 * data.lattice_ids.length);
    this.colorize_by_id(color_arr, data.lattice_ids);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.pos, 3));
    geometry.setAttribute('color', new BufferAttribute(color_arr, 3));
    const groups = new Float32Array(data.lattice_ids);
    geometry.setAttribute('group', new BufferAttribute(groups, 1));
    this.points = new Points(geometry, this.point_material);
    this.scene.add(this.points);
    this.request_render();
  }

  colorize_by_id(color_arr, group_id) {
    const palette = this.config.colors.lattices;
    const palette_len = palette.length;
    if (palette_len === 0) return;
    for (let i = 0; i < group_id.length; i++) {
      const c = palette[(group_id[i] + 1) % palette_len];
      color_arr[3*i] = c.r;
      color_arr[3*i+1] = c.g;
      color_arr[3*i+2] = c.b;
    }
  }

  mousewheel_action(delta) {
    this.change_zoom_by_factor(1 + 0.0005 * delta);
  }

  change_point_size(delta) {
    const size = this.point_material.uniforms.size;
    size.value = Math.max(size.value + delta, 0.5);
    this.hud('point size: ' + size.value.toFixed(1));
  }

  change_dmin(delta) {
    this.d_min = Math.max(this.d_min + delta, 0.1);
    const dmax = this.d_max_inv > 0 ? 1 / this.d_max_inv : null;
    if (dmax !== null && this.d_min > dmax) this.d_min = dmax;
    this.point_material.uniforms.r2_max.value = 1 / (this.d_min * this.d_min);
    const low_res = dmax !== null ? dmax.toFixed(2) : '∞';
    this.hud('res. limit: ' + low_res + ' - ' + this.d_min.toFixed(2) + 'Å');
  }

  change_dmax(delta) {
    let v = Math.min(this.d_max_inv + delta, 1 / this.d_min);
    if (v < 1e-6) v = 0;
    this.d_max_inv = v;
    this.point_material.uniforms.r2_min.value = v * v;
    const low_res = v > 0 ? (1 / v).toFixed(2) : '∞';
    this.hud('res. limit: ' + low_res + ' - ' + this.d_min.toFixed(2) + 'Å');
  }

  redraw_models() {
    this.set_points(this.data);
  }

  get_cell_box_func() {
    if (this.map_bags.length === 0) return null;
    // here the map is ReciprocalSpaceMap not ElMap
    const a = this.map_bags[0].map.box_size;
    return function (xyz) {
      return [(xyz[0]-0.5) * a[0], (xyz[1]-0.5) * a[1], (xyz[2]-0.5) * a[2]];
    };
  }
}

ReciprocalViewer.prototype.KEYBOARD_HELP = [
  '<b>keyboard:</b>',
  'H = toggle help',
  'V = show (un)indexed',
  'A = toggle axes',
  'U = toggle map box',
  'B = bg color',
  'E = toggle fog',
  'M/N = zoom',
  'D/F = clip width',
  '&lt;/> = move clip',
  'R = center view',
  'Z/X = point size',
  'S = point shape',
  'Shift+P = permalink',
  'Shift+F = full screen',
  '←/→ = max resol.',
  '↑/↓ = min resol.',
  '+/- = map level',
].join('\n');

ReciprocalViewer.prototype.MOUSE_HELP =
    Viewer.prototype.MOUSE_HELP.split('\n').slice(0, -2).join('\n');

ReciprocalViewer.prototype.ColorSchemes = ColorSchemes;

function log_timing(t0, text) {
  console.log(text + ': ' + (performance.now() - t0).toFixed(2) + ' ms.');
}

function add_map_from_mtz(gemmi, viewer,
                          mtz_map, is_diff) {
  const map = new ElMap();
  map.gemmi_module = gemmi;
  map.wasm_map = mtz_map;
  const mc = mtz_map.cell;
  map.unit_cell = new gemmi.UnitCell(mc.a, mc.b, mc.c, mc.alpha, mc.beta, mc.gamma);
  map.stats.mean = mtz_map.mean;
  map.stats.rms = mtz_map.rms;
  viewer.add_map(map, is_diff);
}

function load_maps_from_mtz_buffer(gemmi, viewer, mtz,
                                   labels) {
  if (labels != null) {
    for (let n = 0; n < labels.length; n += 2) {
      if (labels[n] === '') continue;
      const t0 = performance.now();
      const mtz_map = mtz.calculate_wasm_map_from_labels(labels[n], labels[n+1]);
      log_timing(t0, 'map ' + (mtz_map ? mtz_map.nx : mtz.nx) + 'x' +
                     (mtz_map ? mtz_map.ny : mtz.ny) + 'x' +
                     (mtz_map ? mtz_map.nz : mtz.nz) +
                     ' calculated in');
      if (mtz_map == null) {
        viewer.hud(mtz.last_error, 'ERR');
        continue;
      }
      const is_diff = (n % 4 == 2);
      add_map_from_mtz(gemmi, viewer, mtz_map, is_diff);
    }
  } else {  // use default labels
    for (let nmap = 0; nmap < 2; ++nmap) {
      const is_diff = (nmap == 1);
      const t0 = performance.now();
      const mtz_map = mtz.calculate_wasm_map(is_diff);
      log_timing(t0, 'map ' + (mtz_map ? mtz_map.nx : mtz.nx) + 'x' +
                     (mtz_map ? mtz_map.ny : mtz.ny) + 'x' +
                     (mtz_map ? mtz_map.nz : mtz.nz) +
                     ' calculated in');
      if (mtz_map != null) {
        add_map_from_mtz(gemmi, viewer, mtz_map, is_diff);
      } else {
        viewer.hud(mtz.last_error, 'ERR');
      }
    }
  }
  mtz.delete();
}

function load_maps_from_mtz(gemmi, viewer, url,
                            labels, callback) {
  viewer.load_file(url, {binary: true, progress: true}, function (req) {
    const t0 = performance.now();
    try {
      const mtz = gemmi.readMtz(req.response);
      //console.log("[after readMTZ] wasm mem:", gemmi.HEAPU8.length / 1024, "kb");
      load_maps_from_mtz_buffer(gemmi, viewer, mtz, labels);
    } catch (e) {
      viewer.hud(e.message, 'ERR');
      return;
    }
    log_timing(t0, 'load_maps_from_mtz');
    //console.log("wasm mem:", gemmi.HEAPU8.length / 1024, "kb");
    if (callback) callback();
  });
}

function set_pdb_and_mtz_dropzone(gemmi, viewer,
                                  zone) {
  viewer.set_dropzone(zone, function (file) {
    if (/\.mtz$/.test(file.name)) {
      const reader = new FileReader();
      return new Promise(function (resolve, reject) {
        reader.onloadend = function (evt) {
          if (evt.target == null || evt.target.readyState !== 2) return;
          const t0 = performance.now();
          try {
            const mtz = gemmi.readMtz(evt.target.result );
            load_maps_from_mtz_buffer(gemmi, viewer, mtz);
          } catch (e) {
            reject(e);
            return;
          }
          log_timing(t0, 'mtz -> maps');
          if (viewer.model_bags.length === 0 && viewer.map_bags.length <= 2) {
            viewer.recenter();
          }
          resolve();
        };
        reader.onerror = () => reject(reader.error || Error('Failed to read ' + file.name));
        reader.readAsArrayBuffer(file);
      });
    } else {
      return viewer.pick_pdb_and_map(file);
    }
  });
}

exports.BondType = BondType;
exports.BufferAttribute = BufferAttribute;
exports.BufferGeometry = BufferGeometry;
exports.Color = Color;
exports.Controls = Controls;
exports.ElMap = ElMap;
exports.Fog = Fog;
exports.GridArray = GridArray;
exports.Label = Label;
exports.Line = Line;
exports.LineSegments = LineSegments;
exports.Matrix4 = Matrix4;
exports.Mesh = Mesh;
exports.Model = Model;
exports.Object3D = Object3D;
exports.OrthographicCamera = OrthographicCamera;
exports.Points = Points;
exports.Quaternion = Quaternion;
exports.Ray = Ray;
exports.ReciprocalSpaceMap = ReciprocalSpaceMap;
exports.ReciprocalViewer = ReciprocalViewer;
exports.STATE = STATE;
exports.Scene = Scene;
exports.ShaderMaterial = ShaderMaterial;
exports.Texture = Texture;
exports.Vector3 = Vector3;
exports.Viewer = Viewer;
exports.WebGLRenderer = WebGLRenderer;
exports.addXyzCross = addXyzCross;
exports.bondDataFromGemmiStructure = bondDataFromGemmiStructure;
exports.fog_end_fragment = fog_end_fragment;
exports.fog_pars_fragment = fog_pars_fragment;
exports.load_maps_from_mtz = load_maps_from_mtz;
exports.load_maps_from_mtz_buffer = load_maps_from_mtz_buffer;
exports.makeBalls = makeBalls;
exports.makeCartoon = makeCartoon;
exports.makeChickenWire = makeChickenWire;
exports.makeCube = makeCube;
exports.makeGrid = makeGrid;
exports.makeLineMaterial = makeLineMaterial;
exports.makeLineSegments = makeLineSegments;
exports.makeRgbBox = makeRgbBox;
exports.makeRibbon = makeRibbon;
exports.makeSticks = makeSticks;
exports.makeUniforms = makeUniforms;
exports.makeWheels = makeWheels;
exports.modelFromGemmiStructure = modelFromGemmiStructure;
exports.modelsFromGemmi = modelsFromGemmi;
exports.set_pdb_and_mtz_dropzone = set_pdb_and_mtz_dropzone;

}));
