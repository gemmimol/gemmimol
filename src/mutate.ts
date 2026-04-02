import type { Atom } from './model';
import { aminoAcidTemplate, nucleotideTemplate } from './residue-templates';

type Num3 = [number, number, number];

export type MutationAtom = {
  name: string,
  element: string,
  xyz: Num3,
};

export type MutationPlan = {
  source_resname: string,
  target_resname: string,
  label: string,
  remove_atoms: Atom[],
  add_atoms: MutationAtom[],
  focus: Num3,
  occupancy: number,
  b_iso: number,
};

type Frame = {
  origin: Num3,
  x: Num3,
  y: Num3,
  z: Num3,
};

type ResidueKind = 'protein' | 'rna' | 'dna' | null;

type AtomLike = {
  name: string,
  xyz: Num3,
};

const EPS = 1e-6;
const PROTEIN_BACKBONE = new Set(['N', 'CA', 'C', 'O', 'OXT', 'OT1', 'OT2']);
const AMINO_ACID_MUTATION_TARGETS = [
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
  'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
];
const RNA_BASE_TARGETS = ['A', 'C', 'G', 'U'];
const DNA_BASE_TARGETS = ['A', 'C', 'G', 'T'];
const RNA_RESNAMES = new Set(RNA_BASE_TARGETS);
const DNA_RESNAMES = new Set(['DA', 'DC', 'DG', 'DT']);
const PHOSPHATE_ATOMS = new Set(['P', 'OP1', 'OP2', 'OP3', 'O1P', 'O2P', 'O3P']);
const SUGAR_TO_DNA = '\u2192 DNA';
const SUGAR_TO_RNA = '\u2192 RNA';

function normalize_atom_name(name: string): string {
  return name.toUpperCase().replace(/\*/g, '\'');
}

function residue_kind(resname: string): ResidueKind {
  const name = resname.toUpperCase();
  if (AMINO_ACID_MUTATION_TARGETS.indexOf(name) !== -1) return 'protein';
  if (RNA_RESNAMES.has(name)) return 'rna';
  if (DNA_RESNAMES.has(name)) return 'dna';
  return null;
}

function is_preserved_nucleotide_atom(name: string): boolean {
  const norm = normalize_atom_name(name);
  return norm.indexOf('\'') !== -1 || PHOSPHATE_ATOMS.has(norm);
}

function base_atom_name(source_resname: string): 'N1' | 'N9' {
  const name = source_resname.toUpperCase();
  if (name === 'A' || name === 'G' || name === 'DA' || name === 'DG') return 'N9';
  return 'N1';
}

function nucleotide_target_resname(source_resname: string, target: string): string {
  const source_kind = residue_kind(source_resname);
  const upper = target.toUpperCase();
  if (source_kind === 'rna') {
    if (RNA_RESNAMES.has(upper)) return upper;
    if (upper === 'T') throw Error('RNA mutation target T is not supported.');
    if (upper.length === 2 && upper.startsWith('D') && DNA_RESNAMES.has(upper)) {
      throw Error('Cannot mutate RNA residue to DNA base ' + upper + '.');
    }
    throw Error('Unsupported RNA mutation target ' + target + '.');
  }
  if (source_kind === 'dna') {
    if (DNA_RESNAMES.has(upper)) return upper;
    const mapped = 'D' + upper;
    if (DNA_RESNAMES.has(mapped)) return mapped;
    if (upper === 'U') throw Error('DNA mutation target U is not supported.');
    throw Error('Unsupported DNA mutation target ' + target + '.');
  }
  return upper;
}

function sub(a: Num3, b: Num3): Num3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Num3, b: Num3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Num3, b: Num3): Num3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function scale(v: Num3, s: number): Num3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function add(a: Num3, b: Num3): Num3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function length(v: Num3): number {
  return Math.sqrt(dot(v, v));
}

function normalize(v: Num3, what: string): Num3 {
  const len = length(v);
  if (!(len > EPS)) throw Error('Cannot define ' + what + '.');
  return [v[0] / len, v[1] / len, v[2] / len];
}

function reject(v: Num3, axis: Num3): Num3 {
  return sub(v, scale(axis, dot(v, axis)));
}

