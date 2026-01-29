/**
 * ACL Service for Kafka.
 *
 * Queries and evaluates Kafka ACLs to determine authorized operations for topics.
 * Used by direct connections where describeTopics with includeAuthorizedOperations is not available.
 */

import type {
  Acl,
  AclFilter,
  Admin,
  AclOperationTypes,
  AclPermissionTypes,
  DescribeAclResource,
  ResourcePatternTypes,
} from "kafkajs";
import type { Credentials } from "../connections";
import { Logger } from "../logging";
import type { KafkaCluster } from "../models/kafkaCluster";
import { getAdminClientManager } from "./adminClientManager";
import { derivePrincipal } from "./principalDerivation";

const logger = new Logger("kafka.aclService");

/** Cache duration in milliseconds (60 seconds). */
const CACHE_TTL_MS = 60 * 1000;

/**
 * Topic operations that can be authorized via ACLs.
 * Maps to human-readable operation names.
 */
export const TOPIC_OPERATIONS: readonly string[] = [
  "READ",
  "WRITE",
  "CREATE",
  "DELETE",
  "ALTER",
  "DESCRIBE",
  "DESCRIBE_CONFIGS",
  "ALTER_CONFIGS",
] as const;

/**
 * Result of ACL evaluation for a topic.
 */
export interface TopicAclResult {
  /** Operations the user is authorized to perform on the topic. */
  authorizedOperations: string[];
  /** Whether ACL information is available (false if ACLs couldn't be queried). */
  aclsAvailable: boolean;
  /** Error message if ACLs couldn't be queried. */
  error?: string;
}

/**
 * Cached ACL result with timestamp.
 */
interface CachedAclResult {
  result: TopicAclResult;
  timestamp: number;
}

/**
 * Service for querying and evaluating Kafka ACLs.
 *
 * Features:
 * - Queries ACLs using admin.describeAcls()
 * - Evaluates ACLs against derived principal
 * - Handles wildcards, prefixes, and ALL operation expansion
 * - Implements DENY precedence rule
 * - Caches results for 60 seconds
 */
export class AclService {
  private static instance: AclService | null = null;

  /** Cache of ACL results by "connectionId:clusterId:topicName" */
  private readonly cache: Map<string, CachedAclResult> = new Map();

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Gets the singleton instance of AclService.
   */
  static getInstance(): AclService {
    if (!AclService.instance) {
      AclService.instance = new AclService();
    }
    return AclService.instance;
  }

  /**
   * Resets the singleton instance.
   * Used for testing purposes only.
   */
  static resetInstance(): void {
    AclService.instance = null;
  }

  /**
   * Gets authorized operations for a single topic.
   *
   * @param cluster The Kafka cluster.
   * @param topicName The topic name.
   * @param credentials Optional credentials (if not provided, will be fetched).
   * @returns ACL result with authorized operations.
   */
  async getTopicAuthorizedOperations(
    cluster: KafkaCluster,
    topicName: string,
    credentials?: Credentials,
  ): Promise<TopicAclResult> {
    const cacheKey = this.getCacheKey(cluster, topicName);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      logger.debug(`returning cached ACL result for topic ${topicName}`);
      return cached.result;
    }

    // Derive principal
    logger.debug(
      `deriving principal from credentials type: ${credentials?.type ?? "unknown"} ` +
        `(keys: ${credentials ? Object.keys(credentials).join(", ") : "none"})`,
    );
    const principalResult = derivePrincipal(credentials);
    if (!principalResult.canDerive) {
      logger.debug(`cannot derive principal: ${principalResult.reason}`);
      return {
        authorizedOperations: [],
        aclsAvailable: false,
        error: principalResult.reason,
      };
    }
    logger.debug(`derived principal: ${principalResult.principal}`);

