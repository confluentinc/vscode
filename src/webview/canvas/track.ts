const UNIT = /^[\d.]+u$/;
const FRAC = /^[\d.]+f$/;

/**
 * Implements one dimensional grid-like layout binning scale.
 *
 * ```js
 * let columns = track(["20u", "1f", "50u"], containerWidth);
 * let rows = track(["15u", "20u", "1f", "20u"], containerHeight);
 * let [x0, x1] = columns(1);
 * let scaleX = scaleLinear(domainX, [x0, x1]);
 * ```
 */
export function track(
  template: string[],
  length: number,
  padding = 0,
  gap = 0,
  u = 1,
): (start: number, span?: number) => [number, number] {
  let n = template.length;
  let nUnits = 0;
  let nFractions = 0;
  for (let index = 0; index < n; index++) {
    let def = template[index];
    if (FRAC.test(def)) nFractions += parseFloat(def);
    else if (UNIT.test(def)) nUnits += parseFloat(def);
  }
  let f = Math.max(0, (length - 2 * padding - nUnits * u - (n - 1) * gap) / nFractions);
  let bins = template.map((def) => {
    if (FRAC.test(def)) return parseFloat(def) * f;
    else if (UNIT.test(def)) return parseFloat(def) * u;
    else throw new Error(`Unknown unit ${def}`);
  });
  return (start, span = 1) => {
    if (start < 0 || span < 0) throw new Error("invariant");
    let offset = reduce(bins, 0, start, (a, b) => a + b, 0) + padding + start * gap;
    let limit = reduce(bins, start, span, (a, b) => a + b, 0) + (span - 1) * gap;
    return [offset, offset + limit];
  };
}

function reduce<T>(
  array: T[],
  offset: number,
  limit: number,
  reducer: (a: T, b: T) => T,
  result: T,
) {
  for (let index = offset; index < offset + limit; index++) {
    result = reducer(result, array[index]);
  }
  return result;
}
