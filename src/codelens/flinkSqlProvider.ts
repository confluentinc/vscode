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
import { DisposableCollection } from "../utils/disposables";

const logger = new Logger("codelens.flinkSqlProvider");

export class FlinkSqlCodelensProvider extends DisposableCollection implements CodeLensProvider {
  // controls refreshing the available codelenses
  private _onDidChangeCodeLenses: EventEmitter<void> = new EventEmitter<void>();
  readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

  private static instance: FlinkSqlCodelensProvider | null = null;
  static getInstance(): FlinkSqlCodelensProvider {
    if (!FlinkSqlCodelensProvider.instance) {
      FlinkSqlCodelensProvider.instance = new FlinkSqlCodelensProvider();
    }
    return FlinkSqlCodelensProvider.instance;
  }

  private constructor() {
    super();

    this.disposables.push(...this.setEventListeners());
  }

  protected setEventListeners(): Disposable[] {
    return [
      ccloudConnected.event(this.ccloudConnectedHandler.bind(this)),
      uriMetadataSet.event(this.uriMetadataSetHandler.bind(this)),
    ];
  }

  /**
   * Refresh/update all codelenses for documents visible in the workspace when ccloudConnected event fires.
   * @param connected - whether the user is connected to Confluent Cloud
   */
  ccloudConnectedHandler(connected: boolean): void {
    logger.debug("ccloudConnectedHandler called, updating codelenses", { connected });
    this._onDidChangeCodeLenses.fire();
  }

