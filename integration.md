---
layout: default
permalink: /integration.html
---

# Integration

This note explains how a server or web app that embeds GemmiMol can provide
monomer CIF files for ligands and other non-standard residues.

GemmiMol needs monomer dictionaries to infer bonds for residues that are not
covered by the built-in amino-acid and nucleotide templates.

## Recommended approach

Pass a monomer source when creating `GM.Viewer`.

### Option 1: `monomer_fetcher`

Use `monomer_fetcher` when your app wants full control over how CIF text is
loaded.

```js
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
```

The callback receives the residue name, already uppercased by GemmiMol.
Return:

- CIF text as a string
- `null` if your app has no dictionary for this residue
- a `Promise` resolving to either of the above

### Option 2: `monomer_url_template`

Use `monomer_url_template` when a simple URL pattern is enough.

```js
const viewer = new GM.Viewer({
  viewer: 'viewer',
  monomer_url_template: '/api/monomers/{name}.cif',
});
```

`{name}` is replaced with the uppercased residue name, URL-encoded.

## What the server should return

For a request such as `/api/monomers/ATP.cif`, return monomer CIF text for that
residue. In practice this means a CIF block with entries such as:

- `_chem_comp`
- `_chem_comp_atom`
- `_chem_comp_bond`

Returning one monomer block per residue name is enough for the fetch-based
integration above.

## Fallback behavior

GemmiMol tries sources in this order:

1. `monomer_fetcher`, if provided
2. built-in amino-acid and nucleotide templates
3. `monomer_url_template`, if provided
4. the default RCSB ligand URL

If `monomer_fetcher` returns `null`, GemmiMol continues with the built-in and
URL-based fallback path.

## Preloading CIF text

If your app already has monomer CIF text in memory, you can inject it directly
into the viewer cache without serving separate files.

```js
const names = viewer.cache_monomer_cif_text(monomerCifText);
viewer.load_pdb('/models/model.pdb');
```

If the model is already loaded, refresh bonding after caching the CIF text:

```js
const names = viewer.cache_monomer_cif_text(monomerCifText);
viewer.refresh_bonding_for_cached_monomers(names);
```

`monomerCifText` may contain one or more monomer data blocks.

## If the model mmCIF already contains chem_comp data

No extra server support is needed when the model file already embeds the
relevant `chem_comp` data blocks. GemmiMol reads those dictionaries directly
from the mmCIF and uses them for bonding.

## Minimal server example

Any backend is fine as long as it returns plain CIF text. For example:

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
