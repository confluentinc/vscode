/**
 * CCloud Control Plane API Proxy.
 *
 * Provides a high-level interface for Confluent Cloud Control Plane API operations with:
 * - User/profile information
 * - Organization management
 * - Environment management
 * - Kafka cluster discovery
 * - Schema Registry discovery
 * - Flink compute pool discovery
 */

import { createHttpClient, type AuthConfig, type HttpClient } from "./httpClient";

/**
 * CCloud Control Plane proxy configuration.
 */
export interface CCloudControlPlaneProxyConfig {
  /** Base URL for the CCloud Control Plane API (e.g., https://api.confluent.cloud). */
  baseUrl: string;
  /** Authentication configuration (bearer token). */
  auth?: AuthConfig;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Custom headers to include in all requests. */
  headers?: Record<string, string>;
}

/**
 * User information from CCloud.
 */
export interface CCloudUser {
  /** User API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** User ID. */
  id: string;
  /** User metadata. */
  metadata?: {
    self?: string;
    resource_name?: string;
    created_at?: string;
    updated_at?: string;
    deleted_at?: string;
  };
  /** User email. */
  email?: string;
  /** Full name. */
  full_name?: string;
  /** Auth type. */
  auth_type?: string;
}

/**
 * Organization information from CCloud.
 */
export interface CCloudOrganization {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Organization ID. */
  id: string;
  /** Organization metadata. */
  metadata?: {
    self?: string;
    resource_name?: string;
    created_at?: string;
    updated_at?: string;
  };
  /** Display name. */
  display_name?: string;
  /** Whether JIT is enabled. */
  jit_enabled?: boolean;
}

/**
 * Environment information from CCloud.
 */
export interface CCloudEnvironmentData {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Environment ID. */
  id: string;
  /** Environment metadata. */
  metadata?: {
    self?: string;
    resource_name?: string;
    created_at?: string;
    updated_at?: string;
  };
  /** Display name. */
  display_name?: string;
  /** Stream governance config. */
  stream_governance_config?: {
    package?: string;
  };
}

/**
 * Kafka cluster information from CCloud.
 */
export interface CCloudKafkaClusterData {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Cluster ID. */
  id: string;
  /** Cluster metadata. */
  metadata?: {
    self?: string;
    resource_name?: string;
    created_at?: string;
    updated_at?: string;
  };
  /** Cluster specification. */
  spec?: {
    display_name?: string;
    availability?: string;
    cloud?: string;
    region?: string;
    kafka_bootstrap_endpoint?: string;
    http_endpoint?: string;
    api_endpoint?: string;
    environment?: {
      id?: string;
      related?: string;
    };
    network?: {
      id?: string;
      related?: string;
    };
    config?: {
      kind?: string;
    };
    byok_key?: {
      id?: string;
      related?: string;
    };
  };
  /** Cluster status. */
  status?: {
    phase?: string;
    cku?: number;
  };
}

/**
 * Schema Registry cluster information from CCloud.
 */
export interface CCloudSchemaRegistryData {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Cluster ID. */
  id: string;
  /** Cluster metadata. */
  metadata?: {
    self?: string;
    resource_name?: string;
    created_at?: string;
    updated_at?: string;
  };
  /** Cluster specification. */
  spec?: {
    display_name?: string;
    package?: string;
    cloud?: string;
    region?: string;
    http_endpoint?: string;
    environment?: {
      id?: string;
      related?: string;
    };
  };
  /** Cluster status. */
  status?: {
    phase?: string;
  };
}

/**
 * Flink compute pool information from CCloud.
 */
export interface CCloudFlinkComputePoolData {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Compute pool ID. */
  id: string;
  /** Compute pool metadata. */
  metadata?: {
    self?: string;
    resource_name?: string;
    created_at?: string;
    updated_at?: string;
  };
  /** Compute pool specification. */
  spec?: {
    display_name?: string;
    cloud?: string;
    region?: string;
    max_cfu?: number;
    environment?: {
      id?: string;
      related?: string;
    };
  };
  /** Compute pool status. */
  status?: {
    phase?: string;
    current_cfu?: number;
  };
}

/**
 * Paginated list response from CCloud API.
 */
