/**
 * Schema Fetcher Implementation.
 *
 * Fetches subjects and schemas from Schema Registry using the Schema Registry proxy.
 * Replaces sidecar's schema fetching during migration.
 */

import type { AuthConfig } from "../proxy";
import { createSchemaRegistryProxy, HttpError, type SchemaRegistryProxy } from "../proxy";
import { Schema, SchemaType } from "../models/schema";
import type { SchemaRegistry } from "../models/schemaRegistry";
import { Logger } from "../logging";
import { type SchemaFetcher, SchemaFetchError } from "./types";
import { executeInWorkerPool, extract } from "../utils/workerPool";

const logger = new Logger("schemaFetcher");

/**
 * Configuration for creating a schema fetcher.
 */
export interface SchemaFetcherConfig {
  /** Function to get auth config for a schema registry. */
  getAuthConfig: (schemaRegistry: SchemaRegistry) => AuthConfig | undefined;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Maximum concurrent requests when fetching schema versions. */
  maxConcurrentRequests?: number;
}

/**
 * Creates a schema fetcher with the given configuration.
 * @param config Fetcher configuration.
 * @returns A SchemaFetcher implementation.
 */
export function createSchemaFetcher(config: SchemaFetcherConfig): SchemaFetcher {
  return new SchemaFetcherImpl(config);
}

/**
 * Schema fetcher implementation using Schema Registry API.
 */
class SchemaFetcherImpl implements SchemaFetcher {
  private readonly config: SchemaFetcherConfig;
  private readonly maxConcurrentRequests: number;

  constructor(config: SchemaFetcherConfig) {
    this.config = config;
    this.maxConcurrentRequests = config.maxConcurrentRequests ?? 5;
  }

  /**
   * Fetch all subjects from a Schema Registry.
   * @param schemaRegistry The Schema Registry to fetch from.
   * @returns Array of subject name strings, sorted alphabetically.
   */
  async fetchSubjects(schemaRegistry: SchemaRegistry): Promise<string[]> {
    logger.debug(`fetching subjects from Schema Registry ${schemaRegistry.id}`);

    const proxy = this.createProxy(schemaRegistry);

    try {
      const subjects = await proxy.listSubjects();
      subjects.sort((a, b) => a.localeCompare(b));

      logger.debug(
        `fetched ${subjects.length} subject(s) from Schema Registry ${schemaRegistry.id}`,
      );

      return subjects;
    } catch (error) {
      throw this.wrapError(
        error,
        `Failed to fetch subjects from Schema Registry ${schemaRegistry.id}`,
      );
    }
  }

  /**
   * Fetch all versions of a subject.
   * @param schemaRegistry The Schema Registry.
   * @param subject The subject name.
   * @returns Array of version numbers.
   */
  async fetchVersions(schemaRegistry: SchemaRegistry, subject: string): Promise<number[]> {
    logger.debug(
      `fetching versions for subject ${subject} from Schema Registry ${schemaRegistry.id}`,
    );

    const proxy = this.createProxy(schemaRegistry);

    try {
      const versions = await proxy.listVersions(subject);
      return versions;
    } catch (error) {
      throw this.wrapError(
        error,
        `Failed to fetch versions for subject ${subject} from Schema Registry ${schemaRegistry.id}`,
      );
    }
  }

  /**
   * Fetch all schema versions for a subject.
   * @param schemaRegistry The Schema Registry.
   * @param subject The subject name.
   * @returns Array of Schema objects, sorted by version descending.
   */
  async fetchSchemasForSubject(schemaRegistry: SchemaRegistry, subject: string): Promise<Schema[]> {
    logger.debug(
      `fetching schemas for subject ${subject} from Schema Registry ${schemaRegistry.id}`,
    );

    const proxy = this.createProxy(schemaRegistry);

    try {
      // Get all version numbers first
      const versions = await proxy.listVersions(subject);

      // Sort versions descending (highest first)
      versions.sort((a, b) => b - a);

      const highestVersion = Math.max(...versions);

      // Prepare concurrent requests for each version
      const fetchParams = versions.map((version) => ({
        proxy,
        schemaRegistry,
        subject,
        version,
        highestVersion,
      }));

      // Fetch all versions concurrently, capped at maxConcurrentRequests
      const results = await executeInWorkerPool(
        (params) => this.fetchSchemaVersion(params),
        fetchParams,
        { maxWorkers: this.maxConcurrentRequests },
      );

      // Extract successful results (throws if any failed)
      return extract(results);
    } catch (error) {
      throw this.wrapError(
        error,
        `Failed to fetch schemas for subject ${subject} from Schema Registry ${schemaRegistry.id}`,
      );
    }
  }