    try {
      const admin = await this.getAdmin(cluster);
      const result = await this.evaluateTopicAcls(admin, topicName, principalResult.principal!);

      // Cache the result
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      logger.debug(`failed to query ACLs: ${error}`);
      // Don't cache failures
      return {
        authorizedOperations: [],
        aclsAvailable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Gets authorized operations for multiple topics.
   *
   * @param cluster The Kafka cluster.
   * @param topicNames The topic names.
   * @param credentials Optional credentials (if not provided, will be fetched).
   * @returns Map of topic name to ACL result.
   */
  async getTopicsAuthorizedOperations(
    cluster: KafkaCluster,
    topicNames: string[],
    credentials?: Credentials,
  ): Promise<Map<string, TopicAclResult>> {
    const results = new Map<string, TopicAclResult>();

    // Derive principal once for all topics
    const principalResult = derivePrincipal(credentials);
    if (!principalResult.canDerive) {
      const errorResult: TopicAclResult = {
        authorizedOperations: [],
        aclsAvailable: false,
        error: principalResult.reason,
      };
      for (const topicName of topicNames) {
        results.set(topicName, errorResult);
      }
      return results;
    }

    // Check cache for all topics
    const uncachedTopics: string[] = [];
    for (const topicName of topicNames) {
      const cacheKey = this.getCacheKey(cluster, topicName);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        results.set(topicName, cached.result);
      } else {
        uncachedTopics.push(topicName);
      }
    }

    if (uncachedTopics.length === 0) {
      return results;
    }

    try {
      const admin = await this.getAdmin(cluster);

      // Query ACLs for all uncached topics in parallel
      const promises = uncachedTopics.map(async (topicName) => {
        const result = await this.evaluateTopicAcls(admin, topicName, principalResult.principal!);
        const cacheKey = this.getCacheKey(cluster, topicName);
        this.cache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        });
        return { topicName, result };
      });

      const resolved = await Promise.all(promises);
      for (const { topicName, result } of resolved) {
        results.set(topicName, result);
      }
    } catch (error) {
      logger.debug(`failed to query ACLs: ${error}`);
      const errorResult: TopicAclResult = {
        authorizedOperations: [],
        aclsAvailable: false,
        error: error instanceof Error ? error.message : String(error),
      };
      for (const topicName of uncachedTopics) {
        results.set(topicName, errorResult);
      }
    }

