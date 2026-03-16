import type { Module as GemmiModule, Isosurface as WasmIsosurface } from './gemmi_wasm';

type Num3 = [number, number, number];

export interface IsosurfaceData {
  vertices: Float32Array;
  segments: Uint32Array;
}

let gemmi_module: GemmiModule | null = null;

export function setIsosurfaceModule(module: GemmiModule) {
  gemmi_module = module;
}

export class Block {
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

  isosurface(isolevel: number, method: string='') {
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
        segments: iso.segments().slice(),
      };
    } finally {
      if (iso != null) iso.delete();
    }
  }
}
