import type { ModelBag } from './bags';
import type { SiteNavItem, ConnectionNavItem } from './types';
import type { Atom } from '../model';

export class NavigationManager {
  model_bags: ModelBag[] = [];
  sites: SiteNavItem[] = [];
  connections: ConnectionNavItem[] = [];
  current_site = -1;

  set_models(bags: ModelBag[]) {
    this.model_bags = bags;
    this.rebuild_navigation();
  }

  rebuild_navigation() {
    this.sites = [];
    this.connections = [];
    this.current_site = -1;

    for (let idx = 0; idx < this.model_bags.length; idx++) {
      const bag = this.model_bags[idx];
      this.extract_sites(bag, idx);
      this.extract_connections(bag, idx);
    }
  }

  private extract_sites(bag: ModelBag, model_idx: number) {
    if (!bag.model) return;
    const model = bag.model;

    // Extract ligands
    const ligand_residues = new Map<string, Atom[]>();
    for (const atom of model.atoms) {
      if (atom.is_ligand && !atom.is_water()) {
        const key = `${atom.chain}/${atom.seqid}`;
        if (!ligand_residues.has(key)) ligand_residues.set(key, []);
        ligand_residues.get(key)!.push(atom);
      }
    }

    for (const atoms of ligand_residues.values()) {
      if (atoms.length === 0) continue;
      const first = atoms[0];
      this.sites.push({
        label: `Ligand ${first.resname} ${first.seqid}/${first.chain}`,
        index: model_idx,
        atom_indices: atoms.map(a => a.i_seq),
      });
    }

    // Extract metals
    for (const atom of model.atoms) {
      if (atom.is_metal) {
        this.sites.push({
          label: `Metal ${atom.element} ${atom.resname || ''} ${atom.seqid}/${atom.chain}`,
          index: model_idx,
          atom_indices: [atom.i_seq],
        });
      }
    }

    // Extract from gemmi structure sites if available
    const gemmi_sites = this.extract_gemmi_sites(bag, model_idx);
    this.sites.push(...gemmi_sites);
  }

  private extract_gemmi_sites(bag: ModelBag, model_idx: number): SiteNavItem[] {
    const sites: SiteNavItem[] = [];
    const ctx = bag.gemmi_selection;
    if (!ctx?.structure?.sites) return sites;

    try {
      const gemmi_sites = ctx.structure.sites;
      for (let i = 0; i < gemmi_sites.size(); i++) {
        const site = gemmi_sites.get(i);
        if (!site) continue;
        
        try {
          const atom_indices: number[] = [];
          const members = site.members;
          
          for (let j = 0; j < members.size(); j++) {
            const member = members.get(j);
            if (!member) continue;
            
            try {
              const auth = member.auth;
              const res_id = auth.res_id;
              const chain = auth.chain_name || member.label_asym_id || '';
              const seqid = res_id.seqid_string || member.label_seq_string || '';
              
              const atoms = bag.model?.get_residues()[`${seqid}/${chain}`];
              if (atoms) {
                for (const atom of atoms) {
                  if (!atom_indices.includes(atom.i_seq)) atom_indices.push(atom.i_seq);
                }
              }
              
              res_id.delete?.();
              auth.delete?.();
            } finally {
              member.delete?.();
            }
          }
          
          members.delete?.();
          
          if (atom_indices.length > 0) {
            let label = site.name || `Site ${i + 1}`;
            if (site.details) label += ` - ${site.details}`;
            sites.push({ label, index: model_idx, atom_indices });
          }
        } finally {
          site.delete?.();
        }
      }
      gemmi_sites.delete?.();
    } catch (e) {
      console.warn('Failed to extract gemmi sites:', e);
    }
    
    return sites;
  }

  private extract_connections(bag: ModelBag, model_idx: number) {
    const ctx = bag.gemmi_selection;
    if (!ctx?.structure?.connections) return;

    try {
      const connections = ctx.structure.connections;
      for (let i = 0; i < connections.size(); i++) {
        const conn = connections.get(i);
        if (!conn) continue;
        
        try {
          // Skip hydrogen bonds and unknown
          if (conn.type === ctx.gemmi?.ConnectionType?.Hydrog ||
              conn.type === ctx.gemmi?.ConnectionType?.Unknown) continue;
          
          const kind = conn.type === ctx.gemmi?.ConnectionType?.Disulf ? 'SSBOND' : 'LINK';
          
          const p1 = conn.partner1;
          const p2 = conn.partner2;
          if (!p1 || !p2) continue;
          
          const chain1 = p1.chain_name || '';
          const chain2 = p2.chain_name || '';
          const seqid1 = p1.res_id?.seqid_string || '';
          const seqid2 = p2.res_id?.seqid_string || '';
          const resname1 = p1.res_id?.name || '';
          const resname2 = p2.res_id?.name || '';
          
          const atoms1 = bag.model?.get_residues()[`${seqid1}/${chain1}`] || [];
          const atoms2 = bag.model?.get_residues()[`${seqid2}/${chain2}`] || [];
          
          const atom_indices = [...atoms1, ...atoms2].map(a => a.i_seq);
          if (atom_indices.length === 0) continue;
          
          const suffix = conn.asu === ctx.gemmi?.Asu?.Different ? ' [sym]' : '';
          const label = `${kind} ${chain1}/${seqid1} ${resname1} - ${chain2}/${seqid2} ${resname2}${suffix}`;
          
          this.connections.push({
            label,
            index: model_idx,
            atom_indices,
            anchor_index: atom_indices[0],
          });
          
          p1.res_id?.delete?.();
          p2.res_id?.delete?.();
          p1.delete?.();
          p2.delete?.();
        } finally {
          conn.delete?.();
        }
      }
      connections.delete?.();
    } catch (e) {
      console.warn('Failed to extract connections:', e);
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
    if (!bag?.model) return null;

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

    return count > 0 ? [cx / count, cy / count, cz / count] : null;
  }

  parse_cid(cid: string): { chain?: string; resno?: number; atom?: string } | null {
    const parts = cid.split('/').filter(p => p.length > 0);
    if (parts.length === 0) return null;

    const result: { chain?: string; resno?: number; atom?: string } = {};
    if (parts[0] && parts[0] !== '*') result.chain = parts[0];
    if (parts[1] && parts[1] !== '*') result.resno = parseInt(parts[1], 10);
    if (parts[2] && parts[2] !== '*') result.atom = parts[2];

    return result;
  }

  find_atom_by_cid(cid: string): { bag: ModelBag; atom: Atom } | null {
    const parsed = this.parse_cid(cid);
    if (!parsed) return null;

    for (const bag of this.model_bags) {
      if (!bag.model) continue;
      for (const atom of bag.model.atoms) {
        if (parsed.chain && atom.chain !== parsed.chain) continue;
        if (parsed.resno !== undefined && atom.seqid !== String(parsed.resno)) continue;
        if (parsed.atom && atom.name !== parsed.atom) continue;
        return { bag, atom };
      }
    }
    return null;
  }

  get_site_menu_items(): { label: string; value: string }[] {
    return this.sites.map((site, idx) => ({
      label: site.label,
      value: String(idx),
    }));
  }

  get_connection_menu_items(): { label: string; value: string }[] {
    return this.connections.map((conn, idx) => ({
      label: conn.label,
      value: String(idx),
    }));
  }
}
