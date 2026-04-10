import { INIT_HUD_TEXT, type HelpActionSpec } from './types';

export type ToolbarMenuId =
  'blobs' | 'metals' | 'ligands' | 'sites' | 'connections' | 'delete' | 'download';

export type ToolbarOption = {
  value: string,
  label: string,
};

export type ToolbarMenuState = {
  label: string,
  options: ToolbarOption[],
  visible?: boolean,
  disabled?: boolean,
};

export type ToolbarButtonState = {
  label: string,
  options?: ToolbarOption[],
  visible?: boolean,
  disabled?: boolean,
};

export class UIManager {
  container: HTMLElement;
  hud: HTMLElement | null;
  title_element: HTMLElement | null;
  help_panel: HTMLElement | null;
  help_button: HTMLButtonElement | null;
  toolbar: HTMLDivElement | null;
  mutate_wrapper: HTMLDivElement | null;
  mutate_button: HTMLButtonElement | null;
  mutate_list: HTMLDivElement | null;
  mutate_button_label: HTMLSpanElement | null;
  cid_dialog: HTMLDivElement | null;
  cid_input: HTMLInputElement | null;
  cid_action: ((cid: string) => void) | null;
  help_toggle: (() => void) | null;
  help_action: ((spec: HelpActionSpec) => void) | null;
  toolbar_action: ((menu: ToolbarMenuId, value: string) => void) | null;
  mutate_action: ((value: string) => void) | null;
  hud_select_action: ((info: string, key: string, options: string[], value: string) => void) | null;
  toolbar_selects: Partial<Record<ToolbarMenuId, HTMLSelectElement>>;
  structure_name_el: HTMLElement | null;
  mutate_open: boolean;
  is_help_visible: boolean;

  constructor(container: HTMLElement) {
    this.container = container;
    this.hud = null;
    this.title_element = null;
    this.help_panel = null;
    this.help_button = null;
    this.toolbar = null;
    this.mutate_wrapper = null;
    this.mutate_button = null;
    this.mutate_list = null;
    this.mutate_button_label = null;
    this.cid_dialog = null;
    this.cid_input = null;
    this.cid_action = null;
    this.help_toggle = null;
    this.help_action = null;
    this.toolbar_action = null;
    this.mutate_action = null;
    this.hud_select_action = null;
    this.toolbar_selects = {};
    this.structure_name_el = null;
    this.mutate_open = false;
    this.is_help_visible = false;
  }

  create_hud(): HTMLElement {
    const existing = document.getElementById('hud');
    const hud = existing || document.createElement('div');
    if (!existing) {
      hud.id = 'hud';
      hud.style.position = 'absolute';
      hud.style.top = '8px';
      hud.style.left = '50%';
      hud.style.transform = 'translateX(-50%)';
      hud.style.zIndex = '11';
      hud.style.maxWidth = 'min(80%, 960px)';
      hud.style.boxSizing = 'border-box';
      hud.style.padding = '2px 8px';
      hud.style.borderRadius = '5px';
      hud.style.background = 'rgba(0,0,0,0.6)';
      hud.style.color = '#ddd';
      hud.style.font = '15px sans-serif';
      hud.style.textAlign = 'center';
      hud.style.whiteSpace = 'pre-line';
      hud.style.pointerEvents = 'auto';
    }
    hud.textContent = INIT_HUD_TEXT;
    hud.addEventListener('click', (event) => {
      let el = event.target as HTMLElement | null;
      while (el && el !== hud) {
        const key = el.getAttribute('data-hud-select-key');
        if (key != null) {
          event.preventDefault();
          event.stopPropagation();
          const value = el.getAttribute('data-hud-select-value') || '';
          const info = el.getAttribute('data-hud-select-info') || key;
          const options = JSON.parse(el.getAttribute('data-hud-select-options') || '[]');
          this.hud_select_action?.(info, key, options, value);
          return;
        }
        el = el.parentElement;
      }
    });
    if (!existing) this.container.appendChild(hud);
    this.hud = hud;
    this.ensure_toolbar();
    this.ensure_help_button();
    return hud;
  }

