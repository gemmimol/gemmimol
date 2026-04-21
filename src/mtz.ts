import { ElMap } from './elmap';
import type { Viewer } from './viewer';
import type { GemmiModule, Mtz as WasmMtz, MtzMap as WasmMtzMap } from './gemmi';

export type ReflectionHistogram = {
  d_bounds: number[];     // length nbins+1, Å, low→high resolution
  observed: Uint32Array;  // length nbins
  missing: Uint32Array;   // length nbins
  label: string | null;   // column used for observed/missing split (null => all observed)
  map_d_min: number | null; // high-resolution cutoff for map calculation
};

const OBSERVED_LABEL_CANDIDATES = [
  'F_meas_au', 'F_meas', 'F_est', 'FP', 'F', 'FOBS',
  'I', 'IMEAN', 'IOBS', 'I-obs',
];
const MIN_MAP_COMPLETENESS = 0.5;

function log_timing(t0: number, text: string) {
  console.log(text + ': ' + (performance.now() - t0).toFixed(2) + ' ms.');
}

function make_histogram(mtz: WasmMtz, label: string | null,
                        nbins: number): ReflectionHistogram | null {
  const d_bounds: number[] = new Array(nbins + 1);
  const buf = mtz.resolution_histogram(label || '', nbins, d_bounds);
  if (!buf) return null;
  // wasm returns a typed_memory_view into wasm memory; slice to detach.
  const flat = new Uint32Array(buf).slice();
  return {
    d_bounds: d_bounds.slice(),
    observed: flat.slice(0, nbins),
    missing: flat.slice(nbins, 2 * nbins),
    label: label,
    map_d_min: null,
  };
}

function has_missing_reflections(hist: ReflectionHistogram): boolean {
  for (let i = 0; i < hist.missing.length; i++) {
    if (hist.missing[i] > 0) return true;
  }
  return false;
}

function map_resolution_limit(hist: ReflectionHistogram): number | null {
  if (!hist.label) return null;
  let last_good_bin = -1;
  for (let i = 0; i < hist.observed.length; i++) {
    const total = hist.observed[i] + hist.missing[i];
    if (total === 0) continue;
    if (hist.observed[i] / total < MIN_MAP_COMPLETENESS) {
      return last_good_bin >= 0 ? hist.d_bounds[last_good_bin + 1] : null;
    }
    last_good_bin = i;
  }
  return null;
}

function compute_histogram(mtz: WasmMtz, nbins: number): ReflectionHistogram | null {
  // resolution_histogram() currently treats unknown non-empty labels as
  // "all observed", so use only labels that expose actual missing values.
  for (const label of OBSERVED_LABEL_CANDIDATES) {
    try {
      const hist = make_histogram(mtz, label, nbins);
      if (hist && has_missing_reflections(hist)) {
        hist.map_d_min = map_resolution_limit(hist);
        return hist;
      }
    } catch { /* ignore */ }
  }
  return make_histogram(mtz, null, nbins);
}

function calculate_wasm_map(mtz: WasmMtz, is_diff: boolean,
                            d_min: number | null): WasmMtzMap | null {
  if (d_min != null && mtz.calculate_wasm_map_limited) {
    return mtz.calculate_wasm_map_limited(is_diff, d_min);
  }
  return mtz.calculate_wasm_map(is_diff);
}

function calculate_wasm_map_from_labels(mtz: WasmMtz, f_label: string, phi_label: string,
                                        d_min: number | null): WasmMtzMap | null {
  if (d_min != null && mtz.calculate_wasm_map_from_labels_limited) {
    return mtz.calculate_wasm_map_from_labels_limited(f_label, phi_label, d_min);
  }
  return mtz.calculate_wasm_map_from_labels(f_label, phi_label);
}

function add_map_from_mtz(gemmi: GemmiModule, viewer: Viewer,
                          mtz_map: WasmMtzMap, is_diff: boolean) {
  const map = new ElMap();
  map.gemmi_module = gemmi;
  map.wasm_map = mtz_map;
  const mc = mtz_map.cell;
  map.unit_cell = new gemmi.UnitCell(mc.a, mc.b, mc.c, mc.alpha, mc.beta, mc.gamma);
  map.stats.mean = mtz_map.mean;
  map.stats.rms = mtz_map.rms;
  viewer.add_map(map, is_diff);
}

