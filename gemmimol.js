/*!
 * GemmiMol v0.8.4. Macromolecular Viewer for Crystallographers.
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

var VERSION = exports.VERSION = "0.8.4";
var GIT_DESCRIBE = exports.GIT_DESCRIBE = "0.8.4-10-g2fc9ef7-dirty";
var GEMMI_GIT_DESCRIBE = exports.GEMMI_GIT_DESCRIBE = "v0.7.5-144-g0445d0c2";


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

const BondType = {
  Unspec: 0,
  Single: 1,
  Double: 2,
  Triple: 3,
  Aromatic: 4,
  Deloc: 5,
  Metal: 6,
} ;

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

  field()  {
    if (this._values == null || this._points == null) return undefined;
    const size = this._size;
    if (size[0] < 2 || size[1] < 2 || size[2] < 2) return undefined;
    const yz = size[1] * size[2];
    const y = size[2];
    return {
      values: this._values,
      size: [size[0], size[1], size[2]],
      origin: [this._points[0], this._points[1], this._points[2]],
      axis_x: [this._points[3*yz] - this._points[0],
               this._points[3*yz+1] - this._points[1],
               this._points[3*yz+2] - this._points[2]],
      axis_y: [this._points[3*y] - this._points[0],
               this._points[3*y+1] - this._points[1],
               this._points[3*y+2] - this._points[2]],
      axis_z: [this._points[3] - this._points[0],
               this._points[4] - this._points[1],
               this._points[5] - this._points[2]],
    };
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
        triangles: iso.triangles().slice(),
        field: this.field(),
      } ;
    } finally {
      if (iso != null) iso.delete();
    }
  }
}

function map_index(dim, i, j, k) {
  i = modulo(i, dim[0]);
  j = modulo(j, dim[1]);
  k = modulo(k, dim[2]);
  return dim[2] * (dim[1] * i + j) + k;
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

function extract_block_from_map(block, map, unit_cell,
                                radius, center) {
  const fc = unit_cell.fractionalize(center);
  const r = [radius / unit_cell.a,
             radius / unit_cell.b,
             radius / unit_cell.c];
  const dim = [map.nx, map.ny, map.nz];
  const grid_min = [Math.floor((fc[0] - r[0]) * dim[0]) | 0,
                          Math.floor((fc[1] - r[1]) * dim[1]) | 0,
                          Math.floor((fc[2] - r[2]) * dim[2]) | 0];
  const grid_max = [Math.floor((fc[0] + r[0]) * dim[0]) | 0,
                          Math.floor((fc[1] + r[1]) * dim[1]) | 0,
                          Math.floor((fc[2] + r[2]) * dim[2]) | 0];
  const size = [grid_max[0] - grid_min[0] + 1,
                      grid_max[1] - grid_min[1] + 1,
                      grid_max[2] - grid_min[2] + 1];
  const data = map.data() ;
  const points = [];
  const values = [];
  for (let i = grid_min[0]; i <= grid_max[0]; i++) {
    for (let j = grid_min[1]; j <= grid_max[1]; j++) {
      for (let k = grid_min[2]; k <= grid_max[2]; k++) {
        const frac = [i / dim[0], j / dim[1], k / dim[2]];
        points.push(unit_cell.orthogonalize(frac));
        values.push(data[map_index(dim, i, j, k)]);
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

  prepare_isosurface(radius, center, want_block=false) {
    this.block_center = center;
    this.block_radius = radius;
    const unit_cell = this.unit_cell;
    if (unit_cell == null) return;
    if (this.wasm_map != null) {
      if (want_block) {
        extract_block_from_map(this.block, this.wasm_map, unit_cell, radius, center);
      }
      return;
    }
    const grid = this.grid;
    if (grid == null) return;
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
        triangles: this.wasm_map.isosurface_triangles().slice(),
        field: this.block.field(),
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

    this.setRenderTarget( renderTarget || null );

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

  this.setRenderTarget = function ( target ) {
    if ( target && target.isWebGLRenderTarget ) {
      target._init( _gl );
      _gl.bindFramebuffer( _gl.FRAMEBUFFER, target._framebuffer );
      _currentRenderTarget = target;
      state.viewport( new Vector4( 0, 0, target.width, target.height ) );
    } else {
      _gl.bindFramebuffer( _gl.FRAMEBUFFER, null );
      _currentRenderTarget = null;
      _currentViewport.copy( _viewport ).multiplyScalar( _pixelRatio );
      state.viewport( _currentViewport );
    }
  };
}

// WebGLRenderTarget — minimal render-to-texture support
let WebGLRenderTarget$1 = class WebGLRenderTarget {
  
  
  
  
  
  
  
  
  // texture index for binding in shaders (set externally)
  
  

  constructor( width, height, options = {} ) {
    this.isWebGLRenderTarget = true;
    this.width = width;
    this.height = height;
    this.depthBuffer = options.depth !== false;
    this._framebuffer = null;
    this._colorTexture = null;
    this._depthTexture = null;
    this._initialized = false;
    this.colorTextureIndex = 0;
    this.depthTextureIndex = 0;
  }

  _init( gl ) {
    if ( this._initialized ) return;
    this._initialized = true;

    this._colorTexture = gl.createTexture();
    gl.bindTexture( gl.TEXTURE_2D, this._colorTexture );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height,
      0, gl.RGBA, gl.UNSIGNED_BYTE, null );

    if ( this.depthBuffer ) {
      this._depthTexture = gl.createTexture();
      gl.bindTexture( gl.TEXTURE_2D, this._depthTexture );
      gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );
      gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
      gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
      gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
      gl.texImage2D( gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, this.width, this.height,
        0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null );
    }

    this._framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer( gl.FRAMEBUFFER, this._framebuffer );
    gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, this._colorTexture, 0 );
    if ( this.depthBuffer && this._depthTexture ) {
      gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
        gl.TEXTURE_2D, this._depthTexture, 0 );
    }
    gl.bindFramebuffer( gl.FRAMEBUFFER, null );
    gl.bindTexture( gl.TEXTURE_2D, null );
  }

  // Bind color texture to a texture unit for reading in a shader
  bindColorTexture( gl, unit ) {
    this.colorTextureIndex = unit;
    gl.activeTexture( gl.TEXTURE0 + unit );
    gl.bindTexture( gl.TEXTURE_2D, this._colorTexture );
  }

  // Bind depth texture to a texture unit for reading in a shader
  bindDepthTexture( gl, unit ) {
    this.depthTextureIndex = unit;
    gl.activeTexture( gl.TEXTURE0 + unit );
    gl.bindTexture( gl.TEXTURE_2D, this._depthTexture );
  }

  dispose( gl ) {
    if ( this._framebuffer ) gl.deleteFramebuffer( this._framebuffer );
    if ( this._colorTexture ) gl.deleteTexture( this._colorTexture );
    if ( this._depthTexture ) gl.deleteTexture( this._depthTexture );
    this._initialized = false;
  }
};


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
WebGLRenderTarget: WebGLRenderTarget$1,
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
const WebGLRenderTarget = impl.WebGLRenderTarget;

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

function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } }




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
uniform int uMode;
void main() {
  if (uMode == 1) {
    gl_FragColor = vec4(0.5, 0.5, 0.5, 1.0);
  } else {
    gl_FragColor = vec4(vcolor, 1.0);
    ${fog_end_fragment}
  }
}`;

const varcolor_frag = `
${fog_pars_fragment}
varying vec3 vcolor;
uniform int uMode;
void main() {
  if (uMode == 1) {
    gl_FragColor = vec4(0.5, 0.5, 0.5, 1.0);
  } else {
    gl_FragColor = vec4(vcolor, 1.0);
    ${fog_end_fragment}
  }
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
    uMode: { value: 0 },
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
uniform int uMode;
varying vec3 vcolor;
varying vec3 vnormal;
void main() {
  if (uMode == 1) {
    gl_FragColor = vec4(normalize(vnormal) * 0.5 + 0.5, 1.0);
  } else {
    float weight = abs(dot(normalize(vnormal), normalize(lightDir))) * 0.6 + 0.4;
    gl_FragColor = vec4(weight * vcolor, 1.0);
    ${fog_end_fragment}
  }
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
    uniforms: makeUniforms({lightDir: light_dir, uMode: 0}),
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

  const vertex_count = data.vertices.length / 3;
  const arr = wireIndexFromTriangles(data.triangles, vertex_count);
  //console.log('arr len:', data.vertices.length, data.triangles.length);
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

function weldSurface(data) {
  const input_pos = data.vertices;
  const input_idx = data.triangles;
  const index_len = input_idx.length - input_idx.length % 3;
  const pos = [];
  const remapped = (input_pos.length / 3 < 65536 ? new Uint16Array(input_idx.length)
                                                 : new Uint32Array(input_idx.length));
  const key_to_index = new Map();
  for (let i = 0; i < input_pos.length; i += 3) {
    const key = Math.round(input_pos[i] * 1e4) + ',' +
                Math.round(input_pos[i+1] * 1e4) + ',' +
                Math.round(input_pos[i+2] * 1e4);
    let idx = key_to_index.get(key);
    if (idx === undefined) {
      idx = pos.length / 3;
      key_to_index.set(key, idx);
      pos.push(input_pos[i], input_pos[i+1], input_pos[i+2]);
    }
    remapped[i / 3] = idx;
  }
  const tri = (pos.length < 3*65536 ? new Uint16Array(index_len)
                                    : new Uint32Array(index_len));
  for (let i = 0; i < index_len; i++) {
    tri[i] = remapped[input_idx[i]];
  }
  return {
    position: new Float32Array(pos),
    index: cleanSurfaceTriangles(tri, pos.length / 3),
  };
}

function cleanSurfaceTriangles(index, vertex_count) {
  const tri = [];
  const seen = new Set();
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i];
    const b = index[i + 1];
    const c = index[i + 2];
    if (a >= vertex_count || b >= vertex_count || c >= vertex_count) continue;
    if (a === b || b === c || c === a) continue;
    const lo = Math.min(a, b, c);
    const hi = Math.max(a, b, c);
    const mid = a + b + c - lo - hi;
    const key = lo + ',' + mid + ',' + hi;
    if (seen.has(key)) continue;
    seen.add(key);
    tri.push(a, b, c);
  }
  return (vertex_count < 65536 ? new Uint16Array(tri)
                               : new Uint32Array(tri));
}

function wireIndexFromTriangles(index, vertex_count) {
  const edges = [];
  const seen = new Set();
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i];
    const b = index[i + 1];
    const c = index[i + 2];
    if (a >= vertex_count || b >= vertex_count || c >= vertex_count) continue;
    if (a === b || b === c || c === a) continue;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const lo = Math.min(u, v);
      const hi = Math.max(u, v);
      const key = lo + ',' + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(u, v);
    }
  }
  return (vertex_count < 65536 ? new Uint16Array(edges)
                               : new Uint32Array(edges));
}

function areaSurfaceNormals(position, index) {
  const normal = new Float32Array(position.length);
  for (let i = 0; i + 2 < index.length; i += 3) {
    const i0 = 3 * index[i];
    const i1 = 3 * index[i+1];
    const i2 = 3 * index[i+2];
    const ax = position[i1] - position[i0];
    const ay = position[i1+1] - position[i0+1];
    const az = position[i1+2] - position[i0+2];
    const bx = position[i2] - position[i0];
    const by = position[i2+1] - position[i0+1];
    const bz = position[i2+2] - position[i0+2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    normal[i0] += nx; normal[i0+1] += ny; normal[i0+2] += nz;
    normal[i1] += nx; normal[i1+1] += ny; normal[i1+2] += nz;
    normal[i2] += nx; normal[i2+1] += ny; normal[i2+2] += nz;
  }
  for (let i = 0; i < normal.length; i += 3) {
    const nx = normal[i];
    const ny = normal[i+1];
    const nz = normal[i+2];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      normal[i] /= len;
      normal[i+1] /= len;
      normal[i+2] /= len;
    } else {
      normal[i] = 0;
      normal[i+1] = 0;
      normal[i+2] = 1;
    }
  }
  return normal;
}

function invertFieldBasis(field) {
  const ax = field.axis_x;
  const ay = field.axis_y;
  const az = field.axis_z;
  const a00 = ax[0], a01 = ay[0], a02 = az[0];
  const a10 = ax[1], a11 = ay[1], a12 = az[1];
  const a20 = ax[2], a21 = ay[2], a22 = az[2];
  const det = a00 * (a11 * a22 - a12 * a21) -
              a01 * (a10 * a22 - a12 * a20) +
              a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) < 1e-12) return null;
  const inv_det = 1 / det;
  return [
    (a11 * a22 - a12 * a21) * inv_det,
    (a02 * a21 - a01 * a22) * inv_det,
    (a01 * a12 - a02 * a11) * inv_det,
    (a12 * a20 - a10 * a22) * inv_det,
    (a00 * a22 - a02 * a20) * inv_det,
    (a02 * a10 - a00 * a12) * inv_det,
    (a10 * a21 - a11 * a20) * inv_det,
    (a01 * a20 - a00 * a21) * inv_det,
    (a00 * a11 - a01 * a10) * inv_det,
  ];
}

function fieldValue(field, x, y, z) {
  const size = field.size;
  x = Math.min(Math.max(x, 0), size[0] - 1);
  y = Math.min(Math.max(y, 0), size[1] - 1);
  z = Math.min(Math.max(z, 0), size[2] - 1);
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const jx = Math.min(ix + 1, size[0] - 1);
  const jy = Math.min(iy + 1, size[1] - 1);
  const jz = Math.min(iz + 1, size[2] - 1);
  const tx = x - ix;
  const ty = y - iy;
  const tz = z - iz;
  const yz = size[1] * size[2];
  const stride = size[2];
  const values = field.values;
  const idx000 = yz * ix + stride * iy + iz;
  const idx001 = yz * ix + stride * iy + jz;
  const idx010 = yz * ix + stride * jy + iz;
  const idx011 = yz * ix + stride * jy + jz;
  const idx100 = yz * jx + stride * iy + iz;
  const idx101 = yz * jx + stride * iy + jz;
  const idx110 = yz * jx + stride * jy + iz;
  const idx111 = yz * jx + stride * jy + jz;
  const c00 = values[idx000] * (1 - tx) + values[idx100] * tx;
  const c01 = values[idx001] * (1 - tx) + values[idx101] * tx;
  const c10 = values[idx010] * (1 - tx) + values[idx110] * tx;
  const c11 = values[idx011] * (1 - tx) + values[idx111] * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

function fieldSurfaceNormals(position, field,
                             fallback) {
  if (field.size[0] < 2 || field.size[1] < 2 || field.size[2] < 2) return null;
  const inv = invertFieldBasis(field);
  if (inv == null) return null;
  const origin = field.origin;
  const normal = new Float32Array(position.length);
  let valid = 0;
  let align = 0;
  for (let i = 0; i < position.length; i += 3) {
    const dx = position[i] - origin[0];
    const dy = position[i+1] - origin[1];
    const dz = position[i+2] - origin[2];
    const x = inv[0] * dx + inv[1] * dy + inv[2] * dz;
    const y = inv[3] * dx + inv[4] * dy + inv[5] * dz;
    const z = inv[6] * dx + inv[7] * dy + inv[8] * dz;
    const gx = fieldValue(field, x - 1, y, z) - fieldValue(field, x + 1, y, z);
    const gy = fieldValue(field, x, y - 1, z) - fieldValue(field, x, y + 1, z);
    const gz = fieldValue(field, x, y, z - 1) - fieldValue(field, x, y, z + 1);
    let nx = inv[0] * gx + inv[3] * gy + inv[6] * gz;
    let ny = inv[1] * gx + inv[4] * gy + inv[7] * gz;
    let nz = inv[2] * gx + inv[5] * gy + inv[8] * gz;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      nx /= len;
      ny /= len;
      nz /= len;
      normal[i] = nx;
      normal[i+1] = ny;
      normal[i+2] = nz;
      const fx = fallback[i];
      const fy = fallback[i+1];
      const fz = fallback[i+2];
      if (fx !== 0 || fy !== 0 || fz !== 0) {
        align += nx * fx + ny * fy + nz * fz;
      }
      valid++;
    } else {
      normal[i] = fallback[i];
      normal[i+1] = fallback[i+1];
      normal[i+2] = fallback[i+2];
    }
  }
  if (valid === 0) return null;
  if (align < 0) {
    for (let i = 0; i < normal.length; i++) normal[i] = -normal[i];
  }
  return normal;
}

function surfaceNormals(position, index,
                        field) {
  const fallback = areaSurfaceNormals(position, index);
  if (field == null) return fallback;
  return fieldSurfaceNormals(position, field, fallback) || fallback;
}

const surface_vert = `
attribute vec3 normal;
varying vec3 vnormal;
varying vec3 vview;
void main() {
  vec4 mv_pos = modelViewMatrix * vec4(position, 1.0);
  vnormal = normalize((modelViewMatrix * vec4(normal, 0.0)).xyz);
  vview = -mv_pos.xyz;
  gl_Position = projectionMatrix * mv_pos;
}
`;

const surface_frag = `
${fog_pars_fragment}
uniform vec3 vcolor;
uniform vec3 lightDir;
uniform float opacity;
uniform int uMode;
varying vec3 vnormal;
varying vec3 vview;
void main() {
  vec3 normal = normalize(vnormal);
  if (!gl_FrontFacing) normal = -normal;
  if (uMode == 1) {
    gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
  } else {
    vec3 view_dir = normalize(vview);
    vec3 light_dir = normalize(lightDir);
    float diffuse = clamp(dot(normal, light_dir), 0.0, 1.0);
    vec3 halfway = normalize(light_dir + view_dir);
    float specular = pow(clamp(dot(normal, halfway), 0.0, 1.0), 80.0);
    float fresnel = pow(1.0 - clamp(dot(normal, view_dir), 0.0, 1.0), 3.0);
    vec3 color = vcolor * (0.22 + 0.78 * diffuse);
    color += vec3(1.0) * (0.16 * specular + 0.08 * fresnel);
    gl_FragColor = vec4(color, opacity);
    ${fog_end_fragment}
  }
}`;

function makeSmoothSurface(data,
                                  options) {
  const welded = weldSurface(data);
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(welded.position, 3));
  geom.setIndex(new BufferAttribute(welded.index, 1));
  geom.setAttribute('normal',
                    new BufferAttribute(surfaceNormals(welded.position,
                                                       welded.index,
                                                       data.field), 3));
  const material = new ShaderMaterial({
    uniforms: makeUniforms({
      vcolor: options.color,
      lightDir: light_dir,
      opacity: _nullishCoalesce(options.opacity, () => ( 0.24)),
      uMode: 0,
    }),
    vertexShader: surface_vert,
    fragmentShader: surface_frag,
    fog: true,
    type: 'um_surface',
  });
  material.transparent = true;
  material.depthWrite = false;
  return new Mesh(geom, material);
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
uniform int uMode;
void main() {
  if (uMode == 1) {
    gl_FragColor = vec4(0.5, 0.5, 0.5, 1.0);
  } else {
    gl_FragColor = vcolor;
  }
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

// Van der Waals radii (in Angstroms) for space-filling rendering.
const VDW_RADII = {
  H: 1.20, D: 1.20, HE: 1.40,
  C: 1.70, N: 1.55, O: 1.52, F: 1.47, NE: 1.54,
  SI: 2.10, P: 1.80, S: 1.80, CL: 1.75, AR: 1.88,
  SE: 1.90, BR: 1.85, KR: 2.02, I: 1.98, XE: 2.16,
  NA: 2.27, MG: 1.73, K: 2.75, CA: 2.31, FE: 1.63,
  ZN: 1.39, CU: 1.40, MN: 1.39, CO: 1.26, NI: 1.24,
};
const VDW_DEFAULT = 1.50;

function getVdwRadius(element) {
  return _nullishCoalesce(VDW_RADII[element.toUpperCase()], () => ( VDW_DEFAULT));
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

// Variant with per-vertex radius for space-filling rendering
const sphere_var_vert = `
attribute vec3 color;
attribute vec2 corner;
attribute float aRadius;
varying vec3 vcolor;
varying vec2 vcorner;
varying vec3 vpos;
varying float vRadius;

void main() {
  vcolor = color;
  vcorner = corner;
  vRadius = aRadius;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vpos = mvPosition.xyz;
  mvPosition.xy += corner * aRadius;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const sphere_var_frag = `
${fog_pars_fragment}
uniform mat4 projectionMatrix;
uniform vec3 lightDir;
uniform int uMode;
varying vec3 vcolor;
varying vec2 vcorner;
varying vec3 vpos;
varying float vRadius;

void main() {
  float sq = dot(vcorner, vcorner);
  if (sq > 1.0) discard;
  float z = sqrt(1.0-sq);
  vec3 xyz = vec3(vcorner.x, vcorner.y, z);
  vec4 projPos = projectionMatrix * vec4(vpos + vRadius * xyz, 1.0);
  gl_FragDepthEXT = 0.5 * ((gl_DepthRange.diff * (projPos.z / projPos.w)) +
                           gl_DepthRange.near + gl_DepthRange.far);
  if (uMode == 1) {
    gl_FragColor = vec4(xyz * 0.5 + 0.5, 1.0);
  } else if (uMode == 2) {
    gl_FragColor = vec4(mix(vcolor, vec3(1.0), 0.5), 1.0);
  } else {
    float weight = clamp(dot(xyz, lightDir), 0.0, 1.0) * 0.8 + 0.2;
    gl_FragColor = vec4(weight * vcolor, 1.0);
    ${fog_end_fragment}
  }
}
`;

// based on 3Dmol imposter shaders
const sphere_frag = `
${fog_pars_fragment}
uniform mat4 projectionMatrix;
uniform vec3 lightDir;
uniform float radius;
uniform int uMode;
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
  if (uMode == 1) {
    gl_FragColor = vec4(xyz * 0.5 + 0.5, 1.0);
  } else if (uMode == 2) {
    gl_FragColor = vec4(mix(vcolor, vec3(1.0), 0.5), 1.0);
  } else {
    float weight = clamp(dot(xyz, lightDir), 0.0, 1.0) * 0.8 + 0.2;
    gl_FragColor = vec4(weight * vcolor, 1.0);
    ${fog_end_fragment}
  }
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
uniform int uMode;
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
  if (uMode == 1) {
    vec3 normal = normalize(vec3(vcorner[1] * vaxis.xy, central));
    gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
  } else if (uMode == 2) {
    gl_FragColor = vec4(mix(vcolor, vec3(1.0), 0.5), 1.0);
  } else {
    float diffuse = length(cross(vaxis, lightDir)) * central;
    float weight = diffuse * 0.8 + 0.2;
    float specular = shineStrength * pow(clamp(diffuse, 0.0, 1.0), shinePower) * central;
    vec3 shaded = min(weight, 1.0) * vcolor;
    gl_FragColor = vec4(min(shaded + specular * shineColor, 1.0), 1.0);
    ${fog_end_fragment}
  }
}`;







function makeSticks(vertex_arr, color_arr, radius,
                    options = {}) {
  const uniforms = makeUniforms({
    radius: radius,
    lightDir: light_dir,
    shineStrength: options.shineStrength || 0.0,
    shinePower: options.shinePower || 8.0,
    shineColor: options.shineColor || new Color(0xffffff),
    uMode: 0,
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
      uMode: 0,
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

function makeSpaceFilling(atom_arr, color_arr) {
  const N = atom_arr.length;
  const geometry = new BufferGeometry();

  const pos = new Float32Array(N * 4 * 3);
  const radii = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const xyz = atom_arr[i].xyz;
    const r = getVdwRadius(atom_arr[i].element);
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 3; k++) {
        pos[3 * (4*i + j) + k] = xyz[k];
      }
      radii[4*i + j] = r;
    }
  }
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('aRadius', new BufferAttribute(radii, 1));

  const corner = new Float32Array(N * 4 * 2);
  for (let i = 0; i < N; i++) {
    corner[8*i + 0] = -1;
    corner[8*i + 1] = -1;
    corner[8*i + 2] = -1;
    corner[8*i + 3] = 1;
    corner[8*i + 4] = 1;
    corner[8*i + 5] = 1;
    corner[8*i + 6] = 1;
    corner[8*i + 7] = -1;
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
      lightDir: light_dir,
      uMode: 0,
    }),
    vertexShader: sphere_var_vert,
    fragmentShader: sphere_var_frag,
    fog: true,
    type: 'um_sphere_var',
  });
  material.extensions.fragDepth = true;
  return new Mesh(geometry, material);
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
uniform int uMode;
void main() {
  if (uMode == 1) {
    gl_FragColor = vec4(0.5, 0.5, 0.5, 1.0);
  } else {
    gl_FragColor = texture2D(map, vUv);
    ${fog_end_fragment}
  }
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

// Default configuration - centralized here
const DEFAULT_CONFIG = {
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

({
  C: new Color(0x1933CC),
  O: new Color(0x5D1F5D),
  S: new Color(0x626E62),
});

const INIT_HUD_TEXT = 'This is GemmiMol not Coot.';

// options handled by select_next()
const COLOR_PROPS = ['element', 'B-factor', 'pLDDT', 'occupancy',
                            'index', 'chain', 'secondary structure'];
const MAINCHAIN_STYLES = ['sticks', 'lines', 'backbone', 'cartoon',
                                 'ribbon', 'ball&stick', 'space-filling'];
const SIDECHAIN_STYLES = ['sticks', 'lines', 'ball&stick', 'invisible'];
const LIGAND_STYLES = ['ball&stick', 'sticks', 'lines'];
const WATER_STYLES = ['sphere', 'cross', 'invisible'];
const MAP_STYLES = ['marching cubes', 'smooth surface'/*, 'snapped MC'*/];
const LABEL_FONTS = ['bold 14px', '14px', '16px', 'bold 16px'];

 





