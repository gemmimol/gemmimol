
var ElMap = require('../gemmimol').ElMap;
var util = require('../perf/util');
var fs = require('node:fs');


/* Note: axis order in ccp4 maps is tricky. It was tested by re-sectioning,
 * i.e. changing axis order, of a map with CCP4 mapmask:
  mapmask mapin 1mru_2mFo-DFc.ccp4 mapout 1mru_yzx.ccp4 << eof
  AXIS Y Z X
  MODE mapin
  eof
*/

describe('ElMap', () => {
  'use strict';
  var dmap_buf = util.open_as_array_buffer('1mru.omap');
  var cmap_buf = util.open_as_array_buffer('1mru.map');
  var dmap = new ElMap();
  var cmap = new ElMap();
  var gemmi;
  beforeAll(function () {
    return util.load_gemmi().then(function (loaded) {
      gemmi = loaded;
    });
  });
  it('#from_dsn6', () => {
    dmap.from_dsn6(dmap_buf, gemmi);
    expect(dmap.grid).toBe(null);
  });
  it('#from_ccp4', () => {
    cmap.from_ccp4(cmap_buf, true, gemmi);
  });
  it('CCP4 maps keep density in wasm', () => {
    var center = [24.5, 26.0, 35.5];
    var radius = 10;
    var sigma = 1.5;
    var method = 'marching cubes';

    expect(cmap.grid).toBe(null);
    cmap.prepare_isosurface(radius, center);
    var iso = cmap.isomesh_in_block(sigma, method);
    expect(iso.vertices.length).toBeGreaterThan(0);
    expect(iso.segments.length).toBeGreaterThan(0);
  });
  it('DSN6 maps keep density in wasm', () => {
    var center = [24.5, 26.0, 35.5];
    dmap.prepare_isosurface(10, center);
    var iso = dmap.isomesh_in_block(1.5, 'marching cubes');
    expect(iso.vertices.length).toBeGreaterThan(0);
    expect(iso.segments.length).toBeGreaterThan(0);
  });
  it('compare unit cells', () => {
    var keys = ['a', 'b', 'c', 'alpha', 'beta', 'gamma'];
    for (var i = 0; i < keys.length; i++) {
      var p1 = dmap.unit_cell[keys[i]];
      var p2 = cmap.unit_cell[keys[i]];
      expect(Math.abs(p1 - p2)).toBeLessThan(0.02);
    }
  });
  it('finds blobs via wasm map wrapper', () => {
    var blobMap = new ElMap();
    var mapBuf = fs.readFileSync('../gemmi/tests/5i55_tiny.ccp4');
    var stBuf = fs.readFileSync('../gemmi/tests/5i55.cif');
    blobMap.from_ccp4(mapBuf, true, gemmi);
    var st = gemmi.read_structure(stBuf, '5i55.cif');
    try {
      var blobs = blobMap.find_blobs(blobMap.stats.rms);
      expect(blobs.length).toBe(1);
      expect(blobs[0].score).toBeGreaterThan(15);
      var masked = blobMap.find_blobs(blobMap.stats.rms, {structure: st});
      expect(masked.length).toBe(0);
    } finally {
      st.delete();
      blobMap.dispose();
    }
  });
});
