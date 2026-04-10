import { Object3D, Vector3, Color, Scene } from '../three-r162/main';
import type { ModelBag, MapBag, Num2 } from './bags';
import type { ViewerConfig } from './types';
import { makeChickenWire, makeSmoothSurface, makeBalls, makeWheels,
         makeCube, makeRgbBox, Label, makeGrid } from '../draw';
import { map_style_method, map_style_is_surface } from './types';
import type { Atom } from '../model';

export class ModelRenderer {
  config: ViewerConfig;

  constructor(config: ViewerConfig) {
    this.config = config;
  }

  private add_rendered_atoms(target: Atom[], seen: Set<number>, atoms: Atom[]) {
    for (const atom of atoms) {
      if (!seen.has(atom.i_seq)) {
        seen.add(atom.i_seq);
        target.push(atom);
      }
    }
  }

  private is_atom_visible_in_current_style(atom: Atom, conf: ViewerConfig) {
    if (atom.is_water()) return conf.water_style !== 'invisible';
    if (atom.is_ligand) return true;
    return atom.is_backbone() || conf.sidechain_style !== 'invisible';
  }

  redraw_model(mb: ModelBag): void {
    mb.objects = [];
    mb.atom_array = [];

    if (!mb.visible || !mb.model) return;

    const mc_style = this.config.mainchain_style;
    const sc_style = this.config.sidechain_style;
    const lig_style = this.config.ligand_style;

    // Space-filling is a global style - all atoms as VdW spheres
    if (mc_style === 'space-filling' || mc_style === 'space-filling+AO') {
      const visible_atoms = mb.get_visible_atoms();
      const colors = mb.atom_colors(visible_atoms);
      // Note: makeSpaceFilling would need to be imported from draw.ts
      // For now, fall back to balls
      for (let i = 0; i < visible_atoms.length; i++) {
        const atom = visible_atoms[i];
        const ball = makeBalls([atom], [colors[i]], this.config.ball_size * 2);
        mb.objects.push(ball);
      }
      mb.atom_array = visible_atoms;
    } else {
      const rendered_atoms: Atom[] = [];
      const seen_atoms = new Set<number>();
      const finish_pass = () => {
        this.add_rendered_atoms(rendered_atoms, seen_atoms, mb.atom_array || []);
        mb.atom_array = [];
      };
      const partner_visible = (_atom: Atom, other: Atom) =>
        this.is_atom_visible_in_current_style(other, this.config);
      let ligand_balls: number | null = null;
      const ligand_sticks = (lig_style === 'sticks');
      if (lig_style === 'ball&stick') {
        ligand_balls = this.config.ball_size;
      }

      const mainchain_filter = (atom: Atom) => atom.is_backbone();
      const sidechain_filter = (atom: Atom) => !atom.is_backbone();
      const wheel_caps = (mc_style === 'lines' && sc_style === 'lines' && lig_style === 'lines');

      switch (mc_style) {
        case 'lines':
          mb.add_bonds(true, false, undefined, mainchain_filter, partner_visible, wheel_caps);
          break;
        case 'sticks':
          mb.add_sticks(true, false, this.config.stick_radius, mainchain_filter, partner_visible);
          break;
        case 'ball&stick':
          mb.add_bonds(true, false, this.config.ball_size, mainchain_filter, partner_visible);
          break;
        case 'backbone':
          mb.add_trace();
          break;
        case 'ribbon':
          mb.add_ribbon(8);
          break;
        case 'cartoon':
          mb.add_cartoon(8);
          break;
      }
      finish_pass();

      switch (sc_style) {
        case 'lines':
          mb.add_bonds(true, false, undefined, sidechain_filter, partner_visible, wheel_caps);
          break;
        case 'sticks':
          mb.add_sticks(true, false, this.config.stick_radius, sidechain_filter, partner_visible);
          break;
        case 'ball&stick':
          mb.add_bonds(true, false, this.config.ball_size, sidechain_filter, partner_visible);
          break;
        case 'invisible':
          break;
      }
      finish_pass();

      if (ligand_sticks) {
        mb.add_sticks(false, true, this.config.stick_radius);
      } else {
        mb.add_bonds(false, true, ligand_balls == null ? undefined : ligand_balls,
                     undefined, undefined, wheel_caps);
      }
      finish_pass();
      mb.atom_array = rendered_atoms;
    }

  }