function escape_html(text) {
  return text.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
  }[ch] || ch));
}

function help_action_attrs(spec) {
  let attrs = ' data-help-keycode="' + spec.keyCode + '"';
  if (spec.shiftKey) attrs += ' data-help-shift="1"';
  if (spec.ctrlKey) attrs += ' data-help-ctrl="1"';
  return attrs;
}

function help_action_link(text, spec) {
  return '<a href="#" class="gm-help-action"' + help_action_attrs(spec) + '>' +
         escape_html(text) + '</a>';
}

function normalize_viewer_options(options) {
  if (typeof options === 'string') return {viewer: options};
  if (options && typeof options === 'object') {
    if (options.map_style === 'squarish') options.map_style = 'marching cubes';
    return options;
  }
  return {};
}

function map_style_method(style) {
  return style === 'smooth surface' || style === 'squarish' ? 'marching cubes' : style;
}

function map_style_is_surface(style) {
  return style === 'smooth surface';
}

// Default colors
const DEFAULT_ATOM_COLOR = 0x808080;

function scale_by_height(value, win_size) {
  return value * win_size[1] / 700;
}



const color_strategies = {
  element: (atoms, scheme) => atoms.map(a => 
    new Color((scheme )[a.element] || scheme.def || DEFAULT_ATOM_COLOR)),

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
    const cache = {};
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
    const ss_colors = {
      Helix: 0xD64A4A,
      Strand: 0xD4A62A,
      Coil: 0x70A5C8,
    };
    return temp.setHex(ss_colors[a.ss] || ss_colors.Coil).clone();
  }),
};

