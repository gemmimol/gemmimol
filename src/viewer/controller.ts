import type { ModelBag, MapBag } from './bags';

/**
 * ModelController - handles high-level coordination between models and UI
 * Acts as a mediator for operations affecting multiple bags
 */
export class ModelController {
  model_bags: ModelBag[];
  map_bags: MapBag[];
  on_change: (() => void) | null;

  constructor() {
    this.model_bags = [];
    this.map_bags = [];
    this.on_change = null;
  }

  set_bags(model_bags: ModelBag[], map_bags: MapBag[]) {
    this.model_bags = model_bags;
    this.map_bags = map_bags;
  }

  // Hide/show all models
  show_all_models(visible: boolean = true) {
    for (const bag of this.model_bags) {
      bag.visible = visible;
    }
    this.notify_change();
  }

  // Hide/show all maps
  show_all_maps(visible: boolean = true) {
    for (const bag of this.map_bags) {
      bag.visible = visible;
    }
    this.notify_change();
  }

  // Toggle visibility of specific model
  toggle_model(index: number): boolean {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.visible = !bag.visible;
    this.notify_change();
    return bag.visible;
  }

  // Toggle visibility of specific map
  toggle_map(index: number): boolean {
    const bag = this.map_bags[index];
    if (!bag) return false;
    bag.visible = !bag.visible;
    this.notify_change();
    return bag.visible;
  }

  // Remove a model
  remove_model(index: number): boolean {
    if (index < 0 || index >= this.model_bags.length) return false;
    this.model_bags.splice(index, 1);
    this.notify_change();
    return true;
  }

  // Remove a map
  remove_map(index: number): boolean {
    if (index < 0 || index >= this.map_bags.length) return false;
    this.map_bags.splice(index, 1);
    this.notify_change();
    return true;
  }

  // Get visible models only
  get_visible_models(): ModelBag[] {
    return this.model_bags.filter(b => b.visible);
  }

  // Get visible maps only
  get_visible_maps(): MapBag[] {
    return this.map_bags.filter(b => b.visible);
  }

  // Check if any models have symmetry info
  has_symmetry(): boolean {
    return this.model_bags.some(b => b.model && (b.model as any).cell);
  }

  // Update hue shift for a model (for distinguishing multiple models)
  set_hue_shift(index: number, shift: number): boolean {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.hue_shift = shift;
    this.notify_change();
    return true;
  }

  // Apply color override function to a model
  set_color_override(index: number, fn: ((atom: any) => any) | null): boolean {
    const bag = this.model_bags[index];
    if (!bag) return false;
    bag.color_override = fn;
    this.notify_change();
    return true;
  }

  private notify_change() {
    if (this.on_change) {
      this.on_change();
    }
  }

  // Serialization - prepare state for saving
  serialize(): object {
    return {
      models: this.model_bags.map(b => ({
        label: b.label,
        visible: b.visible,
        hue_shift: b.hue_shift,
      })),
      maps: this.map_bags.map(b => ({
        name: b.name,
        visible: b.visible,
        isolevel: b.isolevel,
      })),
    };
  }
}
