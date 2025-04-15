import {
  CodeLens,
  CodeLensProvider,
  Disposable,
  Event,
  EventEmitter,
  Position,
  Range,
} from "vscode";
import { ccloudConnected } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { CCloudOrganization } from "../models/organization";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";

const logger = new Logger("codelens.flinkSqlProvider");

export class FlinkSqlCodelensProvider implements CodeLensProvider {
  disposables: Disposable[] = [];

  private _onDidChangeCodeLenses: EventEmitter<void> = new EventEmitter<void>();
  readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

  constructor() {
    const ccloudConnectedSub: Disposable = ccloudConnected.event((connected: boolean) => {
      logger.debug("ccloudConnected event fired, updating codelenses", { connected });
      this._onDidChangeCodeLenses.fire();
    });
    this.disposables.push(ccloudConnectedSub);
  }

  async provideCodeLenses(): Promise<CodeLens[]> {
    const codeLenses: CodeLens[] = [];

    // show codelenses at the top of the file
    const range = new Range(new Position(0, 0), new Position(0, 0));

    if (!hasCCloudAuthSession()) {
      // show single codelens to sign in
      const signInLens = new CodeLens(range, {
        title: "Sign in to Confluent Cloud",
        command: "confluent.connections.ccloud.signIn",
        tooltip: "Sign in to Confluent Cloud",
        arguments: [],
      });
      codeLenses.push(signInLens);
    } else {
      // show current org, environment, and region/provider
      const org: CCloudOrganization = await CCloudResourceLoader.getInstance().getOrganization();
      const orgLens = new CodeLens(range, {
        title: `CCloud Organization: "${org.name}"`,
        command: "confluent.organizations.use",
        tooltip: "Change CCloud Organization",
        arguments: [],
      });

      const envLens = new CodeLens(range, {
        title: `Env: "env-1234"`,
        command: "confluent.environments.use",
        tooltip: "Change CCloud Environment",
        arguments: [],
      });

      codeLenses.push(orgLens, envLens);
    }

    return codeLenses;
  }
}
