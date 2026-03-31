
var GM = require('../gemmimol');
var util = require('../perf/util');

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
});