function color_by(prop, atoms, colors,
                         hue_shift = 0) {
  const scheme = (colors || {}) ;
  const temp = new Color();
  
  const strategy = color_strategies[prop];
  if (strategy) return strategy(atoms, scheme, hue_shift, temp);
  
  // Default
  const hex = scheme.def || 0xffffff;
  return atoms.map(() => new Color(hex));
}

function _optionalChain$6(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }
// Type for Num2 (window size)
 

// Unified container for both models and maps - eliminates 80% duplicate code
class SceneBag {
  
  
  
  
  
  
  
  
  
  
  // Model-specific (undefined for maps)
  
  
  
  
  
  // Map-specific (undefined for models)
  
  
  
  
  
  

  // Internal
  
   static __initStatic() {this.ctor_counter = 0;}

  constructor(data, config, win_size, is_map = false, is_diff_map = false) {
    this.data = data;
    this.visible = true;
    this.hue_shift = 0;
    this.color_override = null;
    this.symop = '';
    this.objects = [];
    this.block_ctr = new Vector3(Infinity, 0, 0);
    this.conf = config;
    this.win_size = win_size;
    
    if (is_map) {
      this.map = data ;
      this.label = '';
      this.name = '';
      this.isolevel = is_diff_map ? 3.0 : config.default_isolevel;
      this.types = is_diff_map ? ['map_pos', 'map_neg'] : ['map_den'];
      this.is_diff_map = is_diff_map;
      this.el_objects = [];
    } else {
      this.model = data ;
      this.label = '(model #' + ++SceneBag.ctor_counter + ')';
      this.atom_array = [];
      this.gemmi_selection = null;
      this.build_chain_name = null;
    }
  }

  // Factory methods for clean creation
  static forModel(model, config, win_size) {
    return new SceneBag(model, config, win_size, false);
  }

  static forMap(map, config, is_diff_map) {
    return new SceneBag(map, config, [800, 600], true, is_diff_map);
  }

  // --- Model-specific methods ---

  get_visible_atoms() {
    if (!this.model) return [];
    const atoms = this.model.atoms;
    if (this.conf.hydrogens || !this.model.has_hydrogens) return atoms;
    
    const non_h = [];
    for (const atom of atoms) {
      if (!atom.is_hydrogen()) non_h.push(atom);
    }
    return non_h;
  }

  atom_colors(atoms) {
    if (this.color_override) {
      return atoms.map((atom) => this.color_override(atom));
    }
    return color_by(this.conf.color_prop, atoms, this.conf.colors, this.hue_shift);
  }

