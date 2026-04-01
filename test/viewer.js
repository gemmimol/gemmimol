
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
