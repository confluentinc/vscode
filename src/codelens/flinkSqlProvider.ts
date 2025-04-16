import {
  CodeLens,
  CodeLensProvider,
  Disposable,
  Event,
  EventEmitter,
  Position,
  Range,
  TextDocument,
} from "vscode";
import { DocumentMetadataManager } from "../documentMetadataManager";
import {
  ccloudConnected,
  uriCCloudEnvSet,
  uriCCloudOrgSet,
  uriCCloudRegionProviderSet,
} from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudOrganization } from "../models/organization";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { ProviderRegion } from "../types";

const logger = new Logger("codelens.flinkSqlProvider");

export class FlinkSqlCodelensProvider implements CodeLensProvider {
  disposables: Disposable[] = [];

  // controls refreshing the available codelenses
  private _onDidChangeCodeLenses: EventEmitter<void> = new EventEmitter<void>();
  readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

  constructor() {
    // refresh/update all codelenses for a given document when any of these events fire
    const ccloudConnectedSub: Disposable = ccloudConnected.event((connected: boolean) => {
      logger.debug("ccloudConnected event fired, updating codelenses", { connected });
      this._onDidChangeCodeLenses.fire();
    });
    const uriCCloudOrgSetSub: Disposable = uriCCloudOrgSet.event(() => {
      logger.debug("uriCCloudOrgSet event fired, updating codelenses");
      this._onDidChangeCodeLenses.fire();
    });
    const uriCCloudEnvSetSub: Disposable = uriCCloudEnvSet.event(() => {
      logger.debug("uriCCloudEnvSet event fired, updating codelenses");
      this._onDidChangeCodeLenses.fire();
    });
    const uriCCloudRegionProviderSetSub: Disposable = uriCCloudRegionProviderSet.event(() => {
      logger.debug("uriCCloudRegionProviderSet event fired, updating codelenses");
      this._onDidChangeCodeLenses.fire();
    });

    this.disposables.push(
      ccloudConnectedSub,
      uriCCloudOrgSetSub,
      uriCCloudEnvSetSub,
      uriCCloudRegionProviderSetSub,
    );
  }

  async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
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
        title: `CCloud Org: "${org.name}"`,
        command: "confluent.document.setCCloudOrg",
        tooltip: "Set CCloud Organization for Flink Statement",
        arguments: [document.uri],
      });

      let env: CCloudEnvironment | undefined;
      let providerRegion: ProviderRegion | undefined;

      const metadata: Record<string, any> =
        DocumentMetadataManager.getInstance().getMetadata(document);
      logger.debug("doc metadata", { uri: document.uri.toString(), metadata });

      const envIdString: string | undefined = metadata.ccloudEnvId;
      if (envIdString) {
        const envs: CCloudEnvironment[] =
          await CCloudResourceLoader.getInstance().getEnvironments();
        env = envs.find((e) => e.id === envIdString);
      }
      const envLens = new CodeLens(range, {
        title: env ? `Env: "${env.name}"` : "Set Environment",
        command: "confluent.document.flinksql.setCCloudEnv",
        tooltip: "Set CCloud Environment for Flink Statement",
        arguments: [document.uri, true], // onlyFlinkEnvs=true
      });

      const providerRegionString: string | undefined = metadata.ccloudProviderRegion as
        | string
        | undefined;
      if (providerRegionString) {
        providerRegion = JSON.parse(providerRegionString) as ProviderRegion;
      }

      const providerRegionLens = new CodeLens(range, {
        title: providerRegion
          ? `Provider & Region: "${providerRegion.provider}.${providerRegion.region}"`
          : "Set Region/Provider",
        command: "confluent.document.flinksql.setCCloudRegionProvider",
        tooltip: "Set CCloud Region/Provider for Flink Statement",
        arguments: [document.uri],
      });
      codeLenses.push(orgLens, envLens, providerRegionLens);

      if (env && providerRegion) {
        const submitLens = new CodeLens(range, {
          title: "▶️ Submit Statement",
          command: "confluent.flinksql.submitStatement",
          tooltip: "Submit Flink Statement to CCloud",
          arguments: [document.uri],
        });
        codeLenses.push(submitLens);
      }
    }

    return codeLenses;
  }
}
