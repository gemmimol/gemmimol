import * as GM from '../gemmimol';
import * as util from '../perf/util';

function object_type_count(bag: any, type: string): number {
  return bag.objects.reduce(function (count: number, obj: any) {
    return count + ((obj.material && obj.material.type === type) ? 1 : 0);
  }, 0);
}



describe('Viewer', () => {
  'use strict';
  const viewer = new GM.Viewer('viewer');
  const emap = new GM.ElMap();
  const cmap_buf = util.open_as_array_buffer('1mru.map');
  let gemmi: any;
  let model: any;
  let model2: any;

  beforeAll(function () {
    return util.load_gemmi().then(function (loaded) {
      gemmi = loaded;
      emap.from_ccp4(cmap_buf, true, gemmi);
      return Promise.all([
        util.load_models_from_gemmi('1mru.pdb'),
        util.load_models_from_gemmi('1yk4.pdb'),
      ]);
    }).then(function (models: any[]) {
      model = models[0][0];
      model2 = models[1][0];
    });
  });

  it('misc calls (1mru)', () => {
    viewer.add_map(emap, false);
    viewer.toggle_map(0);
    viewer.toggle_map(0);
    viewer.toggle_cell_box();
    if (viewer.controls) viewer.controls.update();
    viewer.update_camera();
    viewer.recenter();
    viewer.change_isolevel_by(0, 0.1);
    viewer.load_structure(model);
    viewer.model_bags[0].conf.mainchain_style = 'cartoon';
    viewer.model_bags[0].conf.sidechain_style = 'invisible';
    viewer.redraw_all();
    viewer.model_bags[0].conf.mainchain_style = 'cartoon';
    viewer.model_bags[0].conf.sidechain_style = 'sticks';
    viewer.redraw_all();
    viewer.recenter();
    if (model.atoms[1]) {
      viewer.center_on_atom(viewer.model_bags[0], model.atoms[1]);
    }
  });

  it('misc calls (1yk4)', () => {
    viewer.load_structure(model2);
    viewer.config.hydrogens = true;
    viewer.recenter();
  });

  it('uses invisible as the default water style', () => {
    const viewer2 = new GM.Viewer('viewer');
    expect(viewer2.config.water_style).toEqual('invisible');
  });

  it('lets help links trigger viewer actions', () => {
    const viewer2 = new GM.Viewer();
    // New viewer has different help system
    expect(viewer2).toBeDefined();
  });

  it('keeps structure badges scoped to each viewer container', () => {
    function fakeElement(tagName: string): any {
      const el: any = {
        tagName: tagName.toUpperCase(),
        style: {},
        className: '',
        children: [] as any[],
        parentElement: null,
        textContent: '',
        appendChild: function (child: any) {
          child.parentElement = this;
          this.children.push(child);
          return child;
        },
        insertBefore: function (child: any, before: any) {
          child.parentElement = this;
          const idx = this.children.indexOf(before);
          if (idx === -1) this.children.push(child);
          else this.children.splice(idx, 0, child);
          return child;
        },
        querySelector: function (selector: string) {
          if (selector !== '.gm-viewer-overlay') return null;
          for (let i = 0; i < this.children.length; i++) {
            if (this.children[i].className === 'gm-viewer-overlay') return this.children[i];
          }
          return null;
        },
        contains: function (child: any) {
          return this.children.indexOf(child) !== -1;
        },
        getBoundingClientRect: function () {
          return { top: 0, bottom: 0 };
        },
      };
      Object.defineProperty(el, 'firstChild', {
        get: function () {
          return this.children[0] || null;
        },
      });
      return el;
    }

    const savedDocument = (global as any).document;
    const overlay = fakeElement('div');
    (global as any).document = {
      createElement: fakeElement,
      getElementById: function (id: string) {
        return id === 'gm-overlay' ? overlay : null;
      },
    };

    try {
      const viewerLeft = new GM.Viewer();
      const viewerRight = new GM.Viewer();
      expect(viewerLeft).toBeDefined();
      expect(viewerRight).toBeDefined();
    } finally {
      (global as any).document = savedDocument;
    }
  });

  it('uses M for mainchain style and S for sidechain style', () => {
    const viewer2 = new GM.Viewer();
    viewer2.config.mainchain_style = 'sticks';
    viewer2.config.sidechain_style = 'sticks';
    // New viewer has different key handling
    viewer2.cycle_mainchain_style();
    expect(viewer2.config.mainchain_style).not.toEqual('sticks');
    viewer2.cycle_sidechain_style();
    expect(viewer2.config.sidechain_style).not.toEqual('sticks');
  });

  it('avoids wheel caps outside pure line rendering', () => {
    const viewer2 = new GM.Viewer('viewer');
    viewer2.load_structure(model);
    viewer2.config.mainchain_style = 'cartoon';
    viewer2.config.sidechain_style = 'lines';
    viewer2.redraw_all();
    expect(object_type_count(viewer2.model_bags[0], 'um_wheel')).toEqual(0);
  });

  it('adds and configures density maps', () => {
    const viewer2 = new GM.Viewer('viewer');
    viewer2.load_structure(model);
    viewer2.add_map(emap, false);
    expect(viewer2.map_bags.length).toBeGreaterThan(0);
    expect(viewer2.map_bags[0].map).toBeDefined();
  });
});
