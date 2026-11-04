import { useCallback, useRef } from "react";

/**
 * Row offsets for a long list whose rows wrap. Without them, React Native's list only makes room
 * for rows it has drawn, so a jump to a far file stops at the end of what's drawn. Each row starts
 * from an estimate and switches to its measured height once drawn; offsets are summed lazily
 * because measurements arrive by the hundred.
 */
export function useRowMetrics<Row extends { key: string }>(
  rows: readonly Row[],
  estimate: (row: Row) => number,
) {
  const measured = useRef(new Map<string, number>());
  const cache = useRef<{ rows: readonly Row[]; estimate: unknown; offsets: Float64Array } | null>(
    null,
  );

  const offsets = useCallback(() => {
    const current = cache.current;
    if (current && current.rows === rows && current.estimate === estimate) return current.offsets;
    const sums = new Float64Array(rows.length + 1);
    rows.forEach((row, index) => {
      sums[index + 1] = sums[index]! + (measured.current.get(row.key) ?? estimate(row));
    });
    cache.current = { rows, estimate, offsets: sums };
    return sums;
  }, [rows, estimate]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<Row> | null | undefined, index: number) => {
      const sums = offsets();
      return { length: sums[index + 1]! - sums[index]!, offset: sums[index]!, index };
    },
    [offsets],
  );

  const onRowLayout = useCallback((key: string, height: number) => {
    if (measured.current.get(key) === height) return;
    measured.current.set(key, height);
    cache.current = null;
  }, []);

  // A new width rewraps every line, so heights measured at the old one no longer hold.
  const forgetMeasured = useCallback(() => {
    measured.current.clear();
    cache.current = null;
  }, []);

  return { getItemLayout, onRowLayout, forgetMeasured };
}
