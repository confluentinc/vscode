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
} from "vscode";
import { ccloudConnected, uriMetadataSet } from "../emitters";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../extensionSettings/constants";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
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

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
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

    // look up document metadata from extension state
    const rm = ResourceManager.getInstance();
    const uriMetadata: UriMetadata | undefined = await rm.getUriMetadata(document.uri);
    logger.debug("doc metadata", document.uri.toString(), {
      uriMetadata,
    });

    // look up all environments since we'll need them to filter for compute pools and Kafka clusters
    // (as databases to match whatever the selected compute pool is, based on provider/region)
    const envs: CCloudEnvironment[] = await CCloudResourceLoader.getInstance().getEnvironments();

    const computePool: CCloudFlinkComputePool | undefined = await getComputePoolFromMetadata(
      uriMetadata,
      envs,
    );
    const { catalog, database } = await getCatalogDatabaseFromMetadata(
      uriMetadata,
      envs,
      computePool,
    );

    // codelens for selecting a compute pool, which we'll use to derive the rest of the properties
    // needed for various Flink operations (env ID, provider/region, etc)
    const selectComputePoolCommand: Command = {
      title: computePool ? computePool.name : "Set Compute Pool",
      command: "confluent.document.flinksql.setCCloudComputePool",
      tooltip: computePool
        ? `Compute Pool: ${computePool.name}`
        : "Set CCloud Compute Pool for Flink Statement",
      arguments: [document.uri, database],
    };
    const computePoolLens = new CodeLens(range, selectComputePoolCommand);

    // codelens for selecting a database (and from it, a catalog)
    const selectDatabaseCommand: Command = {
      title: catalog && database ? `${catalog.name}, ${database.name}` : "Set Catalog & Database",
      command: "confluent.document.flinksql.setCCloudDatabase",
      tooltip:
        catalog && database
          ? `Catalog: ${catalog.name}, Database: ${database.name}`
          : "Set Catalog & Database for Flink Statement",
      arguments: [document.uri, computePool],
    };
    const databaseLens = new CodeLens(range, selectDatabaseCommand);

    // codelens for resetting the metadata for the document
    const resetCommand: Command = {
      title: "Clear Settings",
      command: "confluent.document.flinksql.resetCCloudMetadata",
      tooltip: "Clear Selected CCloud Resources for Flink Statement",
      arguments: [document.uri],
    };
    const resetLens = new CodeLens(range, resetCommand);

    if (computePool && database) {
      const submitCommand: Command = {
        title: "▶️ Submit Statement",
        command: "confluent.statements.create",
        tooltip: "Submit Flink Statement to CCloud",
        arguments: [document.uri, computePool, database],
      };
      const submitLens = new CodeLens(range, submitCommand);
      // show the "Submit Statement" | <current pool> | <current catalog+db> codelenses
      codeLenses.push(submitLens, computePoolLens, databaseLens, resetLens);
    } else {
      // don't show the submit codelens if we don't have a compute pool and database
      codeLenses.push(computePoolLens, databaseLens, resetLens);
    }

    return codeLenses;
  }
}

/**
 * Get the compute pool from the metadata stored in the document.
 * @param metadata The metadata stored in the document.
 * @param envs The environments to look up the compute pool.
 * @returns The compute pool.
 */
