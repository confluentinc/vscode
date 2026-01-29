/**
 * CCloud Flink Artifacts API Proxy.
 *
 * Provides a high-level interface for Confluent Cloud Flink Artifacts API operations with:
 * - Artifact listing, creation, update, and deletion
 * - Presigned URL generation for artifact uploads
 */

import type {
  ArtifactV1FlinkArtifactListDataInner,
  CreateArtifactV1FlinkArtifact201Response,
  CreateArtifactV1FlinkArtifactRequest,
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../clients/flinkArtifacts";
import { createHttpClient, type AuthConfig, type HttpClient } from "./httpClient";

/**
 * CCloud Artifacts proxy configuration.
 */
export interface CCloudArtifactsProxyConfig {
  /** Base URL for the CCloud API (e.g., https://api.confluent.cloud). */
  baseUrl: string;
  /** Authentication configuration (bearer token). */
  auth?: AuthConfig;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Custom headers to include in all requests. */
  headers?: Record<string, string>;
}

/**
 * Flink artifact data from the API.
 */
export interface FlinkArtifactData {
  /** API version. */
  api_version?: string;
  /** Resource kind. */
  kind?: string;
  /** Artifact ID. */
  id: string;
  /** Artifact metadata. */
  metadata?: {
    self?: string;
    resource_name?: string;
    created_at?: string;
    updated_at?: string;
    deleted_at?: string;
  };
  /** Cloud provider. */
  cloud: string;
  /** Region. */
  region: string;
  /** Environment ID. */
  environment: string;
  /** Display name. */
  display_name: string;
  /** Description. */
  description?: string;
  /** Documentation link. */
  documentation_link?: string;
  /** Content format (JAR, ZIP). */
  content_format?: string;
  /** Runtime language. */
  runtime_language?: string;
  /** Versions. */
  versions?: Array<{
    version?: string;
    release_notes?: string;
    is_beta?: boolean;
  }>;
}

/**
 * Paginated list response from CCloud Artifacts API.
 */
export interface FlinkArtifactListResponse {
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
  data: FlinkArtifactData[];
}

/**
 * Options for listing artifacts.
 */
export interface ListArtifactsOptions {
  /** Cloud provider filter. */
  cloud: string;
  /** Region filter. */
  region: string;
  /** Environment filter. */
  environment: string;
  /** Page size. */
  pageSize?: number;
  /** Page token for pagination. */
  pageToken?: string;
}

/**
 * Options for creating a presigned upload URL.
 */
export interface CreatePresignedUrlOptions {
  /** Cloud provider. */
  cloud: string;
  /** Region. */
  region: string;
  /** Environment ID. */
  environment: string;
  /** Content format (JAR, ZIP). */
  contentFormat: string;
}

/**
 * Options for creating an artifact.
 */
export interface CreateArtifactOptions {
  /** Cloud provider. */
  cloud: string;
  /** Region. */
  region: string;
  /** Environment ID. */
  environment: string;
  /** Display name. */
  displayName: string;
  /** Upload ID from presigned URL. */
  uploadId: string;
  /** Content format (JAR, ZIP). */
  contentFormat?: string;
  /** Description. */
  description?: string;
  /** Documentation link. */
  documentationLink?: string;
  /** Runtime language. */
  runtimeLanguage?: string;
}

/**
 * Options for updating an artifact.
 */
export interface UpdateArtifactOptions {
  /** Artifact ID. */
  id: string;
  /** Cloud provider. */
  cloud: string;
  /** Region. */
  region: string;
  /** Environment ID. */
  environment: string;
  /** Updated description. */
  description?: string;
  /** Updated documentation link. */
  documentationLink?: string;
}

/**
 * Options for deleting an artifact.
 */
export interface DeleteArtifactOptions {
  /** Artifact ID. */
  id: string;
  /** Cloud provider. */
  cloud: string;
  /** Region. */
  region: string;
  /** Environment ID. */
  environment: string;
}

/**
 * CCloud Flink Artifacts API Proxy.
 *
 * Provides methods for interacting with Flink Artifacts API.
 */
export class CCloudArtifactsProxy {
  private readonly client: HttpClient;

  /**
   * Creates a new CCloud Artifacts proxy.
   * @param config Proxy configuration.
   */
  constructor(config: CCloudArtifactsProxyConfig) {
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
   * Lists Flink artifacts for a given cloud/region/environment.
   * @param options List options.
   * @returns Paginated list of artifacts.
   */
  async listArtifacts(options: ListArtifactsOptions): Promise<FlinkArtifactListResponse> {
    const params: Record<string, string | number | undefined> = {
      cloud: options.cloud,
      region: options.region,
      environment: options.environment,
    };
    if (options.pageSize) {
      params.page_size = options.pageSize;
    }
    if (options.pageToken) {
      params.page_token = options.pageToken;
    }

    const response = await this.client.get<FlinkArtifactListResponse>(
      "/artifact/v1/flink-artifacts",
      { params },
    );
    return response.data;
  }

  /**
   * Fetches all artifacts across all pages for a given cloud/region/environment.
   * @param options List options (without pagination).
   * @returns All artifacts.
   */
  async fetchAllArtifacts(
    options: Omit<ListArtifactsOptions, "pageToken" | "pageSize">,
  ): Promise<FlinkArtifactData[]> {
    const allArtifacts: FlinkArtifactData[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.listArtifacts({
        ...options,
        pageSize: 100,
        pageToken,
      });
      allArtifacts.push(...(response.data ?? []));

      // Extract page token from next URL if present
      if (response.metadata?.next) {
        const nextUrl = new URL(response.metadata.next, "https://api.confluent.cloud");
        pageToken = nextUrl.searchParams.get("page_token") ?? undefined;
      } else {
        pageToken = undefined;
      }
    } while (pageToken);

    return allArtifacts;
  }

  /**
   * Gets a presigned upload URL for uploading an artifact binary.
   * @param options Presigned URL options.
   * @returns Presigned URL response with upload_url and upload_id.
   */
  async getPresignedUploadUrl(
    options: CreatePresignedUrlOptions,
  ): Promise<PresignedUploadUrlArtifactV1PresignedUrl200Response> {
    const body: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
      cloud: options.cloud,
      region: options.region,
      environment: options.environment,
      content_format: options.contentFormat.toUpperCase(),
    };

    const response = await this.client.post<PresignedUploadUrlArtifactV1PresignedUrl200Response>(
      "/artifact/v1/presigned-upload-url",
      body,
    );
    return response.data;
  }

  /**
   * Creates a new Flink artifact.
   * @param options Create artifact options.
   * @returns Created artifact response.
   */
  async createArtifact(
    options: CreateArtifactOptions,
  ): Promise<CreateArtifactV1FlinkArtifact201Response> {
    const body: CreateArtifactV1FlinkArtifactRequest = {
      cloud: options.cloud,
      region: options.region,
      environment: options.environment,
      display_name: options.displayName,
      upload_source: {
        location: "PRESIGNED_URL_LOCATION",
        upload_id: options.uploadId,
      },
    };

    if (options.contentFormat) {
      body.content_format = options.contentFormat.toUpperCase();
    }
    if (options.description) {
      body.description = options.description;
    }
    if (options.documentationLink) {
      body.documentation_link = options.documentationLink;
    }
    if (options.runtimeLanguage) {
      body.runtime_language = options.runtimeLanguage;
    }

    const params = {
      cloud: options.cloud,
      region: options.region,
    };

    const response = await this.client.post<CreateArtifactV1FlinkArtifact201Response>(
      "/artifact/v1/flink-artifacts",
      body,
      { params },
    );
    return response.data;
  }

  /**
   * Updates an existing Flink artifact.
   * @param options Update artifact options.
   * @returns Updated artifact data.
   */
  async updateArtifact(
    options: UpdateArtifactOptions,
  ): Promise<ArtifactV1FlinkArtifactListDataInner> {
    const params = {
      cloud: options.cloud,
      region: options.region,
      environment: options.environment,
    };

    const body: Record<string, string | undefined> = {};
    if (options.description !== undefined) {
      body.description = options.description;
    }
    if (options.documentationLink !== undefined) {
      body.documentation_link = options.documentationLink;
    }

    const response = await this.client.patch<ArtifactV1FlinkArtifactListDataInner>(
      `/artifact/v1/flink-artifacts/${encodeURIComponent(options.id)}`,
      body,
      { params },
    );
    return response.data;
  }

  /**
   * Deletes a Flink artifact.
   * @param options Delete artifact options.
   */
  async deleteArtifact(options: DeleteArtifactOptions): Promise<void> {
    const params = {
      cloud: options.cloud,
      region: options.region,
      environment: options.environment,
    };

    await this.client.delete(`/artifact/v1/flink-artifacts/${encodeURIComponent(options.id)}`, {
      params,
    });
  }
}

/**
 * Creates a CCloud Artifacts proxy with the given configuration.
 * @param config Proxy configuration.
 * @returns A configured CCloud Artifacts proxy.
 */
export function createCCloudArtifactsProxy(
  config: CCloudArtifactsProxyConfig,
): CCloudArtifactsProxy {
  return new CCloudArtifactsProxy(config);
}
