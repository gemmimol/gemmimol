import type { GemmiModule, UnitCell, Structure,
              Ccp4Map as WasmCcp4Map,
              Dsn6Map as WasmDsn6Map,
              MtzMap as WasmMtzMap,
              Isosurface as WasmIsosurface } from './gemmi';

type Num3 = [number, number, number];

export interface IsosurfaceField {
  values: Float32Array;
  size: Num3;
  origin: Num3;
  axis_x: Num3;
  axis_y: Num3;
  axis_z: Num3;
}

export interface IsosurfaceData {
  vertices: Float32Array;
  triangles: Uint32Array;
  field?: IsosurfaceField;
}

export interface BlobHit {
  centroid: Num3;
  peak_pos: Num3;
  score: number;
  volume: number;
  peak_value: number;
}

export interface BlobSearchOptions {
  min_volume?: number;
  min_score?: number;
  min_peak?: number;
  negate?: boolean;
  structure?: Structure | null;
  model_index?: number;
  mask_radius?: number;
  mask_waters?: boolean;
}

type WasmDensityMap = WasmCcp4Map | WasmDsn6Map | WasmMtzMap;

function modulo(a: number, b: number) {
  const reminder = a % b;
  return reminder >= 0 ? reminder : reminder + b;
}

export class GridArray {
  dim: Num3;
  values: Float32Array;

  constructor(dim: Num3) {
    this.dim = dim; // dimensions of the grid for the entire unit cell
    this.values = new Float32Array(dim[0] * dim[1] * dim[2]);
  }

  grid2index(i: number, j: number, k: number) {
    i = modulo(i, this.dim[0]);
    j = modulo(j, this.dim[1]);
    k = modulo(k, this.dim[2]);
    return this.dim[2] * (this.dim[1] * i + j) + k;
  }

  grid2index_unchecked(i: number, j: number, k: number) {
    return this.dim[2] * (this.dim[1] * i + j) + k;
  }

  grid2frac(i: number, j: number, k: number): Num3 {
    return [i / this.dim[0], j / this.dim[1], k / this.dim[2]];
  }

  // return grid coordinates (rounded down) for the given fractional coordinates
  frac2grid(xyz: Num3) {
    // at one point "| 0" here made extract_block() 40% faster on V8 3.14,
    // but I don't see any effect now
    return [Math.floor(xyz[0] * this.dim[0]) | 0,
            Math.floor(xyz[1] * this.dim[1]) | 0,
            Math.floor(xyz[2] * this.dim[2]) | 0];
  }

  set_grid_value(i: number, j: number, k: number, value: number) {
    const idx = this.grid2index(i, j, k);
    this.values[idx] = value;
  }

  get_grid_value(i: number, j: number, k: number) {
    const idx = this.grid2index(i, j, k);
    return this.values[idx];
  }
}

class Block {
  _points: Float32Array | null;
  _values: Float32Array | null;
  _size: Num3;

  constructor() {
    this._points = null;
    this._values = null;
    this._size = [0, 0, 0];
  }

  set(points: Num3[], values: number[], size: Num3) {
    if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) {
      throw Error('Grid dimensions are zero along at least one edge');
    }
    const len = size[0] * size[1] * size[2];
    if (values.length !== len || points.length !== len) {
      throw Error('isosurface: array size mismatch');
    }

    this._points = new Float32Array(3 * len);
    for (let i = 0; i < len; ++i) {
      const point = points[i];
      this._points[3*i] = point[0];
      this._points[3*i+1] = point[1];
      this._points[3*i+2] = point[2];
    }
    this._values = new Float32Array(values);
    this._size = size;
  }

  clear() {
    this._points = null;
    this._values = null;
  }

  empty() : boolean {
    return this._values === null;
  }

  field() : IsosurfaceField | undefined {
    if (this._values == null || this._points == null) return undefined;
    const size = this._size;
    if (size[0] < 2 || size[1] < 2 || size[2] < 2) return undefined;
    const yz = size[1] * size[2];
    const y = size[2];
    return {
      values: this._values,
      size: [size[0], size[1], size[2]],
      origin: [this._points[0], this._points[1], this._points[2]],
      axis_x: [this._points[3*yz] - this._points[0],
               this._points[3*yz+1] - this._points[1],
               this._points[3*yz+2] - this._points[2]],
      axis_y: [this._points[3*y] - this._points[0],
               this._points[3*y+1] - this._points[1],
               this._points[3*y+2] - this._points[2]],
      axis_z: [this._points[3] - this._points[0],
               this._points[4] - this._points[1],
               this._points[5] - this._points[2]],
    };
  }

  isosurface(gemmi_module: GemmiModule | null, isolevel: number, method: string='') {
    if (gemmi_module == null) {
      throw Error('Gemmi is required for isosurface extraction.');
    }
    if (this._values == null || this._points == null) {
      throw Error('Block is empty.');
    }

    let iso: WasmIsosurface | null = null;
    try {
      iso = new gemmi_module.Isosurface();
      iso.resize_input(this._values.length);
      iso.set_size(this._size[0], this._size[1], this._size[2]);
      iso.input_points().set(this._points);
      iso.input_values().set(this._values);
      if (!iso.calculate(isolevel, method)) {
        throw Error(iso.last_error || 'Failed to calculate isosurface.');
      }
      return {
        vertices: iso.vertices().slice(),
        triangles: iso.triangles().slice(),
        field: this.field(),
      } as IsosurfaceData;
    } finally {
      if (iso != null) iso.delete();
    }
  }
}