export interface CCloudListResponse<T> {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Metadata including pagination. */
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
 * Options for listing resources.
 */
export interface ListResourcesOptions {
  /** Page size. */
  pageSize?: number;
  /** Page token for pagination. */
  pageToken?: string;
}

/**
 * Options for listing environments.
 */
export interface ListEnvironmentsOptions extends ListResourcesOptions {
  /** Stream governance package filter. */
  streamGovernancePackage?: string;
}

/**
 * Options for listing Kafka clusters.
 */
export interface ListKafkaClustersOptions extends ListResourcesOptions {
  /** Filter by environment ID. */
  environmentId?: string;
}

/**
 * Options for listing Schema Registries.
 */
export interface ListSchemaRegistriesOptions extends ListResourcesOptions {
  /** Filter by environment ID. */
  environmentId?: string;
}

/**
 * Options for listing Flink compute pools.
 */
export interface ListFlinkComputePoolsOptions extends ListResourcesOptions {
  /** Filter by environment ID. */
  environmentId?: string;
  /** Filter by region. */
  region?: string;
}

/**
 * Options for listing Flink regions.
 */
export interface ListFlinkRegionsOptions extends ListResourcesOptions {
  /** Filter by cloud provider (aws, azure, gcp). */
  cloud?: string;
  /** Filter by region name. */
  regionName?: string;
}

/**
 * Flink region information from CCloud.
 */
export interface CCloudFlinkRegionData {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Region ID. */
  id: string;
  /** Region metadata. */
  metadata?: {
    self?: string;
  };
  /** Display name. */
  display_name?: string;
  /** Cloud provider (aws, azure, gcp). */
  cloud?: string;
  /** Region name. */
  region_name?: string;
  /** HTTP endpoint for Flink API. */
  http_endpoint?: string;
  /** Private HTTP endpoint for Flink API. */
  private_http_endpoint?: string;
}

/**
 * CCloud Control Plane API Proxy.
 *
 * Provides methods for interacting with CCloud Control Plane API.
 */
export class CCloudControlPlaneProxy {
  private readonly client: HttpClient;
  private readonly customHeaders: Record<string, string>;

  /**
   * Creates a new CCloud Control Plane proxy.
   * @param config Proxy configuration.
   */
  constructor(config: CCloudControlPlaneProxyConfig) {
    this.customHeaders = config.headers ?? {};

    this.client = createHttpClient({
      baseUrl: config.baseUrl,
      timeout: config.timeout ?? 30000,
      auth: config.auth,
      defaultHeaders: {
        ...this.customHeaders,
      },
    });
  }

  /**
   * Gets the current user's information.
   * @returns User data.
   */
  async getCurrentUser(): Promise<CCloudUser> {
    const response = await this.client.get<CCloudUser>("/api/iam/v2/users/me");
    return response.data;
  }

  /**
   * Lists all organizations the user has access to.
   * @param options List options.
   * @returns List of organizations.
   */
  async listOrganizations(
    options?: ListResourcesOptions,
  ): Promise<CCloudListResponse<CCloudOrganization>> {
    const params = this.buildPaginationParams(options);
    const response = await this.client.get<CCloudListResponse<CCloudOrganization>>(
      "/api/org/v2/organizations",
      { params },
    );
    return response.data;
  }

  /**
   * Gets a specific organization by ID.
   * @param organizationId Organization ID.
   * @returns Organization data.
   */
  async getOrganization(organizationId: string): Promise<CCloudOrganization> {
    const response = await this.client.get<CCloudOrganization>(
      `/api/org/v2/organizations/${encodeURIComponent(organizationId)}`,
    );
    return response.data;
  }

  /**
   * Lists all environments.
   * @param options List options.
   * @returns List of environments.
   */
  async listEnvironments(
    options?: ListEnvironmentsOptions,
  ): Promise<CCloudListResponse<CCloudEnvironmentData>> {
    const params = this.buildPaginationParams(options);
    if (options?.streamGovernancePackage) {
      params["spec.stream_governance_config.package"] = options.streamGovernancePackage;
    }
    const response = await this.client.get<CCloudListResponse<CCloudEnvironmentData>>(
      "/api/org/v2/environments",
      { params },
    );
    return response.data;
  }

