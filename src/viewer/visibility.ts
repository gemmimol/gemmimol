import type { ModelBag, MapBag } from './bags';

export class VisibilityManager {
  model_bags: ModelBag[];
  map_bags: MapBag[];

  constructor() {
    this.model_bags = [];
    this.map_bags = [];
  }

  set_bags(model_bags: ModelBag[], map_bags: MapBag[]) {
    this.model_bags = model_bags;
    this.map_bags = map_bags;
  }

  show_all_models(visible: boolean = true) {
    for (const bag of this.model_bags) bag.visible = visible;
  }

  show_all_maps(visible: boolean = true) {
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
    return this.model_bags.some(b => b.model && (b.model as any).cell);
  }

  serialize(): object {
    return {
      models: this.model_bags.map(b => ({
        label: b.label,
        visible: b.visible,
        hue_shift: b.hue_shift,
      })),
      maps: this.map_bags.map(b => ({
        name: (b as any).name || '',
        visible: b.visible,
        isolevel: (b as any).isolevel || 1.5,
      })),
    };
  }
}
