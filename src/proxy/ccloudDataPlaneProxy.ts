/**
 * CCloud Data Plane API Proxy (Flink).
 *
 * Provides a high-level interface for Confluent Cloud Data Plane API operations with:
 * - Flink SQL statement management (create, list, get, delete)
 * - Flink statement results retrieval
 * - Flink workspace management
 */

import { Logger } from "../logging";
import { createHttpClient, type AuthConfig, type HttpClient } from "./httpClient";

const logger = new Logger("proxy.ccloudDataPlane");

/**
 * CCloud Data Plane proxy configuration.
 */
export interface CCloudDataPlaneProxyConfig {
  /** Base URL for the CCloud Data Plane API. */
  baseUrl: string;
  /** Organization ID. */
  organizationId: string;
  /** Environment ID. */
  environmentId: string;
  /** Authentication configuration (bearer token). */
  auth?: AuthConfig;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Custom headers to include in all requests. */
  headers?: Record<string, string>;
}

/**
 * Flink SQL statement specification.
 */
export interface FlinkStatementSpec {
  /** SQL statement to execute. */
  statement: string;
  /** Compute pool ID. */
  compute_pool_id?: string;
  /** Statement properties. */
  properties?: Record<string, string>;
  /** Whether the statement is stopped. */
  stopped?: boolean;
  /** Principal (user) who created the statement. */
  principal?: string;
}

/**
 * Flink SQL statement status.
 */
export interface FlinkStatementStatus {
  /** Statement phase. */
  phase?: "PENDING" | "RUNNING" | "COMPLETED" | "DELETING" | "FAILING" | "FAILED" | "STOPPED";
  /** Statement scaling status. */
  scaling_status?: {
    scaling_state?: string;
    last_updated?: string;
  };
  /** Status detail message. */
  detail?: string;
  /** Statement traits. */
  traits?: {
    sql_kind?: string;
    is_bounded?: boolean;
    is_append_only?: boolean;
    upsert_columns?: number[];
    schema?: {
      columns?: Array<{
        name?: string;
        type?: {
          type?: string;
          nullable?: boolean;
          length?: number;
          precision?: number;
          scale?: number;
          element_type?: unknown;
          key_type?: unknown;
          value_type?: unknown;
          fields?: unknown[];
        };
      }>;
    };
  };
  /** Latest offsets (for running statements). */
  latest_offsets?: Record<string, string>;
  /** Latest offset timestamps. */
  latest_offsets_timestamp?: string;
  /** Network kind. */
  network_kind?: string;
  /** HTTP endpoint for public network kind. */
  http_endpoint?: string;
}

/**
 * Flink SQL statement metadata.
 */
export interface FlinkStatementMetadata {
  /** Self link. */
  self?: string;
  /** Creation timestamp. */
  created_at?: string;
  /** Update timestamp. */
  updated_at?: string;
  /** Resource version for optimistic concurrency. */
  resource_version?: string;
}

/**
 * Flink SQL statement.
 */
export interface FlinkStatement {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Statement name (unique in environment). */
  name?: string;
  /** Organization ID. */
  organization_id?: string;
  /** Environment ID. */
  environment_id?: string;
  /** Statement metadata. */
  metadata?: FlinkStatementMetadata;
  /** Statement specification. */
  spec?: FlinkStatementSpec;
  /** Statement status. */
  status?: FlinkStatementStatus;
}

/**
 * Flink SQL statement result data.
 */
export interface FlinkStatementResult {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Result metadata with pagination. */
  metadata?: {
    next?: string;
  };
  /** Result data. */
  results?: {
    /** Result data rows. */
    data?: Array<{
      /** Operation type for changelog. */
      op?: number;
      /** Row data values. */
      row?: unknown[];
    }>;
  };
}

/**
 * Flink SQL statement exception.
 */
export interface FlinkStatementException {
  /** Exception name. */
  name?: string;
  /** Exception timestamp. */
  timestamp?: string;
  /** Exception message. */
  message?: string;
}

/**
 * Flink workspace specification.
 */