  /**
   * Gets a specific environment by ID.
   * @param environmentId Environment ID.
   * @returns Environment data.
   */
  async getEnvironment(environmentId: string): Promise<CCloudEnvironmentData> {
    const response = await this.client.get<CCloudEnvironmentData>(
      `/api/org/v2/environments/${encodeURIComponent(environmentId)}`,
    );
    return response.data;
  }

  /**
   * Lists all Kafka clusters.
   * @param options List options.
   * @returns List of Kafka clusters.
   */
  async listKafkaClusters(
    options?: ListKafkaClustersOptions,
  ): Promise<CCloudListResponse<CCloudKafkaClusterData>> {
    const params = this.buildPaginationParams(options);
    if (options?.environmentId) {
      // The CCloud API expects 'environment' parameter, not 'spec.environment'
      params["environment"] = options.environmentId;
    }
    const response = await this.client.get<CCloudListResponse<CCloudKafkaClusterData>>(
      "/api/cmk/v2/clusters",
      { params },
    );
    return response.data;
  }

  /**
   * Gets a specific Kafka cluster by ID.
   * @param clusterId Cluster ID.
   * @param environmentId Environment ID (required for the API).
   * @returns Kafka cluster data.
   */
  async getKafkaCluster(clusterId: string, environmentId: string): Promise<CCloudKafkaClusterData> {
    const response = await this.client.get<CCloudKafkaClusterData>(
      `/api/cmk/v2/clusters/${encodeURIComponent(clusterId)}`,
      { params: { environment: environmentId } },
    );
    return response.data;
  }

  /**
   * Lists all Schema Registry clusters.
   * @param options List options.
   * @returns List of Schema Registry clusters.
   */
  async listSchemaRegistries(
    options?: ListSchemaRegistriesOptions,
  ): Promise<CCloudListResponse<CCloudSchemaRegistryData>> {
    const params = this.buildPaginationParams(options);
    if (options?.environmentId) {
      // The CCloud API expects 'environment' parameter, not 'spec.environment'
      params["environment"] = options.environmentId;
    }
    const response = await this.client.get<CCloudListResponse<CCloudSchemaRegistryData>>(
      "/api/srcm/v3/clusters",
      { params },
    );
    return response.data;
  }

  /**
   * Gets a specific Schema Registry cluster by ID.
   * @param clusterId Cluster ID.
   * @param environmentId Environment ID (required for the API).
   * @returns Schema Registry cluster data.
   */
  async getSchemaRegistry(
    clusterId: string,
    environmentId: string,
  ): Promise<CCloudSchemaRegistryData> {
    const response = await this.client.get<CCloudSchemaRegistryData>(
      `/api/srcm/v3/clusters/${encodeURIComponent(clusterId)}`,
      { params: { environment: environmentId } },
    );
    return response.data;
  }

  /**
   * Lists all Flink compute pools.
   * @param options List options.
   * @returns List of Flink compute pools.
   */
  async listFlinkComputePools(
    options?: ListFlinkComputePoolsOptions,
  ): Promise<CCloudListResponse<CCloudFlinkComputePoolData>> {
    const params = this.buildPaginationParams(options);
    if (options?.environmentId) {
      // The CCloud API expects 'environment' parameter, not 'spec.environment'
      params["environment"] = options.environmentId;
    }
    if (options?.region) {
      params["spec.region"] = options.region;
    }
    const response = await this.client.get<CCloudListResponse<CCloudFlinkComputePoolData>>(
      "/api/fcpm/v2/compute-pools",
      { params },
    );
    return response.data;
  }

  /**
   * Gets a specific Flink compute pool by ID.
   * @param computePoolId Compute pool ID.
   * @param environmentId Environment ID (required for the API).
   * @returns Flink compute pool data.
   */
  async getFlinkComputePool(
    computePoolId: string,
    environmentId: string,
  ): Promise<CCloudFlinkComputePoolData> {
    const response = await this.client.get<CCloudFlinkComputePoolData>(
      `/api/fcpm/v2/compute-pools/${encodeURIComponent(computePoolId)}`,
      { params: { environment: environmentId } },
    );
    return response.data;
  }