function build_backbone_frame(n: Num3, ca: Num3, c: Num3): Frame {
  let x = normalize(sub(c, ca), 'backbone frame');
  let y = reject(sub(n, ca), x);
  y = normalize(y, 'backbone frame');
  const z = normalize(cross(x, y), 'backbone frame');
  x = normalize(cross(y, z), 'backbone frame');
  return {origin: ca, x: x, y: y, z: z};
}

function build_sidechain_frame(n: Num3, ca: Num3, c: Num3, cb: Num3): Frame {
  let x = normalize(sub(cb, ca), 'CA-CB direction');
  const plane_normal = normalize(cross(sub(c, ca), sub(n, ca)), 'backbone plane');
  let y = cross(plane_normal, x);
  if (length(y) <= EPS) {
    y = reject(sub(n, ca), x);
  }
  y = normalize(y, 'sidechain frame');
  const z = normalize(cross(x, y), 'sidechain frame');
  x = normalize(cross(y, z), 'sidechain frame');
  return {origin: ca, x: x, y: y, z: z};
}

function build_anchor_frame(a: Num3, origin: Num3, c: Num3, what: string): Frame {
  let x = normalize(sub(a, origin), what);
  let y = reject(sub(c, origin), x);
  y = normalize(y, what);
  const z = normalize(cross(x, y), what);
  x = normalize(cross(y, z), what);
  return {origin: origin, x: x, y: y, z: z};
}

function transform_point(point: Num3, from: Frame, to: Frame): Num3 {
  const delta = sub(point, from.origin);
  const local: Num3 = [dot(delta, from.x), dot(delta, from.y), dot(delta, from.z)];
  return add(to.origin,
             add(scale(to.x, local[0]),
                 add(scale(to.y, local[1]), scale(to.z, local[2]))));
}

function atom_by_name<T extends AtomLike>(atoms: T[], name: string): T | null {
  const wanted = normalize_atom_name(name);
  return atoms.find((atom) => normalize_atom_name(atom.name) === wanted) || null;
}

function heavy_amino_template_atoms(resname: string) {
  const template = aminoAcidTemplate(resname);
  if (template == null) throw Error('No template is available for ' + resname + '.');
  return template.atoms.filter((atom) => atom.element !== 'H' && atom.element !== 'D');
}

function heavy_nucleotide_template_atoms(resname: string) {
  const template = nucleotideTemplate(resname);
  if (template == null) throw Error('No template is available for ' + resname + '.');
  return template.atoms.filter((atom) => atom.element !== 'H' && atom.element !== 'D');
}

function pseudo_cb_xyz(residue_atoms: Atom[]): Num3 {
  const ala_atoms = heavy_amino_template_atoms('ALA');
  const source_n = atom_by_name(residue_atoms, 'N');
  const source_ca = atom_by_name(residue_atoms, 'CA');
  const source_c = atom_by_name(residue_atoms, 'C');
  const ala_n = atom_by_name(ala_atoms, 'N');
  const ala_ca = atom_by_name(ala_atoms, 'CA');
  const ala_c = atom_by_name(ala_atoms, 'C');
  const ala_cb = atom_by_name(ala_atoms, 'CB');
  if (!source_n || !source_ca || !source_c || !ala_n || !ala_ca || !ala_c || !ala_cb) {
    throw Error('Cannot derive pseudo-CB for mutation.');
  }
  const from = build_backbone_frame(ala_n.xyz, ala_ca.xyz, ala_c.xyz);
  const to = build_backbone_frame(source_n.xyz, source_ca.xyz, source_c.xyz);
  return transform_point(ala_cb.xyz, from, to);
}

function representative_atom(residue_atoms: Atom[]): Atom {
  return atom_by_name(residue_atoms, 'C1\'') as Atom ||
         atom_by_name(residue_atoms, 'CA') as Atom ||
         residue_atoms[0];
}

function mutation_label(residue_atoms: Atom[]) {
  return '/' + residue_atoms[0].seqid + ' ' + residue_atoms[0].resname + '/' + residue_atoms[0].chain;
}