  add_bonds(polymers, ligands, ball_size,
            atom_filter,
            bond_filter,
            wheel_caps = true) {
    if (!this.model) return;
    
    const visible_atoms = this.get_visible_atoms();
    const colors = this.atom_colors(visible_atoms);
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
      if (atom_filter && !atom_filter(atom)) continue;
      if (atom.is_water() && this.conf.water_style === 'invisible') continue;
      
      if (atom.bonds.length === 0 && ball_size == null) {
        if (!atom.is_water() || this.conf.water_style === 'cross') {
          addXyzCross(vertex_arr, atom.xyz, 0.7);
          for (let n = 0; n < 6; n++) color_arr.push(color);
        }
      } else {
        for (let j = 0; j < atom.bonds.length; j++) {
          const other = this.model.atoms[atom.bonds[j]];
          if (!hydrogens && other.is_hydrogen()) continue;
          if (bond_filter && !bond_filter(atom, other)) continue;
          const bond_type = atom.bond_types[j];
          if (bond_type === 6) { // Metal
            const mid = ball_size == null ? atom.midpoint(other) : this.bond_half_end(atom, other, ball_size * 0.3);
            metal_vertex_arr.push(atom.xyz, mid);
            metal_color_arr.push(color, color);
            metal_bond_type_arr.push(bond_type, bond_type);
          } else {
            const mid = ball_size == null ? atom.midpoint(other) : this.bond_half_end(atom, other, ball_size / 2);
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
        (obj ).userData.bond_types = bond_type_arr;
        this.objects.push(obj);
      }
      if (metal_vertex_arr.length !== 0) {
        const metal_obj = makeSticks(metal_vertex_arr, metal_color_arr, ball_size * 0.25);
        (metal_obj ).userData.bond_types = metal_bond_type_arr;
        this.objects.push(metal_obj);
      }
      if (sphere_arr.length !== 0) {
        this.objects.push(makeBalls(sphere_arr, sphere_color_arr, ball_size));
      }
    } else if (vertex_arr.length !== 0 || metal_vertex_arr.length !== 0) {
      const linewidth = scale_by_height(this.conf.bond_line, this.win_size);
      if (vertex_arr.length !== 0) {
        const material = makeLineMaterial({ linewidth, win_size: this.win_size });
        const obj = makeLineSegments(material, vertex_arr, color_arr);
        (obj ).userData.bond_types = bond_type_arr;
        this.objects.push(obj);
      }
      if (metal_vertex_arr.length !== 0) {
        const metal_material = makeLineMaterial({ linewidth: linewidth * 0.5, win_size: this.win_size });
        const metal_obj = makeLineSegments(metal_material, metal_vertex_arr, metal_color_arr);
        (metal_obj ).userData.bond_types = metal_bond_type_arr;
        this.objects.push(metal_obj);
      }
      if (wheel_caps && sphere_arr.length !== 0) {
        this.objects.push(makeWheels(sphere_arr, sphere_color_arr, linewidth));
      }
    }
    
    if (water_sphere_arr.length !== 0) {
      this.objects.push(makeBalls(water_sphere_arr, water_sphere_color_arr, this.conf.ball_size));
    }

    sphere_arr.forEach((v) => { if (this.atom_array) this.atom_array.push(v); });
    water_sphere_arr.forEach((v) => { if (this.atom_array) this.atom_array.push(v); });
  }

  add_sticks(polymers, ligands, radius,
             atom_filter,
             bond_filter) {
    if (!this.model) return;
    
    const visible_atoms = this.get_visible_atoms();
    const colors = this.atom_colors(visible_atoms);
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
        if (bond_filter && !bond_filter(atom, other)) continue;
        const bond_type = atom.bond_types[j];
        if (bond_type === 6) { // Metal
          const mid = this.bond_half_end(atom, other, radius * 0.5);
          metal_vertex_arr.push(atom.xyz, mid);
          metal_color_arr.push(color, color);
          metal_bond_type_arr.push(bond_type, bond_type);
        } else if (bond_type === 2) { // Double
          this.add_offset_stick(vertex_arr, color_arr, bond_type_arr, atom, other, color, bond_type, radius * 0.75, radius);
          this.add_offset_stick(vertex_arr, color_arr, bond_type_arr, atom, other, color, bond_type, -radius * 0.75, radius);
        } else if (bond_type === 3) { // Triple
          const mid = this.bond_half_end(atom, other, radius);
          vertex_arr.push(atom.xyz, mid);
          color_arr.push(color, color);
          bond_type_arr.push(bond_type, bond_type);
          this.add_offset_stick(vertex_arr, color_arr, bond_type_arr, atom, other, color, bond_type, radius * 1.2, radius);
          this.add_offset_stick(vertex_arr, color_arr, bond_type_arr, atom, other, color, bond_type, -radius * 1.2, radius);
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
      (obj ).userData.bond_types = bond_type_arr;
      this.objects.push(obj);
    }
    if (metal_vertex_arr.length !== 0) {
      const metal_obj = makeSticks(metal_vertex_arr, metal_color_arr, radius * 0.5);
      (metal_obj ).userData.bond_types = metal_bond_type_arr;
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
    const dir = [second.xyz[0] - first.xyz[0], second.xyz[1] - first.xyz[1], second.xyz[2] - first.xyz[2]];
    const ref = (Math.abs(dir[2]) < Math.abs(dir[1])) ? [0, 0, 1] : [0, 1, 0];
    let normal = [dir[1] * ref[2] - dir[2] * ref[1], dir[2] * ref[0] - dir[0] * ref[2], dir[0] * ref[1] - dir[1] * ref[0]];
    const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
    if (len < 1e-6) return [1, 0, 0];
    return [normal[0] / len, normal[1] / len, normal[2] / len];
  }

   bond_half_end(atom, other, radius) {
    const dir = [other.xyz[0] - atom.xyz[0], other.xyz[1] - atom.xyz[1], other.xyz[2] - atom.xyz[2]];
    const len = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
    if (len < 1e-6) return atom.midpoint(other);
    const overlap = Math.min(radius * 0.5, len * 0.12);
    const scale = 0.5 + overlap / len;
    return [atom.xyz[0] + dir[0] * scale, atom.xyz[1] + dir[1] * scale, atom.xyz[2] + dir[2] * scale];
  }

   add_offset_stick(vertex_arr, color_arr, bond_type_arr,
                           atom, other, color, bond_type,
                           offset_scale, radius) {
    const mid = this.bond_half_end(atom, other, radius);
    const normal = this.bond_normal(atom, other);
    const offset = [normal[0] * offset_scale, normal[1] * offset_scale, normal[2] * offset_scale];
    vertex_arr.push([atom.xyz[0] + offset[0], atom.xyz[1] + offset[1], atom.xyz[2] + offset[2]],
                    [mid[0] + offset[0], mid[1] + offset[1], mid[2] + offset[2]]);
    color_arr.push(color, color);
    bond_type_arr.push(bond_type, bond_type);
  }

   extend_stick_segment(start, end, radius) {
    const dir = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    const len = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
    if (len < 1e-6) return [start, end];
    const overlap = Math.min(radius * 0.35, len * 0.12);
    const unit = [dir[0] / len, dir[1] / len, dir[2] / len];
    return [[start[0] - unit[0] * overlap, start[1] - unit[1] * overlap, start[2] - unit[2] * overlap],
            [end[0] + unit[0] * overlap, end[1] + unit[1] * overlap, end[2] + unit[2] * overlap]];
  }

  add_trace() {
    if (!this.model) return;
    const segments = this.model.extract_trace();
    const visible_atoms = ([] ).concat(...segments);
    const colors = this.atom_colors(visible_atoms);
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
    
    if (vertex_arr.length !== 0) this.objects.push(makeSticks(vertex_arr, color_arr, radius));
    this.atom_array = visible_atoms;
  }

   calculate_tangents(seg, res_map) {
    const tangents = [];
    let last = [0, 0, 0];
    for (const atom of seg) {
      const residue = res_map[atom.resid()];
      const tang = this.model.calculate_tangent_vector(residue) ;
      if (tang[0]*last[0] + tang[1]*last[1] + tang[2]*last[2] < 0) {
        tang[0] = -tang[0]; tang[1] = -tang[1]; tang[2] = -tang[2];
      }
      tangents.push(tang);
      last = tang;
    }
    return tangents;
  }

  add_ribbon(smoothness) {
    if (!this.model) return;
    const segments = this.model.extract_trace();
    const res_map = this.model.get_residues();
    const visible_atoms = ([] ).concat(...segments);
    const colors = this.atom_colors(visible_atoms);
    let k = 0;
    
    for (const seg of segments) {
      const tangents = this.calculate_tangents(seg, res_map);
      const color_slice = colors.slice(k, k + seg.length);
      k += seg.length;
      this.objects.push(makeRibbon(seg, color_slice, tangents, smoothness));
    }
    this.atom_array = visible_atoms;
  }

  add_cartoon(smoothness) {
    if (!this.model) return;
    const segments = this.model.extract_trace();
    const res_map = this.model.get_residues();
    const visible_atoms = ([] ).concat(...segments);
    const colors = this.atom_colors(visible_atoms);
    let k = 0;
    
    for (const seg of segments) {
      const tangents = this.calculate_tangents(seg, res_map);
      const color_slice = colors.slice(k, k + seg.length);
      k += seg.length;
      this.objects.push(makeCartoon(seg, color_slice, tangents, smoothness));
    }
    this.atom_array = visible_atoms;
  }

  update_win_size(win_size) {
    this.win_size = win_size;
  }

  // --- Map-specific methods ---
  
  redraw_map(scene, config) {
    if (!this.map || !this.visible) return;
    
    // Clear old objects
    for (const obj of this.el_objects || []) {
      scene.remove(obj);
      if ((obj ).geometry) (obj ).geometry.dispose();
      if ((obj ).material) (obj ).material.dispose();
    }
    this.el_objects = [];
    
    if (config.map_radius <= 0) return;
    
    // Prepare isosurface block
    const center = [this.block_ctr.x, this.block_ctr.y, this.block_ctr.z];
    this.map.prepare_isosurface(config.map_radius, center, false);
    
    // Generate isosurfaces
    for (const mtype of this.types || ['map_den']) {
      const isolevel = (mtype === 'map_neg' ? -1 : 1) * (this.isolevel || 1.5);
      try {
        const iso = this.map.isomesh_in_block(isolevel, 'marching cubes');
        if (!iso) continue;
        
        const color = _optionalChain$6([config, 'access', _ => _.colors, 'optionalAccess', _2 => _2[mtype ]]) || new Color(0x808080);
        const obj = makeChickenWire(iso, { color, linewidth: config.map_line });
        this.el_objects.push(obj);
        scene.add(obj);
      } catch (e) {
        // Skip failed isosurfaces
      }
    }
  }
} SceneBag.__initStatic();

// Backward-compatible type aliases
 


// Legacy factory functions for backward compatibility
function createModelBag(model, config, win_size) {
  return SceneBag.forModel(model, config, win_size);
}

function createMapBag(map, config, is_diff_map) {
  return SceneBag.forMap(map, config, is_diff_map);
}

function _optionalChain$5(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }

class ModelRenderer {
  

  constructor(config) {
    this.config = config;
  }

  redraw_model(mb, scene) {
    const group = new Object3D();
    mb.objects = [];
    mb.atom_array = [];

    if (!mb.visible || !mb.model) return group;

    const mc_style = this.config.mainchain_style;
    const sc_style = this.config.sidechain_style;
    const lig_style = this.config.ligand_style;
    const water_style = this.config.water_style;

    // Space-filling is a global style - all atoms as VdW spheres
    if (mc_style === 'space-filling' || mc_style === 'space-filling+AO') {
      const visible_atoms = mb.get_visible_atoms();
      const colors = mb.atom_colors(visible_atoms);
      // Note: makeSpaceFilling would need to be imported from draw.ts
      // For now, fall back to balls
      for (let i = 0; i < visible_atoms.length; i++) {
        const atom = visible_atoms[i];
        const ball = makeBalls([atom], [colors[i]], this.config.ball_size * 2);
        mb.objects.push(ball);
      }
      mb.atom_array = visible_atoms;
    } else {
      // Main chain visualization
      const mainchain_filter = (atom) => atom.is_backbone();
      const sidechain_filter = (atom) => !atom.is_backbone();
      
      // Determine if we need wheel caps
      const wheel_caps = (mc_style === 'lines' && sc_style === 'lines' && lig_style === 'lines');

      // Main chain rendering
      switch (mc_style) {
        case 'lines':
          mb.add_bonds(true, false, undefined, mainchain_filter, undefined, wheel_caps);
          break;
        case 'sticks':
          mb.add_sticks(true, false, this.config.stick_radius, mainchain_filter);
          break;
        case 'ball&stick':
          mb.add_bonds(true, false, this.config.ball_size, mainchain_filter);
          break;
        case 'backbone':
          mb.add_trace();
          break;
        case 'ribbon':
          mb.add_ribbon(8);
          break;
        case 'cartoon':
          mb.add_cartoon(8);
          break;
      }

      // Side chain rendering
      switch (sc_style) {
        case 'lines':
          mb.add_bonds(true, false, undefined, sidechain_filter, undefined, wheel_caps);
          break;
        case 'sticks':
          mb.add_sticks(true, false, this.config.stick_radius, sidechain_filter);
          break;
        case 'ball&stick':
          mb.add_bonds(true, false, this.config.ball_size, sidechain_filter);
          break;
      }

      // Ligand rendering
      const ligand_filter = (atom) => atom.is_ligand === true && !atom.is_water();
      switch (lig_style) {
        case 'lines':
          mb.add_bonds(false, true, undefined, ligand_filter, undefined, wheel_caps);
          break;
        case 'sticks':
          mb.add_sticks(false, true, this.config.stick_radius, ligand_filter);
          break;
        case 'ball&stick':
          mb.add_bonds(false, true, this.config.ball_size, ligand_filter);
          break;
      }

      // Water rendering
      const water_filter = (atom) => atom.is_water();
      if (water_style !== 'invisible') {
        const waters = mb.model.atoms.filter(water_filter);
        const water_colors = mb.atom_colors(waters);
        
        if (water_style === 'sphere') {
          const water_balls = makeBalls(waters, water_colors, this.config.ball_size);
          mb.objects.push(water_balls);
        } else if (water_style === 'cross') {
          const vertex_arr = [];
          const color_arr = [];
          for (let i = 0; i < waters.length; i++) {
            addXyzCross(vertex_arr, waters[i].xyz, 0.7);
            for (let n = 0; n < 6; n++) color_arr.push(water_colors[i]);
          }
          if (vertex_arr.length > 0) {
            const material = makeLineMaterial({ 
              linewidth: this.config.bond_line, 
              win_size: mb.win_size 
            });
            const obj = makeLineSegments(material, vertex_arr, color_arr);
            mb.objects.push(obj);
          }
        }
        waters.forEach(w => _optionalChain$5([mb, 'access', _ => _.atom_array, 'optionalAccess', _2 => _2.push, 'call', _3 => _3(w)]));
      }
    }

    for (const obj of mb.objects) {
      group.add(obj);
    }

    if (scene) {
      scene.add(group);
    }

    return group;
  }

  /**
   * Create a selection marker for an atom
   */
  create_selection_marker(atom, color, size) {
    return makeWheels([atom], [color], size);
  }

  /**
   * Create a label for an atom
   */
  create_label(text, pos, font, color, 
               win_size, z_shift = 0.2) {
    return new Label(text, { pos, font, color, win_size, z_shift });
  }

  /**
   * Create the center marker cube
   */
  create_center_marker(size, center, color) {
    return makeCube(size, center, { color, linewidth: 2 });
  }

  /**
   * Create unit cell box
   */
  create_cell_box(uc_func, color) {
    return makeRgbBox(uc_func, color);
  }
}

class MapRenderer {
  

  constructor(config) {
    this.config = config;
  }

  /**
   * Check if any map bags need reloading based on camera position.
   */
  check_and_reload(bags, camera_pos, scene) {
    for (const map_bag of bags) {
      if (!map_bag.visible) continue;

      const map_pos = map_bag.block_ctr;
      const radius = this.config.map_radius;
      const dist_sq = camera_pos.distanceToSquared(map_pos);
      const radius_sq = radius * radius;

      if (dist_sq > radius_sq * 0.5) { // Reload when moved 70% of radius
        this.load_block(map_bag, camera_pos, scene);
      }
    }
  }

  /**
   * Load a new block of electron density map data centered at the given position.
   */
  load_block(map_bag, center, scene) {
    // Remove old objects from scene
    for (const obj of map_bag.el_objects || []) {
      scene.remove(obj);
      if ((obj ).geometry) (obj ).geometry.dispose();
      if ((obj ).material) {
        if (Array.isArray((obj ).material)) {
          (obj ).material.forEach((m) => m.dispose());
        } else {
          (obj ).material.dispose();
        }
      }
    }
    map_bag.el_objects = [];

    const map = map_bag.map;
    if (!map) return;

    // Update block center
    map_bag.block_ctr.copy(center);

    // Get isosurface method from config
    const style = this.config.map_style || 'marching cubes';
    const method = map_style_method(style);
    const is_surface = map_style_is_surface(style);

    // Prepare the isosurface block
    try {
      const center_array = [center.x, center.y, center.z];
      map.prepare_isosurface(this.config.map_radius, center_array, true);

      // Generate isosurfaces for each type (positive/negative for diff maps)
      for (const map_type of map_bag.types || ['map_den']) {
        const isolevel = map_type === 'map_neg' ? -(map_bag.isolevel || 1.5) : (map_bag.isolevel || 1.5);
        
        try {
          const iso_data = map.isomesh_in_block(isolevel, method);
          if (iso_data && iso_data.vertices.length > 0) {
            const color = this.get_map_color(map_type);
            const linewidth = this.config.map_line;

            let obj;
            if (is_surface) {
              obj = makeSmoothSurface(iso_data, {
                color: color,
                linewidth: linewidth,
                opacity: 0.24,
              });
            } else {
              obj = makeChickenWire(iso_data, {
                color: color,
                linewidth: linewidth,
              });
            }

            if (obj) {
              (obj ).userData = { map_bag, map_type };
              map_bag.el_objects.push(obj);
              scene.add(obj);
            }
          }
        } catch (e2) {
          // Silently skip failed isosurfaces
        }
      }
    } catch (e) {
      console.error('Failed to load map block:', e);
    }
  }

  /**
   * Force redraw of all maps (useful when isolevel or style changes).
   */
  redraw_all(bags) {
    for (const map_bag of bags) {
      if (!map_bag.visible) continue;
      // Reset block center to force reload
      map_bag.block_ctr.set(Infinity, 0, 0);
    }
  }

  /**
   * Change the isolevel for a map and trigger redraw.
   */
  change_isolevel(map_bag, delta, scene, camera_pos) {
    const new_level = Math.round(((map_bag.isolevel || 1.5) + delta) * 10) / 10;
    map_bag.isolevel = new_level;
    // Force reload by resetting block center
    map_bag.block_ctr.set(Infinity, 0, 0);
    this.check_and_reload([map_bag], camera_pos, scene);
    return new_level;
  }

  /**
   * Get the color for a map type from the current color scheme.
   */
   get_map_color(map_type) {
    const colors = this.config.colors;
    if (!colors) return new Color(0x808080);

    switch (map_type) {
      case 'map_pos': return colors.map_pos || new Color(0x298029);
      case 'map_neg': return colors.map_neg || new Color(0x8B2E2E);
      case 'map_den':
      default:
        return colors.map_den || new Color(0x3362B2);
    }
  }
}

function _optionalChain$4(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; } 

class EventManager {
  
  
  
  
  // Unified callback interface
  





  constructor() {
    this.key_handlers = new Map();
    this.shift_key_handlers = new Map();
    this.ctrl_key_handlers = new Map();
    this.callbacks = {};
  }

  setup_default_handlers(viewer) {
    // Navigation
    this.on('n', () => {
      const site = viewer.next_site();
      if (site) {
        const center = viewer.get_center_for_site(site);
        if (center) _optionalChain$4([this, 'access', _ => _.callbacks, 'access', _2 => _2.on_center, 'optionalCall', _3 => _3(center)]);
      }
      return true;
    });

    this.on('p', () => {
      const site = viewer.prev_site();
      if (site) {
        const center = viewer.get_center_for_site(site);
        if (center) _optionalChain$4([this, 'access', _4 => _4.callbacks, 'access', _5 => _5.on_center, 'optionalCall', _6 => _6(center)]);
      }
      return true;
    });

    // Keys that just trigger redraw
    const redraw_keys = ['b', 'c', 'r', 'l', 'q', 'w', 'h', 'i', ' '];
    for (const key of redraw_keys) {
      this.on(key, () => {
        _optionalChain$4([this, 'access', _7 => _7.callbacks, 'access', _8 => _8.on_redraw, 'optionalCall', _9 => _9()]);
        return true;
      });
    }

    // Deletion
    this.on('d', () => {
      _optionalChain$4([this, 'access', _10 => _10.callbacks, 'access', _11 => _11.on_update_hud, 'optionalCall', _12 => _12('Delete: select atoms first')]);
      return true;
    });

    // Undo/Redo
    this.on_ctrl('z', () => {
      _optionalChain$4([this, 'access', _13 => _13.callbacks, 'access', _14 => _14.on_update_hud, 'optionalCall', _15 => _15('Undo not implemented')]);
      return true;
    });

    this.on_ctrl('y', () => {
      _optionalChain$4([this, 'access', _16 => _16.callbacks, 'access', _17 => _17.on_update_hud, 'optionalCall', _18 => _18('Redo not implemented')]);
      return true;
    });
  }

  // Helper to register handlers
  on(key, handler) {
    this.key_handlers.set(key, handler);
  }

  on_shift(key, handler) {
    this.shift_key_handlers.set(key, handler);
  }

  on_ctrl(key, handler) {
    this.ctrl_key_handlers.set(key, handler);
  }

  handle_keydown(event) {
    const key = event.key.toLowerCase();

    if (event.ctrlKey || event.metaKey) {
      const handler = this.ctrl_key_handlers.get(key);
      if (handler) {
        event.preventDefault();
        return handler(event);
      }
      return false;
    }

    if (event.shiftKey) {
      const handler = this.shift_key_handlers.get(event.key);
      if (handler) {
        event.preventDefault();
        return handler(event);
      }
    }

    const handler = this.key_handlers.get(key);
    if (handler) {
      event.preventDefault();
      return handler(event);
    }

    return false;
  }

  // Mouse event handling
  handle_mousedown(event, pick_fn) {
    const rect = (event.target ).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return pick_fn(x, y);
  }

  handle_wheel(event, zoom_fn) {
    event.preventDefault();
    zoom_fn(event.deltaY);
    return true;
  }

  handle_contextmenu(event) {
    event.preventDefault();
    return true;
  }
}

function _optionalChain$3(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }
class UIManager {
  
  
  
  
  

  constructor(container) {
    this.container = container;
    this.hud = null;
    this.title_element = null;
    this.help_panel = null;
    this.is_help_visible = false;
  }

  create_hud() {
    const hud = document.createElement('div');
    hud.className = 'gm-hud';
    hud.textContent = INIT_HUD_TEXT;
    this.container.appendChild(hud);
    this.hud = hud;
    return hud;
  }

  update_hud(text) {
    if (this.hud) {
      this.hud.textContent = text;
    }
  }

  update_hud_html(html) {
    if (this.hud) {
      this.hud.innerHTML = html;
    }
  }

  set_title(text) {
    if (this.title_element) {
      this.title_element.textContent = text;
    }
  }

  show_help() {
    if (this.help_panel) {
      this.help_panel.style.display = 'block';
      this.is_help_visible = true;
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'gm-help-panel';
    panel.innerHTML = this.get_help_content();
    this.container.appendChild(panel);
    this.help_panel = panel;
    this.is_help_visible = true;

    // Close on click outside
    panel.addEventListener('click', (e) => {
      if (e.target === panel) {
        this.hide_help();
      }
    });
  }

  hide_help() {
    if (this.help_panel) {
      this.help_panel.style.display = 'none';
    }
    this.is_help_visible = false;
  }

  toggle_help() {
    if (this.is_help_visible) {
      this.hide_help();
    } else {
      this.show_help();
    }
  }

   get_help_content() {
    return `
      <div class="gm-help-content">
        <h3>Keyboard Shortcuts</h3>
        <table>
          <tr><td><kbd>n</kbd></td><td>Next ligand/site</td></tr>
          <tr><td><kbd>p</kbd></td><td>Previous ligand/site</td></tr>
          <tr><td><kbd>b</kbd></td><td>Ball & stick</td></tr>
          <tr><td><kbd>c</kbd></td><td>Cartoon</td></tr>
          <tr><td><kbd>r</kbd></td><td>Ribbon</td></tr>
          <tr><td><kbd>l</kbd></td><td>Lines</td></tr>
          <tr><td><kbd>q</kbd></td><td>Toggle ligands</td></tr>
          <tr><td><kbd>w</kbd></td><td>Toggle waters</td></tr>
          <tr><td><kbd>h</kbd></td><td>Toggle hydrogens</td></tr>
          <tr><td><kbd>i</kbd></td><td>Toggle ice (symmetry)</td></tr>
          <tr><td><kbd>Space</kbd></td><td>Cycle colors</td></tr>
          <tr><td><kbd>d</kbd></td><td>Delete selected</td></tr>
          <tr><td><kbd>x</kbd></td><td>Toggle label</td></tr>
          <tr><td><kbd>?</kbd></td><td>Toggle this help</td></tr>
          <tr><td><kbd>Ctrl+Z</kbd></td><td>Undo</td></tr>
          <tr><td><kbd>Ctrl+Y</kbd></td><td>Redo</td></tr>
        </table>
        <p><em>Click background to close</em></p>
      </div>
    `;
  }

  // Dialog for residue mutation
  show_mutation_dialog(residue, chain, resno,
                       on_mutate) {
    const dialog = document.createElement('div');
    dialog.className = 'gm-dialog';

    const common_residues = ['ALA', 'CYS', 'ASP', 'GLU', 'PHE', 'GLY', 'HIS',
                             'ILE', 'LYS', 'LEU', 'MET', 'ASN', 'PRO', 'GLN',
                             'ARG', 'SER', 'THR', 'VAL', 'TRP', 'TYR'];

    let html = `<h3>Mutate ${residue} ${chain}${resno}</h3>`;
    html += '<div class="gm-residue-grid">';
    for (const res of common_residues) {
      html += `<button class="gm-residue-btn" data-res="${res}">${res}</button>`;
    }
    html += '</div>';
    html += '<button class="gm-cancel-btn">Cancel</button>';

    dialog.innerHTML = html;
    this.container.appendChild(dialog);

    // Event handlers
    dialog.querySelectorAll('.gm-residue-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const new_res = (btn ).dataset.res;
        on_mutate(new_res);
        dialog.remove();
      });
    });

    _optionalChain$3([dialog, 'access', _ => _.querySelector, 'call', _2 => _2('.gm-cancel-btn'), 'optionalAccess', _3 => _3.addEventListener, 'call', _4 => _4('click', () => {
      dialog.remove();
    })]);

    // Close on background click
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });
  }

  // Status/progress indicator
  show_progress(text) {
    const indicator = document.createElement('div');
    indicator.className = 'gm-progress';
    indicator.textContent = text;
    this.container.appendChild(indicator);

    return () => {
      indicator.remove();
    };
  }

  // Toast notification
  show_toast(message, duration_ms = 2000) {
    const toast = document.createElement('div');
    toast.className = 'gm-toast';
    toast.textContent = message;
    this.container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, duration_ms);
  }
}

