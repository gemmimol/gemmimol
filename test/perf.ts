// Check that scripts in perf/ can be run without errors.
// To make it quick use the least possible number of iterations.
import * as Benchmark from 'benchmark';
Benchmark.options.maxTime = -Infinity;
Benchmark.options.minTime = -Infinity;
Benchmark.options.minSamples = 1;
Benchmark.options.initCount = 0;

describe('perf', () => {
  'use strict';
  function add(name: string) {
    it(name, function () {
      const save_console_log = console.log;
      console.log = function () {};
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return Promise.resolve(require('../perf/' + name)).finally(function () {
        console.log = save_console_log;
      });
    });
  }
  add('model');
  add('elmap');
  add('isosurface');
  add('viewer');
});
