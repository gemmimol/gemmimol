three.js is a link to a clone of THREE - jsometimes useful when analysing src/three-*
src/three-r162/ is not based  on r162, but it was accummulated  over time based onvarious versions
of three.js; we try to keep it a vompatible witth the current three.js:
/home/wojdyr/fresh/three.js/build/three.module.js

 as is pragmatic
see also. ARCHITECTURE.md
usually copying code from /home/wojdyr/fresh/three.js/build/three.module.js
to src/three-*
is preffered to writing own functions

avoid editing generated files like gemmimol.js, instead edit files in src/ and rebuild js
i'm testing it running server from ../gemmimol.github.io/
wasmfiles are built in../gemmi/wasm/
 make all as simple and minimal as posible
 dont commit the minimizedbundle for each smallsource change, to avoid bloating the repo size.