function map_index(dim: Num3, i: number, j: number, k: number) {
  i = modulo(i, dim[0]);
  j = modulo(j, dim[1]);
  k = modulo(k, dim[2]);
  return dim[2] * (dim[1] * i + j) + k;
}

function extract_block_from_grid(block: Block, grid: GridArray, unit_cell: UnitCell,
                                 radius: number, center: Num3) {
  const fc = unit_cell.fractionalize(center);
  const r = [radius / unit_cell.a,
             radius / unit_cell.b,
             radius / unit_cell.c];
  const grid_min = grid.frac2grid([fc[0] - r[0], fc[1] - r[1], fc[2] - r[2]]);
  const grid_max = grid.frac2grid([fc[0] + r[0], fc[1] + r[1], fc[2] + r[2]]);
  const size: Num3 = [grid_max[0] - grid_min[0] + 1,
                      grid_max[1] - grid_min[1] + 1,
                      grid_max[2] - grid_min[2] + 1];
  const points = [];
  const values = [];
  for (let i = grid_min[0]; i <= grid_max[0]; i++) {
    for (let j = grid_min[1]; j <= grid_max[1]; j++) {
      for (let k = grid_min[2]; k <= grid_max[2]; k++) {
        const frac = grid.grid2frac(i, j, k);
        const orth = unit_cell.orthogonalize(frac);
        points.push(orth);
        const map_value = grid.get_grid_value(i, j, k);
        values.push(map_value);
      }
    }
  }
  block.set(points, values, size);
}

function extract_block_from_map(block: Block, map: WasmDensityMap, unit_cell: UnitCell,
                                radius: number, center: Num3) {
  const fc = unit_cell.fractionalize(center);
  const r = [radius / unit_cell.a,
             radius / unit_cell.b,
             radius / unit_cell.c];
  const dim: Num3 = [map.nx, map.ny, map.nz];
  const grid_min: Num3 = [Math.floor((fc[0] - r[0]) * dim[0]) | 0,
                          Math.floor((fc[1] - r[1]) * dim[1]) | 0,
                          Math.floor((fc[2] - r[2]) * dim[2]) | 0];
  const grid_max: Num3 = [Math.floor((fc[0] + r[0]) * dim[0]) | 0,
                          Math.floor((fc[1] + r[1]) * dim[1]) | 0,
                          Math.floor((fc[2] + r[2]) * dim[2]) | 0];
  const size: Num3 = [grid_max[0] - grid_min[0] + 1,
                      grid_max[1] - grid_min[1] + 1,
                      grid_max[2] - grid_min[2] + 1];
  const data = map.data() as Float32Array;
  const points = [];
  const values = [];
  for (let i = grid_min[0]; i <= grid_max[0]; i++) {
    for (let j = grid_min[1]; j <= grid_max[1]; j++) {
      for (let k = grid_min[2]; k <= grid_max[2]; k++) {
        const frac: Num3 = [i / dim[0], j / dim[1], k / dim[2]];
        points.push(unit_cell.orthogonalize(frac));
        values.push(data[map_index(dim, i, j, k)]);
      }
    }
  }
  block.set(points, values, size);
}

export class ElMap {
  gemmi_module: GemmiModule | null;
  unit_cell: UnitCell | null;
  grid: GridArray | null;
  stats: { mean: number, rms: number };
  block: Block;
  wasm_map: WasmDensityMap | null;
  block_center: Num3 | null;
  block_radius: number;
  declare unit: string;
  box_size?: Num3; // used in ReciprocalSpaceMap

  constructor() {
    this.gemmi_module = null;
    this.unit_cell = null;
    this.grid = null;
    this.stats = { mean: 0.0, rms: 1.0 };
    this.block = new Block();
    this.wasm_map = null;
    this.block_center = null;
    this.block_radius = 0;
  }