class ModelEditor {constructor() { ModelEditor.prototype.__init.call(this); }
  __init() {this.templates = {};}

  set_templates(templates) {
    this.templates = templates;
  }

  delete_residue(bag, chain, resno) {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    const model = bag.model;
    const indices_to_remove = [];
    let center = [0, 0, 0];
    let count = 0;

    for (let i = 0; i < model.atoms.length; i++) {
      const atom = model.atoms[i];
      if (atom.chain === chain && atom.seqid === String(resno)) {
        indices_to_remove.push(i);
        center[0] += atom.xyz[0];
        center[1] += atom.xyz[1];
        center[2] += atom.xyz[2];
        count++;
      }
    }

    if (indices_to_remove.length === 0) {
      return { success: false, message: `No atoms found for ${chain}/${resno}` };
    }

    // Remove atoms (from end to start to preserve indices)
    for (let i = indices_to_remove.length - 1; i >= 0; i--) {
      model.atoms.splice(indices_to_remove[i], 1);
    }

    // Renumber remaining atoms
    for (let i = 0; i < model.atoms.length; i++) {
      model.atoms[i].i_seq = i;
    }

    // Rebuild bonds
    this.rebuild_bonds(model);

    center = count > 0 ? [center[0] / count, center[1] / count, center[2] / count] : center;

    return {
      success: true,
      message: `Deleted ${indices_to_remove.length} atoms from ${chain}/${resno}`,
      center,
      affected_atoms: indices_to_remove.length,
    };
  }

  delete_chain(bag, chain) {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    const model = bag.model;
    const initial_count = model.atoms.length;
    
    // Filter out atoms from this chain
    model.atoms = model.atoms.filter((atom) => {
      if (atom.chain !== chain) return true;
      return false;
    });

    const removed = initial_count - model.atoms.length;
    if (removed === 0) {
      return { success: false, message: `No atoms found for chain ${chain}` };
    }

    // Renumber
    for (let i = 0; i < model.atoms.length; i++) {
      model.atoms[i].i_seq = i;
    }

    this.rebuild_bonds(model);

    return {
      success: true,
      message: `Deleted chain ${chain} (${removed} atoms)`,
      affected_atoms: removed,
    };
  }

  delete_atom(bag, atom_index) {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    if (atom_index < 0 || atom_index >= bag.model.atoms.length) {
      return { success: false, message: 'Invalid atom index' };
    }

    const atom = bag.model.atoms[atom_index];
    const center = atom.xyz.slice();
    
    bag.model.atoms.splice(atom_index, 1);

    // Renumber
    for (let i = 0; i < bag.model.atoms.length; i++) {
      bag.model.atoms[i].i_seq = i;
    }

    this.rebuild_bonds(bag.model);

    return {
      success: true,
      message: `Deleted atom ${atom.name}`,
      center,
      affected_atoms: 1,
    };
  }

  mutate_residue(bag, chain, resno, new_resname) {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    const template = this.templates[new_resname];
    if (!template) {
      return { success: false, message: `Unknown residue: ${new_resname}` };
    }

    const model = bag.model;
    const target_resno = String(resno);
    
    // Find existing atoms
    const existing_atoms = model.atoms.filter(
      a => a.chain === chain && a.seqid === target_resno
    );

    if (existing_atoms.length === 0) {
      return { success: false, message: `No atoms found at ${chain}/${resno}` };
    }

    const ca_atom = existing_atoms.find(a => a.name === 'CA');
    if (!ca_atom) {
      return { success: false, message: 'Residue lacks CA atom' };
    }

    const [cx, cy, cz] = ca_atom.xyz;
    const center = [cx, cy, cz];

    // Keep backbone atoms
    const backbone_names = ['N', 'CA', 'C', 'O', 'OXT', 'OT1', 'OT2'];
    const hydrogens = ['H', 'H1', 'H2', 'H3', 'HA', 'HA2', 'HA3'];
    const keep_names = [...backbone_names, ...hydrogens];
    
    // Remove non-backbone atoms
    for (let i = model.atoms.length - 1; i >= 0; i--) {
      const atom = model.atoms[i];
      if (atom.chain === chain && atom.seqid === target_resno) {
        if (!keep_names.includes(atom.name)) {
          model.atoms.splice(i, 1);
        } else {
          // Update residue name for kept atoms
          atom.resname = new_resname;
        }
      }
    }

    // Add new side chain atoms from template
    for (const ta of template.atoms) {
      if (keep_names.includes(ta.name)) continue;
      
      model.atoms.push({
        i_seq: model.atoms.length,
        name: ta.name,
        element: ta.element,
        xyz: [cx + ta.xyz[0], cy + ta.xyz[1], cz + ta.xyz[2]],
        chain,
        seqid: target_resno,
        resname: new_resname,
        b: 30.0,
        occ: 1.0,
        is_ligand: false,
      } );
    }

    this.rebuild_bonds(model);

    return {
      success: true,
      message: `Mutated to ${new_resname}`,
      center,
    };
  }

