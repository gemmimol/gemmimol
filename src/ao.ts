// Speck-style ambient occlusion for molecular rendering.
// Based on https://github.com/costrouc/speck — multi-view AO technique.
// Post-processing passes use raw WebGL (not three.js) because three.js's
// uniform system doesn't support manually-bound GL textures.

import { Matrix4, WebGLRenderTarget } from './three-r162/main';
import { fog_pars_fragment } from './draw';

// Compile a raw WebGL shader program
function compileProgram(gl: WebGLRenderingContext,
                        vertSrc: string, fragSrc: string): WebGLProgram {
  function compile(src: string, type: number) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      throw new Error('Shader compile failed');
    }
    return s;
  }
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(vertSrc, gl.VERTEX_SHADER));
  gl.attachShader(prog, compile(fragSrc, gl.FRAGMENT_SHADER));
  gl.bindAttribLocation(prog, 0, 'aPosition');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    throw new Error('Program link failed');
  }
  return prog;
}

// Full-screen quad vertex shader (raw, no three.js prefix)
const fsQuadVert = `
precision highp float;
attribute vec3 aPosition;
void main() {
  gl_Position = vec4(aPosition, 1.0);
}
`;

const accumulator_frag = `
precision highp float;
uniform sampler2D uSceneDepth;
uniform sampler2D uSceneNormal;
uniform sampler2D uRandRotDepth;
uniform sampler2D uAccumulator;
uniform mat4 uRot;
uniform mat4 uInvRot;
uniform vec2 uSceneBottomLeft;
uniform vec2 uSceneTopRight;
uniform vec2 uRotBottomLeft;
uniform vec2 uRotTopRight;
uniform float uDepth;
uniform vec2 uRes;
uniform int uSampleCount;

void main() {
  vec2 sceneUV = gl_FragCoord.xy / uRes;
  vec4 acc = texture2D(uAccumulator, sceneUV);
  float dScene = texture2D(uSceneDepth, sceneUV).r;
  if (dScene >= 0.999) {
    gl_FragColor = acc;
    return;
  }

  vec3 r = vec3(uSceneBottomLeft + sceneUV * (uSceneTopRight - uSceneBottomLeft), 0.0);
  r.z = -(dScene - 0.5) * uDepth;
  r = vec3(uRot * vec4(r, 1));
  float depth = -r.z/uDepth + 0.5;

  vec2 p = (r.xy - uRotBottomLeft)/(uRotTopRight - uRotBottomLeft);
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0) {
    gl_FragColor = acc;
    return;
  }
  float dRandRot = texture2D(uRandRotDepth, p).r;
  float ao = step(dRandRot, depth * 0.99);

  vec3 normal = texture2D(uSceneNormal, sceneUV).rgb * 2.0 - 1.0;
  vec3 dir = vec3(uInvRot * vec4(0, 0, 1, 0));
  float mag = dot(dir, normal);
  ao *= step(0.0, mag);

  if (uSampleCount < 256) {
    acc.r += ao/255.0;
  } else if (uSampleCount < 512) {
    acc.g += ao/255.0;
  } else if (uSampleCount < 768) {
    acc.b += ao/255.0;
  } else {
    acc.a += ao/255.0;
  }
  gl_FragColor = acc;
}
`;

const ao_compose_frag = `
precision highp float;
${fog_pars_fragment}
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform sampler2D uAccumulatorOut;
uniform vec2 uRes;
uniform float uAO;
uniform float uBrightness;
uniform float uOutlineStrength;
uniform vec3 uBgColor;

void main() {
  vec2 p = gl_FragCoord.xy/uRes;
  vec4 sceneColor = texture2D(uSceneColor, p);
  if (sceneColor.a == 0.0) {
    gl_FragColor = vec4(uBgColor, 1.0);
    return;
  }
  if (uOutlineStrength > 0.0) {
    float depth = texture2D(uSceneDepth, p).r;
    vec2 texel = 1.0 / uRes;
    float d0 = abs(texture2D(uSceneDepth, p + vec2(-texel.x,  0)).r - depth);
    float d1 = abs(texture2D(uSceneDepth, p + vec2( texel.x,  0)).r - depth);
    float d2 = abs(texture2D(uSceneDepth, p + vec2( 0, -texel.y)).r - depth);
    float d3 = abs(texture2D(uSceneDepth, p + vec2( 0,  texel.y)).r - depth);
    float d = max(max(d0, d1), max(d2, d3));
    sceneColor.rgb *= pow(1.0 - d, uOutlineStrength * 32.0);
    sceneColor.a = max(step(0.003, d), sceneColor.a);
  }
  vec4 dAccum = texture2D(uAccumulatorOut, p);
  float shade = max(0.0, 1.0 - (dAccum.r + dAccum.g + dAccum.b + dAccum.a) * 0.25 * uAO);
  shade = pow(shade, 2.0);
  gl_FragColor = vec4(uBrightness * sceneColor.rgb * shade, sceneColor.a);
}
`;


