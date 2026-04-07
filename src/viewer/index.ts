// GemmiMol Viewer - Main entry point
// Refactored modular architecture

// Viewer entry point
import type { Model } from '../model';
import type { ElMap } from '../elmap';
import { ModelBag, MapBag } from './bags';
import { ModelRenderer, MapRenderer } from './rendering';
import { EventManager } from './events';
import { UIManager } from './ui';
import {
  type ViewerConfig,
  type ColorScheme,
  type SiteNavItem,
  type ConnectionNavItem,
  type ResidueTemplates,
  ColorSchemes,
  COLOR_PROPS,
  MAINCHAIN_STYLES,
  SIDECHAIN_STYLES,
  LIGAND_STYLES,
  WATER_STYLES,
  MAP_STYLES,
  LABEL_FONTS,
  normalize_viewer_options,
  DEFAULT_CONFIG,
} from './types';
// utils imported when needed

// Re-export types for consumers
export type {
  ViewerConfig,
  ColorScheme,
  SiteNavItem,
  ModelBag,
  MapBag,
};

// Re-export constants
export {
  ColorSchemes,
  COLOR_PROPS,
  MAINCHAIN_STYLES,
  SIDECHAIN_STYLES,
  LIGAND_STYLES,
  WATER_STYLES,
  MAP_STYLES,
  LABEL_FONTS,
};



/**
 * Main Viewer class - facade that coordinates all subsystems
 * Maintains backward-compatible API while delegating to specialized managers
 */
export class Viewer {
  // Configuration
  config: ViewerConfig;

  // State
  model_bags: ModelBag[];
  map_bags: MapBag[];
  selected: { bag: ModelBag; atom: any } | null;
  win_size: [number, number];

  // Subsystems
  model_renderer: ModelRenderer;
  map_renderer: MapRenderer;
  events: EventManager;
  ui: UIManager | null;

  // Editing
  templates: ResidueTemplates;

  // Navigation state
  sites: SiteNavItem[];
  connections: ConnectionNavItem[];
  current_site: number;

  // Three.js references (set by caller)
  scene: any;
  camera: any;
  renderer: any;
  controls: any;

  constructor(options?: Record<string, any> | string) {
    const opts = normalize_viewer_options(options);

    this.config = { ...DEFAULT_CONFIG };
    this.apply_options(opts);

    this.model_bags = [];
    this.map_bags = [];
    this.selected = null;
    this.win_size = [800, 600];

    // Initialize subsystems
    this.model_renderer = new ModelRenderer(this.config);
    this.map_renderer = new MapRenderer(this.config);
    this.editor = new ModelEditor();

    // Navigation state
    this.sites = [];
    this.connections = [];
    this.current_site = -1;
    this.events = new EventManager();
    this.ui = null;

    // Setup event callbacks
    this.events.callbacks = {
      on_redraw: () => this.redraw_all(),
      on_center: (pos) => this.go_to(pos),
      on_update_hud: (text) => this.update_hud(text),
    };

    // Three.js references (will be set by init)
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
  }

  // Initialize with Three.js objects
  init(scene: any, camera: any, renderer: any, controls: any, container: HTMLElement) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.ui = new UIManager(container);
    this.ui.create_hud();

    // Setup default event handlers
    this.events.setup_default_handlers(this);

