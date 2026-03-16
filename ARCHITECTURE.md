this project is a fork of UglyMol,which was forked from Nat Echols' xtal.js
The WebGL interactions and rendering were based on the popular THREE library.
To make distribution easier the tiny subset of THREE (<2KLOC) that we actually use is included in
src/three-r162/ (actuallyit was extracted from a few different releases of THREE).
Probably, this project  could beeasily made to work on topof vanilla THREE.
We also rely heavilly on gemmi (throught WASM bindings)
And we  borrow some shader code from 3DMol.
All this limits original GemmiMol code to the minimum.
