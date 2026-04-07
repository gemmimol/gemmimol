import { ElMap } from '../gemmimol';
import * as util from '../perf/util';

/* Note: axis order in ccp4 maps is tricky. It was tested by re-sectioning,
 * i.e. changing axis order, of a map with CCP4 mapmask:
  mapmask mapin 1mru_2mFo-DFc.ccp4 mapout 1mru_yzx.ccp4 << eof
  AXIS Y Z X
  MODE mapin
  eof
*/

describe('ElMap', () => {
  'use strict';
  const dmap_buf = util.open_as_array_buffer('1mru.omap');
  const cmap_buf = util.open_as_array_buffer('1mru.map');
  const dmap = new ElMap();
  const cmap = new ElMap();
  let gemmi: any;

  beforeAll(function () {
    return util.load_gemmi().then(function (loaded) {
      gemmi = loaded;
      dmap.from_dsn6(dmap_buf, gemmi);
      cmap.from_ccp4(cmap_buf, true, gemmi);
    });
  });

  it('#from_dsn6', () => {
    expect(dmap.grid).toBe(null);
  });

  it('#from_ccp4', () => {
    expect(cmap.grid).toBe(null);
  });

  it('CCP4 maps keep density in wasm', () => {
    const center = [24.5, 26.0, 35.5];
    const radius = 10;
    const sigma = 1.5;
    const method = 'marching cubes';

    expect(cmap.grid).toBe(null);
    cmap.prepare_isosurface(radius, center);
    const iso = cmap.isomesh_in_block(sigma, method);
    expect(iso.vertices.length).toBeGreaterThan(0);
    expect(iso.triangles.length).toBeGreaterThan(0);
  });

  it('DSN6 maps keep density in wasm', () => {
    const center = [24.5, 26.0, 35.5];
    dmap.prepare_isosurface(10, center);
    const iso = dmap.isomesh_in_block(1.5, 'marching cubes');
    expect(iso.vertices.length).toBeGreaterThan(0);
    expect(iso.triangles.length).toBeGreaterThan(0);
  });

  it('compare unit cells', () => {
    const keys = ['a', 'b', 'c', 'alpha', 'beta', 'gamma'] as const;
    for (let i = 0; i < keys.length; i++) {
      const p1 = (dmap.unit_cell as any)[keys[i]];
      const p2 = (cmap.unit_cell as any)[keys[i]];
      expect(Math.abs(p1 - p2)).toBeLessThan(0.02);
    }
  });

  it('finds blobs via wasm map wrapper', () => {
    const blobMap = new ElMap();
    const mapBuf = util.open_as_array_buffer('1mru.map');
    const stBuf = util.open_as_array_buffer('1mru.pdb');
    blobMap.from_ccp4(mapBuf, true, gemmi);
    const st = gemmi.read_structure(stBuf, '1mru.pdb');
    try {
      const blobs = blobMap.find_blobs(blobMap.stats.rms);
      expect(blobs.length).toBeGreaterThan(0);
      expect(blobs[0].score).toBeGreaterThan(1000);
      const masked = blobMap.find_blobs(blobMap.stats.rms, { structure: st });
      expect(masked.length).toBe(0);
    } finally {
      st.delete();
      blobMap.dispose();
    }
  });
});
