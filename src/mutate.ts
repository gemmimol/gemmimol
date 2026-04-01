import type { Atom } from './model';
import { aminoAcidTemplate } from './residue-templates';

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

const EPS = 1e-6;
const PRESERVED_BACKBONE = new Set(['N', 'CA', 'C', 'O', 'OXT', 'OT1', 'OT2']);

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

function transform_point(point: Num3, from: Frame, to: Frame): Num3 {
  const delta = sub(point, from.origin);
  const local: Num3 = [dot(delta, from.x), dot(delta, from.y), dot(delta, from.z)];
  return add(to.origin,
             add(scale(to.x, local[0]),
                 add(scale(to.y, local[1]), scale(to.z, local[2]))));
}

function atom_by_name(atoms: {name: string, xyz: Num3}[], name: string) {
  return atoms.find((atom) => atom.name === name) || null;
}

function heavy_template_atoms(resname: string) {
  const template = aminoAcidTemplate(resname);
  if (template == null) throw Error('No template is available for ' + resname + '.');
  return template.atoms.filter((atom) => atom.element !== 'H' && atom.element !== 'D');
}

function pseudo_cb_xyz(residue_atoms: Atom[]): Num3 {
  const ala_atoms = heavy_template_atoms('ALA');
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
  return atom_by_name(residue_atoms, 'CA') as Atom || residue_atoms[0];
}

export function plan_residue_mutation(residue_atoms: Atom[], target_resname: string): MutationPlan {
  if (residue_atoms.length === 0) throw Error('Residue is empty.');
  if (residue_atoms.some((atom) => !atom.is_main_conformer())) {
    throw Error('Mutation of alternate conformers is not supported yet.');
  }

  const target = target_resname.toUpperCase();
  const template_atoms = heavy_template_atoms(target);
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

  const remove_atoms = residue_atoms.filter((atom) => !PRESERVED_BACKBONE.has(atom.name));
  const add_atoms: MutationAtom[] = [];
  let focus = source_ca.xyz;
  if (target !== 'GLY') {
    if (!template_cb) throw Error('Target template for ' + target + ' lacks CB.');
    const from = build_sidechain_frame(template_n.xyz, template_ca.xyz, template_c.xyz, template_cb.xyz);
    const to = build_sidechain_frame(source_n.xyz, source_ca.xyz, source_c.xyz, source_cb);
    for (const atom of template_atoms) {
      if (PRESERVED_BACKBONE.has(atom.name)) continue;
      const xyz = transform_point(atom.xyz, from, to);
      add_atoms.push({name: atom.name, element: atom.element, xyz: xyz});
      if (atom.name === 'CB') focus = xyz;
    }
  }

  const ref_atom = representative_atom(residue_atoms);
  return {
    source_resname: residue_atoms[0].resname,
    target_resname: target,
    label: '/' + residue_atoms[0].seqid + ' ' + residue_atoms[0].resname + '/' + residue_atoms[0].chain,
    remove_atoms: remove_atoms,
    add_atoms: add_atoms,
    focus: focus,
    occupancy: ref_atom.occ,
    b_iso: ref_atom.b,
  };
}

export const STANDARD_MUTATION_TARGETS = [
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
  'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
];
