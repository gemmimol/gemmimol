---
layout: default
permalink: /integration.html
title: Integration
---

# Using GemmiMol in your code

The simplest way to embed GemmiMol is to load the JavaScript bundle, create a
viewer container, and then ask the viewer to load a model.

This page focuses on one integration point that most embedding apps need:
providing monomer CIF files for ligands and other non-standard residues.

## Loading GemmiMol

First, include GemmiMol itself and the Gemmi WASM module in your page.

```html
<link rel="stylesheet" href="gemmimol.css">

<script src="gemmimol.js"></script>
<script src="vendor/wasm/gemmi.js"></script>
```

## Creating the viewer

Now add a container for the viewer and, optionally, HUD and help elements.

```html
<div id="viewer"></div>
<div id="gm-overlay">
  <header id="hud"></header>
</div>
<footer id="help"></footer>
<div id="inset"></div>
```

GemmiMol follows the size of its container, so make sure your page gives the
viewer enough space.

## Loading a model

Once the page has loaded, create a viewer instance and load a model.

```html
<script>
  const viewer = new GM.Viewer({
    viewer: 'viewer',
    hud: 'hud',
    help: 'help',
  });

  viewer.load_model('/models/example.pdb');
</script>
```

If you also want electron density, load it from an MTZ file via the Gemmi
WASM module:

```js
Gemmi().then(function (gemmi) {
  GM.load_maps_from_mtz(gemmi, viewer, '/maps/example.mtz');
});
```

By default this picks the first `FWT/PHWT` and `DELFWT/PHDELWT` column pairs.
To use different column labels, pass them as a third argument, e.g.
`['2FOFCWT', 'PH2FOFCWT', 'FOFCWT', 'PHFOFCWT']`.

## Supplying monomer CIF files

GemmiMol needs monomer dictionaries to infer bonds for residues that are not
covered by its built-in amino-acid and nucleotide templates.

In practice, this mainly matters for ligands, cofactors, modified residues, and
other non-standard components.

### Option 1: `monomer_fetcher`

The most flexible approach is to pass a `monomer_fetcher` when creating the
viewer.

```html
<script>
  const viewer = new GM.Viewer({
    viewer: 'viewer',
    hud: 'hud',
    help: 'help',
    monomer_fetcher: function (resname) {
      return fetch('/api/monomers/' + encodeURIComponent(resname) + '.cif')
        .then(function (resp) {
          return resp.ok ? resp.text() : null;
        });
    },
  });

  viewer.load_model('/models/example.pdb');
</script>
```

The callback receives the residue name, uppercased by GemmiMol.

Return one of:

- CIF text as a string
- `null` if your app has no dictionary for that residue
- a `Promise` resolving to either of the above

GemmiMol only asks for missing residue dictionaries, not for standard protein or
nucleic-acid residues that it already knows.

### Option 2: `monomer_url_template`

If your app exposes monomer files through a simple URL pattern, you can use
`monomer_url_template` instead.

```js
const viewer = new GM.Viewer({
  viewer: 'viewer',
  monomer_url_template: '/api/monomers/{first_letter}/{name}.cif',
});
```

`{name}` is replaced with the uppercased residue name, URL-encoded.
`{first_letter}` is replaced with the lowercased first character of the
residue name, matching the `<first-letter>/<NAME>.cif` layout used by the
[MonomerLibrary/monomers](https://github.com/MonomerLibrary/monomers)
repository that GemmiMol now uses as the default source.

## What the server should return

For a request such as `/api/monomers/ATP.cif`, return monomer CIF text for that
residue.

In practice this usually means a CIF block containing:

- `_chem_comp`
- `_chem_comp_atom`
- `_chem_comp_bond`

One monomer block per residue name is enough for the fetch-based integration
above.

## Preloading monomer CIF text

If your app already has monomer CIF text in memory, you do not need to serve it
through a separate HTTP endpoint.

You can inject it directly into the viewer cache before loading the model:

```js
const names = viewer.cache_monomer_cif_text(monomerCifText);
viewer.load_model('/models/example.pdb');
```

If the model is already loaded, cache the CIF text and then refresh bonding:

```js
const names = viewer.cache_monomer_cif_text(monomerCifText);
viewer.refresh_bonding_for_cached_monomers(names);
```

`monomerCifText` may contain one or more monomer data blocks.

## Fallback behavior

GemmiMol tries monomer sources in this order:

1. `monomer_fetcher`, if provided
2. built-in amino-acid and nucleotide templates
3. `monomer_url_template`, if provided
4. the default MonomerLibrary/monomers URL

If `monomer_fetcher` returns `null`, GemmiMol continues with the built-in and
URL-based fallback path.

## If the model mmCIF already contains chem_comp data

No extra server support is needed when the model file already embeds the
relevant `chem_comp` data blocks.

GemmiMol reads those dictionaries directly from the mmCIF and uses them for
bonding.

## Minimal server example

Any backend is fine as long as it returns plain CIF text.

```js
app.get('/api/monomers/:name.cif', async function (req, res) {
  const name = req.params.name.toUpperCase();
  const cifText = await loadMonomerCifFor(name);
  if (!cifText) {
    res.status(404).end();
    return;
  }
  res.type('text/plain').send(cifText);
});
```

## Note on external files and CORS

If your page fetches models, maps, or monomer CIF files from another origin,
normal browser CORS rules apply.

The simplest setup is to serve the page, the model files, the map files, and the
monomer CIF endpoint from the same site.
