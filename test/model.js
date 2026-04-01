
var util = require('../perf/util');
var GM = require('../gemmimol');
var path = require('path');

describe('Model', () => {
  'use strict';
  var model;
  beforeAll(function () {
    return util.load_models_from_gemmi('1YJP.pdb').then(function (models) {
      model = models[0];
    });
  });
  it('atoms', () => {
    for (var i = 0; i < model.atoms.length; i++) {
      var atom = model.atoms[i];
      expect(atom.i_seq).toEqual(i);
    }
  });
  it('bonds', () => {
    var atoms = model.atoms;
    for (var i = 0; i < atoms.length; i++) {
      var atom = atoms[i];
      expect(atom.bonds.length).toEqual(atom.bond_types.length);
      for (var j = 0; j < atom.bonds.length; j++) {
        var other = atom.bonds[j];
        expect(other).not.toEqual(i);
        expect(atoms[other].bonds.includes(i)).toEqual(true);
      }
    }
  });
  it('next_residue', () => {
    var a1 = model.next_residue();  // first residue
    expect(a1.seqid).toEqual("1");
    expect(a1.name).toEqual('CA');
    var atom_label = a1.long_label();
    expect(atom_label.indexOf('CA /1')).toEqual(0);
    var next_res_atom = model.next_residue(a1);
    expect(next_res_atom.seqid).toEqual("2");
    expect(next_res_atom.name).toEqual('CA');
    expect(model.next_residue(next_res_atom, true)).toEqual(a1);
    var last_res_atom = model.next_residue(a1, true);
    expect(model.next_residue(last_res_atom)).toEqual(a1);
  });
  it('get_nearest_atom', () => {
    var a1 = model.next_residue();  // first residue
    var atms = [a1, model.next_residue(a1), model.next_residue(a1, true)];
    for (var i = 0; i < atms.length; i++) {
      var a = atms[i];
      var nearest = model.get_nearest_atom(a.xyz[0], a.xyz[1]+0.4, a.xyz[2]);
      expect(a).toEqual(nearest);
    }
  });
  it('secondary structure annotations', () => {
    for (var i = 0; i < model.atoms.length; i++) {
      var atom = model.atoms[i];
      expect(typeof atom.ss).toEqual('string');
      expect(typeof atom.strand_sense).toEqual('string');
    }
  });

  it('loads bonds from cif with embedded or fetched monomer data', () => {
    var cif_path = path.resolve(__dirname, '5i55.cif');
    var requested = null;
    return util.load_gemmi().then(function (gemmi) {
      return GM.modelsFromGemmi(gemmi, util.open_as_array_buffer(cif_path), cif_path,
                                function (resnames) {
                                  requested = resnames.slice();
                                  return Promise.resolve([]);
                                });
    }).then(function (result) {
      expect(result.bonding.source).toEqual('gemmi');
      expect(result.bonding.monomers_requested).toBeGreaterThan(0);
      if (requested !== null) {
        expect(requested.length).toBeGreaterThan(0);
      } else {
        expect(result.bonding.monomers_loaded).toBeGreaterThan(0);
      }
      result.structure.delete();
    });
  });
});
