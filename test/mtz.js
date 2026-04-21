var GM = require('../gemmimol');

describe('MTZ loading', () => {
  'use strict';

  function fakeGemmi() {
    function UnitCell(a, b, c, alpha, beta, gamma) {
      this.a = a;
      this.b = b;
      this.c = c;
      this.alpha = alpha;
      this.beta = beta;
      this.gamma = gamma;
    }
    return { UnitCell: UnitCell };
  }

  function fakeWasmMap(mean, rms, dims) {
    return {
      mean: mean,
      rms: rms,
      nx: dims[0],
      ny: dims[1],
      nz: dims[2],
      cell: {a: 10, b: 11, c: 12, alpha: 90, beta: 90, gamma: 120},
      delete: function () {},
      extract_isosurface: function () { return true; },
      isosurface_vertices: function () { return new Float32Array(); },
      isosurface_triangles: function () { return new Uint32Array(); },
    };
  }

  it('uses wasm-backed maps instead of JS grids', () => {
    var gemmi = fakeGemmi();
    var created = [];
    var deleted = false;
    var mtz = {
      nx: 4,
      ny: 5,
      nz: 6,
      last_error: '',
      calculate_map: jest.fn(function () {
        throw new Error('old JS path should not be used');
      }),
      calculate_map_from_labels: jest.fn(function () {
        throw new Error('old JS path should not be used');
      }),
      resolution_histogram: jest.fn(function () {
        return null;
      }),
      calculate_wasm_map: jest.fn(function (isDiff) {
        return fakeWasmMap(isDiff ? 2.5 : 1.5, isDiff ? 4.5 : 3.5, [7, 8, 9]);
      }),
      calculate_wasm_map_from_labels: jest.fn(function () {
        throw new Error('label path not expected here');
      }),
      delete: function () { deleted = true; },
    };
    var viewer = {
      add_map: function (map, isDiff) { created.push({map: map, isDiff: isDiff}); },
      hud: function (msg, level) {
        throw new Error(level + ': ' + msg);
      },
    };

    GM.load_maps_from_mtz_buffer(gemmi, viewer, mtz);

    expect(mtz.calculate_wasm_map).toHaveBeenCalledTimes(2);
    expect(mtz.calculate_wasm_map_from_labels).not.toHaveBeenCalled();
    expect(created).toHaveLength(2);
    expect(created[0].map.grid).toBe(null);
    expect(created[0].map.wasm_map).not.toBe(null);
    expect(created[0].map.stats.mean).toBe(1.5);
    expect(created[0].map.stats.rms).toBe(3.5);
    expect(created[1].map.stats.mean).toBe(2.5);
    expect(created[1].map.stats.rms).toBe(4.5);
    expect(created[1].isDiff).toBe(true);
    expect(deleted).toBe(true);
  });

  it('uses a measured column when it exposes missing reflection bins', () => {
    var gemmi = fakeGemmi();
    var mtz = {
      nx: 4,
      ny: 5,
      nz: 6,
      last_error: '',
      resolution_histogram: jest.fn(function (label, nbins, bounds) {
        for (var i = 0; i <= nbins; i++) {
          bounds[i] = 10 - i * 0.1;
        }
        var flat = new Uint32Array(2 * nbins);
        for (var j = 0; j < nbins; j++) {
          flat[j] = 10;
        }
        if (label === 'F_est') {
          flat[nbins + 2] = 7;
        }
        return flat;
      }),
      calculate_wasm_map: jest.fn(function (isDiff) {
        return fakeWasmMap(isDiff ? 2.5 : 1.5, isDiff ? 4.5 : 3.5, [7, 8, 9]);
      }),
      calculate_wasm_map_from_labels: jest.fn(function () {
        throw new Error('label path not expected here');
      }),
      delete: function () {},
    };
    var viewer = {
      add_map: function () {},
      hud: function (msg, level) {
        throw new Error(level + ': ' + msg);
      },
    };

    GM.load_maps_from_mtz_buffer(gemmi, viewer, mtz);

    expect(viewer.reflection_histogram.label).toBe('F_est');
    expect(viewer.reflection_histogram.missing[2]).toBe(7);
  });

  it('limits map calculation at the first low-completeness resolution shell', () => {
    var gemmi = fakeGemmi();
    var limitCalls = [];
    var mtz = {
      nx: 4,
      ny: 5,
      nz: 6,
      last_error: '',
      resolution_histogram: jest.fn(function (label, nbins, bounds) {
        for (var i = 0; i <= nbins; i++) {
          bounds[i] = 10 - i * 0.2;
        }
        var flat = new Uint32Array(2 * nbins);
        for (var j = 0; j < nbins; j++) {
          flat[j] = 10;
          if (label === 'F_est' && j >= 6) {
            flat[nbins + j] = 15;
          }
        }
        return flat;
      }),
      calculate_wasm_map: jest.fn(function () {
        throw new Error('unlimited map path should not be used');
      }),
      calculate_wasm_map_limited: jest.fn(function (isDiff, dMin) {
        limitCalls.push({isDiff: isDiff, dMin: dMin});
        return fakeWasmMap(isDiff ? 2.5 : 1.5, isDiff ? 4.5 : 3.5, [7, 8, 9]);
      }),
      calculate_wasm_map_from_labels: jest.fn(function () {
        throw new Error('label path not expected here');
      }),
      delete: function () {},
    };
    var viewer = {
      add_map: function () {},
      hud: function (msg, level) {
        throw new Error(level + ': ' + msg);
      },
    };

    GM.load_maps_from_mtz_buffer(gemmi, viewer, mtz);

    expect(viewer.reflection_histogram.label).toBe('F_est');
    expect(viewer.reflection_histogram.map_d_min).toBeCloseTo(8.8);
    expect(limitCalls).toEqual([
      {isDiff: false, dMin: 8.8},
      {isDiff: true, dMin: 8.8},
    ]);
  });
});
