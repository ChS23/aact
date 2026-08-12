import { fc, test as propTest } from "@fast-check/vitest";

import { hungarian } from "../../src/diff/hungarian";

describe("hungarian", () => {
  it("handles empty matrix", () => {
    const { assignment, totalCost } = hungarian([]);
    expect(assignment).toEqual([]);
    expect(totalCost).toBe(0);
  });

  it("handles single row", () => {
    const result = hungarian([[1, 2, 3]]);
    expect(result.assignment).toEqual([0]);
    expect(result.totalCost).toBe(1);
  });

  it("handles 2x2 — picks globally optimal pair", () => {
    // greedy on this matrix would pick (0,0)=1 + (1,1)=4 = 5
    // optimal: (0,1)=2 + (1,0)=3 = 5 — same total here
    // make them differ:
    //   r=0: [1, 100]
    //   r=1: [2, 3]
    // greedy by best-first: 1 then 3 = 4. Hungarian: also 4 (1+3).
    // The case where greedy fails:
    //   r=0: [3, 4]
    //   r=1: [1, 100]
    // Greedy sorts: 100 last, picks 1 first (assign r=1 to c=0). Then r=0
    // gets c=1 = 4. Total = 1+4 = 5. Hungarian global: (3, 100) impossible
    // or (4, 1) = 5. Same answer actually.
    // Real divergence:
    //   r=0: [3, 1]
    //   r=1: [4, 5]
    // Sort all entries desc by negative score: 5,4,3,1.
    // Greedy take-min-first equivalent: pick 1 first (r=0,c=1).
    // Then r=1 → c=0 = 4. Total = 5.
    // Hungarian: (r=0→c=0=3) + (r=1→c=1=5) = 8 vs (r=0→c=1=1) + (r=1→c=0=4) = 5.
    // Picks the 5 — same as greedy here.
    //
    // Where greedy diverges: when local minima conflict.
    //   r=0: [2, 5]
    //   r=1: [3, 1]
    // Pick smallest globally: 1 → assign (r=1, c=1). Then r=0 → c=0 = 2. Total = 3.
    // Hungarian: (r=0→c=1=5)+(r=1→c=0=3)=8 vs (r=0→c=0=2)+(r=1→c=1=1)=3. Picks 3.
    // Same answer.
    //
    // Trying harder to find greedy-bad case. Greedy bad classic:
    //   r=0: [1, 2]
    //   r=1: [2, 4]
    // Greedy picks (r=0,c=0)=1 first, then r=1→c=1=4. Total = 5.
    // Hungarian: (r=0→c=1=2)+(r=1→c=0=2)=4. Wins.
    const result = hungarian([
      [1, 2],
      [2, 4],
    ]);
    expect(result.totalCost).toBe(4);
  });

  it("forbids assignments via Infinity cost", () => {
    const INF = Number.POSITIVE_INFINITY;
    const result = hungarian([
      [INF, 1],
      [2, INF],
    ]);
    expect(result.assignment).toEqual([1, 0]);
    expect(result.totalCost).toBe(3);
  });

  it("returns undefined for unmatchable row when no finite path", () => {
    const INF = Number.POSITIVE_INFINITY;
    // Single row can only go to c=0; but c=0 is forbidden.
    const result = hungarian([[INF]]);
    expect(result.assignment).toEqual([undefined]);
    expect(result.totalCost).toBe(0);
  });

  it("rectangular: more cols than rows leaves extra cols unused", () => {
    // 2x3: pick best 2 of 3 columns
    const result = hungarian([
      [1, 5, 9],
      [9, 1, 5],
    ]);
    // optimal: r=0→c=0(1) + r=1→c=1(1) = 2
    expect(result.totalCost).toBe(2);
    expect(result.assignment).toEqual([0, 1]);
  });

  it("rectangular: more rows than cols leaves extra rows unmatched", () => {
    // 3x2: only 2 of 3 rows can be assigned
    const result = hungarian([
      [1, 5],
      [9, 1],
      [3, 7],
    ]);
    // optimal: r=0→c=0(1), r=1→c=1(1). r=2 unassigned.
    expect(result.totalCost).toBe(2);
    expect(result.assignment[2]).toBeUndefined();
  });

  propTest.prop({
    // Square or rectangular up to 8×8, each cell in [0, 1).
    matrix: fc.integer({ min: 1, max: 8 }).chain((rows) =>
      fc.integer({ min: 1, max: 8 }).chain((cols) =>
        fc.array(
          fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
            minLength: cols,
            maxLength: cols,
          }),
          { minLength: rows, maxLength: rows },
        ),
      ),
    ),
  })(
    "hungarian total cost ≤ any greedy total cost on random matrices",
    ({ matrix }) => {
      const h = hungarian(matrix);
      const g = greedy(matrix);
      // Hungarian must produce a total no worse than greedy on the
      // same matrix. Floating-point slack for sums of doubles.
      expect(h.totalCost).toBeLessThanOrEqual(g.totalCost + 1e-9);
    },
  );
});

/** Reference greedy assignment for property comparison. */
const greedy = (
  cost: readonly (readonly number[])[],
): { totalCost: number } => {
  const rows = cost.length;
  if (rows === 0) return { totalCost: 0 };
  const cols = cost[0].length;
  const cells: { r: number; c: number; v: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Number.isFinite(cost[r][c])) cells.push({ r, c, v: cost[r][c] });
    }
  }
  cells.sort((a, b) => a.v - b.v);
  const usedRows = new Set<number>();
  const usedCols = new Set<number>();
  let total = 0;
  for (const { r, c, v } of cells) {
    if (usedRows.has(r) || usedCols.has(c)) continue;
    usedRows.add(r);
    usedCols.add(c);
    total += v;
  }
  return { totalCost: total };
};