export interface FlinkWorkspaceSpec {
  /** Workspace name. */
  name?: string;
  /** Compute pool ID. */
  compute_pool?: string;
  /** SQL blocks in the workspace. */
  blocks?: Array<{
    /** Block content (SQL). */
    content?: string;
  }>;
}

/**
 * Flink workspace.
 */
export interface FlinkWorkspace {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Workspace name. */
  name?: string;
  /** Organization ID. */
  organization_id?: string;
  /** Environment ID. */
  environment_id?: string;
  /** Workspace metadata. */
  metadata?: {
    self?: string;
    created_at?: string;
    updated_at?: string;
    resource_version?: string;
  };
  /** Workspace specification. */
  spec?: FlinkWorkspaceSpec;
  /** Workspace status. */
  status?: {
    phase?: string;
  };
}

/**
 * Paginated list response.
 */
export interface FlinkListResponse<T> {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Pagination metadata. */
  metadata?: {
    first?: string;
    last?: string;
    prev?: string;
    next?: string;
    total_size?: number;
  };
  /** Data items. */
  data: T[];
}

/**
 * Options for creating a Flink statement.
 */
export interface CreateStatementOptions {
  /** Statement name (optional, will be auto-generated if not provided). */
  name?: string;
  /** SQL statement to execute. */
  statement: string;
  /** Compute pool ID. */
  computePoolId?: string;
  /** Statement properties (SQL session config options). */
  properties?: Record<string, string>;
  /** Statement labels (metadata). */
  labels?: Record<string, string>;
}

/**
 * Options for listing Flink statements.
 */
export interface ListStatementsOptions {
  /** Filter by compute pool ID. */
  computePoolId?: string;
  /** Page size. */
  pageSize?: number;
  /** Page token. */
  pageToken?: string;
  /** Label selector. */
  labelSelector?: string;
}

/**
 * Options for listing Flink workspaces.
 */
export interface ListWorkspacesOptions {
  /** Filter by compute pool ID. */
  computePoolId?: string;
  /** Include all workspaces (not just caller's). */
  all?: boolean;
  /** Page size. */
  pageSize?: number;
  /** Page token. */
  pageToken?: string;
}

/**
 * Options for creating a Flink workspace.
 */
export interface CreateWorkspaceOptions {
  /** Workspace name. */
  name: string;
  /** Compute pool ID. */
  computePoolId?: string;
  /** SQL blocks. */
  blocks?: Array<{ content: string }>;
}

/**
 * CCloud Data Plane API Proxy (Flink).
 *
 * Provides methods for interacting with Flink SQL and Workspace APIs.
 */
export class CCloudDataPlaneProxy {
  private readonly client: HttpClient;
  private readonly baseUrl: string;
  private readonly organizationId: string;
  private readonly environmentId: string;

  /**
   * Creates a new CCloud Data Plane proxy.
   * @param config Proxy configuration.
   */
  constructor(config: CCloudDataPlaneProxyConfig) {
    this.baseUrl = config.baseUrl;
    this.organizationId = config.organizationId;
    this.environmentId = config.environmentId;

    logger.debug("CCloudDataPlaneProxy initialized", {
      baseUrl: config.baseUrl,
      organizationId: config.organizationId,
      environmentId: config.environmentId,
    });

    this.client = createHttpClient({
      baseUrl: config.baseUrl,
      timeout: config.timeout ?? 30000,
      auth: config.auth,
      defaultHeaders: {
        ...config.headers,
      },
    });
  }

  /**
   * Gets the organization ID.
   */
  getOrganizationId(): string {
    return this.organizationId;
  }

  /**
   * Gets the environment ID.
   */
  getEnvironmentId(): string {
    return this.environmentId;
  }

  /**
   * Creates a new Flink SQL statement.
   * @param options Statement options.
   * @returns Created statement.
   */
  async createStatement(options: CreateStatementOptions): Promise<FlinkStatement> {
    const body = {
      name: options.name,
      labels: options.labels,
      spec: {
        statement: options.statement,
        compute_pool_id: options.computePoolId,
        properties: options.properties,
      },
    };

    const response = await this.client.post<FlinkStatement>(this.statementsPath(), body);
    return response.data;
  }

