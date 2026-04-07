import * as util from '../perf/util';
import * as GM from '../gemmimol';
import * as path from 'path';
import { TextEncoder } from 'node:util';

describe('Model', () => {
  'use strict';
  let model: any;

  beforeAll(function () {
    return util.load_models_from_gemmi('1YJP.pdb').then(function (models: any[]) {
      model = models[0];
    });
  });

  it('atoms', () => {
    for (let i = 0; i < model.atoms.length; i++) {
      const atom = model.atoms[i];
      expect(atom.i_seq).toEqual(i);
    }
  });

  it('bonds', () => {
    const atoms = model.atoms;
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      expect(atom.bonds.length).toEqual(atom.bond_types.length);
      for (let j = 0; j < atom.bonds.length; j++) {
        const other = atom.bonds[j];
        expect(other).not.toEqual(i);
        expect(atoms[other].bonds.includes(i)).toEqual(true);
      }
    }
  });

  it('next_residue', () => {
    const a1 = model.next_residue();  // first residue
    expect(a1.seqid).toEqual("1");
    expect(a1.name).toEqual('CA');
    const atom_label = a1.long_label();
    expect(atom_label.indexOf('CA /1')).toEqual(0);
    const next_res_atom = model.next_residue(a1);
    expect(next_res_atom.seqid).toEqual("2");
    expect(next_res_atom.name).toEqual('CA');
    expect(model.next_residue(next_res_atom, true)).toEqual(a1);
    const last_res_atom = model.next_residue(a1, true);
    expect(model.next_residue(last_res_atom)).toEqual(a1);
  });

  it('get_nearest_atom', () => {
    const a1 = model.next_residue();  // first residue
    const atms = [a1, model.next_residue(a1), model.next_residue(a1, true)];
    for (let i = 0; i < atms.length; i++) {
      const a = atms[i];
      const nearest = model.get_nearest_atom(a.xyz[0], a.xyz[1] + 0.4, a.xyz[2]);
      expect(a).toEqual(nearest);
    }
  });

  it('secondary structure annotations', () => {
    for (let i = 0; i < model.atoms.length; i++) {
      const atom = model.atoms[i];
      expect(typeof atom.ss).toEqual('string');
      expect(typeof atom.strand_sense).toEqual('string');
    }
  });

  it('loads bonds from cif with embedded or fetched monomer data', () => {
    const cif_path = path.resolve(__dirname, '5i55.cif');
    let requested: string[] | null = null;
    return util.load_gemmi().then(function (gemmi: any) {
      return GM.modelsFromGemmi(gemmi, util.open_as_array_buffer(cif_path), cif_path,
                                function (resnames: string[]) {
                                  requested = resnames.slice();
                                  return Promise.resolve([]);
                                });
    }).then(function (result: any) {
      expect(result.bonding.source).toEqual('gemmi');
      expect(result.bonding.bond_count).toBeGreaterThan(0);
      if (requested !== null) {
        expect(requested.length).toBeGreaterThan(0);
      } else if (result.bonding.monomers_requested !== 0) {
        expect(result.bonding.monomers_loaded).toBeGreaterThan(0);
      }
      result.structure.delete();
    });
  });

  it('loads bonds from later repeated monomer loops in mmcif', () => {
    const cif_text = [
      'data_test',
      '_cell.length_a 10',
      '_cell.length_b 10',
      '_cell.length_c 10',
      '_cell.angle_alpha 90',
      '_cell.angle_beta 90',
      '_cell.angle_gamma 90',
      "_symmetry.space_group_name_H-M 'P 1'",
      '_symmetry.Int_Tables_number 1',
      'loop_',
      '_entity.id',
      '_entity.type',
      'A polymer',
      'loop_',
      '_entity_poly_seq.entity_id',
      '_entity_poly_seq.num',
      '_entity_poly_seq.mon_id',
      '_entity_poly_seq.hetero',
      'A 1 GLY ?',
      'loop_',
      '_atom_site.group_PDB',
      '_atom_site.id',
      '_atom_site.type_symbol',
      '_atom_site.label_atom_id',
      '_atom_site.label_alt_id',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_entity_id',
      '_atom_site.label_seq_id',
      '_atom_site.pdbx_PDB_ins_code',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.occupancy',
      '_atom_site.B_iso_or_equiv',
      '_atom_site.pdbx_formal_charge',
      '_atom_site.auth_seq_id',
      '_atom_site.auth_asym_id',
      '_atom_site.pdbx_PDB_model_num',
      'ATOM 1 N N . GLY A A 1 ? 0.0 0.0 0.0 1.0 10.0 ? 1 A 1',
      'ATOM 2 C CA . GLY A A 1 ? 1.4 0.0 0.0 1.0 10.0 ? 1 A 1',
      'ATOM 3 C C . GLY A A 1 ? 2.1 1.2 0.0 1.0 10.0 ? 1 A 1',
      'ATOM 4 O O . GLY A A 1 ? 1.8 2.3 0.0 1.0 10.0 ? 1 A 1',
      '#',
      'data_SER',
      '_chem_comp.id SER',
      '_chem_comp.group peptide',
      'loop_',
      '_chem_comp_atom.comp_id',
      '_chem_comp_atom.atom_id',
      '_chem_comp_atom.type_symbol',
      '_chem_comp_atom.type_energy',
      '_chem_comp_atom.charge',
      'SER N N NT3 1',
      'SER CA C CH1 0',
      'SER C C C 0',
      'SER O O O 0',
      'loop_',
      '_chem_comp_bond.comp_id',
      '_chem_comp_bond.atom_id_1',
      '_chem_comp_bond.atom_id_2',
      '_chem_comp_bond.type',
      '_chem_comp_bond.aromatic',
      'SER N CA single n',
      'SER CA C single n',
      'SER C O double n',
      '#',
      'data_GLY',
      '_chem_comp.id GLY',
      '_chem_comp.group peptide',
      'loop_',
      '_chem_comp_atom.comp_id',
      '_chem_comp_atom.atom_id',
      '_chem_comp_atom.type_symbol',
      '_chem_comp_atom.type_energy',
      '_chem_comp_atom.charge',
      'GLY N N NT3 1',
      'GLY CA C CH2 0',
      'GLY C C C 0',
      'GLY O O O 0',
      'loop_',
      '_chem_comp_bond.comp_id',
      '_chem_comp_bond.atom_id_1',
      '_chem_comp_bond.atom_id_2',
      '_chem_comp_bond.type',
      '_chem_comp_bond.aromatic',
      'GLY N CA single n',
      'GLY CA C single n',
      'GLY C O double n',
      '#',
      '',
    ].join('\n');
    return util.load_gemmi().then(function (gemmi: any) {
      return GM.modelsFromGemmi(gemmi, new TextEncoder().encode(cif_text).buffer, 'test.cif');
    }).then(function (result: any) {
      expect(result.bonding.monomers_loaded).toBeGreaterThan(0);
      expect(result.models[0].atoms.map(function (atom: any) { return atom.bonds.length; }))
        .toEqual([1, 2, 2, 1]);
      result.structure.delete();
    });
  });

  it('loads bonds from companion monomer cif fetcher for custom ligands', () => {
    const pdb_text = [
      'HETATM    1  C1  ZZZ A   1       0.000   0.000   0.000  1.00 10.00           C',
      'HETATM    2  C2  ZZZ A   1       1.500   0.000   0.000  1.00 10.00           C',
      'HETATM    3  O1  ZZZ A   1       2.700   0.000   0.000  1.00 10.00           O',
      'END',
      '',
    ].join('\n');
    return util.load_gemmi().then(function (gemmi: any) {
      return GM.modelsFromGemmi(
        gemmi,
        new TextEncoder().encode(pdb_text).buffer,
        'test.pdb',
        function () { return Promise.resolve([]); }
      );
    }).then(function (result: any) {
      expect(result.bonding.monomers_requested).toEqual(1);
      expect(result.bonding.monomers_loaded).toEqual(0);
      expect(result.bonding.unresolved_monomers).toEqual(['ZZZ']);
      expect(result.models[0].atoms.map(function (atom: any) { return atom.bonds.length; }))
        .toEqual([0, 0, 0]);
      result.structure.delete();
    });
  });

  it('clears unresolved monomers when companion monomer cif is provided', () => {
    const pdb_text = [
      'HETATM    1  C1  ZZZ A   1       0.000   0.000   0.000  1.00 10.00           C',
      'HETATM    2  C2  ZZZ A   1       1.500   0.000   0.000  1.00 10.00           C',
      'HETATM    3  O1  ZZZ A   1       2.700   0.000   0.000  1.00 10.00           O',
      'END',
      '',
    ].join('\n');
    const monomer_cif = [
      'data_ZZZ',
      '_chem_comp.id ZZZ',
      '_chem_comp.group non-polymer',
      'loop_',
      '_chem_comp_atom.comp_id',
      '_chem_comp_atom.atom_id',
      '_chem_comp_atom.type_symbol',
      '_chem_comp_atom.type_energy',
      '_chem_comp_atom.charge',
      'ZZZ C1 C CH3 0',
      'ZZZ C2 C CH2 0',
      'ZZZ O1 O O 0',
      'loop_',
      '_chem_comp_bond.comp_id',
      '_chem_comp_bond.atom_id_1',
      '_chem_comp_bond.atom_id_2',
      '_chem_comp_bond.type',
      '_chem_comp_bond.aromatic',
      'ZZZ C1 C2 single n',
      'ZZZ C2 O1 single n',
      '#',
      '',
    ].join('\n');
    return util.load_gemmi().then(function (gemmi: any) {
      return GM.modelsFromGemmi(
        gemmi,
        new TextEncoder().encode(pdb_text).buffer,
        'test.pdb',
        function (resnames: string[]) {
          return Promise.resolve(resnames.indexOf('ZZZ') !== -1 ? [monomer_cif] : []);
        }
      );
    }).then(function (result: any) {
      expect(result.bonding.monomers_requested).toEqual(1);
      expect(result.bonding.monomers_loaded).toEqual(1);
      expect(result.bonding.unresolved_monomers).toEqual([]);
      expect(result.models[0].atoms.map(function (atom: any) { return atom.bonds.length; }))
        .toEqual([1, 2, 1]);
      result.structure.delete();
    });
  });
});
