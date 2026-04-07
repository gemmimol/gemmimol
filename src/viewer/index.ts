// GemmiMol Viewer - Main entry point
// Refactored modular architecture

import type { Model } from '../model';
import type { ElMap } from '../elmap';
import { ModelBag, MapBag } from './bags';
import { ModelRenderer, MapRenderer } from './rendering';
import { EventManager } from './events';
import { UIManager } from './ui';
import { ModelEditor } from './editing';
import { NavigationManager } from './navigation';
import { VisibilityManager } from './visibility';
import {
  type ViewerConfig,
  type ColorScheme,
  type SiteNavItem,
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
  editor: ModelEditor;
  navigation: NavigationManager;
  visibility: VisibilityManager;
  events: EventManager;
  ui: UIManager | null;

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
    this.navigation = new NavigationManager();
    this.visibility = new VisibilityManager();
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
    this.visibility.set_bags(this.model_bags, this.map_bags);
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
    this.visibility.set_bags(this.model_bags, this.map_bags);
    this.navigation.set_models(this.model_bags);
    return bag;
  }

  // Add map (backward compatible)
  add_map(map: ElMap, is_diff_map: boolean = false): MapBag {
    const bag = new MapBag(map, this.config, is_diff_map);
    this.map_bags.push(bag);
    this.visibility.set_bags(this.model_bags, this.map_bags);
    return bag;
  }

  // Redraw all models and maps
  redraw_all() {
    if (!this.scene) return;

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

  // Editing operations - delegate to ModelEditor
  set_templates(templates: ResidueTemplates) {
    this.editor.set_templates(templates);
  }

  delete_selected(): boolean {
    if (!this.selected) {
      this.update_hud('Nothing selected');
      return false;
    }
    const { bag, atom } = this.selected;
    const success = this.editor.delete_residue(bag, atom.chain, atom.seqid);
    if (success) {
      this.redraw_model(bag);
      this.selected = null;
      this.update_hud('Deleted');
    }
    return success;
  }

  delete_residue(bag: ModelBag, chain: string, resno: number): boolean {
    const success = this.editor.delete_residue(bag, chain, resno);
    if (success) this.redraw_model(bag);
    return success;
  }

  mutate_residue_atom(atom: { chain: string; seqid: number }, new_resname: string): boolean {
    if (!this.selected) return false;
    const bag = this.selected.bag;
    const success = this.editor.mutate_residue(bag, atom.chain, atom.seqid, new_resname);
    if (success) {
      this.redraw_model(bag);
      this.update_hud(`Mutated to ${new_resname}`);
    }
    return success;
  }

  mutate_residue(bag: ModelBag, chain: string, resno: number, new_resname: string): boolean {
    const success = this.editor.mutate_residue(bag, chain, resno, new_resname);
    if (success) this.redraw_model(bag);
    return success;
  }

  trim_chain(bag: ModelBag, chain: string, n_keep: number, c_keep: number): boolean {
    const success = this.editor.trim_residues(bag, chain, n_keep, c_keep);
    if (success) this.redraw_model(bag);
    return success;
  }

  place_residue(bag: ModelBag, resname: string, position: number[],
                chain: string, resno: number): boolean {
    const success = this.editor.place_residue(bag, resname, position, chain, resno);
    if (success) this.redraw_model(bag);
    return success;
  }

  // HUD update
  update_hud(text: string) {
    this.ui?.update_hud(text);
  }

  // Event handling (called by main app)
  keydown(event: KeyboardEvent): boolean {
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

  // Visibility control - delegate to VisibilityManager
  show_all_models(visible: boolean = true) {
    this.visibility.show_all_models(visible);
    this.redraw_all();
  }

  show_all_maps(visible: boolean = true) {
    this.visibility.show_all_maps(visible);
    this.redraw_maps();
  }

  toggle_model(index: number): boolean {
    const result = this.visibility.toggle_model(index);
    this.redraw_all();
    return result;
  }

  toggle_map(index: number): boolean {
    const result = this.visibility.toggle_map(index);
    this.redraw_maps();
    return result;
  }

  remove_model(index: number): boolean {
    const result = this.visibility.remove_model(index);
    if (result) {
      this.navigation.set_models(this.model_bags);
      this.redraw_all();
    }
    return result;
  }

  remove_map(index: number): boolean {
    const result = this.visibility.remove_map(index);
    if (result) this.redraw_maps();
    return result;
  }

  get_visible_models(): ModelBag[] {
    return this.visibility.get_visible_models();
  }

  get_visible_maps(): MapBag[] {
    return this.visibility.get_visible_maps();
  }

  set_hue_shift(index: number, shift: number): boolean {
    const result = this.visibility.set_hue_shift(index, shift);
    if (result) this.redraw_all();
    return result;
  }

  set_color_override(index: number, fn: ((atom: any) => any) | null): boolean {
    const result = this.visibility.set_color_override(index, fn);
    if (result) this.redraw_all();
    return result;
  }

  has_symmetry(): boolean {
    return this.visibility.has_symmetry();
  }

  serialize(): object {
    return this.visibility.serialize();
  }

  // Navigation - delegate to NavigationManager
  next_site(): SiteNavItem | null {
    const site = this.navigation.next_site();
    if (site) {
      const center = this.navigation.get_center_for_site(site);
      if (center) this.go_to(center);
    }
    return site;
  }

  prev_site(): SiteNavItem | null {
    const site = this.navigation.prev_site();
    if (site) {
      const center = this.navigation.get_center_for_site(site);
      if (center) this.go_to(center);
    }
    return site;
  }

  get_center_for_site(site: SiteNavItem): number[] | null {
    return this.navigation.get_center_for_site(site);
  }

  parse_cid(cid: string): { chain?: string; resno?: number; atom?: string } | null {
    return this.navigation.parse_cid(cid);
  }

  find_atom_by_cid(cid: string): { bag: ModelBag; atom: any } | null {
    return this.navigation.find_atom_by_cid(cid);
  }

  // Cleanup
  dispose() {
    this.model_bags = [];
    this.map_bags = [];
    this.selected = null;
    this.ui = null;
    this.visibility.set_bags([], []);
    this.navigation.set_models([]);
  }
}

// Default export
export default Viewer;