// Helper: get orthographic rect from camera
function getCameraRect(camera: any) {
  const hw = (camera.right - camera.left) / (2.0 * camera.zoom);
  const hh = (camera.top - camera.bottom) / (2.0 * camera.zoom);
  return {
    left: -hw, right: hw, bottom: -hh, top: hh,
  };
}

// Helper: random rotation matrix
function randomRotation(): any {
  let m = new Matrix4();
  for (let i = 0; i < 3; i++) {
    const angle = Math.random() * Math.PI * 2;
    const x = Math.random() - 0.5;
    const y = Math.random() - 0.5;
    const z = Math.random() - 0.5;
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const ax = x / len, ay = y / len, az = z / len;
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    const r = new Matrix4();
    r.set(
      t*ax*ax+c, t*ax*ay-s*az, t*ax*az+s*ay, 0,
      t*ax*ay+s*az, t*ay*ay+c, t*ay*az-s*ax, 0,
      t*ax*az-s*ay, t*ay*az+s*ax, t*az*az+c, 0,
      0, 0, 0, 1
    );
    const tmp = new Matrix4();
    tmp.multiplyMatrices(m, r);
    m = tmp;
  }
  return m;
}

// Helper: set a uniform on a raw GL program by name
function setUniform(gl: WebGLRenderingContext, prog: WebGLProgram,
                    name: string, type: string, ...args: any[]) {
  const loc = gl.getUniformLocation(prog, name);
  if (loc === null) return;
  (gl as any)['uniform' + type](loc, ...args);
}


export class SpeckAO {
  renderer: any;
  scene: any;
  camera: any;
  gl: WebGLRenderingContext;

  rtColor: any;
  rtNormal: any;
  rtRandRot: any;
  rtAccumulator: any;
  rtAccumulatorOut: any;

  progAccum: WebGLProgram | null;
  progCompose: WebGLProgram | null;
  quadVBO: WebGLBuffer | null;

  sampleCount: number;
  colorRendered: boolean;
  normalRendered: boolean;
  sceneWidth: number;
  sceneHeight: number;
  aoWidth: number;
  aoHeight: number;
  range: number;

  samplesPerFrame: number;
  maxSamples: number;

  aoStrength: number;
  brightness: number;
  outlineStrength: number;

  constructor(renderer: any, scene: any, camera: any, boundingRadius: number) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.gl = renderer.getContext();

    this.sampleCount = 0;
    this.colorRendered = false;
    this.normalRendered = false;
    this.range = boundingRadius * 2;
    this.samplesPerFrame = 32;
    this.maxSamples = 1024;

    this.aoStrength = 4.0;
    this.brightness = 1.0;
    this.outlineStrength = 0.3;

    this.progAccum = null;
    this.progCompose = null;
    this.quadVBO = null;

