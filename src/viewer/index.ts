// GemmiMol Viewer - Main entry point
// Refactored modular architecture

import { BondType, modelsFromGemmi, modelFromGemmiStructure, type Model } from '../model';
import { ElMap } from '../elmap';
import type { GemmiModule } from '../gemmi';
import { mutation_targets_for_residue, plan_residue_mutation } from '../mutate';
import { residueTemplateBonds } from '../residue-templates';
import { createModelBag, createMapBag } from './bags';
import type { ModelBag, MapBag } from './bags';
import { ModelRenderer, MapRenderer } from './rendering';
import { EventManager } from './events';
import { UIManager, type ToolbarMenuId, type ToolbarOption } from './ui';
import { ModelEditor } from './editing';
import { NavigationManager } from './navigation';
import { VisibilityManager } from './visibility';
import { Controls, STATE, type OrCameraType } from '../controls';
import {
  Color,
  Fog,
  OrthographicCamera,
  Ray,
  Scene,
  Vector3,
  WebGLRenderer,
} from '../three-r162/main';
import { makeRgbBox, makeWheels, makeSticks, makeGrid, Label } from '../draw';
import { scale_by_height, color_by } from './utils';
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
  type HelpActionSpec,
  escape_html,
  help_action_link,
  normalize_viewer_options,
  DEFAULT_CONFIG,
} from './types';
import type { EditResult } from './editing';

declare const VERSION: string;
declare const GIT_DESCRIBE: string;
declare const GEMMI_GIT_DESCRIBE: string;

function parse_url_fragment(): Record<string, any> {
  const ret: Record<string, any> = {};
  if (typeof window === 'undefined') return ret;
  const params = window.location.hash.substr(1).split('&');
  for (let i = 0; i < params.length; i++) {
    const kv = params[i].split('=');
    const key = kv[0];
    const val = kv[1];
    if (key === 'xyz' || key === 'eye') {
      ret[key] = val.split(',').map(Number);
    } else if (key === 'zoom') {
      ret[key] = Number(val);
    } else {
      ret[key] = val;
    }
  }
  return ret;
}

const SYMMETRY_MATE_COLORS: Record<string, Color> = {
  C: new Color(0x1933CC),
  O: new Color(0x5D1F5D),
  S: new Color(0x626E62),
};

function symmetry_mate_color(atom: any, elem_colors: any): Color {
  return SYMMETRY_MATE_COLORS[atom.element] ||
         elem_colors[atom.element] ||
         elem_colors.def ||
         SYMMETRY_MATE_COLORS.C;
}

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
 * Main Viewer class - facade that coordinates all subsystems.
 */
export class Viewer {
  private static active_viewer: Viewer | null = null;

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
  container: HTMLElement | null;

  default_camera_pos: [number, number, number];
  decor: any;

  // Gemmi module reference
  private gemmi_module: any;
  private gemmi_factory: (() => Promise<any>) | null;
  private gemmi_loading: Promise<any> | null;
  private viewer_target: string | null;
  private render_scheduled: boolean;

  // Static help properties
  declare KEYBOARD_HELP: string;
  declare MOUSE_HELP: string;

  // Public properties for subclasses
  target: any;
  blob_hits: any[];
  blob_map_bag: any;
  blob_objects: any[];
  blob_focus_index: number;
  blob_negate: boolean;
  histogram_el: HTMLElement | null;
  histogram_redraw: (() => void) | null;
  labels: Record<string, { o: Label; bag: ModelBag }>;
  sym_model_bags: ModelBag[];
  sym_bond_objects: any[];

  constructor(options?: Record<string, any> | string) {
    const opts = normalize_viewer_options(options);
    this.viewer_target = typeof opts.viewer === 'string' ? opts.viewer : null;

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

    this.default_camera_pos = [0, 0, 100];
    this.decor = { cell_box: null, selection: null, zoom_grid: makeGrid(), mark: null };
    this.gemmi_module = null;
    this.gemmi_factory = null;
    this.gemmi_loading = null;
    this.render_scheduled = false;

    if (opts.gemmi) {
      this.gemmi_module = opts.gemmi;
    } else if (opts.gemmi_factory) {
      this.gemmi_factory = opts.gemmi_factory;
    } else {
      const factory = (globalThis as any).Gemmi;
      if (typeof factory === 'function') this.gemmi_factory = factory;
    }

    this.scene = new Scene();
    this.scene.fog = new Fog(this.config.colors.bg, 0, 1);
    this.target = new Vector3(0, 0, 0);
    this.camera = new OrthographicCamera() as OrCameraType;
    this.camera.position.fromArray(this.default_camera_pos);
    this.controls = new Controls(this.camera, this.target);
    this.renderer = null;
    this.container = null;

    // Initialize subclass properties
    this.blob_hits = [];
    this.blob_map_bag = null;
    this.blob_objects = [];
    this.blob_focus_index = -1;
    this.blob_negate = false;
    this.histogram_el = null;
    this.histogram_redraw = null;
    this.labels = {};
    this.sym_model_bags = [];
    this.sym_bond_objects = [];
  }

  // Initialize with Three.js objects
  init(scene: any, camera: any, renderer: any, controls: any, container: HTMLElement) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.container = container;
    this.ui = new UIManager(container);
    this.ui.create_hud();
    this.ui.set_help_toggle(() => this.toggle_help());
    this.ui.set_help_action((spec) => this.trigger_help_action(spec));
    this.ui.set_toolbar_action((menu, value) => this.handle_toolbar_action(menu, value));
    this.ui.set_mutate_action((value) => {
      this.mutate_selected_residue(value);
    });
    this.ui.hud_select_action = (info, key, options, value) => {
      this.set_selected_option(info, key, options, value);
    };
    this.ui.create_structure_name_badge();
    this.ui.create_cid_dialog();
    this.ui.cid_action = (cid) => this.apply_cid(cid);

    // Setup default event handlers
    this.events.setup_default_handlers(this);

    // Add zoom grid to scene (hidden by default)
    this.decor.zoom_grid.visible = false;
    this.scene.add(this.decor.zoom_grid);