  /**
   * Delete a schema version.
   * @param schemaRegistry The Schema Registry.
   * @param subject The subject name.
   * @param version The version number.
   * @param permanent If true, hard delete; if false, soft delete.
   */
  async deleteSchemaVersion(
    schemaRegistry: SchemaRegistry,
    subject: string,
    version: number,
    permanent: boolean,
  ): Promise<void> {
    logger.debug(
      `deleting schema version ${version} for subject ${subject} from Schema Registry ${schemaRegistry.id} (permanent: ${permanent})`,
    );

    const proxy = this.createProxy(schemaRegistry);

    try {
      if (permanent) {
        // Must do a soft delete first, then hard delete
        await proxy.deleteSchemaVersion(subject, version, { permanent: false });
      }
      await proxy.deleteSchemaVersion(subject, version, { permanent });
    } catch (error) {
      throw this.wrapError(
        error,
        `Failed to delete schema version ${version} for subject ${subject}`,
      );
    }
  }

  /**
   * Delete an entire subject.
   * @param schemaRegistry The Schema Registry.
   * @param subject The subject name.
   * @param permanent If true, hard delete; if false, soft delete.
   */
  async deleteSubject(
    schemaRegistry: SchemaRegistry,
    subject: string,
    permanent: boolean,
  ): Promise<void> {
    logger.debug(
      `deleting subject ${subject} from Schema Registry ${schemaRegistry.id} (permanent: ${permanent})`,
    );

    const proxy = this.createProxy(schemaRegistry);

    try {
      if (permanent) {
        // Must do a soft delete first, then hard delete
        await proxy.deleteSubject(subject, { permanent: false });
      }
      await proxy.deleteSubject(subject, { permanent });
    } catch (error) {
      throw this.wrapError(error, `Failed to delete subject ${subject}`);
    }
  }

  /**
   * Fetch a single schema version.
   */
  private async fetchSchemaVersion(params: {
    proxy: SchemaRegistryProxy;
    schemaRegistry: SchemaRegistry;
    subject: string;
    version: number;
    highestVersion: number;
  }): Promise<Schema> {
    const { proxy, schemaRegistry, subject, version, highestVersion } = params;

    const response = await proxy.getSchemaByVersion(subject, version);

    // Convert to Schema model
    return Schema.create({
      connectionId: schemaRegistry.connectionId,
      connectionType: schemaRegistry.connectionType,
      schemaRegistryId: schemaRegistry.id,
      environmentId: schemaRegistry.environmentId,
      id: response.id!.toString(),
      subject: response.subject!,
      version: response.version!,
      // AVRO doesn't show up in schemaType, defaults to AVRO
      type: (response.schemaType as SchemaType) || SchemaType.Avro,
      isHighestVersion: response.version === highestVersion,
    });
  }

  /**
   * Creates a Schema Registry proxy for the given registry.
   */
  private createProxy(schemaRegistry: SchemaRegistry): SchemaRegistryProxy {
    return createSchemaRegistryProxy({
      baseUrl: schemaRegistry.uri,
      auth: this.config.getAuthConfig(schemaRegistry),
      timeout: this.config.timeout,
    });
  }

  /**
   * Wraps an error in a SchemaFetchError.
   */
  private wrapError(error: unknown, message: string): SchemaFetchError {
    if (error instanceof SchemaFetchError) {
      return error;
    }

    if (error instanceof HttpError) {
      return new SchemaFetchError(`${message}: ${error.status} ${error.message}`);
    }

    return new SchemaFetchError(
      `${message}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