  /**
   * Create a selection marker for an atom
   */
  create_selection_marker(atom: Atom, color: Color, size: number): Object3D {
    return makeWheels([atom], [color], size);
  }

  /**
   * Create a label for an atom
   */
  create_label(text: string, pos: Num3, font: string, color: string, 
               win_size: Num2, z_shift = 0.2): Label {
    return new Label(text, { pos, font, color, win_size, z_shift });
  }

  /**
   * Create the center marker cube
   */
  create_center_marker(size: number, center: Vector3, color: Color): Object3D {
    return makeCube(size, center, { color, linewidth: 2 });
  }

  /**
   * Create unit cell box
   */
  create_cell_box(uc_func: (arg: Num3) => Num3, color: Color): Object3D {
    return makeRgbBox(uc_func, color);
  }
}

export class MapRenderer {
  config: ViewerConfig;

  constructor(config: ViewerConfig) {
    this.config = config;
  }

  /**
   * Check if any map bags need reloading based on camera position.
   */
  check_and_reload(bags: MapBag[], camera_pos: Vector3, scene: Scene): void {
    for (const map_bag of bags) {
      if (!map_bag.visible) continue;

      const map_pos = map_bag.block_ctr;
      const radius = this.config.map_radius;
      const dist_sq = camera_pos.distanceToSquared(map_pos);

      if (dist_sq > radius / 100) {
        this.load_block(map_bag, camera_pos, scene);
      }
    }
  }

  /**
   * Load a new block of electron density map data centered at the given position.
   */
  load_block(map_bag: MapBag, center: Vector3, scene: Scene): void {
    // Remove old objects from scene
    for (const obj of map_bag.el_objects || []) {
      scene.remove(obj);
      if ((obj as any).geometry) (obj as any).geometry.dispose();
      if ((obj as any).material) {
        if (Array.isArray((obj as any).material)) {
          (obj as any).material.forEach((m: any) => m.dispose());
        } else {
          (obj as any).material.dispose();
        }
      }
    }
    map_bag.el_objects = [];

    const map = map_bag.map;
    if (!map) return;

    // Update block center
    map_bag.block_ctr.copy(center);

    // Get isosurface method from config
    const style = this.config.map_style || 'marching cubes';
    const method = map_style_method(style);
    const is_surface = map_style_is_surface(style);

    // Prepare the isosurface block
    try {
      const center_array: [number, number, number] = [center.x, center.y, center.z];
      map.prepare_isosurface(this.config.map_radius, center_array, is_surface);

      // Generate isosurfaces for each type (positive/negative for diff maps)
      for (const map_type of map_bag.types || ['map_den']) {
        const isolevel = map_type === 'map_neg' ? -(map_bag.isolevel || 1.5) : (map_bag.isolevel || 1.5);
        
        try {
          const iso_data = map.isomesh_in_block(isolevel, method);
          if (iso_data && iso_data.vertices.length > 0) {
            const color = this.get_map_color(map_type);
            const linewidth = this.config.map_line;

            let obj;
            if (is_surface) {
              obj = makeSmoothSurface(iso_data, {
                color: color,
                linewidth: linewidth,
                opacity: 0.24,
              });
            } else {
              obj = makeChickenWire(iso_data, {
                color: color,
                linewidth: linewidth,
              });
            }

            if (obj) {
              (obj as any).userData = { map_bag, map_type };
              map_bag.el_objects!.push(obj);
              scene.add(obj);
            }
          }
        } catch {
          // Silently skip failed isosurfaces
        }
      }
    } catch (e) {
      console.error('Failed to load map block:', e);
    }
  }

