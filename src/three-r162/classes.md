# Classes in `src/three-r162`

This directory contains three bundled source files with class definitions.

## Regeneration

Run the comparison from the repo root with:

```bash
npm run compare-three-r162
```

Show method-level diffs for one class with:

```bash
node tools/compare-three-r162.js --class Color --diffs
```

Regenerate this file with:

```bash
node tools/compare-three-r162.js --write-md
```

## Exported classes

### `main.js`

- `WebGLRenderer` - differs in constructor, getContext, getPrecision, getPixelRatio, setPixelRatio, setSize, setViewport, getClearColor, setClearColor, clear, clearColor, clearDepth, dispose, renderBufferDirect, render, setRenderTarget
- `Fog` - subset 1/3
- `Scene` - differs in constructor
- `Mesh` - differs in constructor
- `LineSegments` - subset 1/2
- `Line` - differs in constructor
- `Points` - differs in constructor
- `ShaderMaterial` - differs in constructor
- `OrthographicCamera` - differs in constructor, updateProjectionMatrix
- `BufferGeometry` - differs in constructor, setIndex
- `BufferAttribute` - differs in constructor
- `Object3D` - differs in constructor, add, remove, updateMatrix, updateMatrixWorld
- `Texture` - differs in constructor

### `math.js`

- `Quaternion` - differs in constructor, setFromAxisAngle, setFromRotationMatrix, normalize
- `Vector3` - subset 31/75
- `Vector4` - subset 5/54
- `Matrix4` - differs in constructor, makeOrthographic
- `Color` - differs in set, setHex, setRGB, setHSL, getHSL, getHex, getHexString
- `Ray` - subset 5/21

### `extras.js`

- `CatmullRomCurve3` - subset 2/5

## Internal helper classes

These classes are defined in the bundled files but are not exported at the end of those modules.

### `main.js`

- `EventDispatcher` - differs in removeEventListener, dispatchEvent
- `Source` - differs in constructor
- `SingleUniform` - same
- `StructuredUniform` - same
- `WebGLUniforms` - differs in constructor
- `Material` - differs in constructor, setValues, get needsUpdate, set needsUpdate, update
- `Camera` - differs in constructor

### `extras.js`

- `Curve` - differs in constructor