  /**
   * Refresh/update all codelenses for documents visible in the workspace when uriMetadataSet event fires,
   * namely when the user changes the compute pool or database for any Flink SQL document.
   */
  uriMetadataSetHandler(): void {
    logger.debug("uriMetadataSetHandler called, updating codelenses");
    this._onDidChangeCodeLenses.fire();
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
          ? `Catalog: ${catalog.name}, Database: ${database.name} (${database.provider} ${database.region})`
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
  if (envs.length === 0) {
    logger.warn("no environments available to look up catalog/database");
    return catalogDatabase;
  }

  // first look up the default catalog/database from user settings
  let defaultCatalog: CCloudEnvironment | undefined;
  let defaultDatabase: CCloudKafkaCluster | undefined;
  const defaults: CatalogDatabase = await getDefaultCatalogDatabase(envs);
  if (defaults.catalog && defaults.database) {
    defaultCatalog = defaults.catalog;
    defaultDatabase = defaults.database;
  }

  // only fall back to the default values if metadata wasn't set at all, since `null` indicates
  // it was cleared via the "Clear Settings" codelens
  let catalogName: string | null | undefined = metadata?.[UriMetadataKeys.FLINK_CATALOG_NAME];
  let catalogId: string | null | undefined = metadata?.[UriMetadataKeys.FLINK_CATALOG_ID];
  if (defaultCatalog && (catalogName === undefined || catalogId === undefined)) {
    catalogName = defaultCatalog.name;
    catalogId = defaultCatalog.id;
  }
  let databaseName: string | null | undefined = metadata?.[UriMetadataKeys.FLINK_DATABASE_NAME];
  let databaseId: string | null | undefined = metadata?.[UriMetadataKeys.FLINK_DATABASE_ID];
  if (defaultDatabase && (databaseName === undefined || databaseId === undefined)) {
    databaseName = defaultDatabase.name;
    databaseId = defaultDatabase.id;
  }

  if (!(catalogName && databaseName)) {
    // no starting info to go off of (or the user cleared metadata settings), so just return empty
    logger.warn("no catalog or database name stored in metadata");
    return catalogDatabase;
  }

  // at this point, we should at least have the catalog and database names to check against, but
  // unfortunately they may contain IDs instead of names, so we have to check both
  const matchingCatalogs: CCloudEnvironment[] = envs.filter(
    (catalog) => catalog.id === catalogName || catalog.name === catalogName,
  );
  const matchingDatabases: CCloudKafkaCluster[] = [];
  for (const env of matchingCatalogs) {
    const matchedDbs = env.kafkaClusters.filter(
      (database) => database.id === databaseName || database.name === databaseName,
    );
    matchingDatabases.push(...matchedDbs);
  }
  if (matchingCatalogs.length === 0 || matchingDatabases.length === 0) {
    // no catalogs or databases found with the stored names, so just return empty
    logger.warn(
      "no matching catalogs or databases found from catalog/database names in document metadata",
    );
    return catalogDatabase;
  }
  if (matchingCatalogs.length === 1 && matchingDatabases.length === 1) {
    logger.info("matched one catalog and one database from name-related metadata");
    // ideal scenario: exactly one catalog and one database found based on the names alone
    catalogDatabase.catalog = matchingCatalogs[0];
    catalogDatabase.database = matchingDatabases[0];
    return catalogDatabase;
  }

  // if we made it this far, we have multiple catalogs and/or databases to choose from
  // so let's narrow the matches down further by one of two ways:
  // 1. if we have the catalog and database IDs, filter with them since they're unique
  // 2. if we have a compute pool, use its provider/region to match against the database
  //   (and from it, the catalog)
  if (catalogId && databaseId) {
    logger.debug("multiple catalog/database name matches, checking against IDs", {
      catalogId,
      databaseId,
    });
    const matchedCatalog = matchingCatalogs.find((c) => c.id === catalogId);
    const matchedDatabase = matchingDatabases.find((d) => d.id === databaseId);
    if (matchedCatalog && matchedDatabase && matchedDatabase.environmentId === matchedCatalog.id) {
      // found exact matches based on IDs
      catalogDatabase.catalog = matchedCatalog;
      catalogDatabase.database = matchedDatabase;
      return catalogDatabase;
    }
    // fall through to the provider/region matching below
    logger.warn(
      "no matching catalogs or databases found from catalog/database IDs in document metadata",
      { catalogId, databaseId },
    );
  }

  if (!computePool) {
    logger.warn("no compute pool to compare against");
    return catalogDatabase;
  }

  logger.info(
    "multiple catalog/database name matches, checking against compute pool region/provider",
    { provider: computePool.provider, region: computePool.region },
  );
  const poolMatchedDatabases: CCloudKafkaCluster[] = [];
  for (const db of matchingDatabases) {
    if (db.provider === computePool.provider && db.region === computePool.region) {
      poolMatchedDatabases.push(db);
    }
  }
  if (poolMatchedDatabases.length === 0) {
    // no databases found that match the compute pool's provider/region
    logger.warn(
      "no matching databases found from compute pool provider/region compared to database provider/region",
      { provider: computePool.provider, region: computePool.region },
    );
    return catalogDatabase;
  }
  if (poolMatchedDatabases.length === 1) {
    // exactly one database found that matches the compute pool's provider/region
    const matchedDatabase = poolMatchedDatabases[0];
    const matchedCatalog = matchingCatalogs.find((c) => c.id === matchedDatabase.environmentId);
    if (matchedCatalog) {
      catalogDatabase.catalog = matchedCatalog;
      catalogDatabase.database = matchedDatabase;
      logger.info(
        "matched one catalog and one database from name-related metadata and compute pool provider/region",
      );
      return catalogDatabase;
    }
  }

  // if we made it this far, we couldn't narrow down the matches to exactly one catalog and one database
  logger.warn("could not narrow down to one catalog and one database from stored metadata");

  return catalogDatabase;
}

/**
 * Get the default catalog and database from user settings, if set.
 * @param envs The environments to look up the catalog and database.
 * @returns The `catalog` and `database`, if found
 */
export async function getDefaultCatalogDatabase(
  envs: CCloudEnvironment[],
): Promise<CatalogDatabase> {
  let defaultCatalogDatabase: CatalogDatabase = { catalog: undefined, database: undefined };
  if (envs.length === 0) {
    logger.warn("no environments available to look up default catalog/database");
    return defaultCatalogDatabase;
  }

  const defaultDatabaseId: string | undefined = FLINK_CONFIG_DATABASE.value;
  if (!defaultDatabaseId) {
    return defaultCatalogDatabase;
  }

  // look up the default database ID across all environments, and from it, the catalog
  for (const env of envs) {
    const matchedDatabases: CCloudKafkaCluster[] = env.kafkaClusters.filter(
      (cluster: CCloudKafkaCluster) => cluster.id === defaultDatabaseId,
    );
    if (matchedDatabases.length > 0) {
      // not worrying about matching on more than ID, because if we have multiple matches, we have
      // bigger problems
      defaultCatalogDatabase.catalog = env;
      defaultCatalogDatabase.database = matchedDatabases[0];
      break;
    }
  }

  return defaultCatalogDatabase;
}
