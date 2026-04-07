import * as GM from '../gemmimol';

describe('MTZ loading', () => {
  'use strict';

  function fakeGemmi() {
    function UnitCell(a: number, b: number, c: number, alpha: number, beta: number, gamma: number) {
      this.a = a;
      this.b = b;
      this.c = c;
      this.alpha = alpha;
      this.beta = beta;
      this.gamma = gamma;
    }
    return { UnitCell: UnitCell };
  }

  function fakeWasmMap(mean: number, rms: number, dims: number[]) {
    return {
      mean: mean,
      rms: rms,
      nx: dims[0],
      ny: dims[1],
      nz: dims[2],
      cell: { a: 10, b: 11, c: 12, alpha: 90, beta: 90, gamma: 120 },
      delete: function () {},
      extract_isosurface: function () { return true; },
      isosurface_vertices: function () { return new Float32Array(0); },
      isosurface_triangles: function () { return new Uint32Array(0); },
    };
  }

  it('uses wasm-backed maps instead of JS grids', () => {
    const gemmi = fakeGemmi();
    const created: { map: any; isDiff: boolean }[] = [];
    let deleted = false;
    const mtz = {
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
      calculate_wasm_map: jest.fn(function (isDiff: boolean) {
        return fakeWasmMap(isDiff ? 2.5 : 1.5, isDiff ? 4.5 : 3.5, [7, 8, 9]);
      }),
      calculate_wasm_map_from_labels: jest.fn(function () {
        throw new Error('label path not expected here');
      }),
      delete: function () { deleted = true; },
    };
    const viewer = {
      add_map: function (map: any, isDiff: boolean) { created.push({ map: map, isDiff: isDiff }); },
      hud: function (msg: string, level?: string) {
        throw new Error(level + ': ' + msg);
      },
    };

    GM.load_maps_from_mtz_buffer(gemmi as any, viewer as any, mtz as any);

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
});