  /**
   * Lists Flink SQL statements.
   * @param options List options.
   * @returns List of statements.
   */
  async listStatements(
    options?: ListStatementsOptions,
  ): Promise<FlinkListResponse<FlinkStatement>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options?.computePoolId) {
      params.spec_compute_pool_id = options.computePoolId;
    }
    if (options?.pageSize) {
      params.page_size = options.pageSize;
    }
    if (options?.pageToken) {
      params.page_token = options.pageToken;
    }
    if (options?.labelSelector) {
      params.label_selector = options.labelSelector;
    }

    const path = this.statementsPath();
    logger.debug(`listStatements: GET ${this.baseUrl}${path}`, { params });

    const response = await this.client.get<FlinkListResponse<FlinkStatement>>(path, { params });

    logger.debug(`listStatements: received ${response.data.data?.length ?? 0} statements`, {
      hasNext: !!response.data.metadata?.next,
    });

    return response.data;
  }

  /**
   * Gets a Flink SQL statement by name.
   * @param statementName Statement name.
   * @returns Statement data.
   */
  async getStatement(statementName: string): Promise<FlinkStatement> {
    const response = await this.client.get<FlinkStatement>(
      `${this.statementsPath()}/${encodeURIComponent(statementName)}`,
    );
    return response.data;
  }

  /**
   * Updates a Flink SQL statement (e.g., to stop it).
   * @param statementName Statement name.
   * @param spec Updated specification.
   * @returns Updated statement.
   */
  async updateStatement(
    statementName: string,
    spec: Partial<FlinkStatementSpec>,
  ): Promise<FlinkStatement> {
    const body = { spec };
    const response = await this.client.put<FlinkStatement>(
      `${this.statementsPath()}/${encodeURIComponent(statementName)}`,
      body,
    );
    return response.data;
  }

  /**
   * Stops a Flink SQL statement.
   * @param statementName Statement name.
   * @returns Updated statement.
   */
  async stopStatement(statementName: string): Promise<FlinkStatement> {
    return this.updateStatement(statementName, { stopped: true });
  }

  /**
   * Deletes a Flink SQL statement.
   * @param statementName Statement name.
   */
  async deleteStatement(statementName: string): Promise<void> {
    await this.client.delete(`${this.statementsPath()}/${encodeURIComponent(statementName)}`);
  }

  /**
   * Gets results for a Flink SQL statement.
   * @param statementName Statement name.
   * @param pageToken Optional page token for pagination.
   * @returns Statement results.
   */
  async getStatementResults(
    statementName: string,
    pageToken?: string,
  ): Promise<FlinkStatementResult> {
    const params: Record<string, string | undefined> = {};
    if (pageToken) {
      params.page_token = pageToken;
    }

    const response = await this.client.get<FlinkStatementResult>(
      `${this.statementsPath()}/${encodeURIComponent(statementName)}/results`,
      { params },
    );
    return response.data;
  }

  /**
   * Gets exceptions for a Flink SQL statement.
   * @param statementName Statement name.
   * @returns Statement exceptions (last 10).
   */
  async getStatementExceptions(
    statementName: string,
  ): Promise<FlinkListResponse<FlinkStatementException>> {
    const response = await this.client.get<FlinkListResponse<FlinkStatementException>>(
      `${this.statementsPath()}/${encodeURIComponent(statementName)}/exceptions`,
    );
    return response.data;
  }

  /**
   * Creates a new Flink workspace.
   * @param options Workspace options.
   * @returns Created workspace.
   */
  async createWorkspace(options: CreateWorkspaceOptions): Promise<FlinkWorkspace> {
    const body = {
      name: options.name,
      spec: {
        compute_pool: options.computePoolId,
        blocks: options.blocks,
      },
    };

    const response = await this.client.post<FlinkWorkspace>(this.workspacesPath(), body);
    return response.data;
  }

  /**
   * Lists Flink workspaces.
   * @param options List options.
   * @returns List of workspaces.
   */
  async listWorkspaces(
    options?: ListWorkspacesOptions,
  ): Promise<FlinkListResponse<FlinkWorkspace>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options?.computePoolId) {
      params.spec_compute_pool = options.computePoolId;
    }
    if (options?.all !== undefined) {
      params.all = options.all;
    }
    if (options?.pageSize) {
      params.page_size = options.pageSize;
    }
    if (options?.pageToken) {
      params.page_token = options.pageToken;
    }

    const response = await this.client.get<FlinkListResponse<FlinkWorkspace>>(
      this.workspacesPath(),
      { params },
    );
    return response.data;
  }

  /**
   * Gets a Flink workspace by name.
   * @param workspaceName Workspace name.
   * @returns Workspace data.
   */
  async getWorkspace(workspaceName: string): Promise<FlinkWorkspace> {
    const response = await this.client.get<FlinkWorkspace>(
      `${this.workspacesPath()}/${encodeURIComponent(workspaceName)}`,
    );
    return response.data;
  }

  /**
   * Updates a Flink workspace.
   * @param workspaceName Workspace name.
   * @param spec Updated specification.
   * @returns Updated workspace.
   */
  async updateWorkspace(
    workspaceName: string,
    spec: Partial<FlinkWorkspaceSpec>,
  ): Promise<FlinkWorkspace> {
    const body = { spec };
    const response = await this.client.put<FlinkWorkspace>(
      `${this.workspacesPath()}/${encodeURIComponent(workspaceName)}`,
      body,
    );
    return response.data;
  }

  /**
   * Deletes a Flink workspace.
   * @param workspaceName Workspace name.
   */
  async deleteWorkspace(workspaceName: string): Promise<void> {
    await this.client.delete(`${this.workspacesPath()}/${encodeURIComponent(workspaceName)}`);
  }

  /**
   * Fetches all statements across all pages.
   * @param options List options.
   * @returns All statements.
   */
  async fetchAllStatements(
    options?: Omit<ListStatementsOptions, "pageToken">,
  ): Promise<FlinkStatement[]> {
    logger.debug("fetchAllStatements: starting", {
      computePoolId: options?.computePoolId,
      labelSelector: options?.labelSelector,
    });

    const allStatements: FlinkStatement[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      pageCount++;
      const response = await this.listStatements({ ...options, pageToken });
      allStatements.push(...response.data);

      // Extract page token from next URL if present
      if (response.metadata?.next) {
        const nextUrl = new URL(response.metadata.next, this.baseUrl);
        pageToken = nextUrl.searchParams.get("page_token") ?? undefined;
      } else {
        pageToken = undefined;
      }
    } while (pageToken);

    logger.debug(`fetchAllStatements: completed with ${allStatements.length} statements`, {
      pageCount,
    });

    return allStatements;
  }

  /**
   * Fetches all workspaces across all pages.
   * @param options List options.
   * @returns All workspaces.
   */
  async fetchAllWorkspaces(
    options?: Omit<ListWorkspacesOptions, "pageToken">,
  ): Promise<FlinkWorkspace[]> {
    const allWorkspaces: FlinkWorkspace[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.listWorkspaces({ ...options, pageToken });
      allWorkspaces.push(...response.data);

      // Extract page token from next URL if present
      if (response.metadata?.next) {
        const nextUrl = new URL(response.metadata.next, this.baseUrl);
        pageToken = nextUrl.searchParams.get("page_token") ?? undefined;
      } else {
        pageToken = undefined;
      }
    } while (pageToken);

    return allWorkspaces;
  }

  /**
   * Builds the base path for statements.
   */
  private statementsPath(): string {
    return `/sql/v1/organizations/${encodeURIComponent(this.organizationId)}/environments/${encodeURIComponent(this.environmentId)}/statements`;
  }

  /**
   * Builds the base path for workspaces.
   */
  private workspacesPath(): string {
    return `/ws/v1/organizations/${encodeURIComponent(this.organizationId)}/environments/${encodeURIComponent(this.environmentId)}/workspaces`;
  }
}

/**
 * Creates a CCloud Data Plane proxy with the given configuration.
 * @param config Proxy configuration.
 * @returns A configured CCloud Data Plane proxy.
 */
export function createCCloudDataPlaneProxy(
  config: CCloudDataPlaneProxyConfig,
): CCloudDataPlaneProxy {
  return new CCloudDataPlaneProxy(config);
}
