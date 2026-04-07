// GemmiMol Viewer - Main entry point
// Refactored modular architecture

import type { Model } from '../model';
import type { ElMap } from '../elmap';
import { createModelBag, createMapBag } from './bags';
import type { ModelBag, MapBag } from './bags';
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
};

// Re-export bag types
export type { ModelBag, MapBag } from './bags';

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

  // Backward compatibility properties
  key_bindings: Array<((evt: KeyboardEvent) => void) | false | undefined>;
  default_camera_pos: [number, number, number];
  decor: any;

  // Gemmi module reference
  private gemmi_module: any;
  private gemmi_factory: (() => Promise<any>) | null;

  // Static help properties
  declare KEYBOARD_HELP: string;
  declare MOUSE_HELP: string;

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

    // Backward compatibility initialization
    this.key_bindings = [];
    this.default_camera_pos = [0, 0, 100];
    this.decor = { cell_box: null, selection: null, zoom_grid: null, mark: null };
    this.gemmi_module = null;
    this.gemmi_factory = null;
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
    const bag = createModelBag(model, this.config, this.win_size);
    if (label) bag.label = label;
    this.model_bags.push(bag);
    this.visibility.set_bags(this.model_bags, this.map_bags);
    this.navigation.set_models(this.model_bags);
    return bag;
  }

  // Add map (backward compatible)
  add_map(map: ElMap, is_diff_map: boolean = false): MapBag {
    const bag = createMapBag(map, this.config, is_diff_map);
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

  // HUD update (backward compatible alias)
  hud(text: string, type?: string): void {
    if (type === 'ERR') {
      console.error('ERR:', text);
    }
    this.ui?.update_hud(text);
  }

  update_hud(text: string) {
    this.ui?.update_hud(text);
  }

  // Request render (backward compatible)
  request_render(): void {
    // In the new architecture, rendering is handled automatically
    // This is a no-op for backward compatibility
  }

  // Load file via XHR (backward compatible)
  load_file(url: string, options: { binary?: boolean; progress?: boolean },
            callback: (req: XMLHttpRequest) => void): void {
    const req = new XMLHttpRequest();
    req.open('GET', url, true);
    if (options.binary) {
      req.responseType = 'arraybuffer';
    }
    if (this.xhr_headers) {
      for (const [key, val] of Object.entries(this.xhr_headers)) {
        req.setRequestHeader(key, val);
      }
    }
    req.onload = () => {
      if (req.status === 200) {
        callback(req);
      } else {
        this.hud(`Failed to load ${url}: ${req.status}`, 'ERR');
      }
    };
    req.onerror = () => {
      this.hud(`Failed to load ${url}`, 'ERR');
    };
    req.send();
  }

  // XHR headers storage
  xhr_headers: Record<string, string> = {};

  // Set dropzone for drag-and-drop (backward compatible)
  set_dropzone(element: HTMLElement, callback: (file: File) => Promise<void> | void): void {
    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    element.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        callback(files[0]);
      }
    });
  }

  // Recenter view (backward compatible)
  recenter(): void {
    // Implementation would depend on having a model loaded
    // This is a stub for backward compatibility
  }

  // Pick PDB and map from file (backward compatible)
  pick_pdb_and_map(): Promise<void> {
    return Promise.reject(new Error('pick_pdb_and_map not implemented in new viewer'));
  }

  // Set view from options (backward compatible)
  set_view(options: Record<string, any>): void {
    if (options.xyz) {
      this.go_to(options.xyz);
    }
    // Handle other view options as needed
  }

  // Resolve gemmi module (backward compatible)
  resolve_gemmi(): Promise<any> {
    if (this.gemmi_module) {
      return Promise.resolve(this.gemmi_module);
    }
    if (this.gemmi_factory) {
      return this.gemmi_factory();
    }
    // Try to get from globalThis
    const factory = (globalThis as any).Gemmi;
    if (typeof factory === 'function') {
      return factory();
    }
    return Promise.reject(new Error('Gemmi factory not available'));
  }

  // Remove and dispose Three.js object (backward compatible)
  remove_and_dispose(obj: any): void {
    if (!obj) return;
    if (this.scene) {
      this.scene.remove(obj);
    }
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.uniforms?.map?.value) {
        obj.material.uniforms.map.value.dispose();
      }
      obj.material.dispose();
    }
    if (obj.children) {
      for (const child of obj.children) {
        this.remove_and_dispose(child);
      }
    }
  }

  // Clear electron density objects from map (backward compatible)
  clear_el_objects(): void {
    // no-op
  }

  // Apply selected option (backward compatible)
  apply_selected_option(key?: string): void {
    if (key) {
      // Subclass implementation
    }
  }

  // Change zoom by factor (backward compatible)
  change_zoom_by_factor(mult: number): void {
    if (this.camera) {
      this.camera.zoom *= mult;
      if (this.camera.updateProjectionMatrix) {
        this.camera.updateProjectionMatrix();
      }
    }
  }

  // Toggle cell box (backward compatible)
  toggle_cell_box(): void {
    // Stub for backward compatibility
  }

  // Toggle help (backward compatible)
  toggle_help(): void {
    this.ui?.toggle_help();
  }

  // Update camera (backward compatible)
  update_camera(): void {
    if (this.camera?.updateProjectionMatrix) {
      this.camera.updateProjectionMatrix();
    }
  }

  // Get window size (backward compatible alias)
  get window_size(): [number, number] {
    return this.win_size;
  }

  // Change isolevel (backward compatible)
  change_isolevel_by(map_idx: number, delta: number): void {
    const bag = this.map_bags[map_idx];
    if (bag) {
      bag.isolevel += delta;
      this.redraw_maps();
    }
  }

  // Change map radius (backward compatible)
  change_map_radius(delta: number): void {
    this.config.map_radius = Math.max(0, Math.min(
      this.config.map_radius + delta,
      this.config.max_map_radius
    ));
    this.redraw_maps();
  }

  // Change slab width (backward compatible)
  change_slab_width_by(delta: number): void {
    if (this.controls?.slab_width) {
      this.controls.slab_width[0] = Math.max(0.01, this.controls.slab_width[0] + delta);
      this.controls.slab_width[1] = Math.max(0.01, this.controls.slab_width[1] + delta);
    }
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
