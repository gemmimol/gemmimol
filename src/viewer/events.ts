export type KeyHandler = (event: KeyboardEvent) => boolean;

export class EventManager {
  key_handlers: Map<string, KeyHandler>;
  shift_key_handlers: Map<string, KeyHandler>;
  ctrl_key_handlers: Map<string, KeyHandler>;
  
  // Unified callback interface
  callbacks: {
    on_redraw?: () => void;
    on_center?: (pos: number[]) => void;
    on_update_hud?: (text: string) => void;
  };

  constructor() {
    this.key_handlers = new Map();
    this.shift_key_handlers = new Map();
    this.ctrl_key_handlers = new Map();
    this.callbacks = {};
  }

  setup_default_handlers(viewer: any) {
    this.on('b', () => { viewer.cycle_color_scheme?.(); return true; });
    this.on('c', () => { viewer.cycle_color_prop?.(); return true; });
    this.on('d', () => { viewer.change_slab_width_by?.(-0.1); return true; });
    this.on('e', () => { viewer.toggle_fog?.(); return true; });
    this.on('f', () => { viewer.change_slab_width_by?.(0.1); return true; });
    this.on('g', () => { viewer.toggle_histogram?.(); return true; });
    this.on('h', () => { viewer.toggle_help?.(); return true; });
    this.on('i', (evt: KeyboardEvent) => {
      viewer.hud?.('toggled spinning');
      viewer.controls?.toggle_auto?.(evt.shiftKey);
      viewer.request_render?.();
      return true;
    });
    this.on('k', () => {
      viewer.hud?.('toggled rocking');
      viewer.controls?.toggle_auto?.(0.0);
      viewer.request_render?.();
      return true;
    });
    this.on('l', () => { viewer.cycle_ligand_style?.(); return true; });
    this.on('m', () => { viewer.cycle_mainchain_style?.(); return true; });
    this.on('p', () => { viewer.go_to_nearest_Ca?.(); return true; });
    this.on('q', () => { viewer.cycle_label_font?.(); return true; });
    this.on('r', () => {
      viewer.hud?.('recentered');
      viewer.recenter?.();
      return true;
    });
    this.on('s', () => { viewer.cycle_sidechain_style?.(); return true; });
    this.on('t', () => { viewer.cycle_water_style?.(); return true; });
    this.on('u', () => {
      viewer.hud?.('toggled unit cell box');
      viewer.toggle_cell_box?.();
      return true;
    });
    this.on('v', () => { viewer.toggle_inactive_models?.(); return true; });
    this.on('w', () => { viewer.cycle_map_style?.(); return true; });
    this.on('y', () => { viewer.toggle_hydrogens?.(); return true; });
    this.on('[', () => { viewer.change_map_radius?.(-2); return true; });
    this.on(']', () => { viewer.change_map_radius?.(2); return true; });
    this.on('+', (evt: KeyboardEvent) => { viewer.change_isolevel_by?.(evt.shiftKey ? 1 : 0, 0.1); return true; });
    this.on('=', (evt: KeyboardEvent) => { viewer.change_isolevel_by?.(evt.shiftKey ? 1 : 0, 0.1); return true; });
    this.on('-', (evt: KeyboardEvent) => { viewer.change_isolevel_by?.(evt.shiftKey ? 1 : 0, -0.1); return true; });
    this.on('\\', () => { viewer.toggle_symmetry?.(); return true; });
    this.on(' ', (evt: KeyboardEvent) => { viewer.center_next_residue?.(evt.shiftKey); return true; });
    this.on('home', (evt: KeyboardEvent) => {
      if (evt.shiftKey) viewer.change_map_line?.(0.1);
      else viewer.change_stick_radius?.(0.01);
      return true;
    });
    this.on('end', (evt: KeyboardEvent) => {
      if (evt.shiftKey) viewer.change_map_line?.(-0.1);
      else viewer.change_stick_radius?.(-0.01);
      return true;
    });

    this.on_shift('F', () => { viewer.toggle_full_screen?.(); return true; });
    this.on_shift('P', () => { viewer.permalink?.(); return true; });
    this.on_shift('R', () => {
      viewer.hud?.('redraw!');
      viewer.redraw_all?.();
      return true;
    });
    this.on_shift('<', () => { viewer.shift_clip?.(1); return true; });
    this.on_shift('>', () => { viewer.shift_clip?.(-1); return true; });

    this.on_ctrl('g', () => { viewer.open_cid_dialog?.(); return true; });
  }

  // Helper to register handlers
  on(key: string, handler: KeyHandler) {
    this.key_handlers.set(key, handler);
  }

  on_shift(key: string, handler: KeyHandler) {
    this.shift_key_handlers.set(key, handler);
  }

  on_ctrl(key: string, handler: KeyHandler) {
    this.ctrl_key_handlers.set(key, handler);
  }

  handle_keydown(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();

    if (event.ctrlKey || event.metaKey) {
      const handler = this.ctrl_key_handlers.get(key);
      if (handler) {
        event.preventDefault();
        return handler(event);
      }
      return false;
    }

    if (event.shiftKey) {
      const handler = this.shift_key_handlers.get(event.key);
      if (handler) {
        event.preventDefault();
        return handler(event);
      }
    }

    const handler = this.key_handlers.get(key);
    if (handler) {
      event.preventDefault();
      return handler(event);
    }

    return false;
  }

  // Mouse event handling
  handle_mousedown(event: MouseEvent, pick_fn: (x: number, y: number) => any): any {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return pick_fn(x, y);
  }

  handle_wheel(event: WheelEvent, zoom_fn: (delta: number) => void): boolean {
    event.preventDefault();
    zoom_fn(event.deltaY);
    return true;
  }

  handle_contextmenu(event: Event): boolean {
    event.preventDefault();
    return true;
  }
}
