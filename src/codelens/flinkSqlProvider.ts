import {
  CodeLens,
  CodeLensProvider,
  Command,
  Disposable,
  Event,
  EventEmitter,
  Position,
  Range,
  TextDocument,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import { ccloudConnected, uriMetadataSet } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import { CCloudOrganization } from "../models/organization";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../preferences/constants";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { UriMetadata } from "../storage/types";

const logger = new Logger("codelens.flinkSqlProvider");

export class FlinkSqlCodelensProvider implements CodeLensProvider {
  disposables: Disposable[] = [];

  // controls refreshing the available codelenses
  private _onDidChangeCodeLenses: EventEmitter<void> = new EventEmitter<void>();
  readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

  private constructor() {
    // refresh/update all codelenses for documents visible in the workspace when any of these fire
    const ccloudConnectedSub: Disposable = ccloudConnected.event((connected: boolean) => {
      logger.debug("ccloudConnected event fired, updating codelenses", { connected });
      this._onDidChangeCodeLenses.fire();
    });
    const uriMetadataSetSub: Disposable = uriMetadataSet.event(() => {
      logger.debug("uriMetadataSet event fired, updating codelenses");
      this._onDidChangeCodeLenses.fire();
    });

    this.disposables.push(ccloudConnectedSub, uriMetadataSetSub);
  }

  private static instance: FlinkSqlCodelensProvider | null = null;
  static getInstance(): FlinkSqlCodelensProvider {
    if (!FlinkSqlCodelensProvider.instance) {
      FlinkSqlCodelensProvider.instance = new FlinkSqlCodelensProvider();
    }
    return FlinkSqlCodelensProvider.instance;
  }

  async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
    const codeLenses: CodeLens[] = [];

    // show codelenses at the top of the file
    const range = new Range(new Position(0, 0), new Position(0, 0));

    if (!hasCCloudAuthSession()) {
      // show single codelens to sign in to CCloud since we need to be able to list CCloud resources
      // in the other codelenses (via quickpicks) below
      const signInLens = new CodeLens(range, {
        title: "Sign in to Confluent Cloud",
        command: "confluent.connections.ccloud.signIn",
        tooltip: "Sign in to Confluent Cloud",
        arguments: [],
      } as Command);
      return [signInLens];
    }

    // codelens for changing org
    const org: CCloudOrganization = await CCloudResourceLoader.getInstance().getOrganization();
    const selectOrgCommand: Command = {
      title: org.name,
      command: "confluent.document.setCCloudOrg",
      tooltip: "Set CCloud Organization for Flink Statement",
      arguments: [document.uri],
    };
    const orgLens = new CodeLens(range, selectOrgCommand);

    // look up document metadata from extension state
    const rm = ResourceManager.getInstance();
    const uriMetadata: UriMetadata | undefined = await rm.getUriMetadata(document.uri);
    logger.debug("doc metadata", document.uri.toString(), {
      uriMetadata,
    });
    const config: WorkspaceConfiguration = workspace.getConfiguration();

    // look up all environments since we'll need them to filter for compute pools and Kafka clusters
    // (as databases to match whatever the selected compute pool is, based on provider/region)
    const envs: CCloudEnvironment[] = await CCloudResourceLoader.getInstance().getEnvironments();

    // codelens for selecting a compute pool, which we'll use to derive the rest of the properties
    // needed for various Flink operations (env ID, provider/region, etc)
    const defaultComputePoolId: string | undefined = config.get(FLINK_CONFIG_COMPUTE_POOL);
    const computePoolString: string | undefined =
      uriMetadata?.[UriMetadataKeys.FLINK_COMPUTE_POOL_ID] ?? defaultComputePoolId;
    let computePool: CCloudFlinkComputePool | undefined;
    if (computePoolString) {
      // TODO: replace with dedicated loader method for looking up compute pool by ID
      const env: CCloudEnvironment | undefined = envs.find((e) =>
        e.flinkComputePools.some((pool) => pool.id === computePoolString),
      );
      const computePools: CCloudFlinkComputePool[] = env?.flinkComputePools || [];
      computePool = computePools.find((p) => p.id === computePoolString);
      if (computePool) {
        // explicitly turn into a CCloudFlinkComputePool since `submitFlinkStatementCommand` checks
        // for a CCloudFlinkComputePool instance
        computePool = new CCloudFlinkComputePool({ ...computePool });
      } else {
        // no need to clear pool metadata since we'll show "Set Compute Pool" codelens
        // and the user can choose a new one to update the stored metadata
        logger.warn("compute pool not found from stored pool ID");
      }
    }
    const selectComputePoolCommand: Command = {
      title: computePool ? computePool.name : "Set Compute Pool",
      command: "confluent.document.flinksql.setCCloudComputePool",
      tooltip: "Set CCloud Compute Pool for Flink Statement",
      arguments: [document.uri],
    };
    const computePoolLens = new CodeLens(range, selectComputePoolCommand);

    // codelens for selecting a database (and catalog)
    const defaultDatabaseId: string | undefined = config.get(FLINK_CONFIG_DATABASE);
    const catalogId: string | undefined = uriMetadata?.[UriMetadataKeys.FLINK_CATALOG_ID];
    const databaseId: string | undefined =
      uriMetadata?.[UriMetadataKeys.FLINK_DATABASE_ID] ?? defaultDatabaseId;
    let catalog: CCloudEnvironment | undefined;
    let database: CCloudKafkaCluster | undefined;
    if (catalogId && databaseId) {
      catalog = envs.find((e) => e.id === catalogId);
      if (catalog) {
        database = catalog.kafkaClusters.find((k) => k.id === databaseId);
        if (database) {
          // finding a database by ID is not enough, we need to check that the provider/region
          // match the compute pool (if one is selected)
          if (
            database.provider === computePool?.provider &&
            database.region === computePool?.region
          ) {
            // explicitly turn into a CCloudKafkaCluster since `submitFlinkStatementCommand` checks
            // for a CCloudKafkaCluster instance
            database = CCloudKafkaCluster.create({ ...database });
          }
        } else {
          // no need to clear database metadata since we'll show "Set Database" codelens
          // and the user can choose a new one to update the stored metadata
          logger.warn("database not found from stored database ID");
        }
      }
    }
    const selectDatabaseCommand: Command = {
      title:
        catalog && database
          ? `Catalog: ${catalog.name}, Database: ${database.name}`
          : "Set Catalog & Database",
      command: "confluent.document.flinksql.setCCloudCatalogDatabase",
      tooltip: "Set Catalog & Database for Flink Statement",
      arguments: [document.uri],
    };
    const databaseLens = new CodeLens(range, selectDatabaseCommand);

    if (computePool && database) {
      const submitCommand: Command = {
        title: "▶️ Submit Statement",
        command: "confluent.statements.create",
        tooltip: "Submit Flink Statement to CCloud",
        arguments: [document.uri, computePool, database],
      };
      const submitLens = new CodeLens(range, submitCommand);
      // show the "Submit Statement" | <current catalog+db> | <current pool> | <current org> codelenses
      codeLenses.push(submitLens, databaseLens, computePoolLens, orgLens);
    } else {
      // don't show the submit codelens if we don't have a compute pool and database
      codeLenses.push(databaseLens, computePoolLens, orgLens);
    }

    return codeLenses;
  }
}