  trim_residues(bag, chain, n_keep, c_keep) {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    const chain_atoms = bag.model.atoms.filter(a => a.chain === chain);
    if (chain_atoms.length === 0) {
      return { success: false, message: `No atoms in chain ${chain}` };
    }

    // Get unique residue numbers sorted
    const resnos = [...new Set(chain_atoms.map(a => parseInt(a.seqid, 10)))]
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    if (resnos.length <= n_keep + c_keep) {
      return { success: false, message: 'Chain too short to trim' };
    }

    const keep_set = new Set([
      ...resnos.slice(0, n_keep),
      ...resnos.slice(-c_keep),
    ]);

    const initial_count = bag.model.atoms.length;
    
    bag.model.atoms = bag.model.atoms.filter(atom => {
      if (atom.chain !== chain) return true;
      const resno = parseInt(atom.seqid, 10);
      return keep_set.has(resno);
    });

    const removed = initial_count - bag.model.atoms.length;

    // Renumber
    for (let i = 0; i < bag.model.atoms.length; i++) {
      bag.model.atoms[i].i_seq = i;
    }

    this.rebuild_bonds(bag.model);

    return {
      success: true,
      message: `Trimmed chain ${chain} to ${keep_set.size} residues`,
      affected_atoms: removed,
    };
  }

  trim_to_alanine(bag, chain, resno) {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    const target_resno = String(resno);
    const ala_atoms = ['N', 'CA', 'C', 'O', 'CB', 'H', 'HA', 'HB1', 'HB2', 'HB3'];
    
    const residue_atoms = bag.model.atoms.filter(
      a => a.chain === chain && a.seqid === target_resno
    );
    
    if (residue_atoms.length === 0) {
      return { success: false, message: `No atoms at ${chain}/${resno}` };
    }

    const has_cb = residue_atoms.some(a => a.name === 'CB');
    if (!has_cb) {
      return { success: false, message: 'Residue lacks CB, cannot trim to Ala' };
    }

    let center = [0, 0, 0];
    let count = 0;

    // Remove non-Ala atoms
    for (let i = bag.model.atoms.length - 1; i >= 0; i--) {
      const atom = bag.model.atoms[i];
      if (atom.chain === chain && atom.seqid === target_resno) {
        center[0] += atom.xyz[0];
        center[1] += atom.xyz[1];
        center[2] += atom.xyz[2];
        count++;
        
        if (!ala_atoms.includes(atom.name)) {
          bag.model.atoms.splice(i, 1);
        } else {
          atom.resname = 'ALA';
        }
      }
    }

    // Renumber
    for (let i = 0; i < bag.model.atoms.length; i++) {
      bag.model.atoms[i].i_seq = i;
    }

    this.rebuild_bonds(bag.model);

    center = count > 0 ? [center[0] / count, center[1] / count, center[2] / count] : center;

    return {
      success: true,
      message: `Trimmed to Alanine`,
      center,
    };
  }

  place_residue(bag, resname, position,
                chain, resno) {
    const template = this.templates[resname];
    if (!template) {
      return { success: false, message: `Unknown residue: ${resname}` };
    }

    const [cx, cy, cz] = position;
    const target_resno = String(resno);

    for (const ta of template.atoms) {
      bag.model.atoms.push({
        i_seq: bag.model.atoms.length,
        name: ta.name,
        element: ta.element,
        xyz: [cx + ta.xyz[0], cy + ta.xyz[1], cz + ta.xyz[2]],
        chain,
        seqid: target_resno,
        resname,
        b: 40.0,
        occ: 1.0,
        is_ligand: false,
      } );
    }

    this.rebuild_bonds(bag.model);

    return {
      success: true,
      message: `Placed ${resname} at ${chain}/${resno}`,
      center: position,
    };
  }

   rebuild_bonds(model) {
    if (model.recalculate_bonds) {
      model.recalculate_bonds();
    }
    if (model.calculate_cubicles) {
      model.calculate_cubicles();
    }
  }
}

function _optionalChain$2(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }



class NavigationManager {constructor() { NavigationManager.prototype.__init.call(this);NavigationManager.prototype.__init2.call(this);NavigationManager.prototype.__init3.call(this);NavigationManager.prototype.__init4.call(this); }
  __init() {this.model_bags = [];}
  __init2() {this.sites = [];}
  __init3() {this.connections = [];}
  __init4() {this.current_site = -1;}

  set_models(bags) {
    this.model_bags = bags;
    this.rebuild_navigation();
  }

  rebuild_navigation() {
    this.sites = [];
    this.connections = [];
    this.current_site = -1;

    for (let idx = 0; idx < this.model_bags.length; idx++) {
      const bag = this.model_bags[idx];
      this.extract_sites(bag, idx);
      this.extract_connections(bag, idx);
    }
  }

   extract_sites(bag, model_idx) {
    if (!bag.model) return;
    const model = bag.model;

    // Extract ligands
    const ligand_residues = new Map();
    for (const atom of model.atoms) {
      if (atom.is_ligand && !atom.is_water()) {
        const key = `${atom.chain}/${atom.seqid}`;
        if (!ligand_residues.has(key)) ligand_residues.set(key, []);
        ligand_residues.get(key).push(atom);
      }
    }

    for (const atoms of ligand_residues.values()) {
      if (atoms.length === 0) continue;
      const first = atoms[0];
      this.sites.push({
        label: `Ligand ${first.resname} ${first.seqid}/${first.chain}`,
        index: model_idx,
        atom_indices: atoms.map(a => a.i_seq),
      });
    }

    // Extract metals
    for (const atom of model.atoms) {
      if (atom.is_metal) {
        this.sites.push({
          label: `Metal ${atom.element} ${atom.resname || ''} ${atom.seqid}/${atom.chain}`,
          index: model_idx,
          atom_indices: [atom.i_seq],
        });
      }
    }

    // Extract from gemmi structure sites if available
    const gemmi_sites = this.extract_gemmi_sites(bag, model_idx);
    this.sites.push(...gemmi_sites);
  }

   extract_gemmi_sites(bag, model_idx) {
    const sites = [];
    const ctx = bag.gemmi_selection;
    if (!_optionalChain$2([ctx, 'optionalAccess', _ => _.structure, 'optionalAccess', _2 => _2.sites])) return sites;

    try {
      const gemmi_sites = ctx.structure.sites;
      for (let i = 0; i < gemmi_sites.size(); i++) {
        const site = gemmi_sites.get(i);
        if (!site) continue;
        
        try {
          const atom_indices = [];
          const members = site.members;
          
          for (let j = 0; j < members.size(); j++) {
            const member = members.get(j);
            if (!member) continue;
            
            try {
              const auth = member.auth;
              const res_id = auth.res_id;
              const chain = auth.chain_name || member.label_asym_id || '';
              const seqid = res_id.seqid_string || member.label_seq_string || '';
              
              const atoms = _optionalChain$2([bag, 'access', _3 => _3.model, 'optionalAccess', _4 => _4.get_residues, 'call', _5 => _5(), 'access', _6 => _6[`${seqid}/${chain}`]]);
              if (atoms) {
                for (const atom of atoms) {
                  if (!atom_indices.includes(atom.i_seq)) atom_indices.push(atom.i_seq);
                }
              }
              
              _optionalChain$2([res_id, 'access', _7 => _7.delete, 'optionalCall', _8 => _8()]);
              _optionalChain$2([auth, 'access', _9 => _9.delete, 'optionalCall', _10 => _10()]);
            } finally {
              _optionalChain$2([member, 'access', _11 => _11.delete, 'optionalCall', _12 => _12()]);
            }
          }
          
          _optionalChain$2([members, 'access', _13 => _13.delete, 'optionalCall', _14 => _14()]);
          
          if (atom_indices.length > 0) {
            let label = site.name || `Site ${i + 1}`;
            if (site.details) label += ` - ${site.details}`;
            sites.push({ label, index: model_idx, atom_indices });
          }
        } finally {
          _optionalChain$2([site, 'access', _15 => _15.delete, 'optionalCall', _16 => _16()]);
        }
      }
      _optionalChain$2([gemmi_sites, 'access', _17 => _17.delete, 'optionalCall', _18 => _18()]);
    } catch (e) {
      console.warn('Failed to extract gemmi sites:', e);
    }
    
    return sites;
  }

   extract_connections(bag, model_idx) {
    const ctx = bag.gemmi_selection;
    if (!_optionalChain$2([ctx, 'optionalAccess', _19 => _19.structure, 'optionalAccess', _20 => _20.connections])) return;

    try {
      const connections = ctx.structure.connections;
      for (let i = 0; i < connections.size(); i++) {
        const conn = connections.get(i);
        if (!conn) continue;
        
        try {
          // Skip hydrogen bonds and unknown
          if (conn.type === _optionalChain$2([ctx, 'access', _21 => _21.gemmi, 'optionalAccess', _22 => _22.ConnectionType, 'optionalAccess', _23 => _23.Hydrog]) ||
              conn.type === _optionalChain$2([ctx, 'access', _24 => _24.gemmi, 'optionalAccess', _25 => _25.ConnectionType, 'optionalAccess', _26 => _26.Unknown])) continue;
          
          const kind = conn.type === _optionalChain$2([ctx, 'access', _27 => _27.gemmi, 'optionalAccess', _28 => _28.ConnectionType, 'optionalAccess', _29 => _29.Disulf]) ? 'SSBOND' : 'LINK';
          
          const p1 = conn.partner1;
          const p2 = conn.partner2;
          if (!p1 || !p2) continue;
          
          const chain1 = p1.chain_name || '';
          const chain2 = p2.chain_name || '';
          const seqid1 = _optionalChain$2([p1, 'access', _30 => _30.res_id, 'optionalAccess', _31 => _31.seqid_string]) || '';
          const seqid2 = _optionalChain$2([p2, 'access', _32 => _32.res_id, 'optionalAccess', _33 => _33.seqid_string]) || '';
          const resname1 = _optionalChain$2([p1, 'access', _34 => _34.res_id, 'optionalAccess', _35 => _35.name]) || '';
          const resname2 = _optionalChain$2([p2, 'access', _36 => _36.res_id, 'optionalAccess', _37 => _37.name]) || '';
          
          const atoms1 = _optionalChain$2([bag, 'access', _38 => _38.model, 'optionalAccess', _39 => _39.get_residues, 'call', _40 => _40(), 'access', _41 => _41[`${seqid1}/${chain1}`]]) || [];
          const atoms2 = _optionalChain$2([bag, 'access', _42 => _42.model, 'optionalAccess', _43 => _43.get_residues, 'call', _44 => _44(), 'access', _45 => _45[`${seqid2}/${chain2}`]]) || [];
          
          const atom_indices = [...atoms1, ...atoms2].map(a => a.i_seq);
          if (atom_indices.length === 0) continue;
          
          const suffix = conn.asu === _optionalChain$2([ctx, 'access', _46 => _46.gemmi, 'optionalAccess', _47 => _47.Asu, 'optionalAccess', _48 => _48.Different]) ? ' [sym]' : '';
          const label = `${kind} ${chain1}/${seqid1} ${resname1} - ${chain2}/${seqid2} ${resname2}${suffix}`;
          
          this.connections.push({
            label,
            index: model_idx,
            atom_indices,
            anchor_index: atom_indices[0],
          });
          
          _optionalChain$2([p1, 'access', _49 => _49.res_id, 'optionalAccess', _50 => _50.delete, 'optionalCall', _51 => _51()]);
          _optionalChain$2([p2, 'access', _52 => _52.res_id, 'optionalAccess', _53 => _53.delete, 'optionalCall', _54 => _54()]);
          _optionalChain$2([p1, 'access', _55 => _55.delete, 'optionalCall', _56 => _56()]);
          _optionalChain$2([p2, 'access', _57 => _57.delete, 'optionalCall', _58 => _58()]);
        } finally {
          _optionalChain$2([conn, 'access', _59 => _59.delete, 'optionalCall', _60 => _60()]);
        }
      }
      _optionalChain$2([connections, 'access', _61 => _61.delete, 'optionalCall', _62 => _62()]);
    } catch (e) {
      console.warn('Failed to extract connections:', e);
    }
  }