    // Update window size
    this.win_size = [container.clientWidth, container.clientHeight];
  }

  private apply_options(opts: Record<string, any>) {
    for (const [key, val] of Object.entries(opts)) {
      if (key in this.config) {
        (this.config as any)[key] = val;
      }
    }
    // Apply color scheme
    if (this.config.color_scheme in ColorSchemes) {
      this.config.colors = ColorSchemes[this.config.color_scheme];
    }
  }

  // Load structure (backward compatible)
  load_structure(model: Model, label?: string): ModelBag {
    const bag = new ModelBag(model, this.config, this.win_size);
    if (label) bag.label = label;
    this.model_bags.push(bag);
    this.update_sites();
    return bag;
  }

  // Add map (backward compatible)
  add_map(map: ElMap, is_diff_map: boolean = false): MapBag {
    const bag = new MapBag(map, this.config, is_diff_map);
    this.map_bags.push(bag);
    return bag;
  }

  // Redraw all models and maps
  redraw_all() {
    if (!this.scene) return;

    // Clear existing model groups
    // (Actual implementation would remove old groups from scene)

    for (const bag of this.model_bags) {
      const group = this.model_renderer.redraw_model(bag);
      this.scene.add(group);
    }

    this.map_renderer.check_and_reload(this.map_bags, this.camera.position, this.scene);
  }

  redraw_model(bag: ModelBag) {
    if (!this.scene) return;
    const group = this.model_renderer.redraw_model(bag);
    this.scene.add(group);
  }

  redraw_maps() {
    if (!this.scene) return;
    this.map_renderer.check_and_reload(this.map_bags, this.camera.position, this.scene);
  }

  // Navigation
  go_to(position: number[]) {
    if (!this.controls) return;
    this.controls.target.set(position[0], position[1], position[2]);
    this.controls.update();
  }

  center_on_atom(bag: ModelBag, atom: any) {
    this.go_to(atom.xyz);
    this.selected = { bag, atom };
    this.update_hud(`${atom.name} ${atom.resname || ''} ${atom.chain}${atom.seqid}`);
  }

  // Style cycling (backward compatible)
  select_next(list: string[], current: string): string {
    const idx = list.indexOf(current);
    return list[(idx + 1) % list.length];
  }

  cycle_mainchain_style() {
    this.config.mainchain_style = this.select_next(
      MAINCHAIN_STYLES,
      this.config.mainchain_style
    );
    this.redraw_all();
  }

  cycle_sidechain_style() {
    this.config.sidechain_style = this.select_next(
      SIDECHAIN_STYLES,
      this.config.sidechain_style
    );
    this.redraw_all();
  }

  cycle_color_prop() {
    this.config.color_prop = this.select_next(
      COLOR_PROPS,
      this.config.color_prop
    );
    this.redraw_all();
  }

  cycle_color_scheme() {
    const schemes = Object.keys(ColorSchemes);
    const idx = schemes.indexOf(this.config.color_scheme);
    this.config.color_scheme = schemes[(idx + 1) % schemes.length];
    this.config.colors = ColorSchemes[this.config.color_scheme];
    this.redraw_all();
  }

  // Editing operations (merged from ModelEditor)
  set_templates(templates: ResidueTemplates) {
    this.templates = templates;
  }

  delete_selected(): boolean {
    if (!this.selected) {
      this.update_hud('Nothing selected');
      return false;
    }
    const { bag, atom } = this.selected;
    const success = this.delete_residue(bag, atom.chain, atom.seqid);
    if (success) {
      this.redraw_model(bag);
      this.selected = null;
      this.update_hud('Deleted');
    }
    return success;
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

  mutate_residue_atom(atom: { chain: string; seqid: number }, new_resname: string): boolean {
    if (!this.selected) return false;
    const bag = this.selected.bag;
    const success = this.mutate_residue(bag, atom.chain, atom.seqid, new_resname);
    if (success) {
      this.redraw_model(bag);
      this.update_hud(`Mutated to ${new_resname}`);
    }
    return success;
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

  trim_chain(bag: ModelBag, chain: string, n_keep: number, c_keep: number): boolean {
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

  // HUD update
  update_hud(text: string) {
    if (this.ui) {
      this.ui.update_hud(text);
    }
  }

  // Event handling (called by main app)
  keydown(event: KeyboardEvent): boolean {
    // Handle '?' for help
    if (event.key === '?') {
      this.ui?.toggle_help();
      return true;
    }
    return this.events.handle_keydown(event);
  }

  mousedown(event: MouseEvent, pick_fn: (x: number, y: number) => any): any {
    return this.events.handle_mousedown(event, pick_fn);
  }

  wheel(event: WheelEvent, zoom_fn: (delta: number) => void): boolean {
    return this.events.handle_wheel(event, zoom_fn);
  }

  contextmenu(event: Event): boolean {
    return this.events.handle_contextmenu(event);
  }

  // Resize handling
  resize(width: number, height: number) {
    this.win_size = [width, height];
    for (const bag of this.model_bags) {
      bag.win_size = [width, height];
    }
  }

  // Model/Map visibility control (merged from ModelController)
  show_all_models(visible: boolean = true) {
    for (const bag of this.model_bags) bag.visible = visible;
    this.redraw_all();
  }

  show_all_maps(visible: boolean = true) {
    for (const bag of this.map_bags) bag.visible = visible;
    this.redraw_maps();
  }

  toggle_model(index: number): boolean {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.visible = !bag.visible;
    this.redraw_all();
    return bag.visible;
  }

  toggle_map(index: number): boolean {
    const bag = this.map_bags[index];
    if (!bag) return false;
    bag.visible = !bag.visible;
    this.redraw_maps();
    return bag.visible;
  }

  remove_model(index: number): boolean {
    if (index < 0 || index >= this.model_bags.length) return false;
    this.model_bags.splice(index, 1);
    this.update_sites();
    this.redraw_all();
    return true;
  }

  remove_map(index: number): boolean {
    if (index < 0 || index >= this.map_bags.length) return false;
    this.map_bags.splice(index, 1);
    this.redraw_maps();
    return true;
  }

  get_visible_models(): ModelBag[] {
    return this.model_bags.filter(b => b.visible);
  }

  get_visible_maps(): MapBag[] {
    return this.map_bags.filter(b => b.visible);
  }

  set_hue_shift(index: number, shift: number): boolean {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.hue_shift = shift;
    this.redraw_all();
    return true;
  }

  set_color_override(index: number, fn: ((atom: any) => any) | null): boolean {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.color_override = fn;
    this.redraw_all();
    return true;
  }

  has_symmetry(): boolean {
    return this.model_bags.some(b => b.model && (b.model as any).cell);
  }

  serialize(): object {
    return {
      models: this.model_bags.map(b => ({
        label: b.label,
        visible: b.visible,
        hue_shift: b.hue_shift,
      })),
      maps: this.map_bags.map(b => ({
        name: b.name,
        visible: b.visible,
        isolevel: b.isolevel,
      })),
    };
  }

  // Navigation methods (merged from Navigator)
  private update_sites() {
    this.sites = [];
    this.connections = [];
    this.current_site = -1;

    for (let idx = 0; idx < this.model_bags.length; idx++) {
      const bag = this.model_bags[idx];
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

  // Cleanup
  dispose() {
    this.model_bags = [];
    this.map_bags = [];
    this.selected = null;
    this.ui = null;
  }
}

// Default export
export default Viewer;
