import type { Navigator } from './navigation';

export type KeyHandler = (event: KeyboardEvent) => boolean;

export class EventManager {
  key_handlers: Map<string, KeyHandler>;
  shift_key_handlers: Map<string, KeyHandler>;
  ctrl_key_handlers: Map<string, KeyHandler>;
  on_redraw: (() => void) | null;
  on_center: ((pos: number[]) => void) | null;
  on_update_hud: ((text: string) => void) | null;

  constructor() {
    this.key_handlers = new Map();
    this.shift_key_handlers = new Map();
    this.ctrl_key_handlers = new Map();
    this.on_redraw = null;
    this.on_center = null;
    this.on_update_hud = null;
  }

  setup_default_handlers(navigator: Navigator) {
    // Navigation
    this.key_handlers.set('n', () => {
      const site = navigator.next_site();
      if (site && this.on_center) {
        const center = navigator.get_center_for_site(site);
        if (center) this.on_center(center);
      }
      return true;
    });

    this.key_handlers.set('p', () => {
      const site = navigator.prev_site();
      if (site && this.on_center) {
        const center = navigator.get_center_for_site(site);
        if (center) this.on_center(center);
      }
      return true;
    });

    // Deletion
    this.key_handlers.set('d', () => {
      // Would delete selected atoms - needs selection state
      if (this.on_update_hud) {
        this.on_update_hud('Delete: select atoms first');
      }
      return true;
    });

    this.key_handlers.set('x', () => {
      // Toggle label on clicked atom - needs pick handling
      return true;
    });

    // View toggles
    this.key_handlers.set('b', () => {
      // Toggle ball & stick
      if (this.on_redraw) this.on_redraw();
      return true;
    });

    this.key_handlers.set('c', () => {
      // Toggle cartoon
      if (this.on_redraw) this.on_redraw();
      return true;
    });

    this.key_handlers.set('r', () => {
      // Toggle ribbon
      if (this.on_redraw) this.on_redraw();
      return true;
    });

    this.key_handlers.set('l', () => {
      // Toggle lines
      if (this.on_redraw) this.on_redraw();
      return true;
    });

    this.key_handlers.set('q', () => {
      // Toggle ligands
      if (this.on_redraw) this.on_redraw();
      return true;
    });

    this.key_handlers.set('w', () => {
      // Toggle waters
      if (this.on_redraw) this.on_redraw();
      return true;
    });

    this.key_handlers.set('h', () => {
      // Toggle hydrogens
      if (this.on_redraw) this.on_redraw();
      return true;
    });

    this.key_handlers.set('i', () => {
      // Toggle ice (crystal contacts / symmetry mates)
      if (this.on_redraw) this.on_redraw();
      return true;
    });

    // Color cycling
    this.key_handlers.set(' ', () => {
      // Cycle color scheme
      if (this.on_redraw) this.on_redraw();
      return true;
    });

    // Shift+key handlers
    this.shift_key_handlers.set('D', () => {
      // Delete with confirmation
      return true;
    });

    // Ctrl+key handlers
    this.ctrl_key_handlers.set('z', () => {
      // Undo
      if (this.on_update_hud) {
        this.on_update_hud('Undo not implemented');
      }
      return true;
    });

    this.ctrl_key_handlers.set('y', () => {
      // Redo
      if (this.on_update_hud) {
        this.on_update_hud('Redo not implemented');
      }
      return true;
    });
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

    const picked = pick_fn(x, y);
    return picked;
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
