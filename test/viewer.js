
var GM = require('../gemmimol');
var util = require('../perf/util');
var TextEncoder = require('node:util').TextEncoder;

function sphere_atom_count(bag) {
  return bag.objects.reduce(function (count, obj) {
    if (!obj.material || obj.material.type !== 'um_sphere' || !obj.geometry) return count;
    return count + obj.geometry.attributes.position.count / 4;
  }, 0);
}

function text_to_array_buffer(text) {
  return new TextEncoder().encode(text).buffer;
}

const SITE_PDB = [
  'HEADER    TEST',
  'SITE     1 AC1  2 HIS A  94  HIS A  96',
  'ATOM      1  N   HIS A  94       0.000   0.000   0.000  1.00 20.00           N',
  'ATOM      2  CA  HIS A  94       1.000   0.000   0.000  1.00 20.00           C',
  'ATOM      3  N   HIS A  96       5.000   0.000   0.000  1.00 20.00           N',
  'ATOM      4  CA  HIS A  96       6.000   0.000   0.000  1.00 20.00           C',
  'END',
  '',
].join('\n');

const CONNECTIONS_PDB = [
  'HEADER    TEST',
  'ATOM      1  N   ALA A   2       0.000   0.000   0.000  1.00 20.00           N',
  'ATOM      2  CA  ALA A   2       1.200   0.000   0.000  1.00 20.00           C',
  'ATOM      3  N   SER A   3       3.500   0.000   0.000  1.00 20.00           N',
  'ATOM      4  CA  SER A   3       4.700   0.000   0.000  1.00 20.00           C',
  'ATOM      5  OG  SER A   3       5.700   0.800   0.000  1.00 20.00           O',
  'ATOM      6  N   CYS A   4       7.500   0.000   0.000  1.00 20.00           N',
  'ATOM      7  CA  CYS A   4       8.700   0.000   0.000  1.00 20.00           C',
  'ATOM      8  SG  CYS A   4       9.700   1.000   0.000  1.00 20.00           S',
  'ATOM      9  N   CYS A  10      12.000   0.000   0.000  1.00 20.00           N',
  'ATOM     10  CA  CYS A  10      13.200   0.000   0.000  1.00 20.00           C',
  'ATOM     11  SG  CYS A  10      14.200   1.000   0.000  1.00 20.00           S',
  'END',
  '',
].join('\n');

class MockFileReader {
  constructor() {
    this.result = null;
    this.error = null;
    this.readyState = 0;
    this.onloadend = null;
    this.onerror = null;
  }

  readAsArrayBuffer(file) {
    Promise.resolve(file.arrayBuffer()).then((ab) => {
      this.result = ab;
      this.readyState = 2;
      if (this.onloadend) this.onloadend({target: this});
    }, (err) => {
      this.error = err;
      if (this.onerror) this.onerror();
    });
  }
}

