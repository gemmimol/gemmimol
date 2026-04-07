import type { ModelBag } from './bags';
import type { ResidueTemplates } from './types';
import type { Atom } from '../model';

export interface EditResult {
  success: boolean;
  message: string;
  center?: number[];
  affected_atoms?: number;
}

export class ModelEditor {
  templates: ResidueTemplates = {};

  set_templates(templates: ResidueTemplates) {
    this.templates = templates;
  }

  delete_residue(bag: ModelBag, chain: string, resno: number | string): EditResult {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    const model = bag.model;
    const indices_to_remove: number[] = [];
    let center: number[] = [0, 0, 0];
    let count = 0;

    for (let i = 0; i < model.atoms.length; i++) {
      const atom = model.atoms[i];
      if (atom.chain === chain && atom.seqid === String(resno)) {
        indices_to_remove.push(i);
        center[0] += atom.xyz[0];
        center[1] += atom.xyz[1];
        center[2] += atom.xyz[2];
        count++;
      }
    }

    if (indices_to_remove.length === 0) {
      return { success: false, message: `No atoms found for ${chain}/${resno}` };
    }

    // Remove atoms (from end to start to preserve indices)
    for (let i = indices_to_remove.length - 1; i >= 0; i--) {
      model.atoms.splice(indices_to_remove[i], 1);
    }

    // Renumber remaining atoms
    for (let i = 0; i < model.atoms.length; i++) {
      model.atoms[i].i_seq = i;
    }

    // Rebuild bonds
    this.rebuild_bonds(model);

    center = count > 0 ? [center[0] / count, center[1] / count, center[2] / count] : center;

    return {
      success: true,
      message: `Deleted ${indices_to_remove.length} atoms from ${chain}/${resno}`,
      center,
      affected_atoms: indices_to_remove.length,
    };
  }

  delete_chain(bag: ModelBag, chain: string): EditResult {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    const model = bag.model;
    const initial_count = model.atoms.length;
    
    // Filter out atoms from this chain
    model.atoms = model.atoms.filter((atom) => {
      if (atom.chain !== chain) return true;
      return false;
    });

    const removed = initial_count - model.atoms.length;
    if (removed === 0) {
      return { success: false, message: `No atoms found for chain ${chain}` };
    }

    // Renumber
    for (let i = 0; i < model.atoms.length; i++) {
      model.atoms[i].i_seq = i;
    }

    this.rebuild_bonds(model);

    return {
      success: true,
      message: `Deleted chain ${chain} (${removed} atoms)`,
      affected_atoms: removed,
    };
  }

  delete_atom(bag: ModelBag, atom_index: number): EditResult {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    if (atom_index < 0 || atom_index >= bag.model.atoms.length) {
      return { success: false, message: 'Invalid atom index' };
    }

    const atom = bag.model.atoms[atom_index];
    const center = atom.xyz.slice();
    
    bag.model.atoms.splice(atom_index, 1);

    // Renumber
    for (let i = 0; i < bag.model.atoms.length; i++) {
      bag.model.atoms[i].i_seq = i;
    }

    this.rebuild_bonds(bag.model);

    return {
      success: true,
      message: `Deleted atom ${atom.name}`,
      center,
      affected_atoms: 1,
    };
  }

  mutate_residue(bag: ModelBag, chain: string, resno: number | string, new_resname: string): EditResult {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    const template = this.templates[new_resname];
    if (!template) {
      return { success: false, message: `Unknown residue: ${new_resname}` };
    }

    const model = bag.model;
    const target_resno = String(resno);
    
    // Find existing atoms
    const existing_atoms = model.atoms.filter(
      a => a.chain === chain && a.seqid === target_resno
    );

    if (existing_atoms.length === 0) {
      return { success: false, message: `No atoms found at ${chain}/${resno}` };
    }

    const ca_atom = existing_atoms.find(a => a.name === 'CA');
    if (!ca_atom) {
      return { success: false, message: 'Residue lacks CA atom' };
    }

    const [cx, cy, cz] = ca_atom.xyz;
    const center: number[] = [cx, cy, cz];

    // Keep backbone atoms
    const backbone_names = ['N', 'CA', 'C', 'O', 'OXT', 'OT1', 'OT2'];
    const hydrogens = ['H', 'H1', 'H2', 'H3', 'HA', 'HA2', 'HA3'];
    const keep_names = [...backbone_names, ...hydrogens];
    
    // Remove non-backbone atoms
    for (let i = model.atoms.length - 1; i >= 0; i--) {
      const atom = model.atoms[i];
      if (atom.chain === chain && atom.seqid === target_resno) {
        if (!keep_names.includes(atom.name)) {
          model.atoms.splice(i, 1);
        } else {
          // Update residue name for kept atoms
          atom.resname = new_resname;
        }
      }
    }

    // Add new side chain atoms from template
    for (const ta of template.atoms) {
      if (keep_names.includes(ta.name)) continue;
      
      model.atoms.push({
        i_seq: model.atoms.length,
        name: ta.name,
        element: ta.element,
        xyz: [cx + ta.xyz[0], cy + ta.xyz[1], cz + ta.xyz[2]],
        chain,
        seqid: target_resno,
        resname: new_resname,
        b: 30.0,
        occ: 1.0,
        is_ligand: false,
      } as Atom);
    }

    this.rebuild_bonds(model);

    return {
      success: true,
      message: `Mutated to ${new_resname}`,
      center,
    };
  }

