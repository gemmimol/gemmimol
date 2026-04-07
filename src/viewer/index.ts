// GemmiMol Viewer - Main entry point
// Refactored modular architecture

// Viewer entry point
import type { Model } from '../model';
import type { ElMap } from '../elmap';
import { ModelBag, MapBag } from './bags';
import { ModelRenderer, MapRenderer } from './rendering';
import { Navigator } from './navigation';
import { ModelEditor } from './editing';
import { EventManager } from './events';
import { UIManager } from './ui';
import { ModelController } from './controller';
import {
  type ViewerConfig,
  type ColorScheme,
  type SiteNavItem,
  ColorSchemes,
  COLOR_PROPS,
  MAINCHAIN_STYLES,
  SIDECHAIN_STYLES,
  LIGAND_STYLES,
  WATER_STYLES,
  MAP_STYLES,
  LABEL_FONTS,
  normalize_viewer_options,
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

// Default configuration
export const DEFAULT_CONFIG: ViewerConfig = {
  bond_line: 4,
  map_line: 2,
  map_radius: 10,
  max_map_radius: 40,
  default_isolevel: 1.5,
  center_cube_size: 0.15,
  map_style: 'marching cubes',
  mainchain_style: 'cartoon',
  sidechain_style: 'invisible',
  ligand_style: 'ball&stick',
  water_style: 'invisible',
  color_prop: 'element',
  label_font: 'bold 14px',
  color_scheme: 'coot dark',
  hydrogens: false,
  ball_size: 0.5,
  stick_radius: 0.2,
  ao: false,
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
  navigator: Navigator;
  editor: ModelEditor;
  events: EventManager;
  ui: UIManager | null;
  controller: ModelController;

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
    this.navigator = new Navigator();
    this.editor = new ModelEditor();
    this.events = new EventManager();
    this.ui = null;
    this.controller = new ModelController();

    // Setup event callbacks
    this.events.on_redraw = () => this.redraw_all();
    this.events.on_center = (pos) => this.go_to(pos);
    this.events.on_update_hud = (text) => this.update_hud(text);

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
    this.events.setup_default_handlers(this.navigator);

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
    this.navigator.set_models(this.model_bags);
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

  // Editing operations
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

  mutate_residue(new_resname: string): boolean {
    if (!this.selected) {
      this.update_hud('Nothing selected');
      return false;
    }
    const { bag, atom } = this.selected;
    const success = this.editor.mutate_residue(bag, atom.chain, atom.seqid, new_resname);
    if (success) {
      this.redraw_model(bag);
      this.update_hud(`Mutated to ${new_resname}`);
    }
    return success;
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
