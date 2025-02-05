import { deepEqual } from "assert/strict";
import { brush } from "./brush";

describe("brush", () => {
  it("should follow the events", () => {
    let ctl = brush("xy");
    ctl.extent([
      [0, 0],
      [200, 100],
    ]);

    deepEqual(ctl.get(), null);

    ctl.down(10, 10);
    ctl.move(40, 40);
    ctl.move(60, 30);
    ctl.up();

    deepEqual(ctl.get(), [
      [10, 10],
      [60, 30],
    ]);

    ctl.down(70, 80);
    ctl.move(5, 5);
    ctl.up();

    deepEqual(ctl.get(), [
      [5, 5],
      [70, 80],
    ]);

    ctl.down(20, 20);
    ctl.move(25, 25);
    ctl.up();

    deepEqual(ctl.get(), [
      [10, 10],
      [75, 85],
    ]);
  });
});
