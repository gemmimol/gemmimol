'use strict';
// Node.js only

const Buffer = require('buffer').Buffer;
const fs = require('fs');
const pathModule = require('path');
const Benchmark = require('benchmark');
const GM = require('../gemmimol');

let gemmi_promise;
const DATA_DIR = pathModule.join(__dirname, '..', 'data');
const DATA_BASE_URL = 'https://gemmimol.github.io/data/';
const DATA_FILES = ['1mru.pdb', '1mru.map', '1mru_diff.map', '1mru_m0.map',
                    '1mru.omap', '1mru_diff.omap', 'pdb2mru.ent', '1yk4.pdb'];

function data_path(filename) {
  if (filename.charAt(0) === '/') return filename;
  const path = pathModule.join(DATA_DIR, filename);
  try {
    fs.statSync(path);
  } catch {
    throw new Error('Missing data file "' + filename +
                    '". Run "npm run download-data" to fetch test fixtures.');
  }
  return path;
}

async function download_file(filename) {
  const path = data_path_or_target(filename);
  try {
    fs.statSync(path);
    return;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  console.log('downloading ' + filename);
  const response = await fetch(DATA_BASE_URL + filename);
  if (!response.ok) {
    throw new Error('Failed to download ' + filename + ': ' +
                    response.status + ' ' + response.statusText);
  }
  const tmp = path + '.tmp';
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(tmp, buffer);
  await fs.promises.rename(tmp, path);
}

function data_path_or_target(filename) {
  return pathModule.join(DATA_DIR, filename);
}

exports.open_as_utf8 = function (filename) {
  const path = data_path(filename);
  return fs.readFileSync(path, {encoding: 'utf8'});
};

exports.open_as_array_buffer = function (filename) {
  const path = data_path(filename);
  const buffer = fs.readFileSync(path);
  // http://stackoverflow.com/a/12101012/104453
  const ab = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buffer.length; ++i) {
    view[i] = buffer[i];
  }
  return ab;
};

exports.load_gemmi = function () {
  if (!gemmi_promise) {
    gemmi_promise = require('../vendor/wasm/gemmi.js')();
  }
  return gemmi_promise;
};

exports.load_models_from_gemmi = function (filename, getMonomerCifs) {
  return exports.load_gemmi().then(function (gemmi) {
    return GM.modelsFromGemmi(gemmi, exports.open_as_array_buffer(filename),
                              filename, getMonomerCifs)
      .then(function (result) {
        const models = result.models;
        result.structure.delete();
        return models;
      });
  });
};

exports.download_data = async function () {
  for (let i = 0; i < DATA_FILES.length; i++) {
    await download_file(DATA_FILES[i]);
  }
};

const bench_to_run = process.argv[2];

exports.bench = function (name, fn, options) {
  const b = new Benchmark(name, fn, options);
  //b.on('start', function () { console.log('started ' + b.name); });
  b.on('complete', function (event) {
    console.log(' ' + event.target);
  });
  b.on('error', function () {
    console.log(b.error);
  });
  if (bench_to_run === undefined || name.indexOf(bench_to_run) > -1) {
    b.run();
  } else {
    b.fn(); // run once, for possible side effects
  }
  return b;
};

if (bench_to_run === 'download-data') {
  exports.download_data().catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}
