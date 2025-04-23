import * as vscode from "vscode";
import { FlinkStatement } from "../models/flinkStatement";

const SCHEME = "confluent-flinkstatement-active";
const ACTIVE_URI = vscode.Uri.parse(`${SCHEME}:Current Flink Statement`);

export class ActiveFlinkStatementProvider implements vscode.TextDocumentContentProvider {
  private static instance: ActiveFlinkStatementProvider;
  static getInstance(): ActiveFlinkStatementProvider {
    if (!this.instance) {
      this.instance = new ActiveFlinkStatementProvider();
    }
    return this.instance;
  }

  readonly scheme: string = SCHEME;
  readonly ACTIVE_URI: vscode.Uri = ACTIVE_URI;

  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  private currentStatement: FlinkStatement | undefined;

  constructor() {
    this.currentStatement = undefined;
  }

  get onDidChange(): vscode.Event<vscode.Uri> {
    return this._onDidChange.event;
  }

  setStatement(statement: FlinkStatement) {
    this.currentStatement = statement;
    this._onDidChange.fire(ACTIVE_URI);
  }

  provideTextDocumentContent(): string {
    return this.currentStatement?.sqlStatement ?? "-- No statement selected --";
  }
}
