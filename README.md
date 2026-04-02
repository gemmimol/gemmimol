[![npm](https://img.shields.io/npm/v/gemmimol.svg?maxAge=2592000)](https://www.npmjs.com/package/gemmimol)
GemmiMol is a web-based macromolecular viewer focused on electron density.
It is a successor of the deprecated UglyMol.

It makes models and e.den. maps easy to recognize, navigate and interpret --:
for crystallographers.
It looks like [Coot](http://www2.mrc-lmb.cam.ac.uk/personal/pemsley/coot/)
and walks (mouse controls) like Coot.
But it's only a viewer. For situations when you want
a quick look and simple edits without downloading the data and starting Coot.
For instance, when screening
[Dimple](http://ccp4.github.io/dimple/) results in a synchrotron.
Of course, for this to work, it needs to be integrated into a website
that provides the data access
(see the [UglyMol FAQ](https://github.com/uglymol/uglymol/wiki) on how to do it).

Try it:

- [1MRU](https://gemmimol.github.io/1mru.html) (60kDa, 3Å),
  and in [dual view](https://gemmimol.github.io/dual.html) with PDB_REDO,
- [3KW8](https://gemmimol.github.io/3kw8.html) (30kDa, 2.3Å),
- [4UN4](https://gemmimol.github.io/4un4.html) (protein-DNA complex, 2.37Å),
- [a blob](https://gemmimol.github.io/dimple_thaum.html#xyz=14,18,12&eye=80,71,-41&zoom=70)
  (Dimple result, thaumatin, 1.4Å),
- or any [local file or wwPDB entry](https://gemmimol.github.io/view/).


It also has a [reciprocal space spin-off](https://gemmimol.github.io/reciprocal.html?rlp=data/rlp.csv).

GemmiMol is a small (~3 KLOC) [project](https://github.com/gemmimol/gemmimol)
The plan is to keep it small. But if you're missing some functionality,
it won't hurt if you get in touch --
use [Issues](https://github.com/gemmimol/gemmimol/issues)
or [email](mailto:wojdyr@gmail.com).

See the [UglyMol Wiki](https://github.com/uglymol/uglymol/wiki)
for more information.