  next_site() {
    if (this.sites.length === 0) return null;
    this.current_site = (this.current_site + 1) % this.sites.length;
    return this.sites[this.current_site];
  }

  prev_site() {
    if (this.sites.length === 0) return null;
    this.current_site = this.current_site <= 0 ? this.sites.length - 1 : this.current_site - 1;
    return this.sites[this.current_site];
  }

  get_center_for_site(site) {
    const bag = this.model_bags[site.index];
    if (!_optionalChain$2([bag, 'optionalAccess', _63 => _63.model])) return null;

    let cx = 0, cy = 0, cz = 0, count = 0;
    for (const idx of site.atom_indices) {
      const atom = bag.model.atoms[idx];
      if (atom) {
        cx += atom.xyz[0];
        cy += atom.xyz[1];
        cz += atom.xyz[2];
        count++;
      }
    }

    return count > 0 ? [cx / count, cy / count, cz / count] : null;
  }

  parse_cid(cid) {
    const parts = cid.split('/').filter(p => p.length > 0);
    if (parts.length === 0) return null;

    const result = {};
    if (parts[0] && parts[0] !== '*') result.chain = parts[0];
    if (parts[1] && parts[1] !== '*') result.resno = parseInt(parts[1], 10);
    if (parts[2] && parts[2] !== '*') result.atom = parts[2];

    return result;
  }

  find_atom_by_cid(cid) {
    const parsed = this.parse_cid(cid);
    if (!parsed) return null;

    for (const bag of this.model_bags) {
      if (!bag.model) continue;
      for (const atom of bag.model.atoms) {
        if (parsed.chain && atom.chain !== parsed.chain) continue;
        if (parsed.resno !== undefined && atom.seqid !== String(parsed.resno)) continue;
        if (parsed.atom && atom.name !== parsed.atom) continue;
        return { bag, atom };
      }
    }
    return null;
  }

  get_site_menu_items() {
    return this.sites.map((site, idx) => ({
      label: site.label,
      value: String(idx),
    }));
  }

  get_connection_menu_items() {
    return this.connections.map((conn, idx) => ({
      label: conn.label,
      value: String(idx),
    }));
  }
}

function _optionalChain$1(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }

class VisibilityManager {constructor() { VisibilityManager.prototype.__init.call(this);VisibilityManager.prototype.__init2.call(this); }
  __init() {this.model_bags = [];}
  __init2() {this.map_bags = [];}

  set_bags(model_bags, map_bags) {
    this.model_bags = model_bags;
    this.map_bags = map_bags;
  }

  show_all_models(visible = true) {
    for (const bag of this.model_bags) bag.visible = visible;
  }

  show_all_maps(visible = true) {
    for (const bag of this.map_bags) bag.visible = visible;
  }

  toggle_model(index) {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.visible = !bag.visible;
    return bag.visible;
  }

  toggle_map(index) {
    const bag = this.map_bags[index];
    if (!bag) return false;
    bag.visible = !bag.visible;
    return bag.visible;
  }

  remove_model(index) {
    if (index < 0 || index >= this.model_bags.length) return false;
    this.model_bags.splice(index, 1);
    return true;
  }

  remove_map(index) {
    if (index < 0 || index >= this.map_bags.length) return false;
    this.map_bags.splice(index, 1);
    return true;
  }

  get_visible_models() {
    return this.model_bags.filter(b => b.visible);
  }

  get_visible_maps() {
    return this.map_bags.filter(b => b.visible);
  }

  set_hue_shift(index, shift) {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.hue_shift = shift;
    return true;
  }

  set_color_override(index, fn) {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.color_override = fn;
    return true;
  }

  has_symmetry() {
    return this.model_bags.some(b => _optionalChain$1([b, 'access', _ => _.model, 'optionalAccess', _2 => _2.unit_cell]));
  }

  serialize() {
    return {
      models: this.model_bags.map(b => ({
        label: b.label,
        visible: b.visible,
        hue_shift: b.hue_shift,
      })),
      maps: this.map_bags.map(b => ({
        name: b.name || '',
        visible: b.visible,
        isolevel: b.isolevel || 1.5,
      })),
    };
  }

  // Toggle visibility of inactive models (show only active one)
  toggle_inactive_models(active_bag) {
    const visible_count = this.model_bags.filter(b => b.visible).length;
    const show_all = visible_count < this.model_bags.length;
    
    if (show_all) {
      this.show_all_models(true);
      return true;
    } else {
      // Hide all except active
      for (const bag of this.model_bags) {
        bag.visible = bag === active_bag;
      }
      return false;
    }
  }

  // Get the active (first visible or first) model bag
  get_active_bag() {
    return this.model_bags.find(b => b.visible) || this.model_bags[0] || null;
  }

  // Get editable bag (one with gemmi_selection that's not symmetry)
  get_editable_bag() {
    return this.model_bags.find(b => 
      b.symop === '' && b.gemmi_selection
    ) || null;
  }

  // Check if any model has gemmi data
  has_gemmi_models() {
    return this.model_bags.some(b => b.gemmi_selection);
  }
}

function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }

/**
 * Main Viewer class - facade that coordinates all subsystems
 * Maintains backward-compatible API while delegating to specialized managers
 */
class Viewer {
  // Configuration
  

  // State
  
  
  
  

  // Subsystems
  
  
  
  
  
  
  

  // Three.js references (set by caller)
  
  
  
  

  // Backward compatibility properties
  
  
  

  // Gemmi module reference
  
  

  // Static help properties
  
  

  // Public properties for subclasses
  
  
  
  
  
  

  constructor(options) {Viewer.prototype.__init.call(this);
    const opts = normalize_viewer_options(options);

    this.config = { ...DEFAULT_CONFIG };
    this.apply_options(opts);

    this.model_bags = [];
    this.map_bags = [];
    this.selected = null;
    this.win_size = [800, 600];

    // Initialize subsystems
    this.model_renderer = new ModelRenderer(this.config);
    this.map_renderer = new MapRenderer(this.config);
    this.editor = new ModelEditor();
    this.navigation = new NavigationManager();
    this.visibility = new VisibilityManager();
    this.events = new EventManager();
    this.ui = null;

    // Setup event callbacks
    this.events.callbacks = {
      on_redraw: () => this.redraw_all(),
      on_center: (pos) => this.go_to(pos),
      on_update_hud: (text) => this.update_hud(text),
    };

    // Three.js references (will be set by init)
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // Backward compatibility initialization
    this.key_bindings = [];
    this.default_camera_pos = [0, 0, 100];
    this.decor = { cell_box: null, selection: null, zoom_grid: null, mark: null };
    this.gemmi_module = null;
    this.gemmi_factory = null;

    // Initialize subclass properties
    this.target = null;
    this.blob_hits = [];
    this.blob_map_bag = null;
    this.blob_objects = [];
    this.blob_focus_index = -1;
    this.blob_negate = false;
  }

  // Initialize with Three.js objects
  init(scene, camera, renderer, controls, container) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.ui = new UIManager(container);
    this.ui.create_hud();

    // Setup default event handlers
    this.events.setup_default_handlers(this);