    // Update window size
    this.win_size = [container.clientWidth, container.clientHeight];
    this.visibility.set_bags(this.model_bags, this.map_bags);
    this.update_toolbar_menus();
    this.resize();
    this.request_render();
  }

  init_default(container?: string | HTMLElement | null): boolean {
    if (typeof document === 'undefined') return false;
    if (this.renderer != null) return true;

    const element =
      typeof container === 'string' ? document.getElementById(container) :
      container ?? (this.viewer_target ? document.getElementById(this.viewer_target) : null);
    if (element == null || typeof (element as HTMLElement).appendChild !== 'function') return false;

    let renderer: any;
    try {
      renderer = new WebGLRenderer({antialias: true});
    } catch {
      this.hud('No WebGL in your browser?', 'ERR');
      return false;
    }

    renderer.setClearColor(this.config.colors.bg, 1);
    if (typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number') {
      renderer.setPixelRatio(window.devicePixelRatio);
    }
    element.appendChild(renderer.domElement);

    this.init(this.scene, this.camera, renderer, this.controls, element as HTMLElement);
    this.bind_default_dom_events(renderer.domElement);
    if (!Number.isFinite(this.camera.zoom) || this.camera.zoom <= 1) {
      this.camera.zoom = Math.max(this.camera.right, 1) / 35.0;
      this.update_camera();
    }
    renderer.domElement.focus();
    return true;
  }

  private bind_default_dom_events(canvas: HTMLElement) {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('keydown', (event) => {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (target?.isContentEditable ||
            tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          return;
        }
        if (Viewer.active_viewer !== this) return;
        this.keydown(event);
      });
    }
    canvas.tabIndex = 0;
    const activate_keyboard = () => {
      Viewer.active_viewer = this;
    };
    activate_keyboard();
    canvas.addEventListener('focus', activate_keyboard);
    canvas.addEventListener('mousedown', (event) => {
      activate_keyboard();
      this.handle_mouse_down(event);
    });
    canvas.addEventListener('wheel', (event) => {
      this.wheel(event);
    }, {passive: false});
    canvas.addEventListener('contextmenu', (event) => {
      this.contextmenu(event);
    });
    canvas.addEventListener('touchstart', (event) => {
      activate_keyboard();
      this.handle_touch_start(event);
    }, {passive: false});
    canvas.addEventListener('touchmove', (event) => {
      this.handle_touch_move(event);
    }, {passive: false});
    canvas.addEventListener('touchend', (event) => {
      this.handle_touch_end(event);
    });
    canvas.addEventListener('touchcancel', (event) => {
      this.handle_touch_end(event);
    });
    canvas.addEventListener('dblclick', (event) => {
      this.handle_dblclick(event);
    });
  }

  private render_frame = () => {
    this.render_scheduled = false;
    if (!this.renderer) return;

    if (this.controls?.update?.()) {
      this.update_camera();
    }
    if (!this.controls?.is_moving?.()) {
      this.map_renderer.check_and_reload(this.map_bags, this.target, this.scene);
    }
    this.renderer.render(this.scene, this.camera);
    if (this.controls?.is_moving?.()) {
      this.request_render();
    }
  }

  private relative_pointer_position(point: {clientX: number; clientY: number}): [number, number] {
    const canvas = this.renderer?.domElement;
    const rect = canvas?.getBoundingClientRect?.();
    if (!rect || rect.width === 0 || rect.height === 0) return [0, 0];
    return [
      2 * (point.clientX - rect.left) / rect.width - 1,
      1 - 2 * (point.clientY - rect.top) / rect.height,
    ];
  }

  private mouse_state(event: MouseEvent) {
    if (event.button === 1 || (event.button === 0 && event.ctrlKey)) return STATE.PAN;
    if (event.button === 2) return event.ctrlKey ? (event.shiftKey ? STATE.ROLL : STATE.SLAB) : STATE.ZOOM;
    return STATE.ROTATE;
  }

  private handle_mouse_down(event: MouseEvent) {
    if (!this.controls || typeof document === 'undefined') return;
    event.preventDefault();
    event.stopPropagation();
    const [x, y] = this.relative_pointer_position(event);
    const state = this.mouse_state(event);
    if (state === STATE.ZOOM) {
      this.decor.zoom_grid.visible = true;
    }
    this.controls.start(state, x, y);
    this.request_render();
    this.renderer?.domElement?.focus?.();

    const on_mouse_move = (move_event: MouseEvent) => {
      move_event.preventDefault();
      const [mx, my] = this.relative_pointer_position(move_event);
      this.controls.move(mx, my);
      this.request_render();
    };

    const on_mouse_up = (up_event: MouseEvent) => {
      up_event.preventDefault();
      document.removeEventListener('mousemove', on_mouse_move);
      document.removeEventListener('mouseup', on_mouse_up);
      this.decor.zoom_grid.visible = false;
      const not_panned = this.controls.stop();
      if (not_panned) {
        const pick = this.pick_atom(not_panned, this.camera);
        if (pick) this.center_on_atom(pick.bag, pick.atom);
      }
      this.redraw_maps();
      this.request_render();
    };

    document.addEventListener('mousemove', on_mouse_move);
    document.addEventListener('mouseup', on_mouse_up);
  }

  private touch_info(event: TouchEvent) {
    const touches = event.touches;
    if (touches.length < 2) return null;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return {
      clientX: (touches[0].clientX + touches[1].clientX) / 2,
      clientY: (touches[0].clientY + touches[1].clientY) / 2,
      dist: Math.sqrt(dx * dx + dy * dy),
    };
  }

  private handle_touch_start(event: TouchEvent) {
    if (!this.controls) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.touches.length === 1) {
      const [x, y] = this.relative_pointer_position(event.touches[0]);
      this.controls.start(STATE.ROTATE, x, y);
    } else {
      const info = this.touch_info(event);
      if (info == null) return;
      const [x, y] = this.relative_pointer_position(info);
      this.controls.start(STATE.PAN_ZOOM, x, y, info.dist);
    }
    this.request_render();
  }

  private handle_touch_move(event: TouchEvent) {
    if (!this.controls) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.touches.length === 1) {
      const [x, y] = this.relative_pointer_position(event.touches[0]);
      this.controls.move(x, y);
    } else {
      const info = this.touch_info(event);
      if (info == null) return;
      const [x, y] = this.relative_pointer_position(info);
      this.controls.move(x, y, info.dist);
    }
    this.request_render();
  }

  private handle_touch_end(event: TouchEvent) {
    void event;
    if (!this.controls) return;
    this.controls.stop();
    this.redraw_maps();
    this.request_render();
  }

  private handle_dblclick(event: MouseEvent) {
    if (event.button !== 0) return;
    if (this.decor.selection) {
      this.remove_and_dispose(this.decor.selection);
      this.decor.selection = null;
    }
    const mouse = this.relative_pointer_position(event);
    const pick = this.pick_atom(mouse, this.camera);
    if (pick) {
      const atom = pick.atom;
      this.hud(pick.bag.label + ' ' + atom.long_label(pick.bag.symop));
      this.toggle_label(pick);
      const color = this.config.colors[atom.element] || this.config.colors.def;
      const size = 2.5 * scale_by_height(this.config.bond_line, this.win_size);
      this.decor.selection = makeWheels([atom], [color], size);
      this.scene.add(this.decor.selection);
    } else {
      this.hud('');
    }
    this.request_render();
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

  load_structure(model: Model, label?: string): ModelBag {
    const bag = createModelBag(model, this.config, this.win_size);
    if (label) bag.label = label;
    this.model_bags.push(bag);
    this.visibility.set_bags(this.model_bags, this.map_bags);
    this.navigation.set_models(this.model_bags);
    if (this.selected == null) {
      this.selected = {bag: bag, atom: model.atoms[0] || null};
    }
    this.update_toolbar_menus();
    if (this.renderer) this.redraw_model(bag);
    return bag;
  }

  add_map(map: ElMap, is_diff_map: boolean = false): MapBag {
    const bag = createMapBag(map, this.config, is_diff_map);
    this.map_bags.push(bag);
    this.visibility.set_bags(this.model_bags, this.map_bags);
    this.update_toolbar_menus();
    if (this.renderer) this.redraw_maps(true);
    return bag;
  }

  // Redraw all models and maps
  redraw_all() {
    if (!this.renderer) return;

    for (const bag of this.model_bags) {
      this.redraw_model(bag);
    }

    this.redraw_maps(true);
    this.request_render();
  }

  redraw_model(bag: ModelBag) {
    if (!this.renderer) return;
    this.clear_model_objects(bag);
    this.model_renderer.redraw_model(bag);
    for (const obj of bag.objects) {
      this.scene.add(obj);
    }
    this.request_render();
  }

  redraw_maps(force = false) {
    if (!this.renderer) return;
    if (force) this.map_renderer.redraw_all(this.map_bags);
    this.map_renderer.check_and_reload(this.map_bags, this.target, this.scene);
    this.request_render();
  }

  private clear_model_objects(bag: ModelBag) {
    for (const obj of bag.objects) {
      this.remove_and_dispose(obj);
    }
    bag.objects = [];
    bag.atom_array = [];
  }

  // Navigation
  go_to(position: number[], steps: number = 30) {
    if (!this.controls) return;
    this.controls.go_to(new Vector3(position[0], position[1], position[2]), undefined, undefined, steps);
    this.request_render();
  }

  center_on_atom(bag: ModelBag, atom: any) {
    this.go_to(atom.xyz);
    this.toggle_label(this.selected, false);
    this.selected = { bag, atom };
    this.toggle_label(this.selected, true);
    this.update_hud(`${atom.name} ${atom.resname || ''} ${atom.chain}${atom.seqid}`);
    this.update_toolbar_menus();
  }

  private atom_style_key(atom: any): string {
    if (atom.is_water?.()) return 'water_style';
    if (atom.is_ligand) return 'ligand_style';
    return atom.is_backbone?.() ? 'mainchain_style' : 'sidechain_style';
  }

  toggle_label(pick: { bag?: ModelBag | null; atom?: any } | null, show?: boolean) {
    if (pick == null || pick.atom == null) return;
    const symop = pick.bag?.symop ? ' ' + pick.bag.symop : '';
    const text = pick.atom.short_label() + symop;
    const uid = text;
    const is_shown = (uid in this.labels);
    if (show === undefined) show = !is_shown;
    if (show) {
      if (is_shown) return;
      const atom_style = this.atom_style_key(pick.atom);
      const conf = this.config as Record<string, unknown>;
      const balls = conf[atom_style] === 'ball&stick';
      const label = new Label(text, {
        pos: pick.atom.xyz,
        font: this.config.label_font,
        color: '#' + this.config.colors.fg.getHexString(),
        win_size: this.win_size,
        z_shift: balls ? this.config.ball_size + 0.1 : 0.2,
      });
      if (pick.bag == null || label.mesh == null) return;
      this.labels[uid] = { o: label, bag: pick.bag };
      this.scene.add(label.mesh);
    } else {
      if (!is_shown) return;
      this.remove_and_dispose(this.labels[uid].o.mesh);
      delete this.labels[uid];
    }
    this.request_render();
  }

  private active_model_bag(preferred?: ModelBag | null): ModelBag | null {
    if (preferred && this.model_bags.includes(preferred)) return preferred;
    if (this.selected?.bag && this.model_bags.includes(this.selected.bag)) return this.selected.bag;
    return this.model_bags[0] || null;
  }

  private collect_residue_menu_options(
    bag: ModelBag | null,
    filter: (atom: any) => boolean,
  ): ToolbarOption[] {
    if (!bag?.model) return [];
    const seen = new Set<string>();
    const options: ToolbarOption[] = [];
    for (const atom of bag.model.atoms) {
      if (!filter(atom)) continue;
      const key = atom.resid();
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        value: String(atom.i_seq),
        label: `${atom.seqid} ${atom.resname}/${atom.chain}`,
      });
    }
    return options;
  }

  private focus_atom_indices(bag: ModelBag, atom_indices: number[], label: string) {
    if (!bag.model) return;
    const atoms = atom_indices.map((idx) => bag.model!.atoms[idx]).filter(Boolean);
    if (atoms.length === 0) return;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const atom of atoms) {
      x += atom.xyz[0];
      y += atom.xyz[1];
      z += atom.xyz[2];
    }
    this.go_to([x / atoms.length, y / atoms.length, z / atoms.length]);
    this.selected = {bag, atom: atoms[0]};
    this.update_hud(label);
    this.update_toolbar_menus();
  }

  private blob_source_map_bag(negate: boolean): MapBag | null {
    if (negate) {
      return this.map_bags.find((bag) => bag.visible && bag.is_diff_map) || null;
    }
    return this.map_bags.find((bag) => bag.visible && bag.is_diff_map) ||
           this.map_bags.find((bag) => bag.visible) || null;
  }

  private blob_target_xyz(hit: any): [number, number, number] {
    if (!this.blob_negate && this.blob_map_bag?.is_diff_map) {
      return hit.peak_pos;
    }
    return hit.centroid;
  }

  show_blobs(negate = false) {
    const map_bag = this.blob_source_map_bag(negate);
    if (!map_bag?.map) {
      this.hud('No suitable map is loaded for blob search.', 'ERR');
      return;
    }
    const ctx = this.active_model_bag()?.gemmi_selection || null;
    const sigma = map_bag.isolevel ?? this.config.default_isolevel;
    let hits = map_bag.map.find_blobs(map_bag.map.abs_level(sigma), {
      negate,
      structure: ctx?.structure ?? null,
      model_index: ctx?.model_index ?? 0,
    });
    hits.sort((a, b) => b.score - a.score || b.peak_value - a.peak_value);
    if (hits.length > 25) hits = hits.slice(0, 25);
    this.blob_hits = hits;
    this.blob_map_bag = map_bag;
    this.blob_negate = negate;
    this.blob_focus_index = hits.length === 0 ? -1 : 0;
    this.update_toolbar_menus();
    if (hits.length === 0) {
      this.hud(`No ${negate ? 'negative' : 'positive'} blobs above ${sigma.toFixed(2)} rmsd.`);
      return;
    }
    this.focus_blob(0);
  }

  hide_blobs() {
    if (this.blob_hits.length === 0) return;
    this.blob_hits = [];
    this.blob_map_bag = null;
    this.blob_focus_index = -1;
    this.blob_negate = false;
    this.update_toolbar_menus();
    this.hud('Blobs hidden.');
  }

  focus_blob(index: number) {
    if (index < 0 || index >= this.blob_hits.length) return;
    this.blob_focus_index = index;
    const hit = this.blob_hits[index];
    const xyz = this.blob_target_xyz(hit);
    this.go_to(xyz);
    this.update_hud(
      `Blob #${index + 1}: score ${hit.score.toFixed(1)}, ` +
      `peak ${hit.peak_value.toFixed(2)}, volume ${hit.volume.toFixed(1)} A^3`,
    );
    this.update_toolbar_menus();
  }

  private selected_scope(scope: 'atom' | 'residue' | 'chain') {
    const current = this.selected;
    if (!current?.bag?.model || !current.atom) return null;
    const { bag, atom } = current;
    let atoms: any[];
    let label: string;
    if (scope === 'atom') {
      atoms = [atom];
      label = atom.short_label();
    } else if (scope === 'chain') {
      atoms = bag.model.atoms.filter((item) => item.chain === atom.chain);
      label = atom.chain;
    } else {
      atoms = bag.model.get_residues()[atom.resid()] || [atom];
      label = `/${atom.seqid} ${atom.resname}/${atom.chain}`;
    }
    if (atoms.length === 0) return null;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const item of atoms) {
      x += item.xyz[0];
      y += item.xyz[1];
      z += item.xyz[2];
    }
    return {
      bag,
      label,
      indices: atoms.map((item) => item.i_seq),
      center: [x / atoms.length, y / atoms.length, z / atoms.length] as [number, number, number],
    };
  }

  private apply_atom_removal(
    bag: ModelBag,
    indices: number[],
    center: [number, number, number],
    message: string,
  ): EditResult {
    if (!bag.model) return { success: false, message: 'No model data' };
    const removed = bag.model.remove_atoms(indices);
    if (removed === 0) return { success: false, message: 'Nothing deleted' };
    if (bag.model.atoms.length === 0) {
      this.clear_model_objects(bag);
      const idx = this.model_bags.indexOf(bag);
      if (idx !== -1) this.model_bags.splice(idx, 1);
      this.visibility.set_bags(this.model_bags, this.map_bags);
      this.navigation.set_models(this.model_bags);
      const next_bag = this.model_bags[0] || null;
      this.selected = next_bag ? {bag: next_bag, atom: next_bag.model?.atoms[0] || null} : null;
      this.update_toolbar_menus();
      this.redraw_all();
      this.update_hud(message);
      return { success: true, message, center, affected_atoms: removed };
    }
    this.visibility.set_bags(this.model_bags, this.map_bags);
    this.navigation.set_models(this.model_bags);
    const next_atom = bag.model.get_nearest_atom(center[0], center[1], center[2]) || bag.model.atoms[0];
    this.selected = next_atom ? {bag, atom: next_atom} : null;
    this.redraw_model(bag);
    this.update_toolbar_menus();
    this.update_hud(message);
    return { success: true, message, center, affected_atoms: removed };
  }

  delete_selected_scope(scope: 'atom' | 'residue' | 'chain'): EditResult {
    const target = this.selected_scope(scope);
    if (!target) {
      this.update_hud('Nothing selected');
      return { success: false, message: 'Nothing selected' };
    }
    return this.apply_atom_removal(
      target.bag,
      target.indices,
      target.center,
      `Deleted ${scope} ${target.label}`,
    );
  }

  private should_keep_atom_for_alanine(atom: any) {
    return [
      'N', 'CA', 'C', 'O', 'OXT', 'OT1', 'OT2', 'CB',
      'H', 'H1', 'H2', 'H3', 'HA', 'HA2', 'HA3',
      'HB', 'HB1', 'HB2', 'HB3', '1HB', '2HB', '3HB',
      'D', 'D1', 'D2', 'D3', 'DA', 'DA2', 'DA3',
      'DB', 'DB1', 'DB2', 'DB3', '1DB', '2DB', '3DB',
    ].includes(atom.name);
  }

  trim_selected_to_alanine(): EditResult {
    const current = this.selected;
    if (!current?.bag?.model || !current.atom) {
      this.update_hud('Nothing selected');
      return { success: false, message: 'Nothing selected' };
    }
    const { bag, atom } = current;
    const residue_atoms = bag.model.get_residues()[atom.resid()] || [atom];
    if (!residue_atoms.some((item) => item.name === 'CB')) {
      this.update_hud('Residue lacks CB and cannot be trimmed to ALA.');
      return { success: false, message: 'Residue lacks CB' };
    }
    let x = 0;
    let y = 0;
    let z = 0;
    for (const item of residue_atoms) {
      item.resname = 'ALA';
      x += item.xyz[0];
      y += item.xyz[1];
      z += item.xyz[2];
    }
    const remove_indices = residue_atoms
      .filter((item) => !this.should_keep_atom_for_alanine(item))
      .map((item) => item.i_seq);
    if (remove_indices.length === 0) {
      this.redraw_model(bag);
      this.update_toolbar_menus();
      this.update_hud(`Trimmed /${atom.seqid} ALA/${atom.chain} to ALA`);
      return { success: true, message: 'Trimmed to ALA' };
    }
    return this.apply_atom_removal(
      bag,
      remove_indices,
      [x / residue_atoms.length, y / residue_atoms.length, z / residue_atoms.length],
      `Trimmed /${atom.seqid} ALA/${atom.chain} to ALA`,
    );
  }

  private mutation_targets_for_selected(): string[] {
    const current = this.selected;
    if (!current?.bag?.model || !current.atom) return [];
    const residue_atoms = current.bag.model.get_residues()[current.atom.resid()] || [current.atom];
    return mutation_targets_for_residue(residue_atoms);
  }

  private download_target_context(preferred_bag?: ModelBag | null) {
    const bag = this.active_model_bag(preferred_bag);
    if (bag?.gemmi_selection) return bag.gemmi_selection;
    return this.model_bags.find((item) => item.gemmi_selection != null)?.gemmi_selection || null;
  }

  download_model(format: 'pdb' | 'mmcif') {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return;
    const ctx = this.download_target_context();
    if (ctx == null) {
      this.hud('No Gemmi-backed structure loaded.', 'ERR');
      return;
    }
    const structure_name = (ctx.structure?.name || 'model').replace(/[^\w.-]+/g, '_');
    const text = format === 'pdb' ?
      ctx.gemmi.make_pdb_string(ctx.structure) :
      ctx.gemmi.make_mmcif_string(ctx.structure);
    const extension = format === 'pdb' ? 'pdb' : 'cif';
    const filename = `${structure_name}.${extension}`;
    const href = URL.createObjectURL(new Blob([text], {type: 'text/plain'}));
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    this.hud(`Downloaded ${filename}.`);
  }

  private bond_type_from_template(type: string) {
    switch (type.toUpperCase()) {
      case 'SINGLE': return BondType.Single;
      case 'DOUBLE': return BondType.Double;
      case 'TRIPLE': return BondType.Triple;
      case 'AROMATIC': return BondType.Aromatic;
      case 'DELOC': return BondType.Deloc;
      case 'METAL': return BondType.Metal;
      default: return BondType.Unspec;
    }
  }

  private create_mutated_atom(ref_atom: any, target_resname: string,
                              atom_data: {name: string; element: string; xyz: [number, number, number]},
                              occupancy: number, b_iso: number) {
    const atom = Object.create(Object.getPrototypeOf(ref_atom));
    atom.name = atom_data.name;
    atom.altloc = '';
    atom.resname = target_resname;
    atom.chain = ref_atom.chain;
    atom.chain_index = ref_atom.chain_index;
    atom.seqid = ref_atom.seqid;
    atom.ss = ref_atom.ss;
    atom.strand_sense = ref_atom.strand_sense;
    atom.xyz = [atom_data.xyz[0], atom_data.xyz[1], atom_data.xyz[2]];
    atom.occ = occupancy;
    atom.b = b_iso;
    atom.element = atom_data.element;
    atom.is_metal = false;
    atom.i_seq = -1;
    atom.is_ligand = ref_atom.is_ligand;
    atom.bonds = [];
    atom.bond_types = [];
    return atom;
  }

  private rebuild_residue_template_bonds(bag: ModelBag, residue_key: string, target_resname: string) {
    if (!bag.model) return;
    const residue_atoms = bag.model.get_residues()[residue_key] || [];
    const atom_by_name = new Map<string, any>();
    for (const atom of residue_atoms) {
      atom_by_name.set(atom.name, atom);
    }
    for (const bond of residueTemplateBonds(target_resname)) {
      const atom1 = atom_by_name.get(bond.atom_id_1);
      const atom2 = atom_by_name.get(bond.atom_id_2);
      if (!atom1 || !atom2 || atom1.i_seq === atom2.i_seq) continue;
      if (atom1.bonds.includes(atom2.i_seq)) continue;
      bag.model.add_bond(atom1.i_seq, atom2.i_seq, this.bond_type_from_template(bond.type));
    }
  }

  mutate_selected_residue(target_resname: string): EditResult {
    const current = this.selected;
    if (!current?.bag?.model || !current.atom) {
      this.update_hud('Nothing selected');
      return { success: false, message: 'Nothing selected' };
    }
    const { bag, atom } = current;
    const residue_key = atom.resid();
    const residue_atoms = bag.model.get_residues()[residue_key] || [atom];
    let plan;
    try {
      plan = plan_residue_mutation(residue_atoms, target_resname);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.hud(message, 'ERR');
      return { success: false, message };
    }

    const removed = bag.model.remove_atoms(plan.remove_atoms.map((item) => item.i_seq));
    const kept_atoms = bag.model.get_residues()[residue_key] || [];
    for (const item of kept_atoms) item.resname = plan.target_resname;
    const ref_atom = kept_atoms[0] || atom;
    for (const atom_data of plan.add_atoms) {
      const new_atom = this.create_mutated_atom(
        ref_atom, plan.target_resname, atom_data, plan.occupancy, plan.b_iso,
      );
      new_atom.i_seq = bag.model.atoms.length;
      bag.model.atoms.push(new_atom);
    }
    bag.model.bond_data = null;
    bag.model.residue_map = null;
    const mutated_atoms = bag.model.get_residues()[residue_key] || [];
    this.rebuild_residue_template_bonds(bag, residue_key, plan.target_resname);
    bag.model.calculate_bounds();
    bag.model.calculate_cubicles();

    const next_atom = bag.model.get_nearest_atom(plan.focus[0], plan.focus[1], plan.focus[2]) ||
                      mutated_atoms[0] || bag.model.atoms[0] || null;
    this.selected = next_atom ? {bag, atom: next_atom} : null;
    this.redraw_model(bag);
    this.go_to(plan.focus);
    this.update_toolbar_menus();
    const message = `Mutated ${plan.label} to ${plan.target_resname}.`;
    this.update_hud(message);
    return { success: true, message, center: plan.focus, affected_atoms: removed + plan.add_atoms.length };
  }

  open_cid_dialog() {
    const bag = this.active_model_bag();
    if (bag == null || bag.gemmi_selection == null) {
      this.hud('Gemmi selection is unavailable for this model.', 'ERR');
      return;
    }
    this.ui?.open_cid_dialog();
  }

  private apply_cid(cid: string) {
    try {
      const result = this.navigation.find_atom_by_cid(cid);
      if (result) {
        this.go_to(result.atom.xyz);
        this.hud('CID: ' + cid);
      } else {
        this.hud('No atoms match: ' + cid, 'ERR');
      }
    } catch (e) {
      const msg = (e instanceof Error) ? e.message : 'Invalid CID: ' + cid;
      this.hud(msg, 'ERR');
    }
  }

  open_mutation_dialog() {
    const current = this.selected;
    if (!current?.atom) {
      this.update_hud('Nothing selected');
      return;
    }
    const options = this.mutation_targets_for_selected();
    if (options.length === 0) {
      this.hud('Mutation is not supported for this residue.', 'ERR');
      return;
    }
    this.ui?.show_mutation_dialog(
      current.atom.resname,
      current.atom.chain,
      current.atom.seqid,
      options,
      (new_resname) => {
        this.mutate_selected_residue(new_resname);
      },
    );
  }

  private update_toolbar_menus() {
    const bag = this.active_model_bag();
    const metals = this.collect_residue_menu_options(bag, (atom) => atom.is_metal);
    const ligands = this.collect_residue_menu_options(
      bag,
      (atom) => atom.is_ligand && !atom.is_metal && !atom.is_water(),
    );
    const sites = this.navigation.get_site_menu_items();
    const connections = this.navigation.get_connection_menu_items();
    const blob_options: ToolbarOption[] = [];
    const has_pos_blobs = this.blob_source_map_bag(false) != null;
    const has_neg_blobs = this.blob_source_map_bag(true) != null;
    if (has_pos_blobs) blob_options.push({value: 'show_pos', label: 'show +'});
    if (has_neg_blobs) blob_options.push({value: 'show_neg', label: 'show -'});
    if (this.blob_hits.length !== 0) {
      blob_options.push({value: 'hide', label: 'hide'});
      for (let i = 0; i < this.blob_hits.length; i++) {
        const hit = this.blob_hits[i];
        blob_options.push({
          value: `blob:${i}`,
          label: `#${i + 1} ${hit.score.toFixed(1)} e ${hit.volume.toFixed(1)} A^3`,
        });
      }
    }
    this.ui?.update_toolbar({
      blobs: {
        label: this.blob_hits.length === 0 ? 'Blobs' : `Blobs (${this.blob_hits.length})`,
        options: blob_options,
        visible: has_pos_blobs || has_neg_blobs,
      },
      metals: {
        label: `Metals (${metals.length})`,
        options: metals,
        visible: bag != null,
      },
      ligands: {
        label: `Ligands (${ligands.length})`,
        options: ligands,
        visible: bag != null,
      },
      sites: {
        label: `Sites (${sites.length})`,
        options: sites,
        visible: bag != null,
      },
      connections: {
        label: `Connections (${connections.length})`,
        options: connections,
        visible: bag != null,
      },
      delete: {
        label: 'Delete',
        options: [
          {value: 'atom', label: 'atom'},
          {value: 'residue', label: 'residue'},
          {value: 'chain', label: 'chain'},
          {value: 'trim_ala', label: 'trim to Ala'},
        ],
        visible: bag != null,
        disabled: this.selected?.atom == null,
      },
      download: {
        label: 'Download',
        options: [
          {value: 'pdb', label: 'PDB'},
          {value: 'mmcif', label: 'mmCIF'},
        ],
        visible: this.download_target_context(bag) != null,
        disabled: this.download_target_context(bag) == null,
      },
    });
    this.ui?.update_mutate_button({
      label: 'Mutate',
      options: this.mutation_targets_for_selected().map((value) => ({value, label: value})),
      visible: bag != null,
      disabled: this.mutation_targets_for_selected().length === 0,
    });
  }

  private handle_toolbar_action(menu: ToolbarMenuId, value: string) {
    if (menu === 'delete') {
      if (value === 'atom' || value === 'residue' || value === 'chain') {
        this.delete_selected_scope(value);
      } else if (value === 'trim_ala') {
        this.trim_selected_to_alanine();
      }
      return;
    }
    if (menu === 'download') {
      if (value === 'pdb' || value === 'mmcif') this.download_model(value);
      return;
    }
    if (menu === 'blobs') {
      if (value === 'show_pos') this.show_blobs(false);
      else if (value === 'show_neg') this.show_blobs(true);
      else if (value === 'hide') this.hide_blobs();
      else if (value.startsWith('blob:')) this.focus_blob(parseInt(value.slice(5), 10));
      return;
    }
    const bag = this.active_model_bag();
    if (!bag?.model) return;
    if (menu === 'metals' || menu === 'ligands') {
      const atom = bag.model.atoms[parseInt(value, 10)];
      if (atom) this.center_on_atom(bag, atom);
      return;
    }
    if (menu === 'sites') {
      const item = this.navigation.sites[parseInt(value, 10)];
      const item_bag = item ? this.model_bags[item.index] : null;
      if (item && item_bag) this.focus_atom_indices(item_bag, item.atom_indices, item.label);
      return;
    }
    if (menu === 'connections') {
      const item = this.navigation.connections[parseInt(value, 10)];
      const item_bag = item ? this.model_bags[item.index] : null;
      if (item && item_bag) this.focus_atom_indices(item_bag, item.atom_indices, item.label);
    }
  }

  select_next(list: string[], current: string): string {
    const idx = list.indexOf(current);
    return list[(idx + 1) % list.length];
  }

  private select_menu_html(info: string, key: string, options: string[]) {
    const conf = this.config as Record<string, unknown>;
    const value = conf[key];
    const encoded_options = JSON.stringify(options);
    let html = escape_html(info) + ':';
    for (const option of options) {
      const tag = (option === value ? 'u' : 's');
      html += ' <a href="#" class="gm-hud-option" data-hud-select-key="' + escape_html(key) +
              '" data-hud-select-value="' + escape_html(option) +
              '" data-hud-select-info="' + escape_html(info) +
              '" data-hud-select-options="' + escape_html(encoded_options) + '">' +
              '<' + tag + '>' + escape_html(option) + '</' + tag + '></a>';
    }
    return html;
  }

  set_selected_option(info: string, key: string, options: string[], value: string) {
    if (options.indexOf(value) === -1) return;
    (this.config as Record<string, unknown>)[key] = value;
    this.apply_selected_option(key);
    this.hud(this.select_menu_html(info, key, options), 'HTML');
  }

  private show_option_choices(info: string, key: string, options: string[]) {
    this.hud(this.select_menu_html(info, key, options), 'HTML');
  }

  cycle_mainchain_style() {
    this.config.mainchain_style = this.select_next(
      MAINCHAIN_STYLES,
      this.config.mainchain_style
    );
    this.redraw_all();
    this.show_option_choices('mainchain as', 'mainchain_style', MAINCHAIN_STYLES);
  }

  cycle_sidechain_style() {
    this.config.sidechain_style = this.select_next(
      SIDECHAIN_STYLES,
      this.config.sidechain_style
    );
    this.redraw_all();
    this.show_option_choices('sidechains as', 'sidechain_style', SIDECHAIN_STYLES);
  }

  cycle_color_prop() {
    this.config.color_prop = this.select_next(
      COLOR_PROPS,
      this.config.color_prop
    );
    this.redraw_all();
    this.show_option_choices('coloring by', 'color_prop', COLOR_PROPS);
  }

  cycle_color_scheme() {
    const schemes = Object.keys(ColorSchemes);
    const idx = schemes.indexOf(this.config.color_scheme);
    this.config.color_scheme = schemes[(idx + 1) % schemes.length];
    this.config.colors = ColorSchemes[this.config.color_scheme];
    if (this.scene?.fog) this.scene.fog.color = this.config.colors.bg;
    this.renderer?.setClearColor?.(this.config.colors.bg, 1);
    (this.decor.zoom_grid as any).material?.uniforms?.ucolor?.value?.set(this.config.colors.fg);
    this.redraw_all();
    this.show_option_choices('color scheme', 'color_scheme', Object.keys(ColorSchemes));
  }

  cycle_ligand_style() {
    this.config.ligand_style = this.select_next(
      LIGAND_STYLES,
      this.config.ligand_style
    );
    this.redraw_all();
    this.show_option_choices('ligands as', 'ligand_style', LIGAND_STYLES);
  }

  cycle_water_style() {
    this.config.water_style = this.select_next(
      WATER_STYLES,
      this.config.water_style
    );
    this.redraw_all();
    this.show_option_choices('waters as', 'water_style', WATER_STYLES);
  }

  cycle_map_style() {
    this.config.map_style = this.select_next(
      MAP_STYLES,
      this.config.map_style
    );
    this.redraw_maps(true);
    this.show_option_choices('map style', 'map_style', MAP_STYLES);
  }

  toggle_hydrogens() {
    this.config.hydrogens = !this.config.hydrogens;
    const bag = this.active_model_bag();
    const n_h = bag ? bag.model.atoms.filter(
      (a: any) => a.element === 'H' || a.element === 'D').length : 0;
    this.hud((this.config.hydrogens ? 'show' : 'hide') +
             ' hydrogens (' + n_h + ' H/D atom' + (n_h === 1 ? '' : 's') +
             ' in model)');
    this.redraw_all();
  }

  toggle_fog() {
    if (!this.scene?.fog) return;
    const has_fog = this.scene.fog.far === 1;
    this.scene.fog.far = has_fog ? 1e9 : 1;
    this.hud((has_fog ? 'dis' : 'en') + 'able fog');
    this.request_render();
  }

  cycle_label_font() {
    this.config.label_font = this.select_next(LABEL_FONTS, this.config.label_font);
    this.show_option_choices('label font', 'label_font', LABEL_FONTS);
    this.redraw_all();
  }

  toggle_histogram() {
    if (this.histogram_el) {
      this.histogram_el.remove();
      this.histogram_el = null;
      this.histogram_redraw = null;
      return;
    }
    const map_bag = this.map_bags[0];
    if (!map_bag) {
      this.hud('no map loaded');
      return;
    }
    const map = map_bag.map;
    let data: Float32Array | null = null;
    if (map.wasm_map != null) {
      data = map.wasm_map.data();
    } else if (map.grid != null) {
      data = map.grid.values;
    }
    if (data == null || data.length === 0) {
      this.hud('no map data for histogram');
      return;
    }
    this.draw_histogram(data, map_bag);
  }

  private draw_histogram(data: Float32Array, map_bag: MapBag) {
    const map = map_bag.map;
    const mean = map.stats.mean;
    const rms = map.stats.rms;

    const n_bins = 200;
    let data_max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (data[i] > data_max) data_max = data[i];
    }
    const range_min = Math.max(0, mean - 6 * rms);
    const range_max = Math.max(mean + 6 * rms, data_max);
    const bin_width = (range_max - range_min) / n_bins;
    const counts = new Uint32Array(n_bins);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      let bin = Math.floor((v - range_min) / bin_width);
      if (bin < 0) bin = 0;
      if (bin >= n_bins) bin = n_bins - 1;
      counts[bin]++;
    }

    const log_counts = new Float64Array(n_bins);
    let max_log = 0;
    for (let i = 0; i < n_bins; i++) {
      log_counts[i] = counts[i] > 0 ? Math.log10(counts[i]) : 0;
      if (log_counts[i] > max_log) max_log = log_counts[i];
    }

    const W = 400;
    const H = 220;
    const pad_left = 40;
    const pad_right = 10;
    const pad_top = 25;
    const pad_bottom = 35;
    const plot_w = W - pad_left - pad_right;
    const plot_h = H - pad_top - pad_bottom;

    const val2x = (v: number) =>
      pad_left + ((v - range_min) / (range_max - range_min)) * plot_w;
    const x2sigma = (x: number) =>
      ((x - pad_left) / plot_w * (range_max - range_min) + range_min - mean) / rms;

    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.right = '10px';
    wrapper.style.top = '50%';
    wrapper.style.transform = 'translateY(-50%)';
    wrapper.style.zIndex = '10';

    const canvas_box = document.createElement('div');
    canvas_box.style.position = 'relative';
    canvas_box.style.width = W + 'px';
    canvas_box.style.height = H + 'px';

    const btn = document.createElement('div');
    btn.style.position = 'absolute';
    btn.style.top = '2px';
    btn.style.right = '2px';
    btn.style.width = '18px';
    btn.style.height = '18px';
    btn.style.lineHeight = '16px';
    btn.style.textAlign = 'center';
    btn.style.cursor = 'pointer';
    btn.style.color = '#aaa';
    btn.style.fontSize = '14px';
    btn.style.zIndex = '12';
    btn.textContent = '\u2013';
    btn.title = 'minimize';
    btn.onclick = (e) => {
      e.stopPropagation();
      if (canvas_box.style.display === 'none') {
        canvas_box.style.display = '';
        btn.textContent = '\u2013';
        btn.title = 'minimize';
        btn.style.position = 'absolute';
        btn.style.backgroundColor = '';
      } else {
        canvas_box.style.display = 'none';
        btn.textContent = '\u25a4';
        btn.title = 'show histogram';
        btn.style.position = '';
        btn.style.backgroundColor = 'rgba(0,0,0,0.7)';
      }
    };

    const bg = document.createElement('canvas');
    bg.width = W;
    bg.height = H;
    bg.style.position = 'absolute';
    bg.style.left = '0';
    bg.style.top = '0';

    const bg_ctx = bg.getContext('2d')!;
    bg_ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    bg_ctx.fillRect(0, 0, W, H);

    const bar_w = plot_w / n_bins;
    bg_ctx.fillStyle = '#5588cc';
    for (let i = 0; i < n_bins; i++) {
      if (log_counts[i] === 0) continue;
      const bar_h = (log_counts[i] / max_log) * plot_h;
      bg_ctx.fillRect(pad_left + i * bar_w, pad_top + plot_h - bar_h,
                      Math.max(bar_w - 0.5, 1), bar_h);
    }

    const mean_x = val2x(mean);
    if (mean_x >= pad_left && mean_x <= pad_left + plot_w) {
      bg_ctx.strokeStyle = '#aaa';
      bg_ctx.lineWidth = 1;
      bg_ctx.setLineDash([4, 3]);
      bg_ctx.beginPath();
      bg_ctx.moveTo(mean_x, pad_top);
      bg_ctx.lineTo(mean_x, pad_top + plot_h);
      bg_ctx.stroke();
      bg_ctx.setLineDash([]);
    }

    bg_ctx.strokeStyle = '#888';
    bg_ctx.lineWidth = 1;
    bg_ctx.beginPath();
    bg_ctx.moveTo(pad_left, pad_top);
    bg_ctx.lineTo(pad_left, pad_top + plot_h);
    bg_ctx.lineTo(pad_left + plot_w, pad_top + plot_h);
    bg_ctx.stroke();

    bg_ctx.fillStyle = '#ccc';
    bg_ctx.font = '10px monospace';
    bg_ctx.textAlign = 'center';
    for (let s = -5; s <= 5; s += 1) {
      const v = mean + s * rms;
      const x = val2x(v);
      if (x < pad_left || x > pad_left + plot_w) continue;
      bg_ctx.beginPath();
      bg_ctx.moveTo(x, pad_top + plot_h);
      bg_ctx.lineTo(x, pad_top + plot_h + 4);
      bg_ctx.stroke();
      if (s % 2 === 0) {
        bg_ctx.fillText(s + '\u03c3', x, pad_top + plot_h + 15);
      }
    }

    bg_ctx.textAlign = 'right';
    for (let p = 0; p <= max_log; p += 1) {
      const y = pad_top + plot_h - (p / max_log) * plot_h;
      bg_ctx.beginPath();
      bg_ctx.moveTo(pad_left - 4, y);
      bg_ctx.lineTo(pad_left, y);
      bg_ctx.stroke();
      bg_ctx.fillText('10' + (p === 0 ? '\u2070' :
                               p === 1 ? '\u00b9' :
                               p === 2 ? '\u00b2' :
                               p === 3 ? '\u00b3' :
                               '\u2074\u207a'), pad_left - 6, y + 3);
    }

    bg_ctx.fillStyle = '#ddd';
    bg_ctx.font = '11px sans-serif';
    bg_ctx.textAlign = 'left';
    const title = (map_bag.name || 'map') +
      '  \u03bc=' + mean.toFixed(3) + '  \u03c3=' + rms.toFixed(3);
    bg_ctx.fillText(title, pad_left, pad_top - 10);

    bg_ctx.fillStyle = '#aaa';
    bg_ctx.font = '10px sans-serif';
    bg_ctx.textAlign = 'center';
    bg_ctx.fillText('density (' + map.unit + ')', pad_left + plot_w / 2,
                    H - 3);

    const overlay = document.createElement('canvas');
    overlay.width = W;
    overlay.height = H;
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.cursor = 'ew-resize';
    const ov_ctx = overlay.getContext('2d')!;

    const iso_color = map_bag.is_diff_map ? '#40b040' : '#ff6644';
    const draw_isolevel = () => {
      ov_ctx.clearRect(0, 0, W, H);
      const abs_level = map.abs_level(map_bag.isolevel!);
      const iso_x = val2x(abs_level);
      if (iso_x >= pad_left && iso_x <= pad_left + plot_w) {
        ov_ctx.strokeStyle = iso_color;
        ov_ctx.lineWidth = 2;
        ov_ctx.beginPath();
        ov_ctx.moveTo(iso_x, pad_top);
        ov_ctx.lineTo(iso_x, pad_top + plot_h);
        ov_ctx.stroke();
        ov_ctx.fillStyle = iso_color;
        ov_ctx.font = '10px monospace';
        ov_ctx.textAlign = 'center';
        ov_ctx.fillText(map_bag.isolevel!.toFixed(1) + '\u03c3',
                        iso_x, pad_top - 3);
      }
    };
    draw_isolevel();

    let dragging = false;
    const set_level_from_x = (x: number) => {
      const sigma = x2sigma(x);
      const sigma_min = (range_min - mean) / rms;
      const sigma_max = (range_max - mean) / rms;
      const clamped = Math.round(Math.max(sigma_min, Math.min(sigma_max, sigma)) * 10) / 10;
      if (clamped === map_bag.isolevel) return;
      map_bag.isolevel = clamped;
      draw_isolevel();
      this.redraw_maps(true);
      const abs_level = map.abs_level(map_bag.isolevel!);
      this.hud('map level = ' + abs_level.toFixed(4) + ' ' +
               map.unit + ' (' + map_bag.isolevel!.toFixed(2) + ' rmsd)');
    };
    overlay.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      set_level_from_x(e.offsetX);
    });
    overlay.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      set_level_from_x(e.offsetX);
    });
    const stop_drag = () => { dragging = false; };
    overlay.addEventListener('mouseup', stop_drag);
    overlay.addEventListener('mouseleave', stop_drag);

    canvas_box.appendChild(bg);
    canvas_box.appendChild(overlay);
    wrapper.appendChild(btn);
    wrapper.appendChild(canvas_box);

    this.histogram_el = wrapper;
    this.histogram_redraw = draw_isolevel;
    (this.container || document.body).appendChild(wrapper);
  }

  // Editing operations
  set_templates(templates: ResidueTemplates) {
    this.editor.set_templates(templates);
  }

  delete_selected(): EditResult {
    return this.delete_selected_scope('residue');
  }

  delete_residue(bag: ModelBag, chain: string, resno: number): EditResult {
    if (!bag.model) return { success: false, message: 'No model data' };
    const atoms = bag.model.atoms.filter((atom) => atom.chain === chain && atom.seqid === String(resno));
    if (atoms.length === 0) return { success: false, message: `No atoms found for ${chain}/${resno}` };
    let x = 0;
    let y = 0;
    let z = 0;
    for (const atom of atoms) {
      x += atom.xyz[0];
      y += atom.xyz[1];
      z += atom.xyz[2];
    }
    return this.apply_atom_removal(
      bag,
      atoms.map((atom) => atom.i_seq),
      [x / atoms.length, y / atoms.length, z / atoms.length],
      `Deleted residue /${resno} ${atoms[0].resname}/${chain}`,
    );
  }

  mutate_residue_atom(atom: { chain: string; seqid: number }, new_resname: string): EditResult {
    if (!this.selected) return { success: false, message: 'Nothing selected' };
    const bag = this.selected.bag;
    const result = this.editor.mutate_residue(bag, atom.chain, atom.seqid, new_resname);
    if (result.success) {
      this.redraw_model(bag);
      this.update_hud(`Mutated to ${new_resname}`);
    }
    return result;
  }

  mutate_residue(bag: ModelBag, chain: string, resno: number, new_resname: string): EditResult {
    const result = this.editor.mutate_residue(bag, chain, resno, new_resname);
    if (result.success) this.redraw_model(bag);
    return result;
  }

  trim_chain(bag: ModelBag, chain: string, n_keep: number, c_keep: number): EditResult {
    const result = this.editor.trim_residues(bag, chain, n_keep, c_keep);
    if (result.success) this.redraw_model(bag);
    return result;
  }

  place_residue(bag: ModelBag, resname: string, position: number[],
                chain: string, resno: number): EditResult {
    const result = this.editor.place_residue(bag, resname, position, chain, resno);
    if (result.success) this.redraw_model(bag);
    return result;
  }

  hud(text?: string, type?: string): void {
    if (type === 'ERR') {
      console.error('ERR:', text);
    }
    if (text == null) return;
    if (type === 'HTML') {
      this.ui?.update_hud_html(text);
    } else {
      this.ui?.update_hud(text);
    }
  }

  update_hud(text: string) {
    this.ui?.update_hud(text);
  }

  set_structure_name(name?: string | null) {
    this.ui?.set_structure_name(name);
  }

  request_render(): void {
    if (!this.renderer || this.render_scheduled) return;
    this.render_scheduled = true;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(this.render_frame);
    } else {
      setTimeout(this.render_frame, 0);
    }
  }

  load_file(url: string, options: { binary?: boolean; progress?: boolean },
            callback: (req: XMLHttpRequest) => void,
            error_callback?: (req?: XMLHttpRequest) => void): void {
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
        if (error_callback) error_callback(req);
        else this.hud(`Failed to load ${url}: ${req.status}`, 'ERR');
      }
    };
    req.onerror = () => {
      if (error_callback) error_callback(req);
      else this.hud(`Failed to load ${url}`, 'ERR');
    };
    req.send();
  }

  // XHR headers storage
  xhr_headers: Record<string, string> = {};

  set_dropzone(element: HTMLElement, callback: (file: File) => Promise<void> | void): void {
    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer != null) e.dataTransfer.dropEffect = 'copy';
    });
    element.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const sorted_files = Array.from(files).sort((a, b) => a.name.localeCompare(
        b.name, undefined, {numeric: true, sensitivity: 'base'}
      ));
      Promise.resolve().then(async () => {
        for (const file of sorted_files) {
          await callback(file);
        }
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.hud('Loading failed.\n' + msg, 'ERR');
      });
    });
  }

  recenter(xyz?: number[], cam?: number[], steps?: number): void {
    const bag = this.selected?.bag || this.model_bags[0] || null;
    const new_up = new Vector3(0, 1, 0);
    let vec_cam;
    let vec_xyz;
    let eye;

    if (xyz != null && cam == null && bag != null) {
      const mc = bag.model.get_center();
      eye = new Vector3(xyz[0] - mc[0], xyz[1] - mc[1], xyz[2] - mc[2]);
      eye.setLength(100);
      vec_xyz = new Vector3(xyz[0], xyz[1], xyz[2]);
      vec_cam = eye.clone().add(vec_xyz);
    } else {
      if (xyz == null) {
        if (bag != null) {
          xyz = bag.model.get_center();
        } else {
          const uc_func = this.get_cell_box_func();
          xyz = uc_func ? uc_func([0.5, 0.5, 0.5]) : [0, 0, 0];
        }
      }
      vec_xyz = new Vector3(xyz[0], xyz[1], xyz[2]);
      if (cam != null) {
        vec_cam = new Vector3(cam[0], cam[1], cam[2]);
        eye = vec_cam.clone().sub(vec_xyz);
        new_up.copy(this.camera.up);
      } else {
        vec_cam = new Vector3(
          xyz[0] + this.default_camera_pos[0],
          xyz[1] + this.default_camera_pos[1],
          xyz[2] + this.default_camera_pos[2]
        );
      }
    }

    if (eye != null) {
      new_up.projectOnPlane(eye);
      if (new_up.lengthSq() < 0.0001) new_up.x += 1;
      new_up.normalize();
    }
    this.controls.go_to(vec_xyz, vec_cam, new_up, steps);
    this.request_render();
  }

  set_view(options: Record<string, any> = {}): void {
    const frag = parse_url_fragment();
    if (frag.zoom) {
      this.camera.zoom = frag.zoom;
    } else if (options.zoom && this.camera) {
      this.camera.zoom = options.zoom;
    }
    if (frag.zoom || options.zoom) this.update_camera();
    this.recenter(frag.xyz || options.xyz || options.center,
                  frag.eye || options.eye, 1);
  }

  resolve_gemmi(explicit_module?: GemmiModule): Promise<any> {
    if (explicit_module) {
      return Promise.resolve(explicit_module);
    }
    if (this.gemmi_module) {
      return Promise.resolve(this.gemmi_module);
    }
    if (this.gemmi_factory) {
      if (this.gemmi_loading == null) {
        this.gemmi_loading = this.gemmi_factory().then((gemmi) => {
          this.gemmi_module = gemmi;
          return gemmi;
        }, (err) => {
          this.gemmi_loading = null;
          throw err;
        });
      }
      return this.gemmi_loading;
    }
    const factory = (globalThis as any).Gemmi;
    if (typeof factory === 'function') {
      this.gemmi_factory = factory;
      return this.resolve_gemmi();
    }
    return Promise.reject(new Error('Gemmi factory not available'));
  }

  load_structure_from_buffer(gemmi: GemmiModule, buffer: ArrayBuffer, name: string) {
    return modelsFromGemmi(gemmi, buffer, name).then((result) => {
      const first_index = this.model_bags.length;
      for (const model of result.models) {
        const bag = this.load_structure(model);
        bag.gemmi_selection = {
          gemmi: gemmi,
          structure: result.structure,
          model_index: model.source_model_index == null ? 0 : model.source_model_index,
        };
      }
      const first_bag = this.model_bags[first_index] || null;
      this.selected = first_bag ? {bag: first_bag, atom: first_bag.model.atoms[0] || null} : null;
      this.set_structure_name(result.structure?.name);
      this.update_toolbar_menus();
      return result;
    });
  }

  load_coordinate_buffer(buffer: ArrayBuffer, name: string, explicit_gemmi?: GemmiModule) {
    return this.resolve_gemmi(explicit_gemmi).then((gemmi) => {
      if (!gemmi) throw new Error('Gemmi is required for coordinate loading.');
      return this.load_structure_from_buffer(gemmi, buffer, name);
    });
  }

  load_structure_file(file: File, explicit_gemmi?: GemmiModule): Promise<void> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.readyState !== 2 || !(reader.result instanceof ArrayBuffer)) return;
        this.load_coordinate_buffer(reader.result, file.name, explicit_gemmi).then(() => {
          resolve();
        }, reject);
      };
      reader.onerror = () => reject(reader.error || Error('Failed to read ' + file.name));
      reader.readAsArrayBuffer(file);
    });
  }

  load_map_from_buffer(buffer: ArrayBuffer,
                       options: {format: 'ccp4' | 'dsn6'; diff_map?: boolean},
                       gemmi?: GemmiModule) {
    const map = new ElMap();
    if (options.format === 'dsn6') {
      if (!gemmi) throw new Error('Gemmi is required for DSN6 map loading.');
      map.from_dsn6(buffer, gemmi);
    } else {
      if (!gemmi) throw new Error('Gemmi is required for CCP4 map loading.');
      map.from_ccp4(buffer, true, gemmi);
    }
    this.add_map(map, options.diff_map === true);
    return map;
  }

  load_map_file(file: File,
                options: {format: 'ccp4' | 'dsn6'; diff_map?: boolean},
                explicit_gemmi?: GemmiModule): Promise<void> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.readyState !== 2 || !(reader.result instanceof ArrayBuffer)) return;
        this.resolve_gemmi(explicit_gemmi).then((gemmi) => {
          if (!gemmi) throw new Error('Gemmi is required for map loading.');
          this.load_map_from_buffer(reader.result as ArrayBuffer, options, gemmi);
        }).then(() => {
          resolve();
        }, reject);
      };
      reader.onerror = () => reject(reader.error || Error('Failed to read ' + file.name));
      reader.readAsArrayBuffer(file);
    });
  }

  load_pdb(url: string | string[], options: Record<string, any> | null = {},
           callback?: () => void): void {
    const opts = options ?? {};
    if (Array.isArray(url)) {
      this.load_pdb_candidates(url, opts, callback);
      return;
    }
    this.load_file(url, {binary: true, progress: true}, (req) => {
      this.load_coordinate_buffer(req.response, url, opts.gemmi).then(() => {
        if (!opts.stay) this.set_view(opts);
        if (callback) callback();
      }, (err) => {
        this.hud('Error: ' + err.message + '\nwhen processing ' + url, 'ERR');
      });
    });
  }

  private load_pdb_candidates(urls: string[], options: Record<string, any> = {},
                              callback?: () => void) {
    const failed: string[] = [];
    const try_next = (index: number) => {
      if (index >= urls.length) {
        this.hud('Failed to fetch ' + failed.join(' or '), 'ERR');
        return;
      }
      const url = urls[index];
      this.load_file(url, {binary: true, progress: true}, (req) => {
        this.load_coordinate_buffer(req.response, url, options.gemmi).then(() => {
          if (!options.stay) this.set_view(options);
          if (callback) callback();
        }, () => {
          failed.push(url);
          try_next(index + 1);
        });
      }, () => {
        failed.push(url);
        try_next(index + 1);
      });
    };
    try_next(0);
  }

  load_map(url: string | null,
           options: {format: 'ccp4' | 'dsn6'; diff_map?: boolean; gemmi?: GemmiModule},
           callback?: () => void) {
    if (url == null) {
      if (callback) callback();
      return;
    }
    this.load_file(url, {binary: true, progress: true}, (req) => {
      this.resolve_gemmi(options.gemmi).then((gemmi) => {
        if (options.format === 'ccp4' && !gemmi) {
          throw new Error('Gemmi is required for CCP4 map loading.');
        }
        this.load_map_from_buffer(req.response, options, gemmi || undefined);
      }).then(() => {
        if (this.model_bags.length === 0 && this.map_bags.length === 1) {
          this.recenter();
        }
        if (callback) callback();
      }, (err) => {
        this.hud('Error: ' + err.message + '\nwhen processing ' + url, 'ERR');
      });
    });
  }

  load_maps(url1: string, url2: string,
            options: {format: 'ccp4' | 'dsn6'; gemmi?: GemmiModule},
            callback?: () => void) {
    this.load_map(url1, {format: options.format, diff_map: false, gemmi: options.gemmi}, () => {
      this.load_map(url2, {format: options.format, diff_map: true, gemmi: options.gemmi}, callback);
    });
  }

  load_ccp4_maps(url1: string, url2: string, callback?: () => void) {
    this.load_maps(url1, url2, {format: 'ccp4'}, callback);
  }

  load_pdb_and_maps(pdb: string | string[], map1: string, map2: string,
                    options: {format: 'ccp4' | 'dsn6'; gemmi?: GemmiModule; stay?: boolean},
                    callback?: () => void) {
    this.load_pdb(pdb, options, () => {
      this.load_maps(map1, map2, options, callback);
    });
  }

  load_pdb_and_ccp4_maps(pdb: string | string[], map1: string, map2: string,
                         callback?: () => void) {
    this.load_pdb_and_maps(pdb, map1, map2, {format: 'ccp4'}, callback);
  }

  load_from_rcsb(pdb_id: string, callback?: () => void) {
    const id = pdb_id.toLowerCase();
    this.load_pdb_and_maps(
      'https://files.rcsb.org/download/' + id + '.pdb',
      'https://edmaps.rcsb.org/maps/' + id + '_2fofc.dsn6',
      'https://edmaps.rcsb.org/maps/' + id + '_fofc.dsn6',
      {format: 'dsn6'},
      callback
    );
  }

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

  clear_el_objects(map_bag?: MapBag): void {
    const bags = map_bag ? [map_bag] : this.map_bags;
    for (const bag of bags) {
      for (const obj of bag.el_objects || []) {
        this.remove_and_dispose(obj);
      }
      bag.el_objects = [];
    }
  }

  apply_selected_option(key: string): void {
    switch (key) {
      case 'color_scheme':
        this.config.colors = ColorSchemes[this.config.color_scheme];
        if (this.scene?.fog) this.scene.fog.color = this.config.colors.bg;
        this.renderer?.setClearColor?.(this.config.colors.bg, 1);
        this.redraw_all();
        break;
      case 'color_prop':
      case 'mainchain_style':
      case 'sidechain_style':
      case 'ligand_style':
      case 'water_style':
        this.redraw_all();
        break;
      case 'label_font':
        this.redraw_all();
        break;
      case 'map_style':
        this.redraw_maps(true);
        break;
    }
  }

  private clear_cell_box() {
    if (this.decor.cell_box) {
      this.remove_and_dispose(this.decor.cell_box);
      this.decor.cell_box = null;
    }
  }

  get_cell_box_func(): ((arg: [number, number, number]) => [number, number, number]) | null {
    const unit_cell =
      this.selected?.bag?.model?.unit_cell ||
      this.model_bags[0]?.model?.unit_cell ||
      this.map_bags[0]?.map?.unit_cell ||
      null;
    return unit_cell ? unit_cell.orthogonalize.bind(unit_cell) : null;
  }

  change_zoom_by_factor(mult: number): void {
    if (!this.camera) return;
    this.camera.zoom *= mult;
    this.update_camera();
    this.hud('zoom: ' + this.camera.zoom.toPrecision(3));
    this.request_render();
  }

  change_map_line(delta: number): void {
    this.config.map_line = Math.max(this.config.map_line + delta, 0.1);
    this.redraw_maps(true);
    this.hud('wireframe width: ' + this.config.map_line.toFixed(1));
  }

  change_stick_radius(delta: number): void {
    this.config.stick_radius = Math.max(this.config.stick_radius + delta, 0.01);
    this.config.stick_radius = Math.round(this.config.stick_radius * 1000) / 1000;
    this.redraw_all();
    this.hud('stick radius: ' + this.config.stick_radius.toFixed(3));
  }

  go_to_nearest_Ca(): void {
    const t = this.target;
    const bag = this.selected?.bag;
    if (bag == null) return;
    const atom = bag.model.get_nearest_atom(t.x, t.y, t.z, 'CA');
    if (atom != null) {
      this.go_to(atom.xyz);
      this.hud('-> ' + atom.long_label(bag.symop));
    } else {
      this.hud('no nearby CA');
    }
  }

  center_next_residue(back: boolean): void {
    const bag = this.selected?.bag;
    if (bag == null) return;
    const atom = bag.model.next_residue(this.selected?.atom, back);
    if (atom != null) {
      this.go_to(atom.xyz);
      this.hud('-> ' + atom.long_label(bag.symop));
    }
  }

  toggle_symmetry(): void {
    if (this.sym_model_bags.length > 0) {
      const sym_bag_set = new Set(this.sym_model_bags);
      if (this.selected?.bag != null && sym_bag_set.has(this.selected.bag)) {
        this.toggle_label(this.selected, false);
        const fallback = this.model_bags.find((bag) => !sym_bag_set.has(bag)) || null;
        this.selected = fallback ? {bag: fallback, atom: null} : null;
      }
      for (const uid in this.labels) {
        if (!sym_bag_set.has(this.labels[uid].bag)) continue;
        this.remove_and_dispose(this.labels[uid].o.mesh);
        delete this.labels[uid];
      }
      for (const bag of this.sym_model_bags) {
        this.clear_model_objects(bag);
        const idx = this.model_bags.indexOf(bag);
        if (idx !== -1) this.model_bags.splice(idx, 1);
      }
      for (const obj of this.sym_bond_objects) {
        this.remove_and_dispose(obj);
      }
      this.sym_model_bags = [];
      this.sym_bond_objects = [];
      this.update_toolbar_menus();
      this.hud('symmetry mates hidden');
      this.request_render();
      return;
    }
    const bag = this.active_model_bag();
    if (bag == null || bag.gemmi_selection == null) {
      this.hud('No model with gemmi data loaded.');
      return;
    }
    const gemmi = bag.gemmi_selection.gemmi;
    const structure = bag.gemmi_selection.structure;
    if (!gemmi.get_nearby_sym_ops) {
      this.hud('Symmetry functions not available in this gemmi build.');
      return;
    }
    const pos: [number, number, number] = [this.target.x, this.target.y, this.target.z];
    const radius = this.config.map_radius;
    const images = gemmi.get_nearby_sym_ops(structure, pos, radius);
    if (images.size() === 0) {
      this.hud('No symmetry mates within map radius ' + radius +
               '\u00C5 (use [ and ] to change the map radius)');
      images.delete();
      return;
    }
    const n = images.size();
    const shown_symops: string[] = [];
    for (let i = 0; i < n; i++) {
      const image = images.get(i)!;
      const sym_st = gemmi.get_sym_image(structure, image);
      const model = modelFromGemmiStructure(gemmi, sym_st, bag.model.bond_data);
      sym_st.delete();
      const sym_bag = createModelBag(model, this.config, this.win_size);
      sym_bag.hue_shift = 0;
      sym_bag.color_override = (atom) => symmetry_mate_color(atom, this.config.colors);
      sym_bag.symop = image.symmetry_code(true);
      shown_symops.push(sym_bag.symop);
      sym_bag.visible = true;
      this.model_bags.push(sym_bag);
      this.redraw_model(sym_bag);
      this.sym_model_bags.push(sym_bag);
      if (gemmi.CrossSymBonds) {
        const csb = new gemmi.CrossSymBonds();
        csb.find(structure, image);
        const csb_len = csb.bond_data_size();
        if (csb_len > 0) {
          const csb_ptr = csb.bond_data_ptr();
          const csb_data = new Int32Array(gemmi.HEAPU8.buffer, csb_ptr, csb_len).slice();
          const vertex_arr: [number, number, number][] = [];
          const color_arr: Color[] = [];
          const stick_radius = Math.max(this.config.stick_radius,
                                        this.config.ball_size * 0.5);
          for (let j = 0; j < csb_data.length; j += 3) {
            const a1 = bag.model.atoms[csb_data[j]];
            const a2 = model.atoms[csb_data[j + 1]];
            if (!a1 || !a2) continue;
            const c1 = color_by(this.config.color_prop, [a1],
                                this.config.colors, bag.hue_shift);
            const c2 = [symmetry_mate_color(a2, this.config.colors)];
            const mid: [number, number, number] = [
              (a1.xyz[0] + a2.xyz[0]) / 2,
              (a1.xyz[1] + a2.xyz[1]) / 2,
              (a1.xyz[2] + a2.xyz[2]) / 2,
            ];
            vertex_arr.push(a1.xyz, mid);
            color_arr.push(c1[0], c1[0]);
            vertex_arr.push(a2.xyz, mid);
            color_arr.push(c2[0], c2[0]);
          }
          if (vertex_arr.length > 0) {
            const obj = makeSticks(vertex_arr, color_arr, stick_radius);
            this.scene.add(obj);
            this.sym_bond_objects.push(obj);
          }
        }
        csb.delete();
      }
    }
    this.hud(n + ' symmetry mate' + (n > 1 ? 's' : '') +
             ' shown: ' + shown_symops.join(', '));
    images.delete();
    this.request_render();
  }

  toggle_full_screen(): void {
    if (typeof document === 'undefined') return;
    const d = document as Document & Record<string, any>;
    if (d.fullscreenElement || d.webkitFullscreenElement || d.mozFullScreenElement || d.msFullscreenElement) {
      const exit = d.exitFullscreen || d.webkitExitFullscreen || d.mozCancelFullScreen || d.msExitFullscreen;
      if (typeof exit === 'function') exit.call(d);
      return;
    }
    const element = this.container;
    if (!element) return;
    const request =
      (element as any).requestFullscreen ||
      (element as any).webkitRequestFullscreen ||
      (element as any).mozRequestFullScreen ||
      (element as any).msRequestFullscreen;
    if (typeof request === 'function') request.call(element);
  }

  toggle_cell_box(): void {
    if (this.decor.cell_box) {
      this.clear_cell_box();
    } else {
      const uc_func = this.get_cell_box_func();
      if (uc_func) {
        this.decor.cell_box = makeRgbBox(uc_func, this.config.colors.fg);
        this.scene.add(this.decor.cell_box);
      }
    }
    this.request_render();
  }

  toggle_help(): void {
    this.ui?.toggle_help(this.KEYBOARD_HELP, this.MOUSE_HELP, this.help_version_html());
  }

  shift_clip(delta: number): void {
    if (!this.camera || !this.target) return;
    const eye = this.camera.position.clone().sub(this.target);
    eye.multiplyScalar(delta / eye.length());
    this.target.add(eye);
    this.camera.position.add(eye);
    this.update_camera();
    this.redraw_maps(true);
    this.hud('clip shifted by [' +
      [eye.x.toFixed(2), eye.y.toFixed(2), eye.z.toFixed(2)].join(' ') + ']');
  }

  permalink(): void {
    if (typeof window === 'undefined' || !this.camera || !this.target) return;
    const xyz_prec = Math.round(-Math.log10(0.001));
    window.location.hash =
      '#xyz=' + [this.target.x.toFixed(xyz_prec), this.target.y.toFixed(xyz_prec), this.target.z.toFixed(xyz_prec)].join(',') +
      '&eye=' + [this.camera.position.x.toFixed(1), this.camera.position.y.toFixed(1), this.camera.position.z.toFixed(1)].join(',') +
      '&zoom=' + this.camera.zoom.toFixed(0);
    this.hud('copy URL from the location bar');
  }

  update_camera(): void {
    if (!this.camera?.updateProjectionMatrix) return;
    if (this.controls?.slab_width && this.camera.position?.distanceTo && this.target) {
      const dxyz = this.camera.position.distanceTo(this.target);
      const width = this.controls.slab_width;
      const scale = width[2] || this.camera.zoom;
      this.camera.near = dxyz * (1 - width[0] / scale);
      this.camera.far = dxyz * (1 + width[1] / scale);
    }
    this.camera.updateProjectionMatrix();
  }

  get window_size(): [number, number] {
    return this.win_size;
  }

  change_isolevel_by(map_idx: number, delta: number): void {
    const bag = this.map_bags[map_idx];
    if (!bag) return;
    bag.isolevel += delta;
    const abs_level = bag.map?.abs_level(bag.isolevel);
    if (abs_level != null) {
      this.hud('map ' + (map_idx + 1) + ' level =  ' +
               abs_level.toFixed(4) + ' ' +
               bag.map!.unit + ' (' + bag.isolevel.toFixed(2) + ' rmsd)');
    }
    this.redraw_maps(true);
    if (this.histogram_redraw && map_idx === 0) {
      this.histogram_redraw();
    }
  }

  change_map_radius(delta: number): void {
    const cf = this.config;
    const rmax = cf.max_map_radius;
    cf.map_radius = Math.min(Math.max(cf.map_radius + delta, 0), rmax);
    cf.map_radius = Math.round(cf.map_radius * 1e9) / 1e9;
    let info = 'map "radius": ' + cf.map_radius;
    if (cf.map_radius === rmax) info += ' (max)';
    else if (cf.map_radius === 0) info += ' (hidden maps)';
    if (this.map_bags.length === 0) info += '\nNB: no map is loaded.';
    this.hud(info);
    this.redraw_maps(true);
  }

  change_slab_width_by(delta: number): void {
    if (this.controls?.slab_width) {
      this.controls.slab_width[0] = Math.max(0.01, this.controls.slab_width[0] + delta);
      this.controls.slab_width[1] = Math.max(0.01, this.controls.slab_width[1] + delta);
      this.update_camera();
      const final_width = this.camera.far - this.camera.near;
      this.hud('clip width: ' + final_width.toPrecision(3));
      this.request_render();
    }
  }

  // Event handling (called by main app)
  keydown(event: KeyboardEvent): boolean {
    if (event.key === '?' || event.key.toLowerCase() === 'h') {
      event.preventDefault();
      this.toggle_help();
      return true;
    }
    return this.events.handle_keydown(event);
  }

  mousedown(event: MouseEvent, pick_fn: (x: number, y: number) => any): any {
    return this.events.handle_mousedown(event, pick_fn);
  }

  mousewheel_action(delta: number, event?: WheelEvent): void {
    const map_idx = event?.shiftKey ? 1 : 0;
    this.change_isolevel_by(map_idx, 0.0005 * delta);
  }

  wheel(event: WheelEvent): boolean {
    event.preventDefault();
    this.mousewheel_action(event.deltaY, event);
    this.request_render();
    return true;
  }

  contextmenu(event: Event): boolean {
    return this.events.handle_contextmenu(event);
  }

  // Resize handling
  resize(width?: number, height?: number) {
    if ((width == null || height == null) && this.container) {
      width = this.container.clientWidth;
      height = this.container.clientHeight;
    }
    if (width == null || height == null) return;
    this.win_size = [width, height];
    for (const bag of this.model_bags) {
      bag.win_size = [width, height];
    }
    if (this.camera) {
      this.camera.left = -width;
      this.camera.right = width;
      this.camera.top = height;
      this.camera.bottom = -height;
      this.update_camera();
    }
    if (this.renderer?.setSize) {
      this.renderer.setSize(width, height);
    }
    this.request_render();
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

  toggle_inactive_models(): boolean {
    const result = this.visibility.toggle_inactive_models(this.selected?.bag || undefined);
    this.redraw_all();
    return result;
  }

  toggle_map(index: number): boolean {
    const result = this.visibility.toggle_map(index);
    this.redraw_maps();
    return result;
  }

  remove_model(index: number): boolean {
    const bag = this.model_bags[index];
    if (bag) this.clear_model_objects(bag);
    const result = this.visibility.remove_model(index);
    if (result) {
      if (this.selected?.bag === bag) {
        const next_bag = this.model_bags[0] || null;
        this.selected = next_bag ? {bag: next_bag, atom: next_bag.model?.atoms[0] || null} : null;
      }
      this.navigation.set_models(this.model_bags);
      this.update_toolbar_menus();
      this.redraw_all();
    }
    return result;
  }

  remove_map(index: number): boolean {
    const bag = this.map_bags[index];
    if (bag) this.clear_el_objects(bag);
    const result = this.visibility.remove_map(index);
    if (result) {
      this.update_toolbar_menus();
      this.redraw_maps();
    }
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

  private trigger_help_action(spec: HelpActionSpec) {
    const key = this.help_action_key(spec);
    if (!key) return;
    const event = {
      key,
      shiftKey: spec.shiftKey === true,
      ctrlKey: spec.ctrlKey === true,
      metaKey: false,
      preventDefault() {},
      stopPropagation() {},
    } as KeyboardEvent;
    this.keydown(event);
  }

  private help_action_key(spec: HelpActionSpec): string | null {
    switch (spec.keyCode) {
      case 32: return ' ';
      case 35: return 'End';
      case 36: return 'Home';
      case 37: return 'ArrowLeft';
      case 38: return 'ArrowUp';
      case 39: return 'ArrowRight';
      case 40: return 'ArrowDown';
      case 65: return spec.shiftKey ? 'A' : 'a';
      case 66: return 'b';
      case 67: return 'c';
      case 68: return 'd';
      case 69: return 'e';
      case 70: return spec.shiftKey ? 'F' : 'f';
      case 71: return spec.ctrlKey ? 'g' : 'g';
      case 72: return 'h';
      case 73: return 'i';
      case 75: return 'k';
      case 76: return 'l';
      case 77: return spec.shiftKey ? 'M' : 'm';
      case 78: return 'n';
      case 80: return spec.shiftKey ? 'P' : 'p';
      case 81: return 'q';
      case 82: return spec.shiftKey ? 'R' : 'r';
      case 83: return spec.shiftKey ? 'S' : 's';
      case 84: return 't';
      case 85: return 'u';
      case 86: return spec.shiftKey ? 'V' : 'v';
      case 87: return 'w';
      case 88: return spec.shiftKey ? 'X' : 'x';
      case 89: return 'y';
      case 90: return spec.shiftKey ? 'Z' : 'z';
      case 187: return '+';
      case 188: return spec.shiftKey ? '<' : ',';
      case 189: return '-';
      case 190: return spec.shiftKey ? '>' : '.';
      case 219: return '[';
      case 220: return '\\';
      case 221: return ']';
      default: return null;
    }
  }

  private help_version_html(): string {
    const version = typeof VERSION === 'string' ? VERSION : 'dev';
    const describe = typeof GIT_DESCRIBE === 'string' ? ' (' + GIT_DESCRIBE + ')' : '';
    const gemmiDescribe = typeof GEMMI_GIT_DESCRIBE === 'string' ? GEMMI_GIT_DESCRIBE : 'unknown';
    return '&nbsp; <a href="https://gemmimol.github.io">GemmiMol</a> ' +
           version + describe +
           '<br>&nbsp; Gemmi ' + gemmiDescribe;
  }

  private pick_atom(coords: [number, number], camera: OrCameraType) {
    let pick: { bag: ModelBag; atom: any; distance: number } | null = null;
    for (const bag of this.model_bags) {
      if (!bag.visible) continue;
      const z = (camera.near + camera.far) / (camera.near - camera.far);
      const ray = new Ray();
      ray.origin.set(coords[0], coords[1], z).unproject(camera);
      ray.direction.set(0, 0, -1).transformDirection(camera.matrixWorld);
      const near = camera.near;
      const far = camera.far - 0.15 * (camera.far - camera.near);
      const precision2 = 0.35 * 0.35 * 0.02 * camera.zoom;
      const atoms = bag.atom_array || [];
      const vec = new Vector3();
      for (const atom of atoms) {
        vec.set(atom.xyz[0] - ray.origin.x,
                atom.xyz[1] - ray.origin.y,
                atom.xyz[2] - ray.origin.z);
        const distance = vec.dot(ray.direction);
        if (distance < 0 || distance < near || distance > far) continue;
        const diff2 = vec.addScaledVector(ray.direction, -distance).lengthSq();
        if (diff2 > precision2) continue;
        if (pick == null || distance < pick.distance) {
          pick = {bag, atom, distance};
        }
      }
    }
    return pick;
  }

  // Cleanup
  dispose() {
    if (Viewer.active_viewer === this) Viewer.active_viewer = null;
    this.model_bags = [];
    this.map_bags = [];
    this.selected = null;
    this.ui = null;
    this.visibility.set_bags([], []);
    this.navigation.set_models([]);
  }
}

// Static help properties
(Viewer as any).prototype.KEYBOARD_HELP = [
  '<b>keyboard:</b>',
  help_action_link('M = mainchain style', {keyCode: 77}),
  help_action_link('S = sidechain style', {keyCode: 83}),
  help_action_link('L = ligand style', {keyCode: 76}),
  help_action_link('T = water style', {keyCode: 84}),
  help_action_link('C = coloring', {keyCode: 67}),
  help_action_link('B = bg color', {keyCode: 66}),
  help_action_link('E = toggle fog', {keyCode: 69}),
  help_action_link('Q = label font', {keyCode: 81}),
  help_action_link('+ = sigma level up', {keyCode: 187}),
  help_action_link('- = sigma level down', {keyCode: 189}),
  help_action_link('] = larger map radius', {keyCode: 221}),
  help_action_link('[ = smaller map radius', {keyCode: 219}),
  help_action_link('D = narrower clip', {keyCode: 68}),
  help_action_link('F = wider clip', {keyCode: 70}),
  help_action_link('Shift+, = move clip', {keyCode: 188, shiftKey: true}),
  help_action_link('Shift+. = move clip', {keyCode: 190, shiftKey: true}),
  help_action_link('U = unitcell box', {keyCode: 85}),
  help_action_link('\\\\ = toggle symmetry', {keyCode: 220}),
  help_action_link('Y = hydrogens', {keyCode: 89}),
  help_action_link('V = inactive models', {keyCode: 86}),
  help_action_link('R = center view', {keyCode: 82}),
  help_action_link('I = spin', {keyCode: 73}),
  help_action_link('K = rock', {keyCode: 75}),
  help_action_link('W = density style', {keyCode: 87}),
  help_action_link('G = histogram', {keyCode: 71}),
  help_action_link('Home = thicker sticks', {keyCode: 36}),
  help_action_link('End = thinner sticks', {keyCode: 35}),
  help_action_link('P = nearest C\u03B1', {keyCode: 80}),
  help_action_link('Ctrl+G = go to CID', {keyCode: 71, ctrlKey: true}),
  'Delete menu = selected atom/residue/chain',
  help_action_link('Shift+P = permalink', {keyCode: 80, shiftKey: true}),
  help_action_link('Space = next residue', {keyCode: 32}),
  help_action_link('Shift+Space = previous residue', {keyCode: 32, shiftKey: true}),
  help_action_link('Shift+F = full screen', {keyCode: 70, shiftKey: true}),
].join('\n');
(Viewer as any).prototype.MOUSE_HELP = [
  '<b>mouse:</b>',
  'Left = rotate',
  'Middle click = select and center on atom',
  'Middle drag or Ctrl+Left = pan',
  'Right = zoom',
  'Ctrl+Right = clipping',
  'Ctrl+Shift+Right = roll',
  'Wheel = σ level',
  'Shift+Wheel = diff map σ',
].join('\n');

// Default export
export default Viewer;
