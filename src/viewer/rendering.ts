import { Object3D, Vector3, Color } from '../three-r162/main';
import type { ModelBag, MapBag } from './bags';
import type { ViewerConfig } from './types';
import { makeChickenWire, makeSmoothSurface } from '../draw';
import { map_style_method, map_style_is_surface } from './types';

export class ModelRenderer {
  config: ViewerConfig;

  constructor(config: ViewerConfig) {
    this.config = config;
  }

  redraw_model(mb: ModelBag): Object3D {
    const group = new Object3D();
    mb.objects = [];
    mb.atom_array = [];

    if (!mb.visible) return group;

    const mc_style = this.config.mainchain_style;
    const sc_style = this.config.sidechain_style;
    const lig_style = this.config.ligand_style;

    // Main chain visualization
    if (mc_style === 'trace') {
      mb.add_trace();
    } else if (mc_style === 'ribbon') {
      mb.add_ribbon(5);
    } else if (mc_style === 'cartoon') {
      mb.add_cartoon(5);
    }

    // Side chains, ligands, and waters
    const has_bonds = ['lines', 'balls', 'ball&stick', 'sticks'].includes(sc_style) ||
                      ['lines', 'balls', 'ball&stick', 'sticks'].includes(lig_style);

    if (has_bonds || mc_style === 'lines') {
      const ball_size = sc_style === 'balls' ? this.config.ball_size :
                        sc_style === 'ball&stick' ? this.config.ball_size : undefined;
      const show_mc = mc_style === 'lines';
      const show_lig = ['lines', 'balls', 'ball&stick'].includes(lig_style);

      if (sc_style === 'sticks') {
        mb.add_sticks(show_mc, show_lig, this.config.stick_radius);
      } else {
        mb.add_bonds(show_mc, show_lig, ball_size);
      }
    }

    for (const obj of mb.objects) {
      group.add(obj);
    }

    return group;
  }
}

export class MapRenderer {
  config: ViewerConfig;

  constructor(config: ViewerConfig) {
    this.config = config;
  }

  /**
   * Check if any map bags need reloading based on camera position.
   * Reloads the map block if the camera has moved beyond the current block radius.
   */
  check_and_reload(bags: MapBag[], camera_pos: Vector3, scene: any): void {
    for (const map_bag of bags) {
      if (!map_bag.visible) continue;

      const map_pos = map_bag.block_ctr;
      const radius = this.config.map_radius;
      const dist_sq = camera_pos.distanceToSquared(map_pos);
      const radius_sq = radius * radius;

      if (dist_sq > radius_sq) {
        this.load_block(map_bag, camera_pos, scene);
      }
    }
  }

  /**
   * Load a new block of electron density map data centered at the given position.
   * This extracts the density block from the map, calculates the isosurface,
   * and creates the appropriate Three.js objects (chickenwire or smooth surface).
   */
  load_block(map_bag: MapBag, center: Vector3, scene: any): void {
    // Remove old objects from scene
    for (const obj of map_bag.el_objects) {
      scene.remove(obj);
      // Dispose geometry and materials to prevent memory leaks
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m: any) => m.dispose());
        } else {
          obj.material.dispose();
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
      map.prepare_isosurface(this.config.map_radius, center_array, true);

      // Generate isosurfaces for each type (positive/negative for diff maps)
      for (const map_type of map_bag.types) {
        const isolevel = map_type === 'map_neg' ? -map_bag.isolevel : map_bag.isolevel;
        
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
              obj.userData = { map_bag, map_type };
              map_bag.el_objects.push(obj);
              scene.add(obj);
            }
          }
        } catch {
          // Silently skip failed isosurfaces (e.g., negative levels on non-diff maps)
          // console.warn('Isosurface generation failed:', e);
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

  /**
   * Change the isolevel for a map and trigger redraw.
   */
  change_isolevel(map_bag: MapBag, delta: number, scene: any, camera_pos: Vector3): void {
    map_bag.isolevel = Math.round((map_bag.isolevel + delta) * 10) / 10;
    // Force reload by resetting block center
    map_bag.block_ctr.set(Infinity, 0, 0);
    this.check_and_reload([map_bag], camera_pos, scene);
  }
}
