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

  setup_default_handlers(viewer: { next_site(): any; prev_site(): any; get_center_for_site(site: any): number[] | null; }) {
    // Navigation
    this.on('n', () => {
      const site = viewer.next_site();
      if (site) {
        const center = viewer.get_center_for_site(site);
        if (center) this.callbacks.on_center?.(center);
      }
      return true;
    });

    this.on('p', () => {
      const site = viewer.prev_site();
      if (site) {
        const center = viewer.get_center_for_site(site);
        if (center) this.callbacks.on_center?.(center);
      }
      return true;
    });

    // Keys that just trigger redraw
    const redraw_keys = ['b', 'c', 'r', 'l', 'q', 'w', 'h', 'i', ' '];
    for (const key of redraw_keys) {
      this.on(key, () => {
        this.callbacks.on_redraw?.();
        return true;
      });
    }

    // Deletion
    this.on('d', () => {
      this.callbacks.on_update_hud?.('Delete: select atoms first');
      return true;
    });

    // Undo/Redo
    this.on_ctrl('z', () => {
      this.callbacks.on_update_hud?.('Undo not implemented');
      return true;
    });

    this.on_ctrl('y', () => {
      this.callbacks.on_update_hud?.('Redo not implemented');
      return true;
    });
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
