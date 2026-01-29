/**
 * Schema Registry API Proxy.
 *
 * Provides a high-level interface for Schema Registry operations with:
 * - Subject management (list, get, delete)
 * - Schema version management (list, get, register, delete)
 * - Schema retrieval by ID
 * - Compatibility checking
 */

import { createHttpClient, HttpError, type AuthConfig, type HttpClient } from "./httpClient";

// Re-export types from generated clients for convenience
export type {
  Schema,
  RegisterSchemaRequest,
  RegisterSchemaResponse,
  SchemaReference,
  SchemaString,
  SubjectVersion,
  Config,
  CompatibilityCheckResponse,
} from "../clients/schemaRegistryRest/models";

/**
 * Schema types supported by Schema Registry.
 */
export type SchemaType = "AVRO" | "JSON" | "PROTOBUF";

/**
 * Compatibility modes for schemas.
 */
export type CompatibilityMode =
  | "BACKWARD"
  | "BACKWARD_TRANSITIVE"
  | "FORWARD"
  | "FORWARD_TRANSITIVE"
  | "FULL"
  | "FULL_TRANSITIVE"
  | "NONE";

/**
 * Schema Registry proxy configuration.
 */
export interface SchemaRegistryProxyConfig {
  /** Base URL for the Schema Registry API. */
  baseUrl: string;
  /** Authentication configuration. */
  auth?: AuthConfig;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Custom headers to include in all requests. */
  headers?: Record<string, string>;
}

/**
 * Options for listing subjects.
 */
export interface ListSubjectsOptions {
  /** Filter subjects by prefix. */
  subjectPrefix?: string;
  /** Include deleted subjects. */
  deleted?: boolean;
}

/**
 * Options for listing schemas.
 */
export interface ListSchemasOptions {
  /** Filter schemas by subject prefix. */
  subjectPrefix?: string;
  /** Include deleted schemas. */
  deleted?: boolean;
  /** Only return the latest version of each schema. */
  latestOnly?: boolean;
  /** Pagination offset. */
  offset?: number;
  /** Maximum number of results. */
  limit?: number;
}

/**
 * Options for registering a schema.
 */
export interface RegisterSchemaOptions {
  /** Subject name. */
  subject: string;
  /** Schema type. */
  schemaType?: SchemaType;
  /** Schema definition string. */
  schema: string;
  /** Schema references (for schemas that reference other schemas). */
  references?: SchemaReferenceInput[];
  /** Normalize the schema before registering. */
  normalize?: boolean;
}

/**
 * Input for schema references.
 */
export interface SchemaReferenceInput {
  /** Reference name. */
  name: string;
  /** Referenced subject. */
  subject: string;
  /** Referenced version. */
  version: number;
}

/**
 * Options for deleting a subject or schema version.
 */
export interface DeleteOptions {
  /** Permanently delete (hard delete). */
  permanent?: boolean;
}

/**
 * Options for checking compatibility.
 */
export interface CompatibilityCheckOptions {
  /** Subject name. */
  subject: string;
  /** Schema type. */
  schemaType?: SchemaType;
  /** Schema definition string. */
  schema: string;
  /** Schema references. */
  references?: SchemaReferenceInput[];
  /** Version to check against ("latest" or version number). */
  version?: string;
  /** Enable verbose mode for detailed error messages. */
  verbose?: boolean;
}

/**
 * Schema Registry API Proxy.
 *
 * Provides methods for interacting with Schema Registry.
 */
export class SchemaRegistryProxy {
  private readonly client: HttpClient;
  private readonly customHeaders: Record<string, string>;

