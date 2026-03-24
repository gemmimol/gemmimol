import { BufferAttribute, BufferGeometry, ShaderMaterial,
         Object3D, Mesh, Line, LineSegments, Points,
         Color, Vector3, Texture } from './three-r162/main.js';
import { CatmullRomCurve3 } from './three-r162/extras.js';
import type { IsosurfaceData } from './elmap';

import type { Atom } from './model';
type Num3 = [number, number, number];

const CUBE_EDGES: Num3[] =
  [[0, 0, 0], [1, 0, 0],
   [0, 0, 0], [0, 1, 0],
   [0, 0, 0], [0, 0, 1],
   [1, 0, 0], [1, 1, 0],
   [1, 0, 0], [1, 0, 1],
   [0, 1, 0], [1, 1, 0],
   [0, 1, 0], [0, 1, 1],
   [0, 0, 1], [1, 0, 1],
   [0, 0, 1], [0, 1, 1],
   [1, 0, 1], [1, 1, 1],
   [1, 1, 0], [1, 1, 1],
   [0, 1, 1], [1, 1, 1]];

function makeColorAttribute(colors: Color[]) {
  const col = new Float32Array(colors.length * 3);
  for (let i = 0; i < colors.length; i++) {
    col[3*i+0] = colors[i].r;
    col[3*i+1] = colors[i].g;
    col[3*i+2] = colors[i].b;
  }
  return new BufferAttribute(col, 3);
}

const light_dir = new Vector3(-0.2, 0.3, 1.0); // length affects brightness

export const fog_pars_fragment =
`#ifdef USE_FOG
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
#endif`;

