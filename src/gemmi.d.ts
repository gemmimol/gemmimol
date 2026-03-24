// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    function writeArrayToMemory(array: any, buffer: any): void;
    let HEAPU8: any;
}
interface WasmModule {
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export interface NearestImage extends ClassHandle {
  sym_idx: number;
  readonly pbc_shift_x: number;
  readonly pbc_shift_y: number;
  readonly pbc_shift_z: number;
  same_asu(): boolean;
  dist(): number;
  symmetry_code(_0: boolean): string;
}

export interface NearestImageVector extends ClassHandle, Iterable<NearestImage> {
  push_back(_0: NearestImage): void;
  resize(_0: number, _1: NearestImage): void;
  size(): number;
  get(_0: number): NearestImage | undefined;
  set(_0: number, _1: NearestImage): boolean;
}
export interface UnitCellParameters extends ClassHandle {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
}

export interface UnitCell extends UnitCellParameters {
  volume: number;
  is_crystal(): boolean;
  fractionalize(_0: Position): Fractional;
  orthogonalize(_0: Fractional): Position;
}

export interface Isosurface extends ClassHandle {
  readonly last_error: string;
  resize_input(_0: number): void;
  set_size(_0: number, _1: number, _2: number): void;
  calculate(_0: number, _1: EmbindString): boolean;
  input_points(): Float32Array;
  input_values(): Float32Array;
  vertices(): Float32Array;
  segments(): Uint32Array;
}

export interface Structure extends ClassHandle {
  cell: UnitCell;
  readonly length: number;
  get name(): string;
  set name(value: EmbindString);
  at(_0: number): Model | null;
}

export interface Model extends ClassHandle {
  num: number;
  readonly length: number;
  at(_0: number): Chain | null;
  count_occupancies(_0: Selection | null): number;
}

export interface Chain extends ClassHandle {
  readonly length: number;
  get name(): string;
  set name(value: EmbindString);
  at(_0: number): Residue | null;
}

export interface ResidueId extends ClassHandle {
  readonly seqid_string: string;
  get segment(): string;
  set segment(value: EmbindString);
  get name(): string;
  set name(value: EmbindString);
}

export interface Residue extends ResidueId {
  ss_from_file: number;
  strand_sense_from_file: number;
  readonly length: number;
  get subchain(): string;
  set subchain(value: EmbindString);
  readonly ss_from_file_string: string;
  readonly strand_sense_from_file_string: string;
  readonly entity_type_string: string;
  at(_0: number): Atom | null;
}

export interface Atom extends ClassHandle {
  altloc: number;
  charge: number;
  serial: number;
  occ: number;
  b_iso: number;
  pos: Position;
  get name(): string;
  set name(value: EmbindString);
  readonly element_uname: string;
}

export interface Selection extends ClassHandle {
}

export interface BondInfo extends ClassHandle {
  get_bond_lines(_0: Structure): void;
  bond_data_ptr(): number;
  bond_data_size(): number;
  add_monomer_cif(_0: EmbindString): void;
}

export interface SelectionResult extends ClassHandle {
  atom_data_ptr(): number;
  atom_data_size(): number;
  set_atom_indices(_0: Structure, _1: EmbindString, _2: number): void;
}

export interface Ccp4Map extends ClassHandle {
  readonly cell: UnitCell;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly mean: number;
  readonly rms: number;
  readonly last_error: string;
  read(_0: boolean): boolean;
  extract_isosurface(_0: number, _1: number, _2: number, _3: number, _4: number, _5: EmbindString): boolean;
  data(): Float32Array;
  isosurface_vertices(): Float32Array;
  isosurface_segments(): Uint32Array;
}

export interface Dsn6Map extends ClassHandle {
  readonly cell: UnitCell;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly mean: number;
  readonly rms: number;
  readonly last_error: string;
  read(): boolean;
  data(): Float32Array;
  extract_isosurface(_0: number, _1: number, _2: number, _3: number, _4: number, _5: EmbindString): boolean;
  isosurface_vertices(): Float32Array;
  isosurface_segments(): Uint32Array;
}

export interface Mtz extends ClassHandle {
  readonly cell: UnitCell;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly rmsd: number;
  readonly last_error: string;
  read(): boolean;
  calculate_map(_0: boolean): Float32Array | null;
  calculate_map_from_labels(_0: EmbindString, _1: EmbindString): Float32Array | null;
  calculate_wasm_map(_0: boolean): MtzMap | null;
  calculate_wasm_map_from_labels(_0: EmbindString, _1: EmbindString): MtzMap | null;
}

export interface MtzMap extends ClassHandle {
  readonly cell: UnitCell;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly mean: number;
  readonly rms: number;
  readonly last_error: string;
  data(): Float32Array;
  extract_isosurface(_0: number, _1: number, _2: number, _3: number, _4: number, _5: EmbindString): boolean;
  isosurface_vertices(): Float32Array;
  isosurface_segments(): Uint32Array;
}

export type Fractional = [ number, number, number ];

export type Position = [ number, number, number ];

interface EmbindModule {
  NearestImage: {
    new(): NearestImage;
  };
  NearestImageVector: {
    new(): NearestImageVector;
  };
  UnitCellParameters: {};
  UnitCell: {
    new(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number): UnitCell;
  };
  Isosurface: {
    new(): Isosurface;
  };
  Structure: {
    new(): Structure;
  };
  Model: {
    new(): Model;
  };
  Chain: {
    new(): Chain;
  };
  ResidueId: {};
  Residue: {
    new(): Residue;
  };
  Atom: {
    new(): Atom;
  };
  Selection: {
    new(): Selection;
  };
  BondInfo: {
    new(): BondInfo;
  };
  SelectionResult: {
    new(): SelectionResult;
  };
  get_sym_image(_0: Structure, _1: NearestImage): Structure;
  Ccp4Map: {
    new(_0: EmbindString): Ccp4Map;
  };
  Dsn6Map: {
    new(_0: EmbindString): Dsn6Map;
  };
  Mtz: {
    new(_0: EmbindString): Mtz;
  };
  MtzMap: {};
  get_nearby_sym_ops(_0: Structure, _1: Position, _2: number): NearestImageVector;
  get_missing_monomer_names(_0: Structure): string;
  _read_structure(_0: EmbindString, _1: EmbindString, _2: EmbindString): Structure;
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export type GemmiModule = MainModule & {
  read_structure(buf: string | ArrayBuffer, name: string, format?: string): Structure;
  readCcp4Map(map_buf: string | ArrayBuffer, expand_symmetry?: boolean): Ccp4Map;
  readDsn6Map(map_buf: string | ArrayBuffer): Dsn6Map;
  readMtz(mtz_buf: string | ArrayBuffer): Mtz;
};
export default function MainModuleFactory (options?: unknown): Promise<GemmiModule>;
