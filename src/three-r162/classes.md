# Classes in `src/three-r162`

This directory contains three bundled source files with class definitions.

## Exported classes

### `main-impl.ts`

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

### `math.ts`

- `Quaternion` - differs in constructor, setFromAxisAngle, setFromRotationMatrix, normalize
- `Vector3` - subset 31/75
- `Vector4` - subset 5/54
- `Matrix4` - differs in constructor, makeOrthographic
- `Color` - differs in set, setHex, setRGB, setHSL, getHSL, getHex, getHexString
- `Ray` - subset 5/21

### `extras-impl.ts`

- `CatmullRomCurve3` - subset 2/5

## Internal helper classes

These classes are defined in the bundled files but are not exported at the end of those modules.

### `main-impl.ts`

- `EventDispatcher` - differs in removeEventListener, dispatchEvent
- `Source` - differs in constructor
- `SingleUniform` - same
- `StructuredUniform` - same
- `WebGLUniforms` - differs in constructor
- `Material` - differs in constructor, setValues, get needsUpdate, set needsUpdate, update
- `Camera` - differs in constructor

### `extras-impl.ts`

- `Curve` - differs in constructor
