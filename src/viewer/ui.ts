import { INIT_HUD_TEXT } from './types';

export class UIManager {
  container: HTMLElement;
  hud: HTMLElement | null;
  title_element: HTMLElement | null;
  help_panel: HTMLElement | null;
  is_help_visible: boolean;

  constructor(container: HTMLElement) {
    this.container = container;
    this.hud = null;
    this.title_element = null;
    this.help_panel = null;
    this.is_help_visible = false;
  }

  create_hud(): HTMLElement {
    const hud = document.createElement('div');
    hud.className = 'gm-hud';
    hud.textContent = INIT_HUD_TEXT;
    this.container.appendChild(hud);
    this.hud = hud;
    return hud;
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

  show_help() {
    if (this.help_panel) {
      this.help_panel.style.display = 'block';
      this.is_help_visible = true;
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'gm-help-panel';
    panel.innerHTML = this.get_help_content();
    this.container.appendChild(panel);
    this.help_panel = panel;
    this.is_help_visible = true;

    // Close on click outside
    panel.addEventListener('click', (e) => {
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

  toggle_help() {
    if (this.is_help_visible) {
      this.hide_help();
    } else {
      this.show_help();
    }
  }

  private get_help_content(): string {
    return `
      <div class="gm-help-content">
        <h3>Keyboard Shortcuts</h3>
        <table>
          <tr><td><kbd>n</kbd></td><td>Next ligand/site</td></tr>
          <tr><td><kbd>p</kbd></td><td>Previous ligand/site</td></tr>
          <tr><td><kbd>b</kbd></td><td>Ball & stick</td></tr>
          <tr><td><kbd>c</kbd></td><td>Cartoon</td></tr>
          <tr><td><kbd>r</kbd></td><td>Ribbon</td></tr>
          <tr><td><kbd>l</kbd></td><td>Lines</td></tr>
          <tr><td><kbd>q</kbd></td><td>Toggle ligands</td></tr>
          <tr><td><kbd>w</kbd></td><td>Toggle waters</td></tr>
          <tr><td><kbd>h</kbd></td><td>Toggle hydrogens</td></tr>
          <tr><td><kbd>i</kbd></td><td>Toggle ice (symmetry)</td></tr>
          <tr><td><kbd>Space</kbd></td><td>Cycle colors</td></tr>
          <tr><td><kbd>d</kbd></td><td>Delete selected</td></tr>
          <tr><td><kbd>x</kbd></td><td>Toggle label</td></tr>
          <tr><td><kbd>?</kbd></td><td>Toggle this help</td></tr>
          <tr><td><kbd>Ctrl+Z</kbd></td><td>Undo</td></tr>
          <tr><td><kbd>Ctrl+Y</kbd></td><td>Redo</td></tr>
        </table>
        <p><em>Click background to close</em></p>
      </div>
    `;
  }

  // Dialog for residue mutation
  show_mutation_dialog(residue: string, chain: string, resno: number,
                       on_mutate: (new_res: string) => void) {
    const dialog = document.createElement('div');
    dialog.className = 'gm-dialog';

    const common_residues = ['ALA', 'CYS', 'ASP', 'GLU', 'PHE', 'GLY', 'HIS',
                             'ILE', 'LYS', 'LEU', 'MET', 'ASN', 'PRO', 'GLN',
                             'ARG', 'SER', 'THR', 'VAL', 'TRP', 'TYR'];

    let html = `<h3>Mutate ${residue} ${chain}${resno}</h3>`;
    html += '<div class="gm-residue-grid">';
    for (const res of common_residues) {
      html += `<button class="gm-residue-btn" data-res="${res}">${res}</button>`;
    }
    html += '</div>';
    html += '<button class="gm-cancel-btn">Cancel</button>';

    dialog.innerHTML = html;
    this.container.appendChild(dialog);

    // Event handlers
    dialog.querySelectorAll('.gm-residue-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const new_res = (btn as HTMLElement).dataset.res!;
        on_mutate(new_res);
        dialog.remove();
      });
    });

    dialog.querySelector('.gm-cancel-btn')?.addEventListener('click', () => {
      dialog.remove();
    });

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