  abs_level(sigma: number) {
    return sigma * this.stats.rms + this.stats.mean;
  }

  from_ccp4(buf: ArrayBuffer, expand_symmetry?: boolean, gemmi?: GemmiModule) {
    if (expand_symmetry === undefined) expand_symmetry = true;
    if (gemmi == null || typeof gemmi.readCcp4Map !== 'function') {
      throw Error('Gemmi is required for CCP4 map loading.');
    }
    this.gemmi_module = gemmi;
    if (this.wasm_map != null) {
      this.wasm_map.delete();
      this.wasm_map = null;
    }
    const ccp4 = gemmi.readCcp4Map(buf, expand_symmetry);
    this.wasm_map = ccp4;
    this.set_from_wasm_map(ccp4, gemmi);
  }

  // DSN6 MAP FORMAT
  // http://www.uoxray.uoregon.edu/tnt/manual/node104.html
  // Density values are stored as bytes.
  from_dsn6(buf: ArrayBuffer, gemmi: GemmiModule) {
    if (typeof gemmi.readDsn6Map !== 'function') {
      throw Error('Gemmi is required for DSN6 map loading.');
    }
    this.gemmi_module = gemmi;
    if (this.wasm_map != null) {
      this.wasm_map.delete();
      this.wasm_map = null;
    }
    const dsn6 = gemmi.readDsn6Map(buf);
    this.wasm_map = dsn6;
    this.set_from_wasm_map(dsn6, gemmi);
  }

  prepare_isosurface(radius: number, center: Num3, want_block: boolean=false) {
    this.block_center = center;
    this.block_radius = radius;
    const unit_cell = this.unit_cell;
    if (unit_cell == null) return;
    if (this.wasm_map != null) {
      if (want_block) {
        extract_block_from_map(this.block, this.wasm_map, unit_cell, radius, center);
      }
      return;
    }
    const grid = this.grid;
    if (grid == null) return;
    extract_block_from_grid(this.block, grid, unit_cell, radius, center);
  }

  isomesh_in_block(sigma: number, method: string) {
    const abs_level = this.abs_level(sigma);
    if (this.wasm_map != null && this.block_center != null && this.unit_cell != null) {
      if (!this.wasm_map.extract_isosurface(this.block_radius,
                                            this.block_center[0],
                                            this.block_center[1],
                                            this.block_center[2],
                                            abs_level,
                                            method || '')) {
        throw Error(this.wasm_map.last_error || 'Failed to extract isosurface.');
      }
      return {
        vertices: this.wasm_map.isosurface_vertices().slice(),
        triangles: this.wasm_map.isosurface_triangles().slice(),
        field: this.block.field(),
      } as IsosurfaceData;
    }
    return this.block.isosurface(this.gemmi_module, abs_level, method);
  }

  find_blobs(cutoff: number, options: BlobSearchOptions={}) {
    if (this.wasm_map == null) {
      throw Error('Blob search requires a Gemmi-backed map.');
    }
    const result = this.wasm_map.find_blobs(
      cutoff,
      options.min_volume ?? 10.0,
      options.min_score ?? 15.0,
      options.min_peak ?? 0.0,
      options.negate ?? false,
      options.structure ?? null,
      options.model_index ?? 0,
      options.mask_radius ?? 2.0,
      options.mask_waters ?? false
    );
    if (result == null) return [];
    try {
      const centroids = result.centroids();
      const peaks = result.peak_positions();
      const scores = result.scores();
      const volumes = result.volumes();
      const peak_values = result.peak_values();
      const blobs = [];
      for (let i = 0; i < result.size(); i++) {
        blobs.push({
          centroid: [centroids[3*i], centroids[3*i+1], centroids[3*i+2]] as Num3,
          peak_pos: [peaks[3*i], peaks[3*i+1], peaks[3*i+2]] as Num3,
          score: scores[i],
          volume: volumes[i],
          peak_value: peak_values[i],
        } as BlobHit);
      }
      return blobs;
    } finally {
      result.delete();
    }
  }

  dispose() {
    if (this.wasm_map != null) {
      this.wasm_map.delete();
      this.wasm_map = null;
    }
  }

  private set_from_wasm_map(map: WasmDensityMap, gemmi: GemmiModule) {
    const cell = map.cell;
    this.unit_cell = new gemmi.UnitCell(cell.a, cell.b, cell.c,
                                        cell.alpha, cell.beta, cell.gamma);
    this.stats.mean = map.mean;
    this.stats.rms = map.rms;
    this.grid = null;
  }

}

ElMap.prototype.unit = 'e/\u212B\u00B3';
