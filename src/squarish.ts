import type { IsosurfaceData, IsosurfaceField } from './elmap';
import {
  EDGE_INDEX,
  EDGE_TABLE,
  SQUARISH_SEGMENT_TABLE_DATA,
  SQUARISH_SEGMENT_TABLE_OFFSETS,
} from './squarish-tables';

const CUBE_VERTS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
] as const;

function point_offset(size: [number, number, number], i: number, j: number, k: number) {
  return k + size[2] * (j + size[1] * i);
}

function axis_point(field: IsosurfaceField, i: number, j: number, k: number) {
  return [
    field.origin[0] + i * field.axis_x[0] + j * field.axis_y[0] + k * field.axis_z[0],
    field.origin[1] + i * field.axis_x[1] + j * field.axis_y[1] + k * field.axis_z[1],
    field.origin[2] + i * field.axis_x[2] + j * field.axis_y[2] + k * field.axis_z[2],
  ] as [number, number, number];
}

export function squarishIsomesh(field: IsosurfaceField, isolevel: number): IsosurfaceData {
  const size = field.size;
  const values = field.values;
  const vertices: number[] = [];
  const segments: number[] = [];
  const vert_offsets = new Int32Array(8);
  for (let i = 0; i < 8; ++i) {
    const vert = CUBE_VERTS[i];
    vert_offsets[i] = point_offset(size, vert[0], vert[1], vert[2]);
  }

  const vertex_values = new Float32Array(8);
  const vlist = new Uint32Array(12);
  let vertex_count = 0;

  for (let x = 0; x < size[0] - 1; ++x) {
    for (let y = 0; y < size[1] - 1; ++y) {
      for (let z = 0; z < size[2] - 1; ++z) {
        const offset0 = point_offset(size, x, y, z);
        let cubeindex = 0;
        for (let i = 0; i < 8; ++i) {
          const point_index = offset0 + vert_offsets[i];
          cubeindex |= (values[point_index] < isolevel) ? (1 << i) : 0;
        }
        if (cubeindex === 0 || cubeindex === 255) continue;

        for (let i = 0; i < 8; ++i) {
          vertex_values[i] = values[offset0 + vert_offsets[i]];
        }

        const edge_mask = EDGE_TABLE[cubeindex];
        for (let i = 0; i < 12; ++i) {
          if ((edge_mask & (1 << i)) === 0) continue;
          const edge = EDGE_INDEX[i];
          const v0 = edge[0];
          const v1 = edge[1];
          const mu = (isolevel - vertex_values[v0]) /
                     (vertex_values[v1] - vertex_values[v0]);
          const p0 = axis_point(field, x + CUBE_VERTS[v0][0], y + CUBE_VERTS[v0][1], z + CUBE_VERTS[v0][2]);
          const p1 = axis_point(field, x + CUBE_VERTS[v1][0], y + CUBE_VERTS[v1][1], z + CUBE_VERTS[v1][2]);
          vertices.push(
            p0[0] + (p1[0] - p0[0]) * mu,
            p0[1] + (p1[1] - p0[1]) * mu,
            p0[2] + (p1[2] - p0[2]) * mu
          );
          vlist[i] = vertex_count++;
        }

        for (let i = SQUARISH_SEGMENT_TABLE_OFFSETS[cubeindex];
          i < SQUARISH_SEGMENT_TABLE_OFFSETS[cubeindex + 1];
          ++i) {
          segments.push(vlist[SQUARISH_SEGMENT_TABLE_DATA[i]]);
        }
      }
    }
  }

  return {
    vertices: new Float32Array(vertices),
    segments: new Uint32Array(segments),
    field: field,
  };
}
