import { Group } from '../three-r162/main';
import type { ModelBag, MapBag } from './bags';
import type { ViewerConfig } from './types';

export class ModelRenderer {
  config: ViewerConfig;

  constructor(config: ViewerConfig) {
    this.config = config;
  }

  redraw_model(mb: ModelBag): Group {
    const group = new Group();
    mb.objects = [];
    mb.atom_array = [];

    if (!mb.visible) return group;

    const mc_style = this.config.mainchain_style;
    const sc_style = this.config.sidechain_style;
    const lig_style = this.config.ligand_style;
    void this.config.water_style;  // TODO: use for water rendering

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

  select_next(current: string, options: string[]): string {
    const idx = options.indexOf(current);
    return options[(idx + 1) % options.length];
  }
}

export class MapRenderer {
  config: ViewerConfig;

  constructor(config: ViewerConfig) {
    this.config = config;
  }

  check_and_reload(bags: MapBag[], camera_pos: any, scene: any): void {
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

  load_block(map_bag: MapBag, center: any, scene: any): void {
    // Remove old objects
    for (const obj of map_bag.el_objects) {
      scene.remove(obj);
    }
    map_bag.el_objects = [];

    // This is a simplified placeholder - actual implementation would use
    // Gemmi WASM to extract density and create isosurface meshes
    map_bag.block_ctr.copy(center);
  }
}
