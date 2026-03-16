
var ElMap = require('../gemmimol').ElMap;
var util = require('../perf/util');


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
    dmap.from_dsn6(dmap_buf);
  });
  it('#from_ccp4', () => {
    cmap.from_ccp4(cmap_buf, true, gemmi);
  });
  it('direct CCP4 isosurface matches JS block path', () => {
    var center = [24.5, 26.0, 35.5];
    var radius = 10;
    var sigma = 1.5;
    var method = 'marching cubes';

    var direct = new ElMap();
    direct.from_ccp4(cmap_buf.slice(0), true, gemmi);
    direct.prepare_isosurface(radius, center);
    var direct_iso = direct.isomesh_in_block(sigma, method);

    var fallback = new ElMap();
    fallback.from_ccp4(cmap_buf.slice(0), true, gemmi);
    var held = fallback.wasm_ccp4;
    fallback.wasm_ccp4 = null;
    held.delete();
    fallback.prepare_isosurface(radius, center);
    var fallback_iso = fallback.isomesh_in_block(sigma, method);

    expect(direct_iso.vertices.length).toBe(fallback_iso.vertices.length);
    expect(direct_iso.segments.length).toBe(fallback_iso.segments.length);
    for (var i = 0; i < direct_iso.vertices.length; i++) {
      expect(Math.abs(direct_iso.vertices[i] - fallback_iso.vertices[i]))
        .toBeLessThanOrEqual(1e-6);
    }
    for (var j = 0; j < direct_iso.segments.length; j++) {
      expect(direct_iso.segments[j]).toBe(fallback_iso.segments[j]);
    }

    direct.dispose();
    fallback.dispose();
  });
  it('compare unit cells', () => {
    for (var i = 0; i < 6; i++) {
      var p1 = dmap.unit_cell.parameters[i];
      var p2 = cmap.unit_cell.parameters[i];
      expect(Math.abs(p1 - p2)).toBeLessThan(0.02);
    }
  });
});
