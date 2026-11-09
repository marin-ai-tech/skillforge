import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ablationScore,
  medianTokenCost,
  tokenCost,
  tokenEfficiency,
  transferRate,
  upliftFromAblationItem,
} from "../src/metrics/compute.ts";
import { csvCell } from "../src/metrics/csv.ts";

test("transferRate: zeros and rounding", () => {
  assert.equal(transferRate(0, 0), null);
  assert.equal(transferRate(0, 5), null);
  assert.equal(transferRate(10, 8), 0.8);
  assert.equal(transferRate(3, 2), 0.667);
});

test("tokenCost: extensions and ceil", () => {
  assert.equal(tokenCost([]), 0);
  assert.equal(tokenCost([{ path: "a.py", size: 4000 }]), 0);
  assert.equal(tokenCost([{ path: "a.MD", size: 4000 }]), 1000);
  assert.equal(
    tokenCost([
      { path: "a.md", size: 1 },
      { path: "b.txt", size: 2 },
    ]),
    1,
  );
  assert.equal(
    tokenCost([
      { path: "x.yaml", size: 100 },
      { path: "y.yml", size: 100 },
      { path: "z.toml", size: 100 },
      { path: "w.json", size: 100 },
    ]),
    100,
  );
});

test("tokenEfficiency: nulls and rounding", () => {
  assert.equal(tokenEfficiency(null, 1000), null);
  assert.equal(tokenEfficiency(0.8, 0), null);
  assert.equal(tokenEfficiency(0.8, 1000), 0.8);
  assert.equal(tokenEfficiency(0.5, 2000), 0.25);
});

test("ablationScore: latest by at, empty null", () => {
  assert.equal(ablationScore([]), null);
  assert.equal(
    ablationScore([
      { uplift: 0.3, at: "2026-01-01T00:00:00.000Z" },
      { uplift: -0.15, at: "2026-01-02T00:00:00.000Z" },
    ]),
    -0.15,
  );
  assert.equal(
    ablationScore([
      { uplift: 0.4, at: null },
      { uplift: 0.1, at: "2026-01-01T00:00:00.000Z" },
    ]),
    0.1,
  );
});

test("upliftFromAblationItem: data fields", () => {
  assert.equal(upliftFromAblationItem({ uplift: 0.3 }), 0.3);
  assert.equal(
    upliftFromAblationItem({
      data: { tasks: 20, passed_with: 9, passed_without: 12 },
    }),
    -0.15,
  );
  assert.equal(
    upliftFromAblationItem({ data: { tasks: 0, passed_with: 1, passed_without: 0 } }),
    null,
  );
});

test("medianTokenCost", () => {
  assert.equal(medianTokenCost([]), null);
  assert.equal(medianTokenCost([3]), 3);
  assert.equal(medianTokenCost([1, 2, 3]), 2);
  assert.equal(medianTokenCost([1, 2, 3, 4]), 3); // ceil((2+3)/2)
});

test("csvCell: formula prefix and numbers", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(-0.15), "-0.15");
  assert.equal(csvCell(0.25), "0.25");
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(csvCell("+1+1"), `"'+1+1"`);
  assert.equal(csvCell("-2+3"), `"'-2+3"`);
  assert.equal(csvCell("@SUM(1,1)"), `"'@SUM(1,1)"`);
  assert.equal(csvCell('Say "hi", ok'), `"Say ""hi"", ok"`);
});
