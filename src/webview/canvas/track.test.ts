import { track } from "./track";
import { deepEqual } from "assert/strict";

describe("track", () => {
  it("should split in equal pieces", () => {
    let scaleA = track(["1f", "1f", "1f"], 300);
    deepEqual(scaleA(0), [0, 0 + 100]);
    deepEqual(scaleA(1), [100, 100 + 100]);
    deepEqual(scaleA(2), [200, 200 + 100]);
    deepEqual(scaleA(0, 2), [0, 0 + 200]);
    deepEqual(scaleA(1, 2), [100, 100 + 200]);
  });

  it("should account for gap", () => {
    let scaleB = track(["1f", "1f", "1f"], 300, 4);
    deepEqual(scaleB(0), [4, 4 + 97.33333333333333]);
    deepEqual(scaleB(1), [101.33333333333333, 101.33333333333333 + 97.33333333333333]);
    deepEqual(scaleB(2), [198.66666666666666, 198.66666666666666 + 97.33333333333333]);
    deepEqual(scaleB(0, 2), [4, 4 + 194.66666666666666]);
    deepEqual(scaleB(1, 2), [101.33333333333333, 101.33333333333333 + 194.66666666666666]);
  });

  it("should allow custom scaling", () => {
    let scaleC = track(["1f", "1f", "1f"], 300, 4, 2);
    deepEqual(scaleC(0), [4, 4 + 96]);
    deepEqual(scaleC(1), [102, 102 + 96]);
    deepEqual(scaleC(2), [200, 200 + 96]);
    deepEqual(scaleC(0, 2), [4, 4 + 194]);
    deepEqual(scaleC(1, 2), [102, 102 + 194]);
  });

  it("should support predefined static units (ie pixels)", () => {
    let scaleD = track(["20u", "1f", "2f"], 512, 4, 2);
    deepEqual(scaleD(1, 2), [26, 26 + 482]);
    deepEqual(scaleD(0, 1), [4, 4 + 20]);
  });
});
