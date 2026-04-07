
var util = util || require('./util');
var GM = GM || require('../gemmimol');

(function () {  // namespace is needed for perf.html
'use strict';

const cmap_buf = util.open_as_array_buffer('1mru.map');

let viewer = new GM.Viewer({});
let emap = new GM.ElMap();

var setup = Promise.all([util.load_gemmi(), util.load_models_from_gemmi('1mru.pdb')])
  .then(function (result) {
    var gemmi = result[0];
    var models = result[1];
    emap.from_ccp4(cmap_buf, true, gemmi);
    let model = models[0];
    viewer.load_structure(model);

    util.bench('redraw model', function () {
      viewer.redraw_model(viewer.model_bags[0]);
    });

    util.bench('add_map+clear', function () {
      viewer.add_map(emap, false);
      viewer.clear_el_objects(viewer.map_bags.pop());
    });
  });

// makes sense only when pdb has hydrogens
//util.bench('get_visible_atoms', function () {
//  viewer.model_bags[0].get_visible_atoms();
//});

if (typeof module !== 'undefined') {
  module.exports = setup;
}
})();