  /**
   * Creates a new Schema Registry proxy.
   * @param config Proxy configuration.
   */
  constructor(config: SchemaRegistryProxyConfig) {
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
   * Lists all subjects.
   * @param options List options.
   * @returns Array of subject names.
   */
  async listSubjects(options?: ListSubjectsOptions): Promise<string[]> {
    const params: Record<string, string | boolean | undefined> = {};
    if (options?.subjectPrefix !== undefined) {
      params.subjectPrefix = options.subjectPrefix;
    }
    if (options?.deleted !== undefined) {
      params.deleted = options.deleted;
    }

    const response = await this.client.get<string[]>("/subjects", { params });
    return response.data;
  }

  /**
   * Lists all versions for a subject.
   * @param subject Subject name.
   * @param options Optional settings.
   * @returns Array of version numbers.
   */
  async listVersions(subject: string, options?: { deleted?: boolean }): Promise<number[]> {
    const params: Record<string, boolean | undefined> = {};
    if (options?.deleted !== undefined) {
      params.deleted = options.deleted;
    }

    const response = await this.client.get<number[]>(
      `/subjects/${encodeURIComponent(subject)}/versions`,
      { params },
    );
    return response.data;
  }

  /**
   * Gets a schema by subject and version.
   * @param subject Subject name.
   * @param version Version number or "latest".
   * @returns Schema data.
   */
  async getSchemaByVersion(subject: string, version: string | number): Promise<Schema> {
    const response = await this.client.get<Schema>(
      `/subjects/${encodeURIComponent(subject)}/versions/${version}`,
    );
    return response.data;
  }

  /**
   * Gets the latest schema for a subject.
   * @param subject Subject name.
   * @returns Schema data.
   */
  async getLatestSchema(subject: string): Promise<Schema> {
    return this.getSchemaByVersion(subject, "latest");
  }

  /**
   * Gets a schema by its global ID.
   * @param id Schema ID.
   * @returns Schema data.
   */
  async getSchemaById(id: number): Promise<Schema> {
    const response = await this.client.get<Schema>(`/schemas/ids/${id}`);
    return response.data;
  }

  /**
   * Gets the raw schema string by subject and version.
   * @param subject Subject name.
   * @param version Version number or "latest".
   * @returns Schema definition string.
   */
  async getSchemaString(subject: string, version: string | number): Promise<string> {
    // The /schema endpoint returns the raw schema definition.
    // When the Accept header is application/json, Schema Registry returns Content-Type: application/json,
    // which causes the HTTP client to parse the response as a JSON object.
    // We need to handle both cases: when it's already a string, or when it's been parsed as an object.
    const response = await this.client.get<string | object>(
      `/subjects/${encodeURIComponent(subject)}/versions/${version}/schema`,
    );

    // If the response was parsed as JSON (returning an object), stringify it
    if (typeof response.data === "object" && response.data !== null) {
      return JSON.stringify(response.data);
    }

    return response.data as string;
  }

  /**
   * Lists all schemas with optional filtering.
   * @param options List options.
   * @returns Array of schema data.
   */
  async listSchemas(options?: ListSchemasOptions): Promise<Schema[]> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options?.subjectPrefix !== undefined) {
      params.subjectPrefix = options.subjectPrefix;
    }
    if (options?.deleted !== undefined) {
      params.deleted = options.deleted;
    }
    if (options?.latestOnly !== undefined) {
      params.latestOnly = options.latestOnly;
    }
    if (options?.offset !== undefined) {
      params.offset = options.offset;
    }
    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    const response = await this.client.get<Schema[]>("/schemas", { params });
    return response.data;
  }

  /**
   * Gets the subjects associated with a schema ID.
   * @param id Schema ID.
   * @returns Array of subject names.
   */
  async getSubjectsForSchemaId(id: number): Promise<string[]> {
    const response = await this.client.get<string[]>(`/schemas/ids/${id}/subjects`);
    return response.data;
  }

  /**
   * Gets the subject-version pairs for a schema ID.
   * @param id Schema ID.
   * @returns Array of subject-version pairs.
   */
  async getVersionsForSchemaId(id: number): Promise<SubjectVersion[]> {
    const response = await this.client.get<SubjectVersion[]>(`/schemas/ids/${id}/versions`);
    return response.data;
  }

  /**
   * Lists supported schema types.
   * @returns Array of schema type names.
   */
  async listSchemaTypes(): Promise<string[]> {
    const response = await this.client.get<string[]>("/schemas/types");
    return response.data;
  }

  /**
   * Registers a new schema under a subject.
   * @param options Registration options.
   * @returns Registered schema response with ID.
   */
  async registerSchema(options: RegisterSchemaOptions): Promise<RegisterSchemaResponse> {
    const body: RegisterSchemaRequest = {
      schemaType: options.schemaType,
      schema: options.schema,
      references: options.references?.map((ref) => ({
        name: ref.name,
        subject: ref.subject,
        version: ref.version,
      })),
    };

    const params: Record<string, boolean | undefined> = {};
    if (options.normalize !== undefined) {
      params.normalize = options.normalize;
    }

    const response = await this.client.post<RegisterSchemaResponse>(
      `/subjects/${encodeURIComponent(options.subject)}/versions`,
      body,
      { params },
    );
    return response.data;
  }

  /**
   * Looks up a schema under a subject (checks if schema already exists).
   * @param subject Subject name.
   * @param schema Schema to look up.
   * @returns Schema data if found.
   */
  async lookupSchema(
    subject: string,
    schema: { schemaType?: SchemaType; schema: string; references?: SchemaReferenceInput[] },
  ): Promise<Schema> {
    const body: RegisterSchemaRequest = {
      schemaType: schema.schemaType,
      schema: schema.schema,
      references: schema.references?.map((ref) => ({
        name: ref.name,
        subject: ref.subject,
        version: ref.version,
      })),
    };

    const response = await this.client.post<Schema>(
      `/subjects/${encodeURIComponent(subject)}`,
      body,
    );
    return response.data;
  }

  /**
   * Deletes a subject (soft or hard delete).
   * @param subject Subject name.
   * @param options Delete options.
   * @returns Array of deleted version numbers.
   */
  async deleteSubject(subject: string, options?: DeleteOptions): Promise<number[]> {
    const params: Record<string, boolean | undefined> = {};
    if (options?.permanent !== undefined) {
      params.permanent = options.permanent;
    }

    const response = await this.client.delete<number[]>(
      `/subjects/${encodeURIComponent(subject)}`,
      { params },
    );
    return response.data;
  }

  /**
   * Deletes a specific schema version (soft or hard delete).
   * @param subject Subject name.
   * @param version Version number.
   * @param options Delete options.
   * @returns Deleted version number.
   */
  async deleteSchemaVersion(
    subject: string,
    version: number,
    options?: DeleteOptions,
  ): Promise<number> {
    const params: Record<string, boolean | undefined> = {};
    if (options?.permanent !== undefined) {
      params.permanent = options.permanent;
    }

    const response = await this.client.delete<number>(
      `/subjects/${encodeURIComponent(subject)}/versions/${version}`,
      { params },
    );
    return response.data;
  }

  /**
   * Gets the global compatibility level.
   * @returns Compatibility configuration.
   */
  async getGlobalConfig(): Promise<Config> {
    const response = await this.client.get<Config>("/config");
    return response.data;
  }

  /**
   * Sets the global compatibility level.
   * @param compatibility Compatibility mode.
   * @returns Updated configuration.
   */
  async setGlobalConfig(compatibility: CompatibilityMode): Promise<Config> {
    const response = await this.client.put<Config>("/config", {
      compatibility,
    });
    return response.data;
  }

  /**
   * Gets the compatibility level for a subject.
   * @param subject Subject name.
   * @returns Compatibility configuration.
   */
  async getSubjectConfig(subject: string): Promise<Config> {
    const response = await this.client.get<Config>(`/config/${encodeURIComponent(subject)}`);
    return response.data;
  }

  /**
   * Sets the compatibility level for a subject.
   * @param subject Subject name.
   * @param compatibility Compatibility mode.
   * @returns Updated configuration.
   */
  async setSubjectConfig(subject: string, compatibility: CompatibilityMode): Promise<Config> {
    const response = await this.client.put<Config>(`/config/${encodeURIComponent(subject)}`, {
      compatibility,
    });
    return response.data;
  }

  /**
   * Deletes the compatibility level for a subject (reverts to global).
   * @param subject Subject name.
   * @returns Previous compatibility mode.
   */
  async deleteSubjectConfig(subject: string): Promise<string> {
    const response = await this.client.delete<string>(`/config/${encodeURIComponent(subject)}`);
    return response.data;
  }

  /**
   * Checks if a schema is compatible with a subject.
   * @param options Compatibility check options.
   * @returns Compatibility check result.
   */
  async checkCompatibility(
    options: CompatibilityCheckOptions,
  ): Promise<CompatibilityCheckResponse> {
    const body: RegisterSchemaRequest = {
      schemaType: options.schemaType,
      schema: options.schema,
      references: options.references?.map((ref) => ({
        name: ref.name,
        subject: ref.subject,
        version: ref.version,
      })),
    };

    const version = options.version ?? "latest";
    const params: Record<string, boolean | undefined> = {};
    if (options.verbose !== undefined) {
      params.verbose = options.verbose;
    }

    const response = await this.client.post<CompatibilityCheckResponse>(
      `/compatibility/subjects/${encodeURIComponent(options.subject)}/versions/${version}`,
      body,
      { params },
    );
    return response.data;
  }

  /**
   * Checks if a subject exists.
   * @param subject Subject name.
   * @returns True if the subject exists.
   */
  async subjectExists(subject: string): Promise<boolean> {
    try {
      await this.listVersions(subject);
      return true;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Gets schemas that reference a given schema.
   * @param subject Subject name.
   * @param version Version number or "latest".
   * @returns Array of schema IDs that reference this schema.
   */
  async getReferencedBy(subject: string, version: string | number): Promise<number[]> {
    const response = await this.client.get<number[]>(
      `/subjects/${encodeURIComponent(subject)}/versions/${version}/referencedby`,
    );
    return response.data;
  }
}

/**
 * Creates a Schema Registry proxy with the given configuration.
 * @param config Proxy configuration.
 * @returns A configured Schema Registry proxy.
 */
export function createSchemaRegistryProxy(config: SchemaRegistryProxyConfig): SchemaRegistryProxy {
  return new SchemaRegistryProxy(config);
}

// Import types from generated clients
import type {
  Schema,
  RegisterSchemaRequest,
  RegisterSchemaResponse,
  SubjectVersion,
  Config,
  CompatibilityCheckResponse,
} from "../clients/schemaRegistryRest/models";
