import * as assert from "assert";

import { LocalResourceLoader } from "./localResourceLoader";

describe("LocalResourceLoader", () => {
  let loader: LocalResourceLoader;

  beforeEach(() => {
    loader = LocalResourceLoader.getInstance();
  });

  afterEach(() => {
    LocalResourceLoader["instance"] = null; // Reset singleton instance
  });

  it("should be a singleton", () => {
    const anotherLoader = LocalResourceLoader.getInstance();
    assert.strictEqual(loader, anotherLoader, "LocalResourceLoader should be a singleton");
  });

  it("hates constructing twice", () => {
    assert.throws(() => {
      new LocalResourceLoader(); // NOSONAR
    }, /Use LocalResourceLoader.getInstance/);
  });
});
