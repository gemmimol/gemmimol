import type { ModelBag } from './bags';
import type { ResidueTemplates } from './types';

export class ModelEditor {
  templates: ResidueTemplates;

  constructor() {
    this.templates = {};
  }

  set_templates(templates: ResidueTemplates) {
    this.templates = templates;
  }

  delete_residue(bag: ModelBag, chain: string, resno: number): boolean {
    const model = bag.model;
    const atoms_to_remove: number[] = [];

    for (let i = 0; i < model.atoms.length; i++) {
      const atom = model.atoms[i];
      if (atom.chain === chain && (atom as any).seqid === resno) {
        atoms_to_remove.push(i);
      }
    }

    if (atoms_to_remove.length === 0) return false;

    for (let i = atoms_to_remove.length - 1; i >= 0; i--) {
      model.atoms.splice(atoms_to_remove[i], 1);
    }

    this.rebuild_bonds(model);
    return true;
  }

  mutate_residue(bag: ModelBag, chain: string, resno: number, new_resname: string): boolean {
    const model = bag.model;
    const old_atoms = model.atoms.filter(
      (a: any) => a.chain === chain && a.seqid === resno
    );

    if (old_atoms.length === 0) return false;

    const template = this.templates[new_resname];
    if (!template) {
      console.warn(`Unknown residue: ${new_resname}`);
      return false;
    }

    const ca_atom = old_atoms.find((a: any) => a.name === 'CA');
    if (!ca_atom) return false;

    const [cx, cy, cz] = ca_atom.xyz;
    const backbone_names = ['N', 'CA', 'C', 'O', 'OXT'];
    const atoms_to_remove = model.atoms.filter(
      (a: any) => a.chain === chain && a.seqid === resno && !backbone_names.includes(a.name)
    );

    for (const atom of atoms_to_remove) {
      const idx = model.atoms.indexOf(atom);
      if (idx >= 0) model.atoms.splice(idx, 1);
    }

    for (const ta of template.atoms) {
      if (backbone_names.includes(ta.name)) continue;
      model.atoms.push({
        name: ta.name,
        element: ta.element,
        xyz: [cx + ta.xyz[0], cy + ta.xyz[1], cz + ta.xyz[2]],
        chain,
        seqid: resno,
        resname: new_resname,
        b: 30.0,
        occ: 1.0,
        is_ligand: false,
      } as any);
    }

    for (const atom of model.atoms) {
      if (atom.chain === chain && (atom as any).seqid === resno) {
        atom.resname = new_resname;
      }
    }

    this.rebuild_bonds(model);
    return true;
  }

  trim_residues(bag: ModelBag, chain: string, n_keep: number, c_keep: number): boolean {
    const model = bag.model;
    const chain_atoms = model.atoms.filter((a: any) => a.chain === chain);
    if (chain_atoms.length === 0) return false;

    const resnos = [...new Set(chain_atoms.map((a: any) => a.seqid))].sort((a, b) => a - b);
    if (resnos.length <= n_keep + c_keep) return false;

    const keep_set = new Set([...resnos.slice(0, n_keep), ...resnos.slice(-c_keep)]);

    for (let i = model.atoms.length - 1; i >= 0; i--) {
      const atom = model.atoms[i];
      if (atom.chain === chain && !keep_set.has((atom as any).seqid)) {
        model.atoms.splice(i, 1);
      }
    }

    this.rebuild_bonds(model);
    return true;
  }

  place_residue(bag: ModelBag, resname: string, position: number[],
                chain: string, resno: number): boolean {
    const template = this.templates[resname];
    if (!template) {
      console.warn(`Unknown residue: ${resname}`);
      return false;
    }

    const [cx, cy, cz] = position;
    for (const ta of template.atoms) {
      bag.model.atoms.push({
        name: ta.name,
        element: ta.element,
        xyz: [cx + ta.xyz[0], cy + ta.xyz[1], cz + ta.xyz[2]],
        chain,
        seqid: resno,
        resname,
        b: 40.0,
        occ: 1.0,
        is_ligand: false,
      } as any);
    }

    this.rebuild_bonds(bag.model);
    return true;
  }

  private rebuild_bonds(model: any) {
    if (model.recalculate_bonds) {
      model.recalculate_bonds();
    }
  }
}