export const fog_end_fragment =
`#ifdef USE_FOG
  float depth = gl_FragCoord.z / gl_FragCoord.w;
  float fogFactor = smoothstep(fogNear, fogFar, depth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;


const varcolor_vert = `
attribute vec3 color;
varying vec3 vcolor;
void main() {
  vcolor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const unicolor_vert = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const unicolor_frag = `
${fog_pars_fragment}
uniform vec3 vcolor;
void main() {
  gl_FragColor = vec4(vcolor, 1.0);
${fog_end_fragment}
}`;

const varcolor_frag = `
${fog_pars_fragment}
varying vec3 vcolor;
void main() {
  gl_FragColor = vec4(vcolor, 1.0);
${fog_end_fragment}
}`;

export function makeLines(pos: Float32Array, color: Color, linewidth: number) {
  const material = new ShaderMaterial({
    uniforms: makeUniforms({vcolor: color}),
    vertexShader: unicolor_vert,
    fragmentShader: unicolor_frag,
    fog: true,
    linewidth: linewidth,
    type: 'um_lines',
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  return new LineSegments(geometry, material);
}

interface CubeOptions {
  color: Color;
  linewidth: number;
}

export function makeCube(size: number, ctr: Vector3, options: CubeOptions) {
  const pos = new Float32Array(CUBE_EDGES.length * 3);
  for (let i = 0; i < CUBE_EDGES.length; i++) {
    const coor = CUBE_EDGES[i];
    pos[3*i+0] = ctr.x + size * (coor[0] - 0.5);
    pos[3*i+1] = ctr.y + size * (coor[1] - 0.5);
    pos[3*i+2] = ctr.z + size * (coor[2] - 0.5);
  }
  return makeLines(pos, options.color, options.linewidth);
}

export function makeMultiColorLines(pos: Float32Array,
                                    colors: Color[],
                                    linewidth: number) {
  const material = new ShaderMaterial({
    uniforms: makeUniforms({}),
    vertexShader: varcolor_vert,
    fragmentShader: varcolor_frag,
    fog: true,
    linewidth: linewidth,
    type: 'um_multicolor_lines',
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', makeColorAttribute(colors));
  return new LineSegments(geometry, material);
}

// A cube with 3 edges (for x, y, z axes) colored in red, green and blue.
export function makeRgbBox(transform_func: (arg:Num3) => Num3, color: Color) {
  const pos = new Float32Array(CUBE_EDGES.length * 3);
  for (let i = 0; i < CUBE_EDGES.length; i++) {
    const coor = transform_func(CUBE_EDGES[i]);
    pos[3*i+0] = coor[0];
    pos[3*i+1] = coor[1];
    pos[3*i+2] = coor[2];
  }
  const colors = [
    new Color(0xff0000), new Color(0xffaa00),
    new Color(0x00ff00), new Color(0xaaff00),
    new Color(0x0000ff), new Color(0x00aaff),
  ];
  for (let j = 6; j < CUBE_EDGES.length; j++) {
    colors.push(color);
  }
  return makeMultiColorLines(pos, colors, 1);
}

function double_pos(pos: Num3[]) {
  const double_pos = [];
  for (let i = 0; i < pos.length; i++) {
    const v = pos[i];
    double_pos.push(v[0], v[1], v[2]);
    double_pos.push(v[0], v[1], v[2]);
  }
  return double_pos;
}

function double_color(color_arr: Color[]) {
  const len = color_arr.length;
  const color = new Float32Array(6*len);
  for (let i = 0; i < len; i++) {
    const col = color_arr[i];
    color[6*i] = col.r;
    color[6*i+1] = col.g;
    color[6*i+2] = col.b;
    color[6*i+3] = col.r;
    color[6*i+4] = col.g;
    color[6*i+5] = col.b;
  }
  return color;
}

// draw quads as 2 triangles: 4 attributes / quad, 6 indices / quad
function make_quad_index_buffer(len: number) {
  const index = (4*len < 65536 ? new Uint16Array(6*len)
                               : new Uint32Array(6*len));
  const vert_order = [0, 1, 2, 0, 2, 3];
  for (let i = 0; i < len; i++) {
    for (let j = 0; j < 6; j++) {
      index[6*i+j] = 4*i + vert_order[j];
    }
  }
  return new BufferAttribute(index, 1);
}

function normalize_vec(v: Num3, fallback: Num3): Num3 {
  const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
  if (len < 1e-6) return [fallback[0], fallback[1], fallback[2]];
  return [v[0]/len, v[1]/len, v[2]/len];
}

function scale_vec(v: Num3, factor: number): Num3 {
  return [factor * v[0], factor * v[1], factor * v[2]];
}

function add_vec(a: Num3, b: Num3): Num3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function cross_vec(a: Num3, b: Num3): Num3 {
  return [a[1]*b[2] - a[2]*b[1],
          a[2]*b[0] - a[0]*b[2],
          a[0]*b[1] - a[1]*b[0]];
}

function rotate_about_axis(v: Num3, axis: Num3, angle: number): Num3 {
  const cos_a = Math.cos(angle);
  const sin_a = Math.sin(angle);
  const dot = v[0]*axis[0] + v[1]*axis[1] + v[2]*axis[2];
  const cross = cross_vec(axis, v);
  return [
    v[0] * cos_a + cross[0] * sin_a + axis[0] * dot * (1 - cos_a),
    v[1] * cos_a + cross[1] * sin_a + axis[1] * dot * (1 - cos_a),
    v[2] * cos_a + cross[2] * sin_a + axis[2] * dot * (1 - cos_a),
  ];
}

type CartoonKind = 'h' | 's' | 'c' | 'arrow start' | 'arrow end';

function cartoon_kind(atom: Atom): CartoonKind {
  return atom.ss === 'Helix' ? 'h' : atom.ss === 'Strand' ? 's' : 'c';
}

function compute_cartoon_kinds(vertices: Atom[]): CartoonKind[] {
  const kinds: CartoonKind[] = vertices.map(cartoon_kind);
  let strand_start = -1;
  for (let i = 0; i <= vertices.length; i++) {
    const in_strand = i < vertices.length && kinds[i] === 's';
    if (in_strand) {
      if (strand_start < 0) strand_start = i;
      continue;
    }
    if (strand_start >= 0 && i - strand_start >= 2) {
      kinds[i - 2] = 'arrow start';
      kinds[i - 1] = 'arrow end';
    }
    strand_start = -1;
  }
  return kinds;
}


const wide_segments_vert = `
attribute vec3 color;
attribute vec3 other;
attribute float side;
uniform vec2 win_size;
uniform float linewidth;
varying vec3 vcolor;

void main() {
  vcolor = color;
  mat4 mat = projectionMatrix * modelViewMatrix;
  vec2 dir = normalize((mat * vec4(position - other, 0.0)).xy);
  vec2 normal = vec2(-dir.y, dir.x);
  gl_Position = mat * vec4(position, 1.0);
  gl_Position.xy += side * linewidth * normal / win_size;
}`;

function interpolate_vertices(segment: Atom[], smooth: number): Vector3[] {
  const vertices = [];
  for (let i = 0; i < segment.length; i++) {
    const xyz = segment[i].xyz;
    vertices.push(new Vector3(xyz[0], xyz[1], xyz[2]));
  }
  return interpolate_points(vertices, smooth);
}

function interpolate_points(points: Vector3[], smooth: number): Vector3[] {
  if (!smooth || smooth < 2) return points;
  const curve = new CatmullRomCurve3(points);
  return curve.getPoints((points.length - 1) * smooth);
}

function interpolate_colors(colors: Color[], smooth: number) {
  if (!smooth || smooth < 2) return colors;
  const ret = [];
  for (let i = 0; i < colors.length - 1; i++) {
    for (let j = 0; j < smooth; j++) {
      // currently we don't really interpolate colors
      ret.push(colors[i]);
    }
  }
  ret.push(colors[colors.length - 1]);
  return ret;
}

function interpolate_numbers(values: number[], smooth: number) {
  if (!smooth || smooth < 2) return values;
  const ret = [];
  let i;
  for (i = 0; i < values.length - 1; i++) {
    const p = values[i];
    const n = values[i+1];
    for (let j = 0; j < smooth; j++) {
      const an = j / smooth;
      const ap = 1 - an;
      ret.push(ap * p + an * n);
    }
  }
  ret.push(values[i]);
  return ret;
}

// a simplistic linear interpolation, no need to SLERP
function interpolate_directions(dirs: Num3[], smooth: number) {
  smooth = smooth || 1;
  const ret = [];
  let i;
  for (i = 0; i < dirs.length - 1; i++) {
    const p = dirs[i];
    const n = dirs[i+1];
    for (let j = 0; j < smooth; j++) {
      const an = j / smooth;
      const ap = 1 - an;
      ret.push(ap*p[0] + an*n[0], ap*p[1] + an*n[1], ap*p[2] + an*n[2]);
    }
  }
  ret.push(dirs[i][0], dirs[i][1], dirs[i][2]);
  return ret;
}

export function makeUniforms(params: Record<string, any>) {
  const uniforms: Record<string, {value: any}> = {
    fogNear: { value: null },  // will be updated in setProgram()
    fogFar: { value: null },
    fogColor: { value: null },
  };
  for (const [p, v] of Object.entries(params)) {
    uniforms[p] = { value: v };
  }
  return uniforms;
}

const ribbon_vert = `
attribute vec3 color;
attribute vec3 tan;
uniform float shift;
varying vec3 vcolor;
void main() {
  vcolor = color;
  vec3 pos = position + shift * normalize(tan);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

// 9-line ribbon
export function makeRibbon(vertices: Atom[],
                           colors: Color[],
                           tangents: Num3[],
                           smoothness: number) {
  const vertex_arr = interpolate_vertices(vertices, smoothness);
  const color_arr = interpolate_colors(colors, smoothness);
  const tang_arr = interpolate_directions(tangents, smoothness);
  const obj = new Object3D();
  const geometry = new BufferGeometry();
  const pos = new Float32Array(vertex_arr.length * 3);
  for (let i = 0; i < vertex_arr.length; i++) {
    const v = vertex_arr[i];
    pos[3*i+0] = v.x;
    pos[3*i+1] = v.y;
    pos[3*i+2] = v.z;
  }
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', makeColorAttribute(color_arr));
  const tan = new Float32Array(tang_arr);
  geometry.setAttribute('tan', new BufferAttribute(tan, 3));
  for (let n = -4; n < 5; n++) {
    const material = new ShaderMaterial({
      uniforms: makeUniforms({shift: 0.1 * n}),
      vertexShader: ribbon_vert,
      fragmentShader: varcolor_frag,
      fog: true,
      type: 'um_ribbon',
    });
    obj.add(new Line(geometry, material));
  }
  return obj;
}

const cartoon_vert = `
attribute vec3 color;
attribute vec3 normal;
varying vec3 vcolor;
varying vec3 vnormal;
void main() {
  vcolor = color;
  vnormal = normalize((modelViewMatrix * vec4(normal, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const cartoon_frag = `
${fog_pars_fragment}
uniform vec3 lightDir;
varying vec3 vcolor;
varying vec3 vnormal;
void main() {
  float weight = abs(dot(normalize(vnormal), normalize(lightDir))) * 0.6 + 0.4;
  gl_FragColor = vec4(weight * vcolor, 1.0);
${fog_end_fragment}
}`;

export function makeCartoon(vertices: Atom[],
                            colors: Color[],
                            tangents: Num3[],
                            smoothness: number) {
  if (vertices.length < 2) return new Object3D();
  const kinds = compute_cartoon_kinds(vertices);
  const sample_centers: Vector3[] = [];
  const sample_sides: Num3[] = [];
  const sample_widths: number[] = [];
  const sample_thicknesses: number[] = [];
  const sample_colors: Color[] = [];
  let last_side: Num3 = [0, 0, 1];
  for (let i = 0; i < vertices.length; i++) {
    let side = normalize_vec(tangents[i], last_side);
    if (side[0]*last_side[0] + side[1]*last_side[1] + side[2]*last_side[2] < 0) {
      side[0] = -side[0];
      side[1] = -side[1];
      side[2] = -side[2];
    }
    let center: Num3 = [vertices[i].xyz[0], vertices[i].xyz[1], vertices[i].xyz[2]];
    const prev = vertices[Math.max(i - 1, 0)].xyz;
    const next = vertices[Math.min(i + 1, vertices.length - 1)].xyz;
    const forward = normalize_vec([next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]],
                                  [1, 0, 0]);
    const kind = kinds[i];
    let width = 0.5;
    let thickness = 0.16;
    if (kind === 'h') {
      width = 1.3;
      thickness = 0.20;
    } else if (kind === 's' || kind === 'arrow start') {
      width = 1.3;
      thickness = 0.16;
    } else if (kind === 'arrow end') {
      width = 0.5;
      thickness = 0.12;
    }
    if (kind === 'arrow start') {
      center = add_vec(center, cross_vec(scale_vec(forward, 0.3), side));
      const up = normalize_vec(cross_vec(forward, side), [0, 0, 1]);
      side = normalize_vec(rotate_about_axis(side, up, 0.43), side);
    }
    sample_centers.push(new Vector3(center[0], center[1], center[2]));
    sample_sides.push(side);
    sample_widths.push(width);
    sample_thicknesses.push(thickness);
    sample_colors.push(colors[i]);
    if (kind === 'arrow start') {
      sample_centers.push(new Vector3(center[0], center[1], center[2]));
      sample_sides.push(side);
      sample_widths.push(2.0 * width);
      sample_thicknesses.push(0.9 * thickness);
      sample_colors.push(colors[i]);
    }
    last_side = side;
  }

  const rail_count = 7;
  const rails: Vector3[][] = [];
  for (let j = 0; j < rail_count; j++) rails.push([]);
  for (let i = 0; i < sample_centers.length; i++) {
    const center = sample_centers[i];
    const side = sample_sides[i];
    const width = sample_widths[i];
    for (let j = 0; j < rail_count; j++) {
      const delta = -1 + 2 * j / (rail_count - 1);
      rails[j].push(new Vector3(center.x + delta * width * side[0],
                                center.y + delta * width * side[1],
                                center.z + delta * width * side[2]));
    }
  }

  const centerline = interpolate_points(sample_centers, smoothness);
  if (centerline.length < 2) return new Object3D();
  const color_arr = interpolate_colors(sample_colors, smoothness);
  const thickness_arr = interpolate_numbers(sample_thicknesses, smoothness);
  const interp_rails = rails.map((rail) => interpolate_points(rail, smoothness));
  const ups: Num3[] = [];
  const axes: Num3[] = [];
  let last_up: Num3 = [0, 0, 1];
  for (let i = 0; i < centerline.length; i++) {
    const left = interp_rails[0][i];
    const right = interp_rails[rail_count - 1][i];
    const axis = normalize_vec([right.x - left.x, right.y - left.y, right.z - left.z],
                               [1, 0, 0]);
    const prev = centerline[Math.max(i - 1, 0)];
    const next = centerline[Math.min(i + 1, centerline.length - 1)];
    const forward = normalize_vec([next.x - prev.x, next.y - prev.y, next.z - prev.z],
                                  [0, 1, 0]);
    const up = normalize_vec(cross_vec(axis, forward), last_up);
    if (up[0]*last_up[0] + up[1]*last_up[1] + up[2]*last_up[2] < 0) {
      up[0] = -up[0];
      up[1] = -up[1];
      up[2] = -up[2];
    }
    axes.push(axis);
    ups.push(up);
    last_up = up;
  }

  const profile = [];
  for (let j = 0; j < rail_count; j++) {
    profile.push(0.5);
  }
  const quad_count = (centerline.length - 1) * (2 * (rail_count - 1) + 2);
  const pos = new Float32Array(quad_count * 12);
  const col = new Float32Array(quad_count * 12);
  const norm = new Float32Array(quad_count * 12);
  function add_quad(quad_id: number, quad: Num3[], quad_normals: Num3[],
                    c0: Color, c1: Color) {
    const quad_colors = [c0, c0, c1, c1];
    for (let j = 0; j < 4; j++) {
      const k = 12*quad_id + 3*j;
      pos[k+0] = quad[j][0];
      pos[k+1] = quad[j][1];
      pos[k+2] = quad[j][2];
      col[k+0] = quad_colors[j].r;
      col[k+1] = quad_colors[j].g;
      col[k+2] = quad_colors[j].b;
      norm[k+0] = quad_normals[j][0];
      norm[k+1] = quad_normals[j][1];
      norm[k+2] = quad_normals[j][2];
    }
  }

  let quad_id = 0;
  for (let i = 0; i < centerline.length - 1; i++) {
    const c0 = color_arr[i];
    const c1 = color_arr[i+1];
    const top0: Num3[] = [];
    const top1: Num3[] = [];
    const bot0: Num3[] = [];
    const bot1: Num3[] = [];
    for (let j = 0; j < rail_count; j++) {
      const p0 = interp_rails[j][i];
      const p1 = interp_rails[j][i+1];
      const u0 = scale_vec(ups[i], thickness_arr[i] * profile[j]);
      const u1 = scale_vec(ups[i+1], thickness_arr[i+1] * profile[j]);
      top0.push([p0.x + u0[0], p0.y + u0[1], p0.z + u0[2]]);
      top1.push([p1.x + u1[0], p1.y + u1[1], p1.z + u1[2]]);
      bot0.push([p0.x - u0[0], p0.y - u0[1], p0.z - u0[2]]);
      bot1.push([p1.x - u1[0], p1.y - u1[1], p1.z - u1[2]]);
    }
    for (let j = 0; j < rail_count - 1; j++) {
      add_quad(quad_id++,
               [top0[j], top0[j+1], top1[j+1], top1[j]],
               [ups[i], ups[i], ups[i+1], ups[i+1]],
               c0, c1);
      add_quad(quad_id++,
               [bot0[j], bot1[j], bot1[j+1], bot0[j+1]],
               [[-ups[i][0], -ups[i][1], -ups[i][2]],
                [-ups[i+1][0], -ups[i+1][1], -ups[i+1][2]],
                [-ups[i+1][0], -ups[i+1][1], -ups[i+1][2]],
                [-ups[i][0], -ups[i][1], -ups[i][2]]],
               c0, c1);
    }
    add_quad(quad_id++,
             [top0[0], top1[0], bot1[0], bot0[0]],
             [[-axes[i][0], -axes[i][1], -axes[i][2]],
              [-axes[i+1][0], -axes[i+1][1], -axes[i+1][2]],
              [-axes[i+1][0], -axes[i+1][1], -axes[i+1][2]],
              [-axes[i][0], -axes[i][1], -axes[i][2]]],
             c0, c1);
    add_quad(quad_id++,
             [top0[rail_count - 1], bot0[rail_count - 1],
              bot1[rail_count - 1], top1[rail_count - 1]],
             [axes[i], axes[i], axes[i+1], axes[i+1]],
             c0, c1);
  }

  if (quad_id === 0) {
    return new Object3D();
  }
  const used_pos = pos.subarray(0, quad_id * 12);
  const used_col = col.subarray(0, quad_id * 12);
  const used_norm = norm.subarray(0, quad_id * 12);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(used_pos, 3));
  geometry.setAttribute('color', new BufferAttribute(used_col, 3));
  geometry.setAttribute('normal', new BufferAttribute(used_norm, 3));
  geometry.setIndex(make_quad_index_buffer(quad_id));
  const material = new ShaderMaterial({
    uniforms: makeUniforms({lightDir: light_dir}),
    vertexShader: cartoon_vert,
    fragmentShader: cartoon_frag,
    fog: true,
    type: 'um_cartoon',
  });
  return new Mesh(geometry, material);
}


export
function makeChickenWire(data: IsosurfaceData,
                         options: {[key: string]: unknown}) {
  const geom = new BufferGeometry();
  const position = new Float32Array(data.vertices);
  geom.setAttribute('position', new BufferAttribute(position, 3));

  // Although almost all browsers support OES_element_index_uint nowadays,
  // use Uint32 indexes only when needed.
  const arr = (data.vertices.length < 3*65536 ? new Uint16Array(data.segments)
                                              : new Uint32Array(data.segments));
  //console.log('arr len:', data.vertices.length, data.segments.length);
  geom.setIndex(new BufferAttribute(arr, 1));
  const material = new ShaderMaterial({
    uniforms: makeUniforms({vcolor: options.color}),
    vertexShader: unicolor_vert,
    fragmentShader: unicolor_frag,
    fog: true,
    linewidth: options.linewidth,
    type: 'um_line_chickenwire',
  });
  return new LineSegments(geom, material);
}


const grid_vert = `
uniform vec3 ucolor;
uniform vec3 fogColor;
varying vec4 vcolor;
void main() {
  vec2 scale = vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
  float z = position.z;
  float fogFactor = (z > 0.5 ? 0.2 : 0.7);
  float alpha = 0.8 * smoothstep(z > 1.5 ? -10.0 : 0.01, 0.1, scale.y);
  vcolor = vec4(mix(ucolor, fogColor, fogFactor), alpha);
  gl_Position = vec4(position.xy * scale, -0.99, 1.0);
}`;

const grid_frag = `
varying vec4 vcolor;
void main() {
  gl_FragColor = vcolor;
}`;

export function makeGrid(): LineSegments {
  const N = 50;
  const pos = [];
  for (let i = -N; i <= N; i++) {
    let z = 0; // z only marks major/minor axes
    if (i % 5 === 0) z = i % 2 === 0 ? 2 : 1;
    pos.push(-N, i, z, N, i, z);  // horizontal line
    pos.push(i, -N, z, i, N, z);  // vertical line
  }
  const geom = new BufferGeometry();
  const pos_arr = new Float32Array(pos);
  geom.setAttribute('position', new BufferAttribute(pos_arr, 3));
  const material = new ShaderMaterial({
    uniforms: makeUniforms({ucolor: new Color(0x888888)}),
    //linewidth: 3,
    vertexShader: grid_vert,
    fragmentShader: grid_frag,
    fog: true, // no really, but we use fogColor
    type: 'um_grid',
  });
  material.transparent = true;
  const obj = new LineSegments(geom, material);
  obj.frustumCulled = false;  // otherwise the renderer could skip it
  return obj;
}


export function makeLineMaterial(options: Record<string, any>) {
  const uniforms = makeUniforms({
    linewidth: options.linewidth,
    win_size: options.win_size,
  });
  return new ShaderMaterial({
    uniforms: uniforms,
    vertexShader: wide_segments_vert,
    fragmentShader: varcolor_frag,
    fog: true,
    type: 'um_line',
  });
}

// vertex_arr and color_arr must be of the same length
export function makeLineSegments(material: ShaderMaterial,
                                 vertex_arr: Num3[],
                                 color_arr?: Color[]) {
  // n input vertices => 2n output vertices, n triangles, 3n indexes
  const len = vertex_arr.length;
  const pos = double_pos(vertex_arr);
  const position = new Float32Array(pos);
  const other_vert = new Float32Array(6*len);
  for (let i = 0; i < 6 * len; i += 12) {
    let j = 0;
    for (; j < 6; j++) other_vert[i+j] = pos[i+j+6];
    for (; j < 12; j++) other_vert[i+j] = pos[i+j-6];
  }
  const side = new Float32Array(2*len);
  for (let k = 0; k < len; k++) {
    side[2*k] = -1;
    side[2*k+1] = 1;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('other', new BufferAttribute(other_vert, 3));
  geometry.setAttribute('side', new BufferAttribute(side, 1));
  if (color_arr != null) {
    const color = double_color(color_arr);
    geometry.setAttribute('color', new BufferAttribute(color, 3));
  }
  geometry.setIndex(make_quad_index_buffer(len/2));

  const mesh = new Mesh(geometry, material);
  //mesh.userData.bond_lines = true;
  return mesh;
}

const wheel_vert = `
attribute vec3 color;
uniform float size;
varying vec3 vcolor;
void main() {
  vcolor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size;
}`;

// not sure how portable it is
const wheel_frag = `
${fog_pars_fragment}
varying vec3 vcolor;
void main() {
  vec2 diff = gl_PointCoord - vec2(0.5, 0.5);
  if (dot(diff, diff) >= 0.25) discard;
  gl_FragColor = vec4(vcolor, 1.0);
${fog_end_fragment}
}`;

export function makeWheels(atom_arr: Atom[], color_arr: Color[], size: number) {
  const geometry = new BufferGeometry();
  const pos = new Float32Array(atom_arr.length * 3);
  for (let i = 0; i < atom_arr.length; i++) {
    const xyz = atom_arr[i].xyz;
    pos[3*i+0] = xyz[0];
    pos[3*i+1] = xyz[1];
    pos[3*i+2] = xyz[2];
  }
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', makeColorAttribute(color_arr));
  const material = new ShaderMaterial({
    uniforms: makeUniforms({size: size}),
    vertexShader: wheel_vert,
    fragmentShader: wheel_frag,
    fog: true,
    type: 'um_wheel',
  });
  const obj = new Points(geometry, material);
  return obj;
}

// For the ball-and-stick rendering we use so-called imposters.
// This technique was described in:
// http://doi.ieeecomputersociety.org/10.1109/TVCG.2006.115
// free copy here:
// http://vcg.isti.cnr.it/Publications/2006/TCM06/Tarini_FinalVersionElec.pdf
// and was nicely summarized in:
// http://www.sunsetlakesoftware.com/2011/05/08/enhancing-molecules-using-opengl-es-20

const sphere_vert = `
attribute vec3 color;
attribute vec2 corner;
uniform float radius;
varying vec3 vcolor;
varying vec2 vcorner;
varying vec3 vpos;

void main() {
  vcolor = color;
  vcorner = corner;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vpos = mvPosition.xyz;
  mvPosition.xy += corner * radius;
  gl_Position = projectionMatrix * mvPosition;
}
`;

// based on 3Dmol imposter shaders
const sphere_frag = `
${fog_pars_fragment}
uniform mat4 projectionMatrix;
uniform vec3 lightDir;
uniform float radius;
varying vec3 vcolor;
varying vec2 vcorner;
varying vec3 vpos;

void main() {
  float sq = dot(vcorner, vcorner);
  if (sq > 1.0) discard;
  float z = sqrt(1.0-sq);
  vec3 xyz = vec3(vcorner.x, vcorner.y, z);
  vec4 projPos = projectionMatrix * vec4(vpos + radius * xyz, 1.0);
  gl_FragDepthEXT = 0.5 * ((gl_DepthRange.diff * (projPos.z / projPos.w)) +
                           gl_DepthRange.near + gl_DepthRange.far);
  float weight = clamp(dot(xyz, lightDir), 0.0, 1.0) * 0.8 + 0.2;
  gl_FragColor = vec4(weight * vcolor, 1.0);
  ${fog_end_fragment}
}
`;

const stick_vert = `
attribute vec3 color;
attribute vec3 axis;
attribute vec2 corner;
uniform float radius;
varying vec3 vcolor;
varying vec2 vcorner;
varying vec3 vpos;
varying vec3 vaxis;

void main() {
  vcolor = color;
  vcorner = corner;
  vaxis = normalize((modelViewMatrix * vec4(axis, 0.0)).xyz);
  vec2 normal = normalize(vec2(-vaxis.y, vaxis.x));
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vpos = mvPosition.xyz;
  mvPosition.xy += corner[1] * radius * normal;
  gl_Position = projectionMatrix * mvPosition;
}`;

const stick_frag = `
${fog_pars_fragment}
uniform mat4 projectionMatrix;
uniform vec3 lightDir;
uniform float radius;
uniform float shineStrength;
uniform float shinePower;
uniform vec3 shineColor;
varying vec3 vcolor;
varying vec2 vcorner;
varying vec3 vpos;
varying vec3 vaxis;
void main() {
  float central = 1.0 - vcorner[1] * vcorner[1];
  vec4 pos = vec4(vpos, 1.0);
  pos.z += radius * vaxis.z * central;
  vec4 projPos = projectionMatrix * pos;
  gl_FragDepthEXT = 0.5 * ((gl_DepthRange.diff * (projPos.z / projPos.w)) +
                           gl_DepthRange.near + gl_DepthRange.far);
  float diffuse = length(cross(vaxis, lightDir)) * central;
  float weight = diffuse * 0.8 + 0.2;
  float specular = shineStrength * pow(clamp(diffuse, 0.0, 1.0), shinePower) * central;
  vec3 shaded = min(weight, 1.0) * vcolor;
  gl_FragColor = vec4(min(shaded + specular * shineColor, 1.0), 1.0);
${fog_end_fragment}
}`;

type StickOptions = {
  shineStrength?: number,
  shinePower?: number,
  shineColor?: Color,
};

export
function makeSticks(vertex_arr: Num3[], color_arr: Color[], radius: number,
                    options: StickOptions = {}) {
  const uniforms = makeUniforms({
    radius: radius,
    lightDir: light_dir,
    shineStrength: options.shineStrength || 0.0,
    shinePower: options.shinePower || 8.0,
    shineColor: options.shineColor || new Color(0xffffff),
  });
  const material = new ShaderMaterial({
    uniforms: uniforms,
    vertexShader: stick_vert,
    fragmentShader: stick_frag,
    fog: true,
    type: 'um_stick',
  });
  material.extensions.fragDepth = true;

  const len = vertex_arr.length;
  const pos = double_pos(vertex_arr);
  const position = new Float32Array(pos);
  const axis = new Float32Array(6*len);
  for (let i = 0; i < 6 * len; i += 12) {
    for (let j = 0; j < 6; j++) axis[i+j] = pos[i+j+6] - pos[i+j];
    for (let j = 0; j < 6; j++) axis[i+j+6] = axis[i+j];
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  const corner = new Float32Array(4*len);
  for (let i = 0; 2 * i < len; i++) {
    corner[8*i + 0] = -1;  // 0
    corner[8*i + 1] = -1;  // 0
    corner[8*i + 2] = -1;  // 1
    corner[8*i + 3] = +1;  // 1
    corner[8*i + 4] = +1;  // 2
    corner[8*i + 5] = +1;  // 2
    corner[8*i + 6] = +1;  // 3
    corner[8*i + 7] = -1;  // 3
  }
  geometry.setAttribute('axis', new BufferAttribute(axis, 3));
  geometry.setAttribute('corner', new BufferAttribute(corner, 2));
  const color = double_color(color_arr);
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setIndex(make_quad_index_buffer(len/2));

  const mesh = new Mesh(geometry, material);
  //mesh.userData.bond_lines = true;
  return mesh;
}

export
function makeBalls(atom_arr: Atom[], color_arr: Color[], radius: number) {
  const N = atom_arr.length;
  const geometry = new BufferGeometry();

  const pos = new Float32Array(N * 4 * 3);
  for (let i = 0; i < N; i++) {
    const xyz = atom_arr[i].xyz;
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 3; k++) {
        pos[3 * (4*i + j) + k] = xyz[k];
      }
    }
  }
  geometry.setAttribute('position', new BufferAttribute(pos, 3));

  const corner = new Float32Array(N * 4 * 2);
  for (let i = 0; i < N; i++) {
    corner[8*i + 0] = -1;  // 0
    corner[8*i + 1] = -1;  // 0
    corner[8*i + 2] = -1;  // 1
    corner[8*i + 3] = +1;  // 1
    corner[8*i + 4] = +1;  // 2
    corner[8*i + 5] = +1;  // 2
    corner[8*i + 6] = +1;  // 3
    corner[8*i + 7] = -1;  // 3
  }
  geometry.setAttribute('corner', new BufferAttribute(corner, 2));

  const colors = new Float32Array(N * 4 * 3);
  for (let i = 0; i < N; i++) {
    const col = color_arr[i];
    for (let j = 0; j < 4; j++) {
      colors[3 * (4*i + j) + 0] = col.r;
      colors[3 * (4*i + j) + 1] = col.g;
      colors[3 * (4*i + j) + 2] = col.b;
    }
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  geometry.setIndex(make_quad_index_buffer(N));

  const material = new ShaderMaterial({
    uniforms: makeUniforms({
      radius: radius,
      lightDir: light_dir,
    }),
    vertexShader: sphere_vert,
    fragmentShader: sphere_frag,
    fog: true,
    type: 'um_sphere',
  });
  material.extensions.fragDepth = true;
  const obj = new Mesh(geometry, material);
  return obj;
}

const label_vert = `
attribute vec2 uvs;
uniform vec2 canvas_size;
uniform vec2 win_size;
uniform float z_shift;
varying vec2 vUv;
void main() {
  vUv = uvs;
  vec2 rel_offset = vec2(0.02, -0.3);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.xy += (uvs + rel_offset) * 2.0 * canvas_size / win_size;
  gl_Position.z += z_shift * projectionMatrix[2][2];
}`;

const label_frag = `
${fog_pars_fragment}
varying vec2 vUv;
uniform sampler2D map;
void main() {
  gl_FragColor = texture2D(map, vUv);
${fog_end_fragment}
}`;

export class Label {
  texture: Texture;
  mesh?: Mesh;

  constructor(text: string, options: Record<string, any>) {
    this.texture = new Texture();
    const canvas_size = this.redraw(text, options);
    if (canvas_size === undefined) return;

    // Rectangle geometry.
    const geometry = new BufferGeometry();
    const pos = options.pos;
    const position = new Float32Array([].concat(pos, pos, pos, pos));
    const uvs = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 2, 1, 2, 3, 1]);
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('uvs', new BufferAttribute(uvs, 2));

    const material = new ShaderMaterial({
      uniforms: makeUniforms({map: this.texture,
                              canvas_size: canvas_size,
                              win_size: options.win_size,
                              z_shift: options.z_shift}),
      vertexShader: label_vert,
      fragmentShader: label_frag,
      fog: true,
      type: 'um_label',
    });
    material.transparent = true;
    this.mesh = new Mesh(geometry, material);
  }

  redraw(text: string, options: Record<string, any>) {
    if (typeof document === 'undefined') return;  // for testing on node
    const canvas = document.createElement('canvas');
    // Canvas size should be 2^N.
    canvas.width = 256;  // arbitrary limit, to keep it simple
    canvas.height = 16;  // font size
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.font = (options.font || 'bold 14px') + ' sans-serif';
    //context.fillStyle = 'green';
    //context.fillRect(0, 0, canvas.width, canvas.height);
    context.textBaseline = 'bottom';
    if (options.color) context.fillStyle = options.color;
    context.fillText(text, 0, canvas.height);
    this.texture.image = canvas;
    this.texture.needsUpdate = true;
    return [canvas.width, canvas.height];
  }
}


// Add vertices of a 3d cross (representation of an unbonded atom)
export
function addXyzCross(vertices: Num3[], xyz: Num3, r: number) {
  vertices.push([xyz[0]-r, xyz[1], xyz[2]], [xyz[0]+r, xyz[1], xyz[2]]);
  vertices.push([xyz[0], xyz[1]-r, xyz[2]], [xyz[0], xyz[1]+r, xyz[2]]);
  vertices.push([xyz[0], xyz[1], xyz[2]-r], [xyz[0], xyz[1], xyz[2]+r]);
}