    return results;
  }

  /**
   * Clears the ACL cache for a specific cluster.
   */
  clearCacheForCluster(cluster: KafkaCluster): void {
    const prefix = `${cluster.connectionId}:${cluster.id}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clears the entire ACL cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Evaluates ACLs for a topic and principal.
   */
  private async evaluateTopicAcls(
    admin: Admin,
    topicName: string,
    principal: string,
  ): Promise<TopicAclResult> {
    // Import kafkajs enums dynamically
    const kafkajs = await import("kafkajs");

    // Query ACLs for the topic using MATCH pattern type to get all matching ACLs
    const filter: AclFilter = {
      resourceType: kafkajs.AclResourceTypes.TOPIC,
      resourcePatternType: kafkajs.ResourcePatternTypes.MATCH,
      operation: kafkajs.AclOperationTypes.ANY,
      permissionType: kafkajs.AclPermissionTypes.ANY,
    };

    let response;
    try {
      logger.debug(`querying ACLs for topic "${topicName}" with principal "${principal}"`);
      response = await admin.describeAcls(filter);
      logger.debug(
        `describeAcls response: errorCode=${response.errorCode}, resources=${response.resources.length}`,
      );
    } catch (error) {
      // If the error indicates ACLs are not supported or accessible, return unavailable
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`describeAcls error: ${message}`);
      if (
        message.includes("SECURITY_DISABLED") ||
        message.includes("AUTHORIZATION") ||
        message.includes("Cluster not ready")
      ) {
        return {
          authorizedOperations: [],
          aclsAvailable: false,
          error: "ACLs not available or not authorized to query",
        };
      }
      throw error;
    }

    // errorCode is 0 for success, non-zero for errors
    // kafkajs may return undefined when there's no error
    if (response.errorCode) {
      return {
        authorizedOperations: [],
        aclsAvailable: false,
        error: response.errorMessage ?? `ACL query error: ${response.errorCode}`,
      };
    }

    // If no ACLs are configured, assume open access (all operations allowed)
    if (response.resources.length === 0) {
      return {
        authorizedOperations: [...TOPIC_OPERATIONS],
        aclsAvailable: true,
      };
    }

    // Filter resources that match our topic
    const matchingResources = response.resources.filter((r) =>
      this.resourceMatchesTopic(r, topicName, kafkajs.ResourcePatternTypes),
    );

    if (matchingResources.length === 0) {
      // No ACLs apply to this topic - open access
      return {
        authorizedOperations: [...TOPIC_OPERATIONS],
        aclsAvailable: true,
      };
    }

    // Evaluate ACLs for the principal
    const authorizedOps = this.evaluateAclsForPrincipal(
      matchingResources,
      principal,
      kafkajs.AclOperationTypes,
      kafkajs.AclPermissionTypes,
    );

    return {
      authorizedOperations: authorizedOps,
      aclsAvailable: true,
    };
  }

  /**
   * Checks if a resource matches a topic name.
   */
  private resourceMatchesTopic(
    resource: DescribeAclResource,
    topicName: string,
    patternTypes: typeof ResourcePatternTypes,
  ): boolean {
    switch (resource.resourcePatternType) {
      case patternTypes.LITERAL:
        // Exact match or wildcard
        return resource.resourceName === topicName || resource.resourceName === "*";
      case patternTypes.PREFIXED:
        // Prefix match
        return topicName.startsWith(resource.resourceName);
      case patternTypes.ANY:
      case patternTypes.MATCH:
        // These match any topic
        return true;
      default:
        return false;
    }
  }

  /**
   * Evaluates ACLs for a principal and returns authorized operations.
   *
   * Rules:
   * 1. DENY takes precedence over ALLOW
   * 2. User:* (wildcard) matches all users
   * 3. ALL operation expands to all topic operations
   */
  private evaluateAclsForPrincipal(
    resources: DescribeAclResource[],
    principal: string,
    operationTypes: typeof AclOperationTypes,
    permissionTypes: typeof AclPermissionTypes,
  ): string[] {
    // Collect all ACLs from all matching resources
    const allAcls: Acl[] = [];
    for (const resource of resources) {
      allAcls.push(...resource.acls);
    }

    // Filter ACLs that apply to this principal
    const applicableAcls = allAcls.filter((acl) => this.principalMatches(acl.principal, principal));

    if (applicableAcls.length === 0) {
      // No ACLs apply to this principal - no access
      return [];
    }

    // Build sets of allowed and denied operations
    const allowedOps = new Set<number>();
    const deniedOps = new Set<number>();

    for (const acl of applicableAcls) {
      // Skip if host doesn't match (we assume * for local clients)
      if (acl.host !== "*") {
        continue;
      }

      const operations = this.expandOperation(acl.operation, operationTypes);

      if (acl.permissionType === permissionTypes.ALLOW) {
        for (const op of operations) {
          allowedOps.add(op);
        }
      } else if (acl.permissionType === permissionTypes.DENY) {
        for (const op of operations) {
          deniedOps.add(op);
        }
      }
    }

    // Apply DENY precedence: remove denied operations from allowed
    for (const denied of deniedOps) {
      allowedOps.delete(denied);
    }

    // Convert to operation names
    return this.operationNumbersToNames(allowedOps, operationTypes);
  }

  /**
   * Checks if an ACL principal matches the user's principal.
   */
  private principalMatches(aclPrincipal: string, userPrincipal: string): boolean {
    // Exact match
    if (aclPrincipal === userPrincipal) {
      return true;
    }
    // Wildcard matches all users
    if (aclPrincipal === "User:*") {
      return true;
    }
    return false;
  }

  /**
   * Expands an operation (especially ALL) to individual operations.
   */
  private expandOperation(
    operation: AclOperationTypes,
    operationTypes: typeof AclOperationTypes,
  ): number[] {
    if (operation === operationTypes.ALL) {
      // ALL expands to all topic-relevant operations
      return [
        operationTypes.READ,
        operationTypes.WRITE,
        operationTypes.CREATE,
        operationTypes.DELETE,
        operationTypes.ALTER,
        operationTypes.DESCRIBE,
        operationTypes.DESCRIBE_CONFIGS,
        operationTypes.ALTER_CONFIGS,
      ];
    }
    return [operation];
  }

  /**
   * Converts operation numbers to human-readable names.
   */
  private operationNumbersToNames(
    operations: Set<number>,
    operationTypes: typeof AclOperationTypes,
  ): string[] {
    const names: string[] = [];
    const opMap: Record<number, string> = {
      [operationTypes.READ]: "READ",
      [operationTypes.WRITE]: "WRITE",
      [operationTypes.CREATE]: "CREATE",
      [operationTypes.DELETE]: "DELETE",
      [operationTypes.ALTER]: "ALTER",
      [operationTypes.DESCRIBE]: "DESCRIBE",
      [operationTypes.DESCRIBE_CONFIGS]: "DESCRIBE_CONFIGS",
      [operationTypes.ALTER_CONFIGS]: "ALTER_CONFIGS",
    };

    for (const op of operations) {
      const name = opMap[op];
      if (name) {
        names.push(name);
      }
    }

    // Sort for consistent ordering
    return names.sort();
  }

  /**
   * Gets cache key for a topic.
   */
  private getCacheKey(cluster: KafkaCluster, topicName: string): string {
    return `${cluster.connectionId}:${cluster.id}:${topicName}`;
  }

  /**
   * Gets an Admin client for the cluster.
   */
  private async getAdmin(cluster: KafkaCluster): Promise<Admin> {
    const manager = getAdminClientManager();
    return manager.getAdmin(cluster);
  }
}

/**
 * Gets the singleton AclService instance.
 */
export function getAclService(): AclService {
  return AclService.getInstance();
}
