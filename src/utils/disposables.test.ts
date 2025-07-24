import * as sinon from "sinon";
import { BaseDisposableManager } from "./disposables";

class TestDisposableManager extends BaseDisposableManager {
  dispose(): void {
    super.dispose();
  }
}

describe("utils/disposables.ts BaseDisposableManager", function () {
  it("should dispose all registered disposables", function () {
    const manager = new TestDisposableManager();

    const disposable1 = { dispose: sinon.spy() };
    const disposable2 = { dispose: sinon.spy() };
    manager.disposables.push(disposable1);
    manager.disposables.push(disposable2);

    manager.dispose();

    sinon.assert.calledOnce(disposable1.dispose);
    sinon.assert.calledOnce(disposable2.dispose);
  });
});
