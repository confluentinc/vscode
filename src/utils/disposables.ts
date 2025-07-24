import { Disposable } from "vscode";

/**
 * A base class for managing a collection of {@link Disposable disposables}.
 * This class implements the `dispose` method to clean up all registered disposables.
 */
export abstract class BaseDisposableManager implements Disposable {
  disposables: Disposable[] = [];

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables = [];
  }
}
