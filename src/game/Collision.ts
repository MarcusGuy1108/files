export interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export function makeAABB(): AABB {
  return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
}

/** Fill `out` with a box of the given size whose bottom-centre sits at (x, y, z). */
export function setAABB(out: AABB, x: number, y: number, z: number, w: number, h: number, d: number): AABB {
  out.minX = x - w / 2;
  out.maxX = x + w / 2;
  out.minY = y;
  out.maxY = y + h;
  out.minZ = z - d / 2;
  out.maxZ = z + d / 2;
  return out;
}

export function overlaps(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ
  );
}
