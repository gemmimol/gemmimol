import type { ModelBag } from './bags';
import type { ResidueTemplates, ResidueTemplate } from './residue-templates';

export class ModelEditor {
  templates: ResidueTemplates;

  constructor() {
    // Templates would be loaded lazily or passed in
    this.templates = {};
  }

  set_templates(templates: ResidueTemplates) {
    this.templates = templates;
  }

  // Delete selected atoms/residues
  delete_residue(bag: ModelBag, chain: string, resno: number): boolean {
    const model = bag.model;
    const atoms_to_remove: number[] = [];

    for (let i = 0; i < model.atoms.length; i++) {
      const atom = model.atoms[i];
      if (atom.chain === chain && atom.seqid === resno) {
        atoms_to_remove.push(i);
      }
    }

    if (atoms_to_remove.length === 0) return false;

    // Remove in reverse order to maintain indices
    for (let i = atoms_to_remove.length - 1; i >= 0; i--) {
      model.atoms.splice(atoms_to_remove[i], 1);
    }

    // Rebuild bonds
    this.rebuild_bonds(model);
    return true;
  }

  // Mutate residue (e.g., ALA -> GLY)
  mutate_residue(bag: ModelBag, chain: string, resno: number,
                 new_resname: string): boolean {
    const model = bag.model;
    const old_atoms = model.atoms.filter(
      a => a.chain === chain && a.seqid === resno
    );

    if (old_atoms.length === 0) return false;

    const template = this.templates[new_resname];
    if (!template) {
      console.warn(`Unknown residue: ${new_resname}`);
      return false;
    }

    // Get CA position as anchor
    const ca_atom = old_atoms.find(a => a.name === 'CA');
    if (!ca_atom) return false;

    const [cx, cy, cz] = ca_atom.xyz;

    // Remove old side-chain atoms (keep backbone: N, CA, C, O)
    const backbone_names = ['N', 'CA', 'C', 'O', 'OXT'];
    const atoms_to_remove = model.atoms.filter(
      a => a.chain === chain && a.seqid === resno && !backbone_names.includes(a.name)
    );

    // Remove old side-chain
    for (const atom of atoms_to_remove) {
      const idx = model.atoms.indexOf(atom);
      if (idx >= 0) model.atoms.splice(idx, 1);
    }

    // Add new side-chain from template
    for (const [name, rel_pos] of Object.entries(template.atoms)) {
      if (backbone_names.includes(name)) continue; // Skip backbone

      model.atoms.push({
        name,
        element: this.guess_element(name),
        xyz: [cx + rel_pos[0], cy + rel_pos[1], cz + rel_pos[2]],
        chain,
        seqid: resno,
        resname: new_resname,
        b: 30.0,
        occ: 1.0,
        is_ligand: false,
      } as any);
    }

    // Update residue name on backbone atoms
    for (const atom of model.atoms) {
      if (atom.chain === chain && atom.seqid === resno) {
        atom.resname = new_resname;
      }
    }

    this.rebuild_bonds(model);
    return true;
  }

  // Trim residues to N residues from N-term and C residues from C-term
  trim_chain(bag: ModelBag, chain: string, n_keep: number, c_keep: number): boolean {
    const model = bag.model;
    const chain_atoms = model.atoms.filter(a => a.chain === chain);

    if (chain_atoms.length === 0) return false;

    // Get unique residue numbers in order
    const resnos = [...new Set(chain_atoms.map(a => a.seqid))].sort((a, b) => a - b);

    if (resnos.length <= n_keep + c_keep) return false; // Nothing to trim

    const keep_set = new Set([
      ...resnos.slice(0, n_keep),
      ...resnos.slice(-c_keep)
    ]);

    // Remove atoms not in kept residues
    for (let i = model.atoms.length - 1; i >= 0; i--) {
      const atom = model.atoms[i];
      if (atom.chain === chain && !keep_set.has(atom.seqid)) {
        model.atoms.splice(i, 1);
      }
    }

    this.rebuild_bonds(model);
    return true;
  }

  // Place a new residue (e.g., from blob-fitting)
  place_residue(bag: ModelBag, resname: string, position: number[],
                chain: string, resno: number): boolean {
    const template = this.templates[resname];
    if (!template) {
      console.warn(`Unknown residue: ${resname}`);
      return false;
    }

    const [cx, cy, cz] = position;

    for (const [name, rel_pos] of Object.entries(template.atoms)) {
      bag.model.atoms.push({
        name,
        element: this.guess_element(name),
        xyz: [cx + rel_pos[0], cy + rel_pos[1], cz + rel_pos[2]],
        chain,
        seqid: resno,
        resname,
        b: 40.0, // Higher B-factor for placed atoms
        occ: 1.0,
        is_ligand: false,
      } as any);
    }

    this.rebuild_bonds(bag.model);
    return true;
  }

  private rebuild_bonds(model: any) {
    // Simple bond rebuilding based on distances
    // This is a placeholder - actual implementation would use
    // proper chemistry or the Model's existing bond-building logic
    if (model.recalculate_bonds) {
      model.recalculate_bonds();
    }
  }

  private guess_element(atom_name: string): string {
    const name = atom_name.trim();
    if (name.startsWith('CL')) return 'CL';
    if (name.startsWith('BR')) return 'BR';
    if (name.startsWith('FE')) return 'FE';
    if (name.startsWith('CA') && name.length === 2) return 'CA';
    if (name.startsWith('MG')) return 'MG';
    if (name.startsWith('NA') && name.length === 2) return 'NA';
    if (name.startsWith('ZN')) return 'ZN';
    if (name.startsWith('S')) return 'S';
    if (name.startsWith('P')) return 'P';
    if (name.startsWith('N')) return 'N';
    if (name.startsWith('O')) return 'O';
    if (name.startsWith('C')) return 'C';
    if (name.startsWith('H')) return 'H';
    return 'C'; // Default to carbon
  }
}

// Type for residue template data
export type ResidueTemplates = Record<string, ResidueTemplate>;
export type ResidueTemplate = {
  atoms: Record<string, [number, number, number]>;
};
