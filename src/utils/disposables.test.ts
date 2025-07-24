import * as sinon from "sinon";
import { DisposableCollection } from "./disposables";

class TestDisposableCollection extends DisposableCollection {
  dispose(): void {
    super.dispose();
  }
}

describe("utils/disposables.ts DisposableCollection", function () {
  it("should dispose all registered disposables", function () {
    const manager = new TestDisposableCollection();

    const disposable1 = { dispose: sinon.spy() };
    const disposable2 = { dispose: sinon.spy() };
    manager["disposables"].push(disposable1);
    manager["disposables"].push(disposable2);

    manager.dispose();

    sinon.assert.calledOnce(disposable1.dispose);
    sinon.assert.calledOnce(disposable2.dispose);
  });
});
