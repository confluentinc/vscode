import * as sinon from "sinon";
import { DisposableCollection } from "./disposables";

class TestDisposableCollection extends DisposableCollection {
  dispose(): void {
    super.dispose();
  }
}

describe("utils/disposables.ts DisposableCollection", function () {
  const sandbox = sinon.createSandbox();

  afterEach(function () {
    sandbox.restore();
  });

  it("should dispose all registered disposables", function () {
    const manager = new TestDisposableCollection();

    const disposable1 = { dispose: sandbox.spy() };
    const disposable2 = { dispose: sandbox.spy() };
    manager["disposables"].push(disposable1);
    manager["disposables"].push(disposable2);

    manager.dispose();

    sinon.assert.calledOnce(disposable1.dispose);
    sinon.assert.calledOnce(disposable2.dispose);
  });
});
