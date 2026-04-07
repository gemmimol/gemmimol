import type { ModelBag } from './bags';
import type { SiteNavItem, ConnectionNavItem } from './types';

export class NavigationManager {
  model_bags: ModelBag[];
  sites: SiteNavItem[];
  connections: ConnectionNavItem[];
  current_site: number;

  constructor() {
    this.model_bags = [];
    this.sites = [];
    this.connections = [];
    this.current_site = -1;
  }

  set_models(bags: ModelBag[]) {
    this.model_bags = bags;
    this.sites = [];
    this.connections = [];
    this.current_site = -1;

    for (let idx = 0; idx < bags.length; idx++) {
      const bag = bags[idx];
      this.extract_sites_from_model(bag, idx);
    }
  }

  private extract_sites_from_model(bag: ModelBag, model_idx: number) {
    const model = bag.model;

    // Extract ligand binding sites
    for (const ligand of (model as any).ligands || []) {
      const atoms = ligand.atoms || [];
      if (atoms.length === 0) continue;

      const atom_indices = atoms.map((a: any) => a.i_seq);
      this.sites.push({
        label: `Ligand ${ligand.name || 'UNK'} (${ligand.chain || '?'})`,
        index: model_idx,
        atom_indices,
      });
    }

    // Extract metal sites
    for (const atom of model.atoms) {
      if (atom.is_metal) {
        this.sites.push({
          label: `Metal ${atom.element} ${atom.resname || ''}`,
          index: model_idx,
          atom_indices: [atom.i_seq],
        });
      }
    }
  }

  next_site(): SiteNavItem | null {
    if (this.sites.length === 0) return null;
    this.current_site = (this.current_site + 1) % this.sites.length;
    return this.sites[this.current_site];
  }

  prev_site(): SiteNavItem | null {
    if (this.sites.length === 0) return null;
    this.current_site = this.current_site <= 0 ? this.sites.length - 1 : this.current_site - 1;
    return this.sites[this.current_site];
  }

  get_center_for_site(site: SiteNavItem): number[] | null {
    const bag = this.model_bags[site.index];
    if (!bag) return null;

    let cx = 0, cy = 0, cz = 0, count = 0;
    for (const idx of site.atom_indices) {
      const atom = bag.model.atoms[idx];
      if (atom) {
        cx += atom.xyz[0];
        cy += atom.xyz[1];
        cz += atom.xyz[2];
        count++;
      }
    }

    if (count === 0) return null;
    return [cx / count, cy / count, cz / count];
  }

  // Parse GEMMI CID (Chain/Residue/Atom selection)
  parse_cid(cid: string): { chain?: string; resno?: number; atom?: string } | null {
    const parts = cid.split('/').filter(p => p.length > 0);
    if (parts.length === 0) return null;

    const result: { chain?: string; resno?: number; atom?: string } = {};
    if (parts[0] && parts[0] !== '*') result.chain = parts[0];
    if (parts[1] && parts[1] !== '*') result.resno = parseInt(parts[1], 10);
    if (parts[2] && parts[2] !== '*') result.atom = parts[2];

    return result;
  }

  find_atom_by_cid(cid: string): { bag: ModelBag; atom: any } | null {
    const parsed = this.parse_cid(cid);
    if (!parsed) return null;

    for (const bag of this.model_bags) {
      for (const atom of bag.model.atoms) {
        if (parsed.chain && atom.chain !== parsed.chain) continue;
        if (parsed.resno !== undefined && (atom as any).seqid !== parsed.resno) continue;
        if (parsed.atom && atom.name !== parsed.atom) continue;
        return { bag, atom };
      }
    }
    return null;
  }
}