function plan_protein_mutation(residue_atoms: Atom[], target: string): MutationPlan {
  const template_atoms = heavy_amino_template_atoms(target);
  const source_n = atom_by_name(residue_atoms, 'N');
  const source_ca = atom_by_name(residue_atoms, 'CA');
  const source_c = atom_by_name(residue_atoms, 'C');
  if (!source_n || !source_ca || !source_c) {
    throw Error('Mutation requires protein backbone atoms N, CA and C.');
  }

  const source_cb_atom = atom_by_name(residue_atoms, 'CB') as Atom | null;
  const source_cb = source_cb_atom ? source_cb_atom.xyz : pseudo_cb_xyz(residue_atoms);
  const template_n = atom_by_name(template_atoms, 'N');
  const template_ca = atom_by_name(template_atoms, 'CA');
  const template_c = atom_by_name(template_atoms, 'C');
  const template_cb = atom_by_name(template_atoms, 'CB');
  if (!template_n || !template_ca || !template_c) {
    throw Error('Target template for ' + target + ' is incomplete.');
  }

  const remove_atoms = residue_atoms.filter((atom) => !PROTEIN_BACKBONE.has(atom.name));
  const add_atoms: MutationAtom[] = [];
  let focus = source_ca.xyz;
  if (target !== 'GLY') {
    if (!template_cb) throw Error('Target template for ' + target + ' lacks CB.');
    const from = build_sidechain_frame(template_n.xyz, template_ca.xyz, template_c.xyz, template_cb.xyz);
    const to = build_sidechain_frame(source_n.xyz, source_ca.xyz, source_c.xyz, source_cb);
    for (const atom of template_atoms) {
      if (PROTEIN_BACKBONE.has(atom.name)) continue;
      const xyz = transform_point(atom.xyz, from, to);
      add_atoms.push({name: atom.name, element: atom.element, xyz: xyz});
      if (atom.name === 'CB') focus = xyz;
    }
  }

  const ref_atom = representative_atom(residue_atoms);
  return {
    source_resname: residue_atoms[0].resname,
    target_resname: target,
    label: mutation_label(residue_atoms),
    remove_atoms: remove_atoms,
    add_atoms: add_atoms,
    focus: focus,
    occupancy: ref_atom.occ,
    b_iso: ref_atom.b,
  };
}

function plan_nucleotide_mutation(residue_atoms: Atom[], source_kind: 'rna' | 'dna',
                                  target_label: string): MutationPlan {
  const target = nucleotide_target_resname(residue_atoms[0].resname, target_label);
  const template_atoms = heavy_nucleotide_template_atoms(target);
  const source_o4 = atom_by_name(residue_atoms, 'O4\'');
  const source_c1 = atom_by_name(residue_atoms, 'C1\'');
  const source_c2 = atom_by_name(residue_atoms, 'C2\'');
  const template_o4 = atom_by_name(template_atoms, 'O4\'');
  const template_c1 = atom_by_name(template_atoms, 'C1\'');
  const template_c2 = atom_by_name(template_atoms, 'C2\'');
  if (!source_o4 || !source_c1 || !source_c2) {
    throw Error('Base mutation requires sugar atoms O4\', C1\' and C2\'.');
  }
  if (!template_o4 || !template_c1 || !template_c2) {
    throw Error('Target template for ' + target + ' is incomplete.');
  }

  const from = build_anchor_frame(template_o4.xyz, template_c1.xyz, template_c2.xyz,
                                  'nucleotide sugar frame');
  const to = build_anchor_frame(source_o4.xyz, source_c1.xyz, source_c2.xyz,
                                'nucleotide sugar frame');
  const remove_atoms = residue_atoms.filter((atom) => !is_preserved_nucleotide_atom(atom.name));
  const add_atoms: MutationAtom[] = [];
  const focus_name = base_atom_name(target);
  let focus = source_c1.xyz;
  for (const atom of template_atoms) {
    if (is_preserved_nucleotide_atom(atom.name)) continue;
    const xyz = transform_point(atom.xyz, from, to);
    add_atoms.push({name: atom.name, element: atom.element, xyz: xyz});
    if (normalize_atom_name(atom.name) === focus_name) focus = xyz;
  }

  const ref_atom = representative_atom(residue_atoms);
  return {
    source_resname: residue_atoms[0].resname,
    target_resname: target,
    label: mutation_label(residue_atoms),
    remove_atoms: remove_atoms,
    add_atoms: add_atoms,
    focus: focus,
    occupancy: ref_atom.occ,
    b_iso: ref_atom.b,
  };
}

