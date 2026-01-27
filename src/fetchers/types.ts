/**
 * Resource Fetcher Types and Interfaces.
 *
 * Defines the contracts for fetching resources from different connection types.
 * These fetchers replace GraphQL queries to the sidecar during migration.
 */

import type { KafkaCluster } from "../models/kafkaCluster";
import type { Schema } from "../models/schema";
import type { SchemaRegistry } from "../models/schemaRegistry";

/**
 * Raw topic data from Kafka REST API v3.
 * This matches the TopicData type from the Kafka REST client.
 */
export interface TopicData {
  /** Topic name. */
  topic_name: string;
  /** Whether this is an internal topic. */
  is_internal: boolean;
  /** Replication factor. */
  replication_factor: number;
  /** Number of partitions. */
  partitions_count: number;
  /** Partition details. */
  partitions: object;
  /** Topic configuration. */
  configs: object;
  /** Authorized operations for the topic. */
  authorized_operations?: string[];
}

/**
 * Interface for fetching topics from a Kafka cluster.
 * Replaces sidecar Kafka REST v3 proxy calls.
 */
export interface TopicFetcher {
  /**
   * Fetch all topics from a Kafka cluster.
   * @param cluster The Kafka cluster to fetch topics from.
   * @returns Array of TopicData matching Kafka REST v3 API format.
   */
  fetchTopics(cluster: KafkaCluster): Promise<TopicData[]>;
}

/**
 * Interface for fetching subjects and schemas from a Schema Registry.
 * Replaces sidecar Schema Registry API calls.
 */
export interface SchemaFetcher {
  /**
   * Fetch all subjects from a Schema Registry.
   * @param schemaRegistry The Schema Registry to fetch from.
   * @returns Array of subject name strings, sorted alphabetically.
   */
  fetchSubjects(schemaRegistry: SchemaRegistry): Promise<string[]>;

  /**
   * Fetch all versions of a subject.
   * @param schemaRegistry The Schema Registry.
   * @param subject The subject name.
   * @returns Array of version numbers.
   */
  fetchVersions(schemaRegistry: SchemaRegistry, subject: string): Promise<number[]>;

  /**
   * Fetch all schema versions for a subject.
   * @param schemaRegistry The Schema Registry.
   * @param subject The subject name.
   * @returns Array of Schema objects, sorted by version descending.
   */
  fetchSchemasForSubject(schemaRegistry: SchemaRegistry, subject: string): Promise<Schema[]>;

  /**
   * Delete a schema version.
   * @param schemaRegistry The Schema Registry.
   * @param subject The subject name.
   * @param version The version number.
   * @param permanent If true, hard delete; if false, soft delete.
   */
  deleteSchemaVersion(
    schemaRegistry: SchemaRegistry,
    subject: string,
    version: number,
    permanent: boolean,
  ): Promise<void>;

  /**
   * Delete an entire subject.
   * @param schemaRegistry The Schema Registry.
   * @param subject The subject name.
   * @param permanent If true, hard delete; if false, soft delete.
   */
  deleteSubject(schemaRegistry: SchemaRegistry, subject: string, permanent: boolean): Promise<void>;
}

/**
 * Error thrown when topic fetching fails.
 */
export class TopicFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopicFetchError";
  }
}

/**
 * Error thrown when schema fetching fails.
 */
export class SchemaFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaFetchError";
  }
}
