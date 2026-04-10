import { ElMap } from './elmap';
import type { Viewer } from './viewer/index';
import type { GemmiModule, Mtz as WasmMtz, MtzMap as WasmMtzMap } from './gemmi';

function log_timing(t0: number, text: string) {
  console.log(text + ': ' + (performance.now() - t0).toFixed(2) + ' ms.');
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
  if (labels != null) {
    for (let n = 0; n < labels.length; n += 2) {
      if (labels[n] === '') continue;
      const t0 = performance.now();
      const mtz_map = mtz.calculate_wasm_map_from_labels(labels[n], labels[n+1]);
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
      const mtz_map = mtz.calculate_wasm_map(is_diff);
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
      return viewer.load_structure_file(file, gemmi).then(function () {
        viewer.recenter();
      });
    }
  });
}
