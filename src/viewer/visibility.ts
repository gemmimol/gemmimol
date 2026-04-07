import type { ModelBag, MapBag } from './bags';

export class VisibilityManager {
  model_bags: ModelBag[] = [];
  map_bags: MapBag[] = [];

  set_bags(model_bags: ModelBag[], map_bags: MapBag[]) {
    this.model_bags = model_bags;
    this.map_bags = map_bags;
  }

  show_all_models(visible = true) {
    for (const bag of this.model_bags) bag.visible = visible;
  }

  show_all_maps(visible = true) {
    for (const bag of this.map_bags) bag.visible = visible;
  }

  toggle_model(index: number): boolean {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.visible = !bag.visible;
    return bag.visible;
  }

  toggle_map(index: number): boolean {
    const bag = this.map_bags[index];
    if (!bag) return false;
    bag.visible = !bag.visible;
    return bag.visible;
  }

  remove_model(index: number): boolean {
    if (index < 0 || index >= this.model_bags.length) return false;
    this.model_bags.splice(index, 1);
    return true;
  }

  remove_map(index: number): boolean {
    if (index < 0 || index >= this.map_bags.length) return false;
    this.map_bags.splice(index, 1);
    return true;
  }

  get_visible_models(): ModelBag[] {
    return this.model_bags.filter(b => b.visible);
  }

  get_visible_maps(): MapBag[] {
    return this.map_bags.filter(b => b.visible);
  }

  set_hue_shift(index: number, shift: number): boolean {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.hue_shift = shift;
    return true;
  }

  set_color_override(index: number, fn: ((atom: any) => any) | null): boolean {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.color_override = fn;
    return true;
  }

  has_symmetry(): boolean {
    return this.model_bags.some(b => b.model?.unit_cell);
  }

  serialize(): object {
    return {
      models: this.model_bags.map(b => ({
        label: b.label,
        visible: b.visible,
        hue_shift: b.hue_shift,
      })),
      maps: this.map_bags.map(b => ({
        name: b.name || '',
        visible: b.visible,
        isolevel: b.isolevel || 1.5,
      })),
    };
  }

  // Toggle visibility of inactive models (show only active one)
  toggle_inactive_models(active_bag?: ModelBag): boolean {
    const visible_count = this.model_bags.filter(b => b.visible).length;
    const show_all = visible_count < this.model_bags.length;
    
    if (show_all) {
      this.show_all_models(true);
      return true;
    } else {
      // Hide all except active
      for (const bag of this.model_bags) {
        bag.visible = bag === active_bag;
      }
      return false;
    }
  }

  // Get the active (first visible or first) model bag
  get_active_bag(): ModelBag | null {
    return this.model_bags.find(b => b.visible) || this.model_bags[0] || null;
  }

  // Get editable bag (one with gemmi_selection that's not symmetry)
  get_editable_bag(): ModelBag | null {
    return this.model_bags.find(b => 
      b.symop === '' && b.gemmi_selection
    ) || null;
  }

  // Check if any model has gemmi data
  has_gemmi_models(): boolean {
    return this.model_bags.some(b => b.gemmi_selection);
  }
}