export async function getComputePoolFromMetadata(
  metadata: UriMetadata | undefined,
  envs: CCloudEnvironment[],
): Promise<CCloudFlinkComputePool | undefined> {
  const defaultComputePoolId: string | undefined = FLINK_CONFIG_COMPUTE_POOL.value;
  // clearing will set the metadata to `null`, so we'll only fall back to the default value if
  // the metadata is `undefined` (not set at all)
  let computePoolString: string | null | undefined =
    metadata?.[UriMetadataKeys.FLINK_COMPUTE_POOL_ID];
  if (computePoolString === undefined) {
    computePoolString = defaultComputePoolId;
  }
  if (!computePoolString) {
    return;
  }

  // Replace this section with dedicated loader method for looking up compute pool by ID
  // https://github.com/confluentinc/vscode/issues/1963
  let computePool: CCloudFlinkComputePool | undefined;
  const env: CCloudEnvironment | undefined = envs.find((e) =>
    e.flinkComputePools.some((pool) => pool.id === computePoolString),
  );
  const computePools: CCloudFlinkComputePool[] = env?.flinkComputePools || [];
  computePool = computePools.find((p) => p.id === computePoolString);
  if (computePool) {
    // explicitly turn into a CCloudFlinkComputePool since `submitFlinkStatementCommand` checks
    // for a CCloudFlinkComputePool instance
    logger.debug("compute pool found from stored pool ID", {
      computePool,
    });
    computePool = new CCloudFlinkComputePool({ ...computePool });
  } else {
    // no need to clear pool metadata since we'll show "Set Compute Pool" codelens
    // and the user can choose a new one to update the stored metadata
    logger.warn("compute pool not found from stored pool ID");
  }

  return computePool;
}

export interface CatalogDatabase {
  catalog?: CCloudEnvironment;
  database?: CCloudKafkaCluster;
}

/**
 * Get the catalog and database from the metadata stored in the document.
 * @param metadata The metadata stored in the document.
 * @param envs The environments to look up the catalog and database.
 * @param computePool Optional: the compute pool to match provider/region against the database.
 * @returns The catalog and database.
 */
export async function getCatalogDatabaseFromMetadata(
  metadata: UriMetadata | undefined,
  envs: CCloudEnvironment[],
  computePool?: CCloudFlinkComputePool,
): Promise<CatalogDatabase> {
  let catalogDatabase: CatalogDatabase = { catalog: undefined, database: undefined };

  const defaultDatabaseId: string | undefined = FLINK_CONFIG_DATABASE.value;
  // clearing will set the metadata to `null`, so we'll only fall back to the default value if
  // the metadata is `undefined` (not set at all)
  let databaseId: string | null | undefined = metadata?.[UriMetadataKeys.FLINK_DATABASE_ID];
  if (databaseId === undefined) {
    databaseId = defaultDatabaseId;
  }
  if (!databaseId) {
    return catalogDatabase;
  }

  const catalog: CCloudEnvironment | undefined = envs.find((e) =>
    e.kafkaClusters.some((k) => k.id === databaseId || k.name === databaseId),
  );
  if (!catalog) {
    // no need to clear it since we'll show "Set Catalog & Database" codelens
    logger.warn("catalog not found from stored database ID/name", { database: databaseId });
    return catalogDatabase;
  }

  const cluster: CCloudKafkaCluster | undefined = catalog.kafkaClusters.find(
    (k) => k.id === databaseId || k.name === databaseId,
  );
  if (!cluster) {
    // shouldn't happen since we just looked it up in order to get the catalog
    logger.warn("database not found from stored database ID/name", { database: databaseId });
    return catalogDatabase;
  }

  // finding a database by ID is not enough, we need to check that the provider/region
  // match the compute pool (if one is selected)
  let database: CCloudKafkaCluster | undefined;
  if (computePool) {
    if (cluster.provider === computePool.provider && cluster.region === computePool?.region) {
      // explicitly turn into a CCloudKafkaCluster since `submitFlinkStatementCommand` checks
      // for a CCloudKafkaCluster instance
      logger.debug("database provider/region matches compute pool provider/region", {
        database: cluster,
        computePool,
      });
      database = CCloudKafkaCluster.create({ ...cluster });
    } else {
      logger.warn("database provider/region does not match compute pool provider/region", {
        database,
        computePool,
      });
    }
  } else {
    // no compute pool selected, so we can use the database as-is
    logger.debug("no compute pool selected, using database without provider/region matching", {
      database: cluster,
    });
    database = CCloudKafkaCluster.create({ ...cluster });
  }

  catalogDatabase = { catalog, database };
  return catalogDatabase;
}
