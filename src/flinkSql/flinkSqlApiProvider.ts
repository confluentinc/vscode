/**
 * Flink SQL API Provider implementation.
 *
 * Provides the Flink SQL API instances required by FlinkStatementResultsManager,
 * using the generated OpenAPI client classes configured with the appropriate
 * base URL and authentication.
 */

import { TokenManager } from "../auth/oauth2/tokenManager";
import { Configuration, StatementResultsSqlV1Api, StatementsSqlV1Api } from "../clients/flinkSql";
import { Logger } from "../logging";
import type { FlinkStatement } from "../models/flinkStatement";
import { buildFlinkDataPlaneBaseUrl } from "../proxy/flinkDataPlaneUrlBuilder";
import type { FlinkSqlApiProvider } from "./flinkStatementResultsManager";

const logger = new Logger("flinkSql.flinkSqlApiProvider");

/**
 * Implementation of FlinkSqlApiProvider that creates API instances
 * configured for the specific statement's provider/region.
 */
export class CCloudFlinkSqlApiProvider implements FlinkSqlApiProvider {
  private tokenManager: TokenManager;

  constructor() {
    this.tokenManager = TokenManager.getInstance();
  }

  /**
   * Gets a StatementResultsSqlV1Api instance configured for the statement's region.
   * @param statement The Flink statement to get results for.
   * @returns A configured StatementResultsSqlV1Api instance.
   */
  getFlinkSqlStatementResultsApi(statement: FlinkStatement): StatementResultsSqlV1Api {
    const config = this.createConfiguration(statement);
    return new StatementResultsSqlV1Api(config);
  }

  /**
   * Gets a StatementsSqlV1Api instance configured for the statement's region.
   * @param statement The Flink statement to manage.
   * @returns A configured StatementsSqlV1Api instance.
   */
  getFlinkSqlStatementsApi(statement: FlinkStatement): StatementsSqlV1Api {
    const config = this.createConfiguration(statement);
    return new StatementsSqlV1Api(config);
  }

  /**
   * Creates an API configuration for the given statement's provider/region.
   */
  private createConfiguration(statement: FlinkStatement): Configuration {
    const baseUrl = buildFlinkDataPlaneBaseUrl(
      statement.provider,
      statement.region,
      statement.environmentId,
    );

    logger.debug("Creating Flink SQL API configuration", {
      provider: statement.provider,
      region: statement.region,
      baseUrl,
    });

    return new Configuration({
      basePath: baseUrl,
      accessToken: async () => {
        const token = await this.tokenManager.getDataPlaneToken();
        if (!token) {
          throw new Error("No data plane token available for Flink SQL API");
        }
        return token;
      },
    });
  }
}

/**
 * Singleton instance of the CCloud Flink SQL API provider.
 */
let flinkSqlApiProviderInstance: CCloudFlinkSqlApiProvider | null = null;

/**
 * Gets the singleton CCloud Flink SQL API provider instance.
 * @returns The FlinkSqlApiProvider instance.
 */
export function getFlinkSqlApiProvider(): FlinkSqlApiProvider {
  if (!flinkSqlApiProviderInstance) {
    flinkSqlApiProviderInstance = new CCloudFlinkSqlApiProvider();
  }
  return flinkSqlApiProviderInstance;
}