  /**
   * Lists all Flink regions.
   * @param options List options.
   * @returns List of Flink regions.
   */
  async listFlinkRegions(
    options?: ListFlinkRegionsOptions,
  ): Promise<CCloudListResponse<CCloudFlinkRegionData>> {
    const params = this.buildPaginationParams(options);
    if (options?.cloud) {
      params["cloud"] = options.cloud;
    }
    if (options?.regionName) {
      params["region_name"] = options.regionName;
    }
    const response = await this.client.get<CCloudListResponse<CCloudFlinkRegionData>>(
      "/fcpm/v2/regions",
      { params },
    );
    return response.data;
  }

  /**
   * Fetches all resources across all pages.
   * @param fetchFn Function to fetch a single page.
   * @returns All resources from all pages.
   */
  async fetchAllPages<T>(
    fetchFn: (options?: ListResourcesOptions) => Promise<CCloudListResponse<T>>,
  ): Promise<T[]> {
    const allData: T[] = [];
    let pageToken: string | undefined;

    do {
      const response = await fetchFn({ pageToken, pageSize: 100 });
      allData.push(...response.data);

      // Extract page token from next URL if present
      if (response.metadata?.next) {
        const nextUrl = new URL(response.metadata.next, "https://api.confluent.cloud");
        pageToken = nextUrl.searchParams.get("page_token") ?? undefined;
      } else {
        pageToken = undefined;
      }
    } while (pageToken);

    return allData;
  }

  /**
   * Fetches all organizations across all pages.
   * @returns All organizations.
   */
  async fetchAllOrganizations(): Promise<CCloudOrganization[]> {
    return this.fetchAllPages((opts) => this.listOrganizations(opts));
  }

  /**
   * Fetches all environments across all pages.
   * @returns All environments.
   */
  async fetchAllEnvironments(): Promise<CCloudEnvironmentData[]> {
    return this.fetchAllPages((opts) => this.listEnvironments(opts));
  }

  /**
   * Fetches all Kafka clusters for an environment.
   * @param environmentId Environment ID.
   * @returns All Kafka clusters in the environment.
   */
  async fetchAllKafkaClusters(environmentId: string): Promise<CCloudKafkaClusterData[]> {
    return this.fetchAllPages((opts) => this.listKafkaClusters({ ...opts, environmentId }));
  }

  /**
   * Fetches all Schema Registries for an environment.
   * @param environmentId Environment ID.
   * @returns All Schema Registries in the environment.
   */
  async fetchAllSchemaRegistries(environmentId: string): Promise<CCloudSchemaRegistryData[]> {
    return this.fetchAllPages((opts) => this.listSchemaRegistries({ ...opts, environmentId }));
  }

  /**
   * Fetches all Flink compute pools for an environment.
   * @param environmentId Environment ID.
   * @returns All Flink compute pools in the environment.
   */
  async fetchAllFlinkComputePools(environmentId: string): Promise<CCloudFlinkComputePoolData[]> {
    return this.fetchAllPages((opts) => this.listFlinkComputePools({ ...opts, environmentId }));
  }

  /**
   * Fetches all Flink regions across all pages.
   * @param cloud Optional cloud provider filter.
   * @returns All Flink regions.
   */
  async fetchAllFlinkRegions(cloud?: string): Promise<CCloudFlinkRegionData[]> {
    return this.fetchAllPages((opts) => this.listFlinkRegions({ ...opts, cloud }));
  }

  /**
   * Builds pagination parameters.
   */
  private buildPaginationParams(
    options?: ListResourcesOptions,
  ): Record<string, string | number | undefined> {
    const params: Record<string, string | number | undefined> = {};
    if (options?.pageSize) {
      params.page_size = options.pageSize;
    }
    if (options?.pageToken) {
      params.page_token = options.pageToken;
    }
    return params;
  }
}

/**
 * Creates a CCloud Control Plane proxy with the given configuration.
 * @param config Proxy configuration.
 * @returns A configured CCloud Control Plane proxy.
 */
export function createCCloudControlPlaneProxy(
  config: CCloudControlPlaneProxyConfig,
): CCloudControlPlaneProxy {
  return new CCloudControlPlaneProxy(config);
}