    // Update window size
    this.win_size = [container.clientWidth, container.clientHeight];
    this.visibility.set_bags(this.model_bags, this.map_bags);
  }

   apply_options(opts) {
    for (const [key, val] of Object.entries(opts)) {
      if (key in this.config) {
        (this.config )[key] = val;
      }
    }
    // Apply color scheme
    if (this.config.color_scheme in ColorSchemes$1) {
      this.config.colors = ColorSchemes$1[this.config.color_scheme];
    }
  }

  // Load structure (backward compatible)
  load_structure(model, label) {
    const bag = createModelBag(model, this.config, this.win_size);
    if (label) bag.label = label;
    this.model_bags.push(bag);
    this.visibility.set_bags(this.model_bags, this.map_bags);
    this.navigation.set_models(this.model_bags);
    return bag;
  }

  // Add map (backward compatible)
  add_map(map, is_diff_map = false) {
    const bag = createMapBag(map, this.config, is_diff_map);
    this.map_bags.push(bag);
    this.visibility.set_bags(this.model_bags, this.map_bags);
    return bag;
  }

  // Redraw all models and maps
  redraw_all() {
    if (!this.scene) return;

    for (const bag of this.model_bags) {
      const group = this.model_renderer.redraw_model(bag);
      this.scene.add(group);
    }

    this.map_renderer.check_and_reload(this.map_bags, this.camera.position, this.scene);
  }

  redraw_model(bag) {
    if (!this.scene) return;
    const group = this.model_renderer.redraw_model(bag);
    this.scene.add(group);
  }

  redraw_maps() {
    if (!this.scene) return;
    this.map_renderer.check_and_reload(this.map_bags, this.camera.position, this.scene);
  }

  // Navigation
  go_to(position) {
    if (!this.controls) return;
    this.controls.target.set(position[0], position[1], position[2]);
    this.controls.update();
  }

  center_on_atom(bag, atom) {
    this.go_to(atom.xyz);
    this.selected = { bag, atom };
    this.update_hud(`${atom.name} ${atom.resname || ''} ${atom.chain}${atom.seqid}`);
  }

  // Style cycling (backward compatible)
  select_next(list, current) {
    const idx = list.indexOf(current);
    return list[(idx + 1) % list.length];
  }

  cycle_mainchain_style() {
    this.config.mainchain_style = this.select_next(
      MAINCHAIN_STYLES,
      this.config.mainchain_style
    );
    this.redraw_all();
  }

  cycle_sidechain_style() {
    this.config.sidechain_style = this.select_next(
      SIDECHAIN_STYLES,
      this.config.sidechain_style
    );
    this.redraw_all();
  }

  cycle_color_prop() {
    this.config.color_prop = this.select_next(
      COLOR_PROPS,
      this.config.color_prop
    );
    this.redraw_all();
  }

  cycle_color_scheme() {
    const schemes = Object.keys(ColorSchemes$1);
    const idx = schemes.indexOf(this.config.color_scheme);
    this.config.color_scheme = schemes[(idx + 1) % schemes.length];
    this.config.colors = ColorSchemes$1[this.config.color_scheme];
    this.redraw_all();
  }

  // Editing operations - delegate to ModelEditor
  set_templates(templates) {
    this.editor.set_templates(templates);
  }

  delete_selected() {
    if (!this.selected) {
      this.update_hud('Nothing selected');
      return { success: false, message: 'Nothing selected' };
    }
    const { bag, atom } = this.selected;
    const result = this.editor.delete_residue(bag, atom.chain, atom.seqid);
    if (result.success) {
      this.redraw_model(bag);
      this.selected = null;
      this.update_hud('Deleted');
    }
    return result;
  }

  delete_residue(bag, chain, resno) {
    const result = this.editor.delete_residue(bag, chain, resno);
    if (result.success) this.redraw_model(bag);
    return result;
  }

  mutate_residue_atom(atom, new_resname) {
    if (!this.selected) return { success: false, message: 'Nothing selected' };
    const bag = this.selected.bag;
    const result = this.editor.mutate_residue(bag, atom.chain, atom.seqid, new_resname);
    if (result.success) {
      this.redraw_model(bag);
      this.update_hud(`Mutated to ${new_resname}`);
    }
    return result;
  }

  mutate_residue(bag, chain, resno, new_resname) {
    const result = this.editor.mutate_residue(bag, chain, resno, new_resname);
    if (result.success) this.redraw_model(bag);
    return result;
  }

  trim_chain(bag, chain, n_keep, c_keep) {
    const result = this.editor.trim_residues(bag, chain, n_keep, c_keep);
    if (result.success) this.redraw_model(bag);
    return result;
  }

  place_residue(bag, resname, position,
                chain, resno) {
    const result = this.editor.place_residue(bag, resname, position, chain, resno);
    if (result.success) this.redraw_model(bag);
    return result;
  }

  // HUD update (backward compatible alias)
  hud(text, type) {
    if (type === 'ERR') {
      console.error('ERR:', text);
    }
    _optionalChain([this, 'access', _ => _.ui, 'optionalAccess', _2 => _2.update_hud, 'call', _3 => _3(text)]);
  }

  update_hud(text) {
    _optionalChain([this, 'access', _4 => _4.ui, 'optionalAccess', _5 => _5.update_hud, 'call', _6 => _6(text)]);
  }

  // Request render (backward compatible)
  request_render() {
    // In the new architecture, rendering is handled automatically
  }

  // Load file via XHR (backward compatible)
  load_file(url, options,
            callback) {
    const req = new XMLHttpRequest();
    req.open('GET', url, true);
    if (options.binary) {
      req.responseType = 'arraybuffer';
    }
    if (this.xhr_headers) {
      for (const [key, val] of Object.entries(this.xhr_headers)) {
        req.setRequestHeader(key, val);
      }
    }
    req.onload = () => {
      if (req.status === 200) {
        callback(req);
      } else {
        this.hud(`Failed to load ${url}: ${req.status}`, 'ERR');
      }
    };
    req.onerror = () => {
      this.hud(`Failed to load ${url}`, 'ERR');
    };
    req.send();
  }

  // XHR headers storage
  __init() {this.xhr_headers = {};}

  // Set dropzone for drag-and-drop (backward compatible)
  set_dropzone(element, callback) {
    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    element.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = _optionalChain([e, 'access', _7 => _7.dataTransfer, 'optionalAccess', _8 => _8.files]);
      if (files && files.length > 0) {
        callback(files[0]);
      }
    });
  }

  // Recenter view (backward compatible)
  recenter() {
    // Implementation would depend on having a model loaded
  }

  // Pick PDB and map from file (backward compatible)
  pick_pdb_and_map() {
    return Promise.reject(new Error('pick_pdb_and_map not implemented in new viewer'));
  }

  // Set view from options (backward compatible)
  set_view(options) {
    if (options.xyz) {
      this.go_to(options.xyz);
    }
  }

  // Resolve gemmi module (backward compatible)
  resolve_gemmi() {
    if (this.gemmi_module) {
      return Promise.resolve(this.gemmi_module);
    }
    if (this.gemmi_factory) {
      return this.gemmi_factory();
    }
    const factory = (globalThis ).Gemmi;
    if (typeof factory === 'function') {
      return factory();
    }
    return Promise.reject(new Error('Gemmi factory not available'));
  }

  // Remove and dispose Three.js object (backward compatible)
  remove_and_dispose(obj) {
    if (!obj) return;
    if (this.scene) {
      this.scene.remove(obj);
    }
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (_optionalChain([obj, 'access', _9 => _9.material, 'access', _10 => _10.uniforms, 'optionalAccess', _11 => _11.map, 'optionalAccess', _12 => _12.value])) {
        obj.material.uniforms.map.value.dispose();
      }
      obj.material.dispose();
    }
    if (obj.children) {
      for (const child of obj.children) {
        this.remove_and_dispose(child);
      }
    }
  }

  // Clear electron density objects from map (backward compatible)
  clear_el_objects() {
    // Handled by MapRenderer in new architecture
  }

  // Apply selected option (backward compatible)
  apply_selected_option(key) {
  }

  // Change zoom by factor (backward compatible)
  change_zoom_by_factor(mult) {
    if (this.camera) {
      this.camera.zoom *= mult;
      if (this.camera.updateProjectionMatrix) {
        this.camera.updateProjectionMatrix();
      }
    }
  }

  // Toggle cell box (backward compatible)
  toggle_cell_box() {
    // Stub for backward compatibility
  }

  // Toggle help (backward compatible)
  toggle_help() {
    _optionalChain([this, 'access', _13 => _13.ui, 'optionalAccess', _14 => _14.toggle_help, 'call', _15 => _15()]);
  }

  // Update camera (backward compatible)
  update_camera() {
    if (_optionalChain([this, 'access', _16 => _16.camera, 'optionalAccess', _17 => _17.updateProjectionMatrix])) {
      this.camera.updateProjectionMatrix();
    }
  }

  // Get window size (backward compatible alias)
  get window_size() {
    return this.win_size;
  }

  // Change isolevel (backward compatible)
  change_isolevel_by(map_idx, delta) {
    const bag = this.map_bags[map_idx];
    if (bag) {
      bag.isolevel += delta;
      this.redraw_maps();
    }
  }

  // Change map radius (backward compatible)
  change_map_radius(delta) {
    this.config.map_radius = Math.max(0, Math.min(
      this.config.map_radius + delta,
      this.config.max_map_radius
    ));
    this.redraw_maps();
  }

  // Change slab width (backward compatible)
  change_slab_width_by(delta) {
    if (_optionalChain([this, 'access', _18 => _18.controls, 'optionalAccess', _19 => _19.slab_width])) {
      this.controls.slab_width[0] = Math.max(0.01, this.controls.slab_width[0] + delta);
      this.controls.slab_width[1] = Math.max(0.01, this.controls.slab_width[1] + delta);
    }
  }

  // Event handling (called by main app)
  keydown(event) {
    if (event.key === '?') {
      _optionalChain([this, 'access', _20 => _20.ui, 'optionalAccess', _21 => _21.toggle_help, 'call', _22 => _22()]);
      return true;
    }
    return this.events.handle_keydown(event);
  }

  mousedown(event, pick_fn) {
    return this.events.handle_mousedown(event, pick_fn);
  }

  wheel(event, zoom_fn) {
    return this.events.handle_wheel(event, zoom_fn);
  }

  contextmenu(event) {
    return this.events.handle_contextmenu(event);
  }

  // Resize handling
  resize(width, height) {
    this.win_size = [width, height];
    for (const bag of this.model_bags) {
      bag.win_size = [width, height];
    }
  }

  // Visibility control - delegate to VisibilityManager
  show_all_models(visible = true) {
    this.visibility.show_all_models(visible);
    this.redraw_all();
  }

  show_all_maps(visible = true) {
    this.visibility.show_all_maps(visible);
    this.redraw_maps();
  }

  toggle_model(index) {
    const result = this.visibility.toggle_model(index);
    this.redraw_all();
    return result;
  }

  toggle_map(index) {
    const result = this.visibility.toggle_map(index);
    this.redraw_maps();
    return result;
  }

  remove_model(index) {
    const result = this.visibility.remove_model(index);
    if (result) {
      this.navigation.set_models(this.model_bags);
      this.redraw_all();
    }
    return result;
  }

  remove_map(index) {
    const result = this.visibility.remove_map(index);
    if (result) this.redraw_maps();
    return result;
  }

  get_visible_models() {
    return this.visibility.get_visible_models();
  }

  get_visible_maps() {
    return this.visibility.get_visible_maps();
  }

  set_hue_shift(index, shift) {
    const result = this.visibility.set_hue_shift(index, shift);
    if (result) this.redraw_all();
    return result;
  }

  set_color_override(index, fn) {
    const result = this.visibility.set_color_override(index, fn);
    if (result) this.redraw_all();
    return result;
  }

  has_symmetry() {
    return this.visibility.has_symmetry();
  }

  serialize() {
    return this.visibility.serialize();
  }

  // Navigation - delegate to NavigationManager
  next_site() {
    const site = this.navigation.next_site();
    if (site) {
      const center = this.navigation.get_center_for_site(site);
      if (center) this.go_to(center);
    }
    return site;
  }

  prev_site() {
    const site = this.navigation.prev_site();
    if (site) {
      const center = this.navigation.get_center_for_site(site);
      if (center) this.go_to(center);
    }
    return site;
  }

  get_center_for_site(site) {
    return this.navigation.get_center_for_site(site);
  }

  parse_cid(cid) {
    return this.navigation.parse_cid(cid);
  }

  find_atom_by_cid(cid) {
    return this.navigation.find_atom_by_cid(cid);
  }

  // Cleanup
  dispose() {
    this.model_bags = [];
    this.map_bags = [];
    this.selected = null;
    this.ui = null;
    this.visibility.set_bags([], []);
    this.navigation.set_models([]);
  }
}

// Static help properties
(Viewer ).prototype.KEYBOARD_HELP = 'Keyboard shortcuts not yet implemented.';
(Viewer ).prototype.MOUSE_HELP = 'Mouse controls: left=rotate, middle=zoom, right=pan';

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

  prepare_isosurface(radius, center, _want_block=false) {
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
    options = normalize_viewer_options(options);
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
          self.clear_el_objects();
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

  apply_selected_option(key) {
    if (!key) return;
    switch (key) {
      case 'show_axes':
        this.set_axes();
        break;
      case 'spot_shape':
        this.point_material.fragmentShader = this.config.spot_shape === 'wheel' ?
          round_point_frag : square_point_frag;
        this.point_material.needsUpdate = true;
        break;
      case 'show_only': {
        const idx = SPOT_SEL.indexOf(this.config.show_only);
        this.point_material.uniforms.show_only.value = idx - 2;
        break;
      }
      default:
        return;
    }
    this.request_render();
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
  help_action_link('V = show (un)indexed', {keyCode: 86}),
  help_action_link('A = toggle axes', {keyCode: 65}),
  help_action_link('U = toggle map box', {keyCode: 85}),
  help_action_link('B = bg color', {keyCode: 66}),
  help_action_link('E = toggle fog', {keyCode: 69}),
  help_action_link('M = zoom in', {keyCode: 77}),
  help_action_link('N = zoom out', {keyCode: 78}),
  help_action_link('D = narrower clip', {keyCode: 68}),
  help_action_link('F = wider clip', {keyCode: 70}),
  help_action_link('Shift+, = move clip', {keyCode: 188, shiftKey: true}),
  help_action_link('Shift+. = move clip', {keyCode: 190, shiftKey: true}),
  help_action_link('R = center view', {keyCode: 82}),
  help_action_link('Z = smaller points', {keyCode: 90}),
  help_action_link('X = larger points', {keyCode: 88}),
  help_action_link('S = point shape', {keyCode: 83}),
  help_action_link('P = permalink', {keyCode: 80}),
  help_action_link('Shift+F = full screen', {keyCode: 70, shiftKey: true}),
  help_action_link('← = lower max resolution', {keyCode: 37}),
  help_action_link('→ = higher max resolution', {keyCode: 39}),
  help_action_link('↑ = higher min resolution', {keyCode: 38}),
  help_action_link('↓ = lower min resolution', {keyCode: 40}),
  help_action_link('+ = map level up', {keyCode: 187}),
  help_action_link('- = map level down', {keyCode: 189}),
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
      return viewer.pick_pdb_and_map();
    }
  });
}

exports.BondType = BondType;
exports.BufferAttribute = BufferAttribute;
exports.BufferGeometry = BufferGeometry;
exports.COLOR_PROPS = COLOR_PROPS;
exports.Color = Color;
exports.ColorSchemes = ColorSchemes$1;
exports.Controls = Controls;
exports.ElMap = ElMap;
exports.Fog = Fog;
exports.GridArray = GridArray;
exports.LABEL_FONTS = LABEL_FONTS;
exports.LIGAND_STYLES = LIGAND_STYLES;
exports.Label = Label;
exports.LegacyViewer = Viewer;
exports.Line = Line;
exports.LineSegments = LineSegments;
exports.MAINCHAIN_STYLES = MAINCHAIN_STYLES;
exports.MAP_STYLES = MAP_STYLES;
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
exports.SIDECHAIN_STYLES = SIDECHAIN_STYLES;
exports.STATE = STATE;
exports.Scene = Scene;
exports.ShaderMaterial = ShaderMaterial;
exports.Texture = Texture;
exports.Vector3 = Vector3;
exports.Viewer = Viewer;
exports.WATER_STYLES = WATER_STYLES;
exports.WebGLRenderTarget = WebGLRenderTarget;
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
exports.makeSmoothSurface = makeSmoothSurface;
exports.makeSpaceFilling = makeSpaceFilling;
exports.makeSticks = makeSticks;
exports.makeUniforms = makeUniforms;
exports.makeWheels = makeWheels;
exports.modelFromGemmiStructure = modelFromGemmiStructure;
exports.modelsFromGemmi = modelsFromGemmi;
exports.set_pdb_and_mtz_dropzone = set_pdb_and_mtz_dropzone;

}));
