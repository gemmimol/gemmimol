import * as GM from '../gemmimol';

describe('ReciprocalViewer', () => {
  'use strict';
  const viewer = new GM.ReciprocalViewer();

  it('misc calls', () => {
    if (viewer.controls) viewer.controls.update();
    viewer.update_camera();
    viewer.recenter();
  });
});