    this._syncSizes();
    this._createRenderTargets();
    this._createPrograms();
  }

  setBoundingRadius(boundingRadius: number) {
    this.range = Math.max(2 * boundingRadius, 1);
  }

  _syncSizes() {
    const canvas = this.renderer.domElement;
    this.sceneWidth = Math.max(1, canvas.width);
    this.sceneHeight = Math.max(1, canvas.height);
    this.aoWidth = Math.max(64, Math.floor(this.sceneWidth / 4));
    this.aoHeight = Math.max(64, Math.floor(this.sceneHeight / 4));
  }

  _recreateRenderTargets() {
    if (this.rtColor) this.rtColor.dispose(this.gl);
    if (this.rtNormal) this.rtNormal.dispose(this.gl);
    if (this.rtRandRot) this.rtRandRot.dispose(this.gl);
    if (this.rtAccumulator) this.rtAccumulator.dispose(this.gl);
    if (this.rtAccumulatorOut) this.rtAccumulatorOut.dispose(this.gl);
    this._createRenderTargets();
    this.reset();
  }

  _createRenderTargets() {
    this.rtColor = new WebGLRenderTarget(this.sceneWidth, this.sceneHeight, { depth: true });
    this.rtNormal = new WebGLRenderTarget(this.sceneWidth, this.sceneHeight, { depth: true });
    this.rtRandRot = new WebGLRenderTarget(this.aoWidth, this.aoHeight, { depth: true });
    this.rtAccumulator = new WebGLRenderTarget(this.sceneWidth, this.sceneHeight, { depth: false });
    this.rtAccumulatorOut = new WebGLRenderTarget(this.sceneWidth, this.sceneHeight, { depth: false });
  }

  _createPrograms() {
    const gl = this.gl;
    this.progAccum = compileProgram(gl, fsQuadVert, accumulator_frag);
    this.progCompose = compileProgram(gl, fsQuadVert, ao_compose_frag);

    // Full-screen quad VBO
    this.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 1, -1, 0, 1, 1, 0,
      -1, -1, 0, 1, 1, 0, -1, 1, 0,
    ]), gl.STATIC_DRAW);
  }

  _drawQuad(prog: WebGLProgram) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    const loc = gl.getAttribLocation(prog, 'aPosition');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(loc);
  }

  reset() {
    this.sampleCount = 0;
    this.colorRendered = false;
    this.normalRendered = false;
    const gl = this.gl;
    this.rtAccumulator._init(gl);
    this.rtAccumulatorOut._init(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtAccumulator._framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtAccumulatorOut._framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  isDone() {
    return this.sampleCount >= this.maxSamples;
  }

  _withoutFog(fn: () => void) {
    const fog = this.scene.fog;
    this.scene.fog = null;
    fn();
    this.scene.fog = fog;
  }

  // Set camera near/far to tight range around molecule (like speck: near=0, far=range)
  // so depth buffer values span only the molecule, not the entire scene.
  _withTightDepth(fn: () => void) {
    const origNear = this.camera.near;
    const origFar = this.camera.far;
    const dxyz = (origNear + origFar) / 2; // distance to molecule center
    this.camera.near = dxyz - this.range / 2;
    this.camera.far = dxyz + this.range / 2;
    this.camera.updateProjectionMatrix();
    fn();
    this.camera.near = origNear;
    this.camera.far = origFar;
    this.camera.updateProjectionMatrix();
  }

  _setMaterialMode(mode: number) {
    this.scene.traverse((obj: any) => {
      if (obj.material && obj.material.uniforms && obj.material.uniforms.uMode) {
        obj.material.uniforms.uMode.value = mode;
      }
    });
  }

  render() {
    const prevWidth = this.sceneWidth;
    const prevHeight = this.sceneHeight;
    this._syncSizes();
    if (this.sceneWidth !== prevWidth || this.sceneHeight !== prevHeight) {
      this._recreateRenderTargets();
    }

    if (!this.colorRendered) {
      this._setMaterialMode(0);
      this._withoutFog(() => this._withTightDepth(() => {
        this.renderer.render(this.scene, this.camera, this.rtColor, true);
      }));
      this.colorRendered = true;
    } else if (!this.normalRendered) {
      this._setMaterialMode(1);
      this._withoutFog(() => this._withTightDepth(() => {
        this.renderer.render(this.scene, this.camera, this.rtNormal, true);
      }));
      this._setMaterialMode(0);
      this.normalRendered = true;
    } else {
      for (let i = 0; i < this.samplesPerFrame; i++) {
        if (this.sampleCount >= this.maxSamples) break;
        this._sample();
        this.sampleCount++;
      }
    }

    this._compose();
  }

  _sample() {
    const gl = this.gl;
    const rot = randomRotation();
    const invRot = new Matrix4();
    invRot.copy(rot);
    invRot.invert();

    // Save original camera state
    const origMatrix = new Matrix4();
    origMatrix.copy(this.camera.matrixWorld);
    const origMatrixInverse = new Matrix4();
    origMatrixInverse.copy(this.camera.matrixWorldInverse);
    const origLeft = this.camera.left;
    const origRight = this.camera.right;
    const origTop = this.camera.top;
    const origBottom = this.camera.bottom;
    const origZoom = this.camera.zoom;
    const origMatrixAutoUpdate = this.camera.matrixAutoUpdate;
    const origMatrixWorldNeedsUpdate = this.camera.matrixWorldNeedsUpdate;

    // Widen camera and tighten depth to encompass molecule at any rotation
    const half = this.range / 2;
    const dxyz = (this.camera.near + this.camera.far) / 2;
    const origNear = this.camera.near;
    const origFar = this.camera.far;
    this.camera.left = -half;
    this.camera.right = half;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.zoom = 1;
    this.camera.near = dxyz - half;
    this.camera.far = dxyz + half;
    this.camera.updateProjectionMatrix();

    // Rotate the camera
    const rotatedMatrix = new Matrix4();
    rotatedMatrix.multiplyMatrices(origMatrix, rot);
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldNeedsUpdate = false;
    this.camera.matrixWorld.copy(rotatedMatrix);
    this.camera.matrixWorldInverse.copy(rotatedMatrix);
    this.camera.matrixWorldInverse.invert();

    this._setMaterialMode(0);
    this._withoutFog(() => {
      this.renderer.render(this.scene, this.camera, this.rtRandRot, true);
    });

    // Restore camera
    this.camera.matrixWorld.copy(origMatrix);
    this.camera.matrixWorldInverse.copy(origMatrixInverse);
    this.camera.left = origLeft;
    this.camera.right = origRight;
    this.camera.top = origTop;
    this.camera.bottom = origBottom;
    this.camera.zoom = origZoom;
    this.camera.near = origNear;
    this.camera.far = origFar;
    this.camera.matrixAutoUpdate = origMatrixAutoUpdate;
    this.camera.matrixWorldNeedsUpdate = origMatrixWorldNeedsUpdate;
    this.camera.updateProjectionMatrix();

    // Accumulator pass (raw WebGL)
    const sceneRect = getCameraRect(this.camera);
    const rotRect = { left: -half, right: half, bottom: -half, top: half };
    const prog = this.progAccum!;

    this.rtAccumulatorOut._init(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtAccumulatorOut._framebuffer);
    gl.viewport(0, 0, this.sceneWidth, this.sceneHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);

    gl.useProgram(prog);

    // Bind textures
    this.rtColor.bindDepthTexture(gl, 0);
    setUniform(gl, prog, 'uSceneDepth', '1i', 0);

    this.rtNormal.bindColorTexture(gl, 1);
    setUniform(gl, prog, 'uSceneNormal', '1i', 1);

    this.rtRandRot.bindDepthTexture(gl, 2);
    setUniform(gl, prog, 'uRandRotDepth', '1i', 2);

    this.rtAccumulator.bindColorTexture(gl, 3);
    setUniform(gl, prog, 'uAccumulator', '1i', 3);

    setUniform(gl, prog, 'uRot', 'Matrix4fv', false, rot.elements);
    setUniform(gl, prog, 'uInvRot', 'Matrix4fv', false, invRot.elements);
    setUniform(gl, prog, 'uSceneBottomLeft', '2fv', [sceneRect.left, sceneRect.bottom]);
    setUniform(gl, prog, 'uSceneTopRight', '2fv', [sceneRect.right, sceneRect.top]);
    setUniform(gl, prog, 'uRotBottomLeft', '2fv', [rotRect.left, rotRect.bottom]);
    setUniform(gl, prog, 'uRotTopRight', '2fv', [rotRect.right, rotRect.top]);
    setUniform(gl, prog, 'uDepth', '1f', this.range);
    setUniform(gl, prog, 'uRes', '2fv', [this.sceneWidth, this.sceneHeight]);
    setUniform(gl, prog, 'uSampleCount', '1i', this.sampleCount);

    this._drawQuad(prog);

    // Ping-pong: swap accumulators (avoids expensive copyTexImage2D)
    const tmp = this.rtAccumulator;
    this.rtAccumulator = this.rtAccumulatorOut;
    this.rtAccumulatorOut = tmp;

    gl.enable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.renderer.resetGLState();
  }

  _compose() {
    const gl = this.gl;
    const prog = this.progCompose!;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.renderer.setRenderTarget(null);  // restore three.js viewport
    gl.viewport(0, 0, this.sceneWidth, this.sceneHeight);
    gl.disable(gl.DEPTH_TEST);

    gl.useProgram(prog);

    this.rtColor.bindColorTexture(gl, 0);
    setUniform(gl, prog, 'uSceneColor', '1i', 0);

    this.rtColor.bindDepthTexture(gl, 1);
    setUniform(gl, prog, 'uSceneDepth', '1i', 1);

    this.rtAccumulator.bindColorTexture(gl, 2);
    setUniform(gl, prog, 'uAccumulatorOut', '1i', 2);

    setUniform(gl, prog, 'uRes', '2fv', [this.sceneWidth, this.sceneHeight]);
    setUniform(gl, prog, 'uAO', '1f', this.aoStrength);
    setUniform(gl, prog, 'uBrightness', '1f', this.brightness);
    setUniform(gl, prog, 'uOutlineStrength', '1f', this.outlineStrength);
    const bg = this.renderer.getClearColor();
    setUniform(gl, prog, 'uBgColor', '3fv', [bg.r, bg.g, bg.b]);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._drawQuad(prog);

    gl.enable(gl.DEPTH_TEST);
    this.renderer.resetGLState();
  }

  dispose() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.renderer.resetGLState();
    this.rtColor.dispose(gl);
    this.rtNormal.dispose(gl);
    this.rtRandRot.dispose(gl);
    this.rtAccumulator.dispose(gl);
    this.rtAccumulatorOut.dispose(gl);
    if (this.progAccum) gl.deleteProgram(this.progAccum);
    if (this.progCompose) gl.deleteProgram(this.progCompose);
    if (this.quadVBO) gl.deleteBuffer(this.quadVBO);
  }
}
