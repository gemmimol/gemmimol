export interface UnitCell {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
  delete(): void;
}

export interface Structure {
  readonly name: string;
  readonly cell: UnitCell;
  readonly length: number;
  at(index: number): Model;
  delete(): void;
}

export interface Model {
  readonly num: number;
  readonly length: number;
  at(index: number): Chain;
  count_occupancies(_0: any): number;
  delete(): void;
}

export interface Chain {
  readonly name: string;
  readonly length: number;
  at(index: number): Residue;
  delete(): void;
}

export interface Residue {
  readonly seqid_string: string;
  readonly segment: string;
  readonly name: string;
  readonly subchain: string;
  readonly entity_type_string: string;
  readonly length: number;
  at(index: number): Atom;
  delete(): void;
}

export type Position = [number, number, number];

export interface Atom {
  readonly name: string;
  readonly altloc: number;
  readonly charge: number;
  readonly element_uname: string;
  readonly serial: number;
  readonly pos: Position;
  readonly occ: number;
  readonly b_iso: number;
  delete(): void;
}

export interface Selection {
  delete(): void;
}

export interface BondInfo {
  add_monomer_cif(cif_text: string): void;
  get_bond_lines(st: Structure): void;
  bond_data_ptr(): number;
  bond_data_size(): number;
  delete(): void;
}

export interface SelectionResult {
  set_atom_indices(st: Structure, cid: string, model_index: number): void;
  atom_data_ptr(): number;
  atom_data_size(): number;
  delete(): void;
}

export interface Ccp4Map {
  readonly cell: UnitCell;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly mean: number;
  readonly rms: number;
  readonly last_error: string;
  read(_0: boolean): boolean;
  data(): Float32Array;
  extract_isosurface(radius: number, x: number, y: number, z: number,
                     isolevel: number, method: string): boolean;
  isosurface_vertices(): Float32Array;
  isosurface_segments(): Uint32Array;
  delete(): void;
}

export interface Isosurface {
  readonly last_error: string;
  resize_input(point_count: number): void;
  set_size(size_x: number, size_y: number, size_z: number): void;
  input_points(): Float32Array;
  input_values(): Float32Array;
  calculate(isolevel: number, method: string): boolean;
  vertices(): Float32Array;
  segments(): Uint32Array;
  delete(): void;
}

export interface Mtz {
  readonly cell: UnitCell;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly rmsd: number;
  readonly last_error: string;
  read(_0?: number, _1?: number): boolean;
  calculate_map(_0: boolean): Float32Array | null;
  calculate_map_from_labels(_0: string, _1: string): Float32Array | null;
  delete(): void;
}

export interface Module {
  read_structure(buf: string | ArrayBuffer, name: string, format?: string): Structure;
  get_residue_names(st: Structure): string;
  Selection: {
    new (): Selection;
  };
  BondInfo: {
    new (): BondInfo;
  };
  SelectionResult: {
    new (): SelectionResult;
  };
  readCcp4Map(map_buf: string | ArrayBuffer, expand_symmetry?: boolean): Ccp4Map;
  readMtz(mtz_buf: string | ArrayBuffer): Mtz;
  Isosurface: {
    new (): Isosurface;
  };
  HEAPU8: Uint8Array;
}