describe('Viewer', () => {
  'use strict';
  var viewer = new GM.Viewer('viewer');
  var emap = new GM.ElMap();
  var cmap_buf = util.open_as_array_buffer('1mru.map');
  var gemmi;
  var model;
  var model2;
  beforeAll(function () {
    return util.load_gemmi().then(function (loaded) {
      gemmi = loaded;
      emap.from_ccp4(cmap_buf, true, gemmi);
      return Promise.all([
        util.load_models_from_gemmi('1mru.pdb'),
        util.load_models_from_gemmi('1yk4.pdb'),
      ]);
    }).then(function (models) {
      model = models[0][0];
      model2 = models[1][0];
    });
  });
  it('misc calls (1mru)', () => {
    viewer.add_map(emap, false);
    viewer.toggle_map_visibility(viewer.map_bags[0], false);
    viewer.toggle_map_visibility(viewer.map_bags[0], true);
    viewer.toggle_cell_box();
    viewer.controls.update();
    viewer.update_camera();
    viewer.shift_clip();
    viewer.change_isolevel_by(0, 0.1);
    viewer.center_next_residue();
    viewer.add_model(model);
    viewer.model_bags[0].conf.render_style = 'cartoon';
    viewer.redraw_models();
    viewer.model_bags[0].conf.render_style = 'cartoon+sticks';
    viewer.redraw_models();
    viewer.center_next_residue();
    viewer.recenter();
    viewer.recenter([11, 22, 33]);
    viewer.select_atom({bag: viewer.model_bags[0], atom: model.atoms[1]});
  });

  it('misc calls (1yk4)', () => {
    viewer.add_model(model2);
    viewer.config.hydrogens = true;
    viewer.recenter();
  });

  it('uses sphere as the default water style', () => {
    var viewer2 = new GM.Viewer('viewer');
    expect(viewer2.config.water_style).toEqual('sphere');
  });

  it('refreshes ligand bonding when a monomer cif is dropped later', () => {
    var viewer2 = new GM.Viewer('viewer');
    var savedFileReader = global.FileReader;
    var FileCtor = globalThis.File;
    var pdbText = [
      'HETATM    1  C1  ZZZ A   1       0.000   0.000   0.000  1.00 10.00           C',
      'HETATM    2  C2  ZZZ A   1       1.500   0.000   0.000  1.00 10.00           C',
      'HETATM    3  O1  ZZZ A   1       2.700   0.000   0.000  1.00 10.00           O',
      'END',
      '',
    ].join('\n');
    var monomerCif = [
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
    expect(FileCtor).toBeDefined();
    global.FileReader = MockFileReader;
    viewer2.gemmi_module = gemmi;
    return viewer2.pick_pdb_and_map(
      new FileCtor([new Uint8Array(text_to_array_buffer(pdbText))], 'test.pdb')
    ).then(function () {
      expect(viewer2.model_bags.length).toEqual(1);
      expect(viewer2.model_bags[0].model.atoms.map(function (atom) { return atom.bonds.length; }))
        .toEqual([0, 0, 0]);
      return viewer2.pick_pdb_and_map(
        new FileCtor([new Uint8Array(text_to_array_buffer(monomerCif))], 'ZZZ.cif')
      );
    }).then(function () {
      expect(viewer2.model_bags.length).toEqual(1);
      expect(viewer2.model_bags[0].model.atoms.map(function (atom) { return atom.bonds.length; }))
        .toEqual([1, 2, 1]);
    }).finally(function () {
      global.FileReader = savedFileReader;
      var ctx = viewer2.model_bags[0] && viewer2.model_bags[0].gemmi_selection;
      if (ctx) ctx.structure.delete();
    });
  });

  it('includes unresolved monomer dictionaries in drop summary', () => {
    var viewer2 = new GM.Viewer('viewer');
    viewer2.last_bonding_info = {
      source: 'gemmi',
      monomers_requested: 1,
      monomers_loaded: 0,
      unresolved_monomers: ['Z1234'],
      bond_count: 0,
    };
    expect(viewer2.drop_complete_message(['0185-01_refmacat.mmcif']))
      .toContain('Missing monomer dictionary: Z1234.');
  });

  it('shows and hides blobs from a loaded map', () => {
    var viewer2 = new GM.Viewer('viewer');
    viewer2.add_map(emap, false);
    var seed = emap.find_blobs(emap.abs_level(viewer2.map_bags[0].isolevel))[0];
    expect(seed).toBeDefined();
    viewer2.target.set(seed.centroid[0] + 1000, seed.centroid[1] + 1000, seed.centroid[2] + 1000);
    viewer2.show_blobs(false);
    expect(viewer2.blob_hits.length).toBeGreaterThan(0);
    expect(viewer2.blob_objects.length).toBeGreaterThan(0);
    viewer2.focus_blob(0);
    viewer2.hide_blobs(true);
    expect(viewer2.blob_hits.length).toEqual(0);
    expect(viewer2.blob_objects.length).toEqual(0);
  });

  it('prefers diff map for empty blobs', () => {
    var viewer2 = new GM.Viewer('viewer');
    viewer2.add_map(emap, false);
    viewer2.add_map(emap, true);
    viewer2.show_empty_blobs();
    expect(viewer2.blob_map_bag).not.toBeNull();
    expect(viewer2.blob_map_bag.is_diff_map).toBe(true);
    expect(viewer2.blob_negate).toBe(false);
  });

  it('uses nearest Gemmi-backed model for blob search recentering', () => {
    var viewer2 = new GM.Viewer('viewer');
    return viewer2.load_coordinate_buffer(
      util.open_as_array_buffer('1mru.pdb'),
      '1mru.pdb',
      gemmi
    ).then(function () {
      viewer2.add_model(model2);
      viewer2.selected = {bag: viewer2.model_bags[1], atom: null};
      viewer2.add_map(emap, false);
      var captured = null;
      viewer2.map_bags[0].map.find_blobs = function (_cutoff, options) {
        captured = options;
        return [];
      };
      viewer2.show_blobs(false);
      expect(captured).not.toBeNull();
      expect(captured.structure).toBe(viewer2.model_bags[0].gemmi_selection.structure);
      expect(captured.model_index).toBe(viewer2.model_bags[0].gemmi_selection.model_index);
      viewer2.model_bags[0].gemmi_selection.structure.delete();
    });
  });

  it('finds multiple empty blobs in dimple_thaum diff map', () => {
    var viewer2 = new GM.Viewer('viewer');
    return viewer2.load_coordinate_buffer(
      util.open_as_array_buffer('1mru.pdb'),
      '1mru.pdb',
      gemmi
    ).then(function () {
      var diffMap = new GM.ElMap();
      var diffBuf = util.open_as_array_buffer('1mru_diff.map');
      diffMap.from_ccp4(diffBuf, true, gemmi);
      viewer2.add_map(diffMap, true);
      viewer2.show_empty_blobs();
      expect(viewer2.blob_map_bag).not.toBeNull();
      expect(viewer2.blob_map_bag.is_diff_map).toBe(true);
      expect(viewer2.blob_hits.length).toBeGreaterThan(1);
      expect(viewer2.blob_search_sigma).toEqual(1.0);
      expect(viewer2.blob_mask_waters).toBe(true);
    });
  });

  it('collects deposited SITE annotations for navigation', () => {
    var viewer2 = new GM.Viewer('viewer');
    return viewer2.load_pdb_from_text(SITE_PDB, 'site.pdb', gemmi).then(function () {
      var bag = viewer2.model_bags[0];
      var items = viewer2.collect_site_nav_items(bag);
      expect(items.length).toBe(1);
      expect(items[0].label).toBe('AC1');
      expect(items[0].atom_indices.length).toBe(4);
      viewer2.focus_site_item(bag, items[0]);
      expect(viewer2.selected.bag).toBe(bag);
      expect(['94', '96']).toContain(viewer2.selected.atom.seqid);
      bag.gemmi_selection.structure.delete();
    });
  });

  it('collects deposited LINK and SSBOND annotations for navigation', () => {
    function make_address(chain, seqid, resname, atom_name) {
      var address = new gemmi.AtomAddress();
      var res_id = new gemmi.ResidueId();
      res_id.name = resname;
      res_id.seqid_string = seqid;
      address.chain_name = chain;
      address.res_id = res_id;
      address.atom_name = atom_name;
      res_id.delete();
      return address;
    }

    var viewer2 = new GM.Viewer('viewer');
    return viewer2.load_pdb_from_text(CONNECTIONS_PDB, 'connections.pdb', gemmi).then(function () {
      var bag = viewer2.model_bags[0];
      var structure = bag.gemmi_selection.structure;

      var ssbond = new gemmi.Connection();
      ssbond.name = 'ss1';
      ssbond.type = gemmi.ConnectionType.Disulf;
      ssbond.asu = gemmi.Asu.Same;
      ssbond.partner1 = make_address('A', '4', 'CYS', 'SG');
      ssbond.partner2 = make_address('A', '10', 'CYS', 'SG');
      structure.add_connection(ssbond);

      var link = new gemmi.Connection();
      link.name = 'link1';
      link.type = gemmi.ConnectionType.Covale;
      link.asu = gemmi.Asu.Same;
      link.partner1 = make_address('A', '2', 'ALA', 'N');
      link.partner2 = make_address('A', '3', 'SER', 'OG');
      structure.add_connection(link);

      var items = viewer2.collect_connection_nav_items(bag);
      expect(items.length).toBe(2);
      expect(items[0].label).toContain('SSBOND');
      expect(items[0].label).toContain('A/4 CYS SG');
      expect(items[1].label).toContain('LINK');
      expect(items[1].label).toContain('A/3 SER OG');

      viewer2.focus_connection_item(bag, items[0]);
      expect(viewer2.selected.bag).toBe(bag);
      expect(['4', '10']).toContain(viewer2.selected.atom.seqid);

      viewer2.focus_connection_item(bag, items[1]);
      expect(['2', '3']).toContain(viewer2.selected.atom.seqid);

      ssbond.delete();
      link.delete();
      structure.delete();
    });
  });

  it('keydown', () => {
    function press(codes) {
      for (var i = 0; i < codes.length; i++) {
        var code = codes[i];
        var shift = false;
        if (typeof code === 'string') {
          shift = (code !== code.toLowerCase());
          code = code.toUpperCase().charCodeAt(0);
        }
        viewer.keydown({keyCode: code, shiftKey: shift});
      }
    }
    press(['c', 'b', 'C', 'b', 'b', 'b', 'c', 'c', 'c', 'c']); // colors
    press(['d', 'f', 'm', 'n', 219/*[*/, 221/*]*/]);
    press(['y', 'w', 'u', 220/*backslash*/, 'y', 'w', 'u', 220, 'r']);
    press([99/*numpad 3*/, 110/*decimal point (Mac)*/]);
    press([107/*add*/, 109/*subtract*/]);
    press([32/*space*/, 999/*dummy*/]);
    press(['t', 't', 'q', 'q']);
  });

  it('PDBe loader falls back to updated cif', () => {
    var viewer2 = new GM.Viewer('viewer');
    viewer2.load_pdb_and_maps = jest.fn();

    viewer2.load_from_pdbe('8aq8');

    expect(viewer2.load_pdb_and_maps).toHaveBeenCalledWith(
      [
        'https://www.ebi.ac.uk/pdbe/entry-files/pdb8aq8.ent',
        'https://www.ebi.ac.uk/pdbe/entry-files/download/8aq8_updated.cif',
      ],
      'https://www.ebi.ac.uk/pdbe/coordinates/files/8aq8.ccp4',
      'https://www.ebi.ac.uk/pdbe/coordinates/files/8aq8_diff.ccp4',
      {format: 'ccp4'},
      undefined
    );
  });

  function load_viewer_model(filename) {
    var loaded_viewer = new GM.Viewer('viewer');
    return loaded_viewer.load_coordinate_buffer(
      util.open_as_array_buffer(filename), filename, gemmi
    ).then(function () {
      return loaded_viewer;
    });
  }

  it('deletes selected atom from gemmi-backed model', () => {
    var structure;
    return load_viewer_model('1mru.pdb').then(function (loaded_viewer) {
      var bag = loaded_viewer.model_bags[0];
      var atom = bag.model.atoms[0];
      var before = bag.model.atoms.length;
      structure = bag.gemmi_selection.structure;
      loaded_viewer.select_atom({bag: bag, atom: atom});
      loaded_viewer.delete_selected('atom');
      expect(bag.model.atoms.length).toEqual(before - 1);
      expect(gemmi.make_pdb_string(structure).length).toBeGreaterThan(0);
    }).finally(function () {
      if (structure) structure.delete();
    });
  });

  it('deletes selected residue from gemmi-backed model', () => {
    var structure;
    return load_viewer_model('1mru.pdb').then(function (loaded_viewer) {
      var bag = loaded_viewer.model_bags[0];
      var atom = bag.model.atoms[0];
      var residue_atoms = bag.model.get_residues()[atom.resid()];
      var before = bag.model.atoms.length;
      structure = bag.gemmi_selection.structure;
      loaded_viewer.select_atom({bag: bag, atom: atom});
      loaded_viewer.delete_selected('residue');
      expect(bag.model.atoms.length).toEqual(before - residue_atoms.length);
      expect(gemmi.make_mmcif_string(structure).indexOf('loop_')).toBeGreaterThan(-1);
    }).finally(function () {
      if (structure) structure.delete();
    });
  });

  it('deletes selected chain from gemmi-backed model', () => {
    var structure;
    return load_viewer_model('1mru.pdb').then(function (loaded_viewer) {
      var bag = loaded_viewer.model_bags[0];
      var atom = bag.model.atoms[0];
      var chain_atoms = bag.model.atoms.filter(function (item) {
        return item.chain_index === atom.chain_index;
      }).length;
      var before = bag.model.atoms.length;
      structure = bag.gemmi_selection.structure;
      loaded_viewer.select_atom({bag: bag, atom: atom});
      loaded_viewer.delete_selected('chain');
      if (chain_atoms === before) {
        expect(loaded_viewer.model_bags.length).toEqual(0);
      } else {
        expect(loaded_viewer.model_bags[0].model.atoms.length).toEqual(before - chain_atoms);
      }
      expect(gemmi.make_pdb_string(structure).length).toBeGreaterThan(0);
    }).finally(function () {
      if (structure) structure.delete();
    });
  });

  it('trims selected residue to alanine', () => {
    var structure;
    return load_viewer_model('1mru.pdb').then(function (loaded_viewer) {
      var bag = loaded_viewer.model_bags[0];
      var residues = bag.model.get_residues();
      var target_atom = null;
      var target_residue = null;
      var keep_names = {
        N: true, CA: true, C: true, O: true, OXT: true, OT1: true, OT2: true, CB: true,
        H: true, H1: true, H2: true, H3: true, HA: true, HA2: true, HA3: true,
        HB: true, HB1: true, HB2: true, HB3: true, '1HB': true, '2HB': true, '3HB': true,
        D: true, D1: true, D2: true, D3: true, DA: true, DA2: true, DA3: true,
        DB: true, DB1: true, DB2: true, DB3: true, '1DB': true, '2DB': true, '3DB': true,
      };
      for (var resid in residues) {
        var residue = residues[resid];
        var has_cb = residue.some(function (atom) { return atom.name === 'CB'; });
        var has_extra = residue.some(function (atom) { return !keep_names[atom.name]; });
        if (has_cb && has_extra) {
          target_atom = residue[0];
          target_residue = residue;
          break;
        }
      }
      expect(target_atom).not.toBeNull();
      expect(target_residue).not.toBeNull();
      structure = bag.gemmi_selection.structure;
      loaded_viewer.select_atom({bag: bag, atom: target_atom});
      loaded_viewer.trim_selected_to_alanine();
      var trimmed = bag.model.get_residues()[target_atom.resid()];
      expect(trimmed.every(function (atom) { return keep_names[atom.name]; })).toBe(true);
      expect(trimmed.every(function (atom) { return atom.resname === 'ALA'; })).toBe(true);
      expect(trimmed.length).toBeLessThan(target_residue.length);
      expect(gemmi.make_pdb_string(structure).indexOf('ALA')).toBeGreaterThan(-1);
    }).finally(function () {
      if (structure) structure.delete();
    });
  });

  it('mutates a selected residue to tryptophan', () => {
    var structure;
    return load_viewer_model('1mru.pdb').then(function (loaded_viewer) {
      var bag = loaded_viewer.model_bags[0];
      var residues = bag.model.get_residues();
      var target_atom = null;
      for (var resid in residues) {
        var residue = residues[resid];
        var names = residue.map(function (atom) { return atom.name; });
        if (residue[0].resname === 'TRP') continue;
        if (names.indexOf('N') === -1 || names.indexOf('CA') === -1 ||
            names.indexOf('C') === -1 || names.indexOf('CB') === -1) {
          continue;
        }
        target_atom = residue[0];
        break;
      }
      expect(target_atom).not.toBeNull();
      structure = bag.gemmi_selection.structure;
      loaded_viewer.select_atom({bag: bag, atom: target_atom});
      return loaded_viewer.mutate_selected_residue('TRP').then(function () {
        var mutated = bag.model.get_residues()[target_atom.resid()];
        var atom_names = mutated.map(function (atom) { return atom.name; });
        expect(mutated.every(function (atom) { return atom.resname === 'TRP'; })).toBe(true);
        expect(atom_names).toContain('CG');
        expect(atom_names).toContain('NE1');
        expect(atom_names).toContain('CH2');
        var cb = mutated.find(function (atom) { return atom.name === 'CB'; });
        var cg = mutated.find(function (atom) { return atom.name === 'CG'; });
        expect(cb).toBeDefined();
        expect(cg).toBeDefined();
        expect(cb.bonds.length).toBeGreaterThan(1);
        expect(cg.bonds.length).toBeGreaterThan(1);
        expect(gemmi.make_pdb_string(structure).indexOf('TRP')).toBeGreaterThan(-1);
      });
    }).finally(function () {
      if (structure) structure.delete();
    });
  });

  it('mutates glycine using a pseudo-CB frame', () => {
    var structure;
    return load_viewer_model('1mru.pdb').then(function (loaded_viewer) {
      var bag = loaded_viewer.model_bags[0];
      var residues = bag.model.get_residues();
      var target_atom = null;
      for (var resid in residues) {
        var residue = residues[resid];
        if (residue[0].resname !== 'GLY') continue;
        var names = residue.map(function (atom) { return atom.name; });
        if (names.indexOf('N') === -1 || names.indexOf('CA') === -1 || names.indexOf('C') === -1) {
          continue;
        }
        target_atom = residue[0];
        break;
      }
      expect(target_atom).not.toBeNull();
      structure = bag.gemmi_selection.structure;
      loaded_viewer.select_atom({bag: bag, atom: target_atom});
      return loaded_viewer.mutate_selected_residue('SER').then(function () {
        var mutated = bag.model.get_residues()[target_atom.resid()];
        var atom_names = mutated.map(function (atom) { return atom.name; });
        expect(mutated.every(function (atom) { return atom.resname === 'SER'; })).toBe(true);
        expect(atom_names).toContain('CB');
        expect(atom_names).toContain('OG');
        expect(gemmi.make_mmcif_string(structure).indexOf('SER')).toBeGreaterThan(-1);
      });
    }).finally(function () {
      if (structure) structure.delete();
    });
  });

  it('mutates a DNA residue by replacing only the base', () => {
    var structure;
    return load_viewer_model('pdb2mru.ent').then(function (loaded_viewer) {
      var bag = loaded_viewer.model_bags[0];
      var residues = bag.model.get_residues();
      var target_atom = null;
      for (var resid in residues) {
        var residue = residues[resid];
        if (residue[0].resname !== 'DC') continue;
        var names = residue.map(function (atom) { return atom.name.replace(/\*/g, '\''); });
        if (names.indexOf('O4\'') === -1 || names.indexOf('C1\'') === -1 ||
            names.indexOf('C2\'') === -1 || names.indexOf('N1') === -1) {
          continue;
        }
        target_atom = residue[0];
        break;
      }
      expect(target_atom).not.toBeNull();
      structure = bag.gemmi_selection.structure;
      loaded_viewer.select_atom({bag: bag, atom: target_atom});
      return loaded_viewer.mutate_selected_residue('G').then(function () {
        var mutated = bag.model.get_residues()[target_atom.resid()];
        var atom_names = mutated.map(function (atom) { return atom.name.replace(/\*/g, '\''); });
        expect(mutated.every(function (atom) { return atom.resname === 'DG'; })).toBe(true);
        expect(atom_names).toContain('C1\'');
        expect(atom_names).toContain('O4\'');
        expect(atom_names).toContain('N9');
        expect(atom_names).toContain('O6');
        expect(atom_names).toContain('N2');
        expect(atom_names).not.toContain('N4');
        expect(gemmi.make_mmcif_string(structure).indexOf('DG')).toBeGreaterThan(-1);
      });
    }).finally(function () {
      if (structure) structure.delete();
    });
  });

  it('mutates from the menu while stepping with arrow keys', () => {
    return load_viewer_model('1mru.pdb').then(function (loaded_viewer) {
      var targets = [
        'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
        'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
      ];
      var bag = loaded_viewer.model_bags[0];
      var residues = bag.model.get_residues();
      var target_atom = null;
      for (var resid in residues) {
        var residue = residues[resid];
        var names = residue.map(function (atom) { return atom.name; });
        if (targets.indexOf(residue[0].resname) === -1 || residue[0].resname === 'VAL') continue;
        if (names.indexOf('N') === -1 || names.indexOf('CA') === -1 || names.indexOf('C') === -1) {
          continue;
        }
        target_atom = residue[0];
        break;
      }
      expect(target_atom).not.toBeNull();
      loaded_viewer.select_atom({bag: bag, atom: target_atom});
      var current_index = targets.indexOf(target_atom.resname);
      expect(current_index).toBeGreaterThan(0);
      expect(current_index).toBeLessThan(targets.length - 1);
      expect(loaded_viewer.mutation_target_step(targets, target_atom.resname, 1))
        .toEqual(targets[current_index + 1]);
    });
  });

  it('places water and metal sites at blob positions', () => {
    var structure;
    return load_viewer_model('1mru.pdb').then(function (loaded_viewer) {
      var bag = loaded_viewer.model_bags[0];
      loaded_viewer.has_frag_depth = function () { return true; };
      loaded_viewer.redraw_model(bag);
      var before = bag.model.atoms.length;
      var spheres_before = sphere_atom_count(bag);
      structure = bag.gemmi_selection.structure;

      loaded_viewer.blob_hits = [{
        centroid: [11.1, 12.2, 13.3],
        peak_pos: [11.1, 12.2, 13.3],
        score: 20.0,
        volume: 8.0,
        peak_value: 3.0,
      }];
      loaded_viewer.blob_focus_index = 0;
      loaded_viewer.place_selected_blob('water');
      expect(loaded_viewer.selected.atom.resname).toEqual('HOH');
      expect(loaded_viewer.selected.atom.name).toEqual('O');
      expect(sphere_atom_count(loaded_viewer.model_bags[0])).toEqual(spheres_before + 1);

      loaded_viewer.blob_hits = [{
        centroid: [14.4, 15.5, 16.6],
        peak_pos: [14.4, 15.5, 16.6],
        score: 25.0,
        volume: 10.0,
        peak_value: 4.0,
      }];
      loaded_viewer.blob_focus_index = 0;
      loaded_viewer.place_selected_blob('zn');
      expect(loaded_viewer.selected.atom.resname).toEqual('ZN');
      expect(loaded_viewer.selected.atom.element).toEqual('ZN');
      expect(loaded_viewer.model_bags[0].model.atoms.length).toEqual(before + 2);
      expect(sphere_atom_count(loaded_viewer.model_bags[0])).toEqual(spheres_before + 2);

      var cif = gemmi.make_mmcif_string(structure);
      expect(cif.indexOf('HOH')).toBeGreaterThan(-1);
      expect(cif.indexOf(' ZN ')).toBeGreaterThan(-1);
    }).finally(function () {
      if (structure) structure.delete();
    });
  });

  it('shows placed waters as spheres in line mode by default', () => {
    var structure;
    return load_viewer_model('1mru.pdb').then(function (loaded_viewer) {
      var bag = loaded_viewer.model_bags[0];
      bag.conf.render_style = 'lines';
      loaded_viewer.redraw_model(bag);
      var spheres_before = sphere_atom_count(bag);
      structure = bag.gemmi_selection.structure;

      loaded_viewer.blob_hits = [{
        centroid: [11.1, 12.2, 13.3],
        peak_pos: [11.1, 12.2, 13.3],
        score: 20.0,
        volume: 8.0,
        peak_value: 3.0,
      }];
      loaded_viewer.blob_focus_index = 0;
      loaded_viewer.place_selected_blob('water');
      expect(loaded_viewer.selected.atom.resname).toEqual('HOH');
      expect(sphere_atom_count(loaded_viewer.model_bags[0])).toEqual(spheres_before + 1);
    }).finally(function () {
      if (structure) structure.delete();
    });
  });

  it('places empty-blob atoms at peak position, not centroid', () => {
    var structure;
    return load_viewer_model('1mru.pdb').then(function (loaded_viewer) {
      var bag = loaded_viewer.model_bags[0];
      structure = bag.gemmi_selection.structure;
      loaded_viewer.blob_hits = [{
        centroid: [11.1, 12.2, 13.3],
        peak_pos: [14.4, 15.5, 16.6],
        score: 20.0,
        volume: 8.0,
        peak_value: 3.0,
      }];
      loaded_viewer.blob_focus_index = 0;
      loaded_viewer.blob_negate = false;
      loaded_viewer.blob_map_bag = {is_diff_map: true};
      loaded_viewer.place_selected_blob('water');
      expect(loaded_viewer.selected.atom.resname).toEqual('HOH');
      expect(loaded_viewer.selected.atom.xyz[0]).toBeCloseTo(14.4, 4);
      expect(loaded_viewer.selected.atom.xyz[1]).toBeCloseTo(15.5, 4);
      expect(loaded_viewer.selected.atom.xyz[2]).toBeCloseTo(16.6, 4);
    }).finally(function () {
      if (structure) structure.delete();
    });
  });

  it('refreshes loaded ligand bonds after adding a monomer cif', () => {
    var pdb_text = [
      'HETATM    1  C1  ZZZ A   1       0.000   0.000   0.000  1.00 10.00           C',
      'HETATM    2  C2  ZZZ A   1       1.500   0.000   0.000  1.00 10.00           C',
      'HETATM    3  O1  ZZZ A   1       2.700   0.000   0.000  1.00 10.00           O',
      'END',
      '',
    ].join('\n');
    var monomer_cif = [
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
    var viewer2 = new GM.Viewer('viewer');
    return util.load_gemmi().then(function (gemmi) {
      return viewer2.load_coordinate_buffer(text_to_array_buffer(pdb_text), 'test.pdb', gemmi);
    }).then(function () {
      var bag = viewer2.model_bags[0];
      expect(bag.model.atoms.map(function (atom) { return atom.bonds.length; }))
        .toEqual([0, 0, 0]);
      var names = viewer2.cache_monomer_cif_text(monomer_cif);
      return viewer2.refresh_bonding_for_cached_monomers(names).then(function (refreshed) {
        expect(refreshed).toEqual(1);
        expect(viewer2.model_bags[0].model.atoms.map(function (atom) { return atom.bonds.length; }))
          .toEqual([1, 2, 1]);
      });
    });
  });
});