  /**
   * Force redraw of all maps (useful when isolevel or style changes).
   */
  redraw_all(bags: MapBag[]): void {
    for (const map_bag of bags) {
      if (!map_bag.visible) continue;
      // Reset block center to force reload
      map_bag.block_ctr.set(Infinity, 0, 0);
    }
  }

  /**
   * Change the isolevel for a map and trigger redraw.
   */
  change_isolevel(map_bag: MapBag, delta: number, scene: Scene, camera_pos: Vector3): number {
    const new_level = Math.round(((map_bag.isolevel || 1.5) + delta) * 10) / 10;
    map_bag.isolevel = new_level;
    // Force reload by resetting block center
    map_bag.block_ctr.set(Infinity, 0, 0);
    this.check_and_reload([map_bag], camera_pos, scene);
    return new_level;
  }

  /**
   * Get the color for a map type from the current color scheme.
   */
  private get_map_color(map_type: string): Color {
    const colors = this.config.colors;
    if (!colors) return new Color(0x808080);

    switch (map_type) {
      case 'map_pos': return colors.map_pos || new Color(0x298029);
      case 'map_neg': return colors.map_neg || new Color(0x8B2E2E);
      case 'map_den':
      default:
        return colors.map_den || new Color(0x3362B2);
    }
  }
}

// Type for Num3 tuple
type Num3 = [number, number, number];

/**
 * Utility class for managing scene decorations (grid, axes, etc.)
 */
export class DecorationManager {
  scene: Scene;
  grid: Object3D | null = null;
  cell_box: Object3D | null = null;
  center_marker: Object3D | null = null;
  selection_marker: Object3D | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Create or update the zoom grid
   */
  setup_grid(): Object3D {
    if (!this.grid) {
      this.grid = makeGrid();
      this.grid.visible = false;
      this.scene.add(this.grid);
    }
    return this.grid;
  }

  /**
   * Toggle grid visibility
   */
  toggle_grid(visible?: boolean): boolean {
    if (!this.grid) this.setup_grid();
    if (this.grid) {
      this.grid.visible = visible !== undefined ? visible : !this.grid.visible;
      return this.grid.visible;
    }
    return false;
  }

  /**
   * Show/hide cell box
   */
  set_cell_box(visible: boolean, uc_func?: (arg: Num3) => Num3, color?: Color) {
    if (this.cell_box) {
      this.scene.remove(this.cell_box);
      this.cell_box = null;
    }
    if (visible && uc_func && color) {
      this.cell_box = makeRgbBox(uc_func, color);
      this.scene.add(this.cell_box);
    }
  }

  /**
   * Update center marker position
   */
  update_center_marker(size: number, center: Vector3, color: Color) {
    if (this.center_marker) {
      this.scene.remove(this.center_marker);
    }
    this.center_marker = makeCube(size, center, { color, linewidth: 2 });
    this.scene.add(this.center_marker);
  }

  /**
   * Set selection marker
   */
  set_selection_marker(atom: Atom | null, color?: Color, size?: number) {
    if (this.selection_marker) {
      this.scene.remove(this.selection_marker);
      this.selection_marker = null;
    }
    if (atom && color && size) {
      this.selection_marker = makeWheels([atom], [color], size);
      this.scene.add(this.selection_marker);
    }
  }

  /**
   * Clear all decorations
   */
  clear() {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid = null;
    }
    if (this.cell_box) {
      this.scene.remove(this.cell_box);
      this.cell_box = null;
    }
    if (this.center_marker) {
      this.scene.remove(this.center_marker);
      this.center_marker = null;
    }
    if (this.selection_marker) {
      this.scene.remove(this.selection_marker);
      this.selection_marker = null;
    }
  }
}
