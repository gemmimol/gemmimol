
var util = util || require('./util');
var GM = GM || require('../gemmimol');

(function () {  // namespace is needed for perf.html
'use strict';

const dmap_buf = util.open_as_array_buffer('1mru.omap');
let map;

var setup = util.load_gemmi().then(function (gemmi) {
  map = new GM.ElMap();
  map.from_dsn6(dmap_buf.slice(0), gemmi);
  map.prepare_isosurface(15, [25, 26, 35]);

  util.bench('isosurface', function () {
    map.isomesh_in_block(1.5);
  });
});

if (typeof module !== 'undefined') {
  module.exports = setup;
}
})();