  create_structure_name_badge() {
    if (typeof document === 'undefined') return;
    const el = document.createElement('header');
    el.style.display = 'none';
    el.style.fontSize = '18px';
    el.style.color = '#ddd';
    el.style.backgroundColor = 'rgba(0,0,0,0.6)';
    el.style.textAlign = 'right';
    el.style.alignSelf = 'stretch';
    el.style.padding = '3px 8px';
    el.style.borderRadius = '5px';
    el.style.letterSpacing = '0.08em';
    el.style.fontWeight = 'bold';
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'text';
    el.style.userSelect = 'text';
    el.style.webkitUserSelect = 'text';
    el.onmousedown = (evt) => evt.stopPropagation();
    const overlay = document.getElementById('gm-overlay');
    if (overlay) {
      overlay.insertBefore(el, overlay.firstChild);
    } else {
      this.container.appendChild(el);
    }
    this.structure_name_el = el;
  }

  set_structure_name(name?: string | null) {
    const el = this.structure_name_el;
    if (!el) return;
    const text = (name || '').trim();
    if (text !== '') {
      el.textContent = text.toUpperCase();
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }

  create_cid_dialog() {
    const dialog = document.createElement('div');
    dialog.style.display = 'none';
    dialog.style.alignSelf = 'center';
    dialog.style.padding = '8px 10px';
    dialog.style.borderRadius = '6px';
    dialog.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    dialog.style.color = '#ddd';
    dialog.style.boxShadow = '0 2px 12px rgba(0,0,0,0.35)';

    const label = document.createElement('div');
    label.textContent = 'Go to atom/residue (Gemmi CID)';
    label.style.fontSize = '13px';
    label.style.marginBottom = '6px';
    dialog.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. /*/A/15/CA';
    input.style.width = '220px';
    input.style.padding = '4px 6px';
    input.style.border = '1px solid #666';
    input.style.borderRadius = '4px';
    input.style.backgroundColor = '#111';
    input.style.color = '#eee';
    input.style.outline = 'none';
    input.addEventListener('keydown', (evt: KeyboardEvent) => {
      evt.stopPropagation();
      if (evt.key === 'Escape') {
        evt.preventDefault();
        this.close_cid_dialog();
      } else if (evt.key === 'Enter') {
        evt.preventDefault();
        const cid = input.value.trim();
        if (cid === '') {
          this.close_cid_dialog();
        } else {
          this.cid_action?.(cid);
          this.close_cid_dialog();
        }
      }
    });
    dialog.appendChild(input);

    const overlay = document.getElementById('gm-overlay');
    (overlay || this.container).appendChild(dialog);
    this.cid_dialog = dialog;
    this.cid_input = input;
  }

  open_cid_dialog() {
    if (this.cid_dialog == null || this.cid_input == null) return;
    this.cid_dialog.style.display = 'block';
    this.cid_input.focus();
    this.cid_input.select();
  }

  close_cid_dialog() {
    if (this.cid_dialog == null || this.cid_input == null) return;
    this.cid_dialog.style.display = 'none';
    this.cid_input.blur();
  }

  set_help_toggle(handler: () => void) {
    this.help_toggle = handler;
    this.ensure_help_button();
  }

  set_help_action(handler: (spec: HelpActionSpec) => void) {
    this.help_action = handler;
  }

  set_toolbar_action(handler: (menu: ToolbarMenuId, value: string) => void) {
    this.toolbar_action = handler;
    this.ensure_toolbar();
  }

  set_mutate_action(handler: (value: string) => void) {
    this.mutate_action = handler;
    this.ensure_toolbar();
  }

  update_toolbar(menus: Partial<Record<ToolbarMenuId, ToolbarMenuState>>) {
    this.ensure_toolbar();
    const ids: ToolbarMenuId[] = ['blobs', 'metals', 'ligands', 'sites', 'connections', 'delete', 'download'];
    for (const id of ids) {
      const select = this.toolbar_selects[id];
      const menu = menus[id];
      if (!select || !menu || menu.visible === false) {
        if (select) select.style.display = 'none';
        continue;
      }
      select.innerHTML = '';
      const header = document.createElement('option');
      header.textContent = menu.label;
      header.value = '';
      header.selected = true;
      select.appendChild(header);
      for (const option of menu.options) {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        select.appendChild(node);
      }
      select.disabled = menu.disabled === true || menu.options.length === 0;
      select.style.display = '';
      select.value = '';
    }
  }

  update_mutate_button(state: ToolbarButtonState | null) {
    this.ensure_toolbar();
    const wrapper = this.mutate_wrapper;
    const button = this.mutate_button;
    const list = this.mutate_list;
    if (!wrapper || !button || !list || state == null || state.visible === false) {
      if (wrapper) wrapper.style.display = 'none';
      this.set_mutate_menu_open(false);
      return;
    }
    if (this.mutate_button_label) {
      this.mutate_button_label.textContent = state.label;
    }
    list.innerHTML = '';
    for (const option of state.options || []) {
      const item = document.createElement('button');
      item.type = 'button';
      item.tabIndex = -1;
      item.dataset.target = option.value;
      item.textContent = option.label;
      item.style.display = 'block';
      item.style.width = '100%';
      item.style.padding = '3px 8px';
      item.style.border = '0';
      item.style.backgroundColor = 'transparent';
      item.style.color = '#d6e8ff';
      item.style.fontSize = '13px';
      item.style.textAlign = 'left';
      item.style.cursor = 'pointer';
      item.addEventListener('mousedown', (evt) => {
        evt.preventDefault();
      });
      item.addEventListener('click', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.set_mutate_menu_open(false);
        this.mutate_action?.(option.value);
      });
      list.appendChild(item);
    }
    button.disabled = state.disabled === true;
    wrapper.style.display = '';
    button.style.opacity = button.disabled ? '0.7' : '1';
    button.style.cursor = button.disabled ? 'default' : 'pointer';
    if (button.disabled || (state.options || []).length === 0) {
      this.set_mutate_menu_open(false);
    }
  }

  private ensure_toolbar() {
    if (this.toolbar) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'gm-toolbar';
    toolbar.style.position = 'absolute';
    toolbar.style.top = '8px';
    toolbar.style.left = '8px';
    toolbar.style.zIndex = '12';
    toolbar.style.display = 'flex';
    toolbar.style.flexWrap = 'wrap';
    toolbar.style.alignItems = 'center';
    toolbar.style.gap = '4px';
    toolbar.style.maxWidth = 'calc(100% - 120px)';
    const ids: ToolbarMenuId[] = ['blobs', 'metals', 'ligands', 'sites', 'connections'];
    for (const id of ids) {
      const select = this.create_toolbar_select(id);
      toolbar.appendChild(select);
      this.toolbar_selects[id] = select;
    }
    const row_break = document.createElement('div');
    row_break.style.flexBasis = '100%';
    row_break.style.height = '0';
    toolbar.appendChild(row_break);
    const delete_select = this.create_toolbar_select('delete');
    toolbar.appendChild(delete_select);
    this.toolbar_selects.delete = delete_select;
    const mutate_wrapper = this.create_mutate_button();
    toolbar.appendChild(mutate_wrapper);
    const download_select = this.create_toolbar_select('download');
    toolbar.appendChild(download_select);
    this.toolbar_selects.download = download_select;
    this.container.appendChild(toolbar);
    this.toolbar = toolbar;
  }

  private create_toolbar_select(id: ToolbarMenuId) {
    const select = document.createElement('select');
    const palette: Record<ToolbarMenuId, [string, string]> = {
      blobs: ['rgba(0, 36, 64, 0.9)', '#d6f0ff'],
      metals: ['rgba(52, 42, 0, 0.9)', '#f3e3a0'],
      ligands: ['rgba(0, 40, 20, 0.9)', '#d8f1d8'],
      sites: ['rgba(36, 16, 52, 0.9)', '#ead7ff'],
      connections: ['rgba(52, 24, 0, 0.9)', '#ffd8b8'],
      delete: ['rgba(64, 0, 0, 0.9)', '#f0d0d0'],
      download: ['rgba(24, 24, 24, 0.9)', '#e8e8e8'],
    };
    const [background, color] = palette[id];
    select.style.padding = '3px 6px';
    select.style.borderRadius = '4px';
    select.style.border = '1px solid rgba(255,255,255,0.24)';
    select.style.backgroundColor = background;
    select.style.color = color;
    select.style.fontSize = '13px';
    select.style.maxWidth = '220px';
    select.style.display = 'none';
    select.addEventListener('change', () => {
      if (select.value !== '') this.toolbar_action?.(id, select.value);
      select.value = '';
    });
    select.addEventListener('keydown', (evt) => {
      evt.stopPropagation();
    });
    return select;
  }

  private set_mutate_menu_open(open: boolean) {
    this.mutate_open = open;
    if (this.mutate_list) {
      this.mutate_list.style.display = this.mutate_open ? '' : 'none';
    }
    if (this.mutate_button) {
      this.mutate_button.setAttribute('aria-expanded', this.mutate_open ? 'true' : 'false');
    }
  }

  private create_mutate_button() {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'none';

    const button = document.createElement('button');
    button.type = 'button';
    button.style.padding = '3px 6px';
    button.style.borderRadius = '4px';
    button.style.border = '1px solid #666';
    button.style.backgroundColor = 'rgba(0, 28, 56, 0.9)';
    button.style.color = '#d6e8ff';
    button.style.fontSize = '13px';
    button.style.minWidth = '84px';
    button.style.textAlign = 'left';
    button.style.display = 'inline-flex';
    button.style.alignItems = 'center';
    button.style.gap = '6px';
    button.style.cursor = 'pointer';
    const label = document.createElement('span');
    label.textContent = 'Mutate';
    const marker = document.createElement('span');
    marker.setAttribute('aria-hidden', 'true');
    marker.style.display = 'inline-block';
    marker.style.width = '0';
    marker.style.height = '0';
    marker.style.borderLeft = '4px solid transparent';
    marker.style.borderRight = '4px solid transparent';
    marker.style.borderTop = '6px solid currentColor';
    const list = document.createElement('div');
    list.style.position = 'absolute';
    list.style.left = '0';
    list.style.top = 'calc(100% + 2px)';
    list.style.minWidth = '100%';
    list.style.maxHeight = '280px';
    list.style.overflowY = 'auto';
    list.style.borderRadius = '4px';
    list.style.border = '1px solid #666';
    list.style.backgroundColor = 'rgba(0, 28, 56, 0.96)';
    list.style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.35)';
    list.style.zIndex = '20';
    list.style.display = 'none';
    button.appendChild(label);
    button.appendChild(marker);
    wrapper.appendChild(button);
    wrapper.appendChild(list);
    this.mutate_wrapper = wrapper;
    this.mutate_button = button;
    this.mutate_list = list;
    this.mutate_button_label = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      this.set_mutate_menu_open(!this.mutate_open);
    });
    button.addEventListener('keydown', (evt) => {
      evt.stopPropagation();
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('mousedown', (evt) => {
        const target = evt.target as Node | null;
        if (target != null && wrapper.contains(target)) return;
        this.set_mutate_menu_open(false);
      });
    }
    return wrapper;
  }

  private ensure_help_button() {
    if (this.help_button) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Help';
    button.className = 'gm-help-button';
    button.style.position = 'absolute';
    button.style.top = '8px';
    button.style.right = '8px';
    button.style.zIndex = '12';
    button.style.padding = '4px 10px';
    button.style.border = '1px solid rgba(255,255,255,0.35)';
    button.style.borderRadius = '999px';
    button.style.background = 'rgba(0,0,0,0.7)';
    button.style.color = '#eee';
    button.style.font = '600 13px sans-serif';
    button.style.cursor = 'pointer';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.help_toggle?.();
    });
    this.container.appendChild(button);
    this.help_button = button;
  }

  update_hud(text: string) {
    if (this.hud) {
      this.hud.textContent = text;
    }
  }

  update_hud_html(html: string) {
    if (this.hud) {
      this.hud.innerHTML = html;
    }
  }

  set_title(text: string) {
    if (this.title_element) {
      this.title_element.textContent = text;
    }
  }

  show_help(keyboard_help: string, mouse_help: string, version_help?: string) {
    const help_html = this.get_help_content(keyboard_help, mouse_help, version_help);
    if (this.help_panel) {
      this.help_panel.innerHTML = help_html;
      this.help_panel.style.display = 'flex';
      this.is_help_visible = true;
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'gm-help-panel';
    panel.style.position = 'absolute';
    panel.style.inset = '0';
    panel.style.display = 'flex';
    panel.style.alignItems = 'center';
    panel.style.justifyContent = 'flex-start';
    panel.style.padding = '20px';
    panel.style.boxSizing = 'border-box';
    panel.style.background = 'rgba(0,0,0,0.45)';
    panel.style.zIndex = '20';
    panel.innerHTML = help_html;
    this.container.appendChild(panel);
    this.help_panel = panel;
    this.is_help_visible = true;

    // Close on click outside
    panel.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement | null)?.closest?.('.gm-help-action') as HTMLElement | null;
      if (action) {
        e.preventDefault();
        e.stopPropagation();
        const keyCode = Number(action.dataset.helpKeycode);
        if (Number.isFinite(keyCode)) {
          this.help_action?.({
            keyCode,
            shiftKey: action.dataset.helpShift === '1',
            ctrlKey: action.dataset.helpCtrl === '1',
          });
        }
        return;
      }
      if (e.target === panel) {
        this.hide_help();
      }
    });
  }

  hide_help() {
    if (this.help_panel) {
      this.help_panel.style.display = 'none';
    }
    this.is_help_visible = false;
  }

  toggle_help(keyboard_help: string, mouse_help: string, version_help?: string) {
    if (this.is_help_visible) {
      this.hide_help();
    } else {
      this.show_help(keyboard_help, mouse_help, version_help);
    }
  }

  private get_help_content(keyboard_help: string, mouse_help: string, version_help?: string): string {
    const version_block = version_help ? `<div style="margin-top: 0.8em">${version_help}</div>` : '';
    return `
      <div class="gm-help-content"
           style="max-width: 680px; background: rgba(12,12,12,0.96); color: #eee; border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 18px 20px; line-height: 1.5; box-shadow: 0 18px 48px rgba(0,0,0,0.4)">
        <div>${mouse_help.replace(/\n/g, '<br>')}</div>
        <div style="margin-top: 0.8em">${keyboard_help.replace(/\n/g, '<br>')}</div>
        ${version_block}
        <p style="margin: 0.8em 0 0 0"><em>Click background to close</em></p>
      </div>
    `;
  }

  // Dialog for residue mutation
  show_mutation_dialog(residue: string, chain: string, resno: number | string,
                       options: string[],
                       on_mutate: (new_res: string) => void) {
    const dialog = document.createElement('div');
    dialog.className = 'gm-dialog';
    dialog.style.position = 'absolute';
    dialog.style.inset = '0';
    dialog.style.display = 'flex';
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';
    dialog.style.padding = '20px';
    dialog.style.boxSizing = 'border-box';
    dialog.style.background = 'rgba(0,0,0,0.45)';
    dialog.style.zIndex = '24';

    let html = `<div style="max-width: 560px; background: rgba(12,12,12,0.97); color: #eee; border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 18px 20px; box-shadow: 0 18px 48px rgba(0,0,0,0.4)">`;
    html += `<h3 style="margin: 0 0 12px 0; font: 600 18px sans-serif">Mutate ${residue} ${chain}${resno}</h3>`;
    html += '<div class="gm-residue-grid">';
    for (const res of options) {
      html += `<button class="gm-residue-btn" data-res="${res}">${res}</button>`;
    }
    html += '</div>';
    html += '<div style="margin-top: 14px; display: flex; justify-content: flex-end">';
    html += '<button class="gm-cancel-btn">Cancel</button>';
    html += '</div>';
    html += '</div>';

    dialog.innerHTML = html;
    this.container.appendChild(dialog);

    const grid = dialog.querySelector('.gm-residue-grid') as HTMLElement | null;
    if (grid) {
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(64px, 1fr))';
      grid.style.gap = '8px';
    }

    // Event handlers
    dialog.querySelectorAll('.gm-residue-btn').forEach(btn => {
      const el = btn as HTMLButtonElement;
      el.style.padding = '7px 10px';
      el.style.border = '1px solid rgba(255,255,255,0.18)';
      el.style.borderRadius = '8px';
      el.style.background = 'rgba(18, 54, 18, 0.92)';
      el.style.color = '#d8f1d8';
      el.style.font = '600 13px sans-serif';
      el.style.cursor = 'pointer';
      btn.addEventListener('click', () => {
        const new_res = (btn as HTMLElement).dataset.res!;
        on_mutate(new_res);
        dialog.remove();
      });
    });

    const cancel = dialog.querySelector('.gm-cancel-btn') as HTMLButtonElement | null;
    if (cancel) {
      cancel.style.padding = '7px 12px';
      cancel.style.border = '1px solid rgba(255,255,255,0.18)';
      cancel.style.borderRadius = '8px';
      cancel.style.background = 'rgba(64, 0, 0, 0.9)';
      cancel.style.color = '#f0d0d0';
      cancel.style.font = '600 13px sans-serif';
      cancel.style.cursor = 'pointer';
      cancel.addEventListener('click', () => {
        dialog.remove();
      });
    }

    // Close on background click
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });
  }

  // Status/progress indicator
  show_progress(text: string): () => void {
    const indicator = document.createElement('div');
    indicator.className = 'gm-progress';
    indicator.textContent = text;
    this.container.appendChild(indicator);

    return () => {
      indicator.remove();
    };
  }

  // Toast notification
  show_toast(message: string, duration_ms = 2000) {
    const toast = document.createElement('div');
    toast.className = 'gm-toast';
    toast.textContent = message;
    this.container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, duration_ms);
  }
}