function sugar_switch_resname(source: string): string {
  const upper = source.toUpperCase();
  if (upper === 'A') return 'DA';
  if (upper === 'C') return 'DC';
  if (upper === 'G') return 'DG';
  if (upper === 'U') return 'DT';
  if (upper === 'DA') return 'A';
  if (upper === 'DC') return 'C';
  if (upper === 'DG') return 'G';
  if (upper === 'DT') return 'U';
  throw Error('No sugar switch mapping for ' + source + '.');
}

function plan_sugar_switch(residue_atoms: Atom[], source_kind: 'rna' | 'dna'): MutationPlan {
  const source_resname = residue_atoms[0].resname;
  const target_resname = sugar_switch_resname(source_resname);

  const remove_atoms: Atom[] = [];
  const add_atoms: MutationAtom[] = [];

  const source_c2 = atom_by_name(residue_atoms, "C2'");
  if (!source_c2) throw Error('Sugar switch requires C2\' atom.');
  let focus = source_c2.xyz;

  if (source_kind === 'rna') {
    // RNA → DNA: remove O2'
    const o2_atom = atom_by_name(residue_atoms, "O2'");
    if (o2_atom) remove_atoms.push(o2_atom);
  } else {
    // DNA → RNA: add O2' from RNA template
    const template_atoms = heavy_nucleotide_template_atoms(target_resname);
    const template_o2 = atom_by_name(template_atoms, "O2'");
    if (!template_o2) throw Error('RNA template for ' + target_resname + ' lacks O2\'.');

    const source_o4 = atom_by_name(residue_atoms, "O4'");
    const source_c1 = atom_by_name(residue_atoms, "C1'");
    const template_o4 = atom_by_name(template_atoms, "O4'");
    const template_c1 = atom_by_name(template_atoms, "C1'");
    const template_c2 = atom_by_name(template_atoms, "C2'");
    if (!source_o4 || !source_c1) {
      throw Error('Sugar switch requires O4\', C1\' and C2\' atoms.');
    }
    if (!template_o4 || !template_c1 || !template_c2) {
      throw Error('Template for ' + target_resname + ' is incomplete.');
    }

    const from = build_anchor_frame(template_o4.xyz, template_c1.xyz, template_c2.xyz,
                                    'nucleotide sugar frame');
    const to = build_anchor_frame(source_o4.xyz, source_c1.xyz, source_c2.xyz,
                                  'nucleotide sugar frame');
    const xyz = transform_point(template_o2.xyz, from, to);
    add_atoms.push({name: "O2'", element: 'O', xyz: xyz});
    focus = xyz;
  }

  const ref_atom = representative_atom(residue_atoms);
  return {
    source_resname: source_resname,
    target_resname: target_resname,
    label: mutation_label(residue_atoms),
    remove_atoms: remove_atoms,
    add_atoms: add_atoms,
    focus: focus,
    occupancy: ref_atom.occ,
    b_iso: ref_atom.b,
  };
}

export function mutation_targets_for_residue(residue_atoms: Atom[]): string[] {
  if (residue_atoms.length === 0) return [];
  const kind = residue_kind(residue_atoms[0].resname);
  if (kind === 'protein') return AMINO_ACID_MUTATION_TARGETS.slice();
  if (kind === 'rna') return [...RNA_BASE_TARGETS, SUGAR_TO_DNA];
  if (kind === 'dna') return [...DNA_BASE_TARGETS, SUGAR_TO_RNA];
  return [];
}

export function plan_residue_mutation(residue_atoms: Atom[], target_resname: string): MutationPlan {
  if (residue_atoms.length === 0) throw Error('Residue is empty.');
  if (residue_atoms.some((atom) => !atom.is_main_conformer())) {
    throw Error('Mutation of alternate conformers is not supported yet.');
  }
  const kind = residue_kind(residue_atoms[0].resname);
  if (kind === 'protein') {
    return plan_protein_mutation(residue_atoms, target_resname.toUpperCase());
  }
  if (kind === 'rna' || kind === 'dna') {
    if (target_resname === SUGAR_TO_DNA || target_resname === SUGAR_TO_RNA) {
      return plan_sugar_switch(residue_atoms, kind);
    }
    return plan_nucleotide_mutation(residue_atoms, kind, target_resname);
  }
  throw Error('Mutation is supported only for standard amino-acid and nucleic-acid residues.');
}
