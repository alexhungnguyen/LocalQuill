import { applyRewriteToSpans } from "../Editor";

test("keeps spans entirely before the replaced range unchanged", () => {
  const result = applyRewriteToSpans([{ start: 0, end: 5 }], 10, 20, 7);
  expect(result).toContainEqual({ start: 0, end: 5 });
});

test("drops spans that overlap the replaced range", () => {
  // span [5,15) overlaps replacement [10,20)
  const result = applyRewriteToSpans([{ start: 5, end: 15 }], 10, 20, 7);
  expect(result.find((s) => s.start === 5 && s.end === 15)).toBeUndefined();
});

test("shifts spans after the range left when replacement is shorter", () => {
  // replacing [10,20) (10 chars) with 7 chars: delta = -3
  const result = applyRewriteToSpans([{ start: 20, end: 30 }], 10, 20, 7);
  expect(result).toContainEqual({ start: 17, end: 27 });
});

test("shifts spans after the range right when replacement is longer", () => {
  // replacing [10,20) (10 chars) with 15 chars: delta = +5
  const result = applyRewriteToSpans([{ start: 20, end: 30 }], 10, 20, 15);
  expect(result).toContainEqual({ start: 25, end: 35 });
});

test("inserts a new span covering the rewritten range", () => {
  const result = applyRewriteToSpans([], 5, 10, 8);
  expect(result).toContainEqual({ start: 5, end: 13 });
});

test("handles empty spans array", () => {
  const result = applyRewriteToSpans([], 0, 5, 3);
  expect(result).toEqual([{ start: 0, end: 3 }]);
});