  trim_residues(bag: ModelBag, chain: string, n_keep: number, c_keep: number): EditResult {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    const chain_atoms = bag.model.atoms.filter(a => a.chain === chain);
    if (chain_atoms.length === 0) {
      return { success: false, message: `No atoms in chain ${chain}` };
    }

    // Get unique residue numbers sorted
    const resnos = [...new Set(chain_atoms.map(a => parseInt(a.seqid, 10)))]
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    if (resnos.length <= n_keep + c_keep) {
      return { success: false, message: 'Chain too short to trim' };
    }

    const keep_set = new Set([
      ...resnos.slice(0, n_keep),
      ...resnos.slice(-c_keep),
    ]);

    const initial_count = bag.model.atoms.length;
    
    bag.model.atoms = bag.model.atoms.filter(atom => {
      if (atom.chain !== chain) return true;
      const resno = parseInt(atom.seqid, 10);
      return keep_set.has(resno);
    });

    const removed = initial_count - bag.model.atoms.length;

    // Renumber
    for (let i = 0; i < bag.model.atoms.length; i++) {
      bag.model.atoms[i].i_seq = i;
    }

    this.rebuild_bonds(bag.model);

    return {
      success: true,
      message: `Trimmed chain ${chain} to ${keep_set.size} residues`,
      affected_atoms: removed,
    };
  }

  trim_to_alanine(bag: ModelBag, chain: string, resno: number | string): EditResult {
    if (!bag.model) return { success: false, message: 'No model data' };
    
    const target_resno = String(resno);
    const ala_atoms = ['N', 'CA', 'C', 'O', 'CB', 'H', 'HA', 'HB1', 'HB2', 'HB3'];
    
    const residue_atoms = bag.model.atoms.filter(
      a => a.chain === chain && a.seqid === target_resno
    );
    
    if (residue_atoms.length === 0) {
      return { success: false, message: `No atoms at ${chain}/${resno}` };
    }

    const has_cb = residue_atoms.some(a => a.name === 'CB');
    if (!has_cb) {
      return { success: false, message: 'Residue lacks CB, cannot trim to Ala' };
    }

    let center: number[] = [0, 0, 0];
    let count = 0;

    // Remove non-Ala atoms
    for (let i = bag.model.atoms.length - 1; i >= 0; i--) {
      const atom = bag.model.atoms[i];
      if (atom.chain === chain && atom.seqid === target_resno) {
        center[0] += atom.xyz[0];
        center[1] += atom.xyz[1];
        center[2] += atom.xyz[2];
        count++;
        
        if (!ala_atoms.includes(atom.name)) {
          bag.model.atoms.splice(i, 1);
        } else {
          atom.resname = 'ALA';
        }
      }
    }

    // Renumber
    for (let i = 0; i < bag.model.atoms.length; i++) {
      bag.model.atoms[i].i_seq = i;
    }

    this.rebuild_bonds(bag.model);

    center = count > 0 ? [center[0] / count, center[1] / count, center[2] / count] : center;

    return {
      success: true,
      message: `Trimmed to Alanine`,
      center,
    };
  }

  place_residue(bag: ModelBag, resname: string, position: number[],
                chain: string, resno: number | string): EditResult {
    const template = this.templates[resname];
    if (!template) {
      return { success: false, message: `Unknown residue: ${resname}` };
    }

    const [cx, cy, cz] = position;
    const target_resno = String(resno);

    for (const ta of template.atoms) {
      bag.model!.atoms.push({
        i_seq: bag.model!.atoms.length,
        name: ta.name,
        element: ta.element,
        xyz: [cx + ta.xyz[0], cy + ta.xyz[1], cz + ta.xyz[2]],
        chain,
        seqid: target_resno,
        resname,
        b: 40.0,
        occ: 1.0,
        is_ligand: false,
      } as Atom);
    }

    this.rebuild_bonds(bag.model!);

    return {
      success: true,
      message: `Placed ${resname} at ${chain}/${resno}`,
      center: position,
    };
  }

  private rebuild_bonds(model: any) {
    if (model.recalculate_bonds) {
      model.recalculate_bonds();
    }
    if (model.calculate_cubicles) {
      model.calculate_cubicles();
    }
  }
}