export
function load_maps_from_mtz_buffer(gemmi: GemmiModule, viewer: Viewer, mtz: WasmMtz,
                                   labels?: string[]) {
  let map_d_min: number | null = null;
  try {
    const hist = compute_histogram(mtz, 25);
    if (hist) {
      viewer.reflection_histogram = hist;
      map_d_min = hist.map_d_min;
      if (map_d_min != null) {
        console.log('limiting map calculation to ' + map_d_min.toFixed(2) +
                    ' Å based on ' + hist.label + ' completeness');
      }
    }
  } catch (e) {
    console.warn('reflection histogram failed:', e);
  }
  if (labels != null) {
    for (let n = 0; n < labels.length; n += 2) {
      if (labels[n] === '') continue;
      const t0 = performance.now();
      const mtz_map = calculate_wasm_map_from_labels(mtz, labels[n], labels[n+1],
                                                     map_d_min);
      log_timing(t0, 'map ' + (mtz_map ? mtz_map.nx : mtz.nx) + 'x' +
                     (mtz_map ? mtz_map.ny : mtz.ny) + 'x' +
                     (mtz_map ? mtz_map.nz : mtz.nz) +
                     ' calculated in');
      if (mtz_map == null) {
        viewer.hud(mtz.last_error, 'ERR');
        continue;
      }
      const is_diff = (n % 4 == 2);
      add_map_from_mtz(gemmi, viewer, mtz_map, is_diff);
    }
  } else {  // use default labels
    for (let nmap = 0; nmap < 2; ++nmap) {
      const is_diff = (nmap == 1);
      const t0 = performance.now();
      const mtz_map = calculate_wasm_map(mtz, is_diff, map_d_min);
      log_timing(t0, 'map ' + (mtz_map ? mtz_map.nx : mtz.nx) + 'x' +
                     (mtz_map ? mtz_map.ny : mtz.ny) + 'x' +
                     (mtz_map ? mtz_map.nz : mtz.nz) +
                     ' calculated in');
      if (mtz_map != null) {
        add_map_from_mtz(gemmi, viewer, mtz_map, is_diff);
      } else {
        viewer.hud(mtz.last_error, 'ERR');
      }
    }
  }
  mtz.delete();
}

export
function load_maps_from_mtz(gemmi: GemmiModule, viewer: Viewer, url: string,
                            labels?: string[], callback?: () => void) {
  viewer.load_file(url, {binary: true, progress: true}, function (req) {
    const t0 = performance.now();
    try {
      const mtz = gemmi.readMtz(req.response);
      //console.log("[after readMTZ] wasm mem:", gemmi.HEAPU8.length / 1024, "kb");
      load_maps_from_mtz_buffer(gemmi, viewer, mtz, labels);
    } catch (e) {
      viewer.hud(e.message, 'ERR');
      return;
    }
    log_timing(t0, 'load_maps_from_mtz');
    //console.log("wasm mem:", gemmi.HEAPU8.length / 1024, "kb");
    if (callback) callback();
  });
}

export
function set_pdb_and_mtz_dropzone(gemmi: GemmiModule, viewer: Viewer,
                                  zone: HTMLElement) {
  viewer.set_dropzone(zone, function (file) {
    if (/\.mtz$/.test(file.name)) {
      const reader = new FileReader();
      return new Promise<void>(function (resolve, reject) {
        reader.onloadend = function (evt) {
          if (evt.target == null || evt.target.readyState !== 2) return;
          const t0 = performance.now();
          try {
            const mtz = gemmi.readMtz(evt.target.result as ArrayBuffer);
            load_maps_from_mtz_buffer(gemmi, viewer, mtz);
          } catch (e) {
            reject(e);
            return;
          }
          log_timing(t0, 'mtz -> maps');
          if (viewer.model_bags.length === 0 && viewer.map_bags.length <= 2) {
            viewer.recenter();
          }
          resolve();
        };
        reader.onerror = () => reject(reader.error || Error('Failed to read ' + file.name));
        reader.readAsArrayBuffer(file);
      });
    } else {
      return viewer.pick_pdb_and_map(file);
    }
  });
}
