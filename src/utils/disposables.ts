import { Disposable } from "vscode";

export abstract class DisposableCollection implements Disposable {
  protected disposables: Disposable[] = [];

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables = [];
  }
}
