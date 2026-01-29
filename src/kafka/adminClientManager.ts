/**
 * Kafka Admin Client Manager.
 *
 * Manages the lifecycle of kafkajs Admin clients with connection pooling and caching.
 * Clients are cached by connection+cluster ID and automatically expired after 5 minutes
 * of inactivity (matching sidecar behavior).
 */

import type { Admin, Kafka, KafkaConfig } from "kafkajs";
import type { Disposable } from "vscode";
import { ConnectionType, type Credentials } from "../connections";
import { Logger } from "../logging";
import type { KafkaCluster } from "../models/kafkaCluster";
import { getResourceManager } from "../storage/resourceManager";
import { KafkaAdminError, KafkaAdminErrorCategory } from "./errors";
import { toSaslOptions } from "./saslConfig";

const logger = new Logger("kafka.adminClientManager");

/** Default client expiry time in milliseconds (5 minutes). */
const DEFAULT_EXPIRY_MS = 5 * 60 * 1000;

/** Cleanup interval in milliseconds (60 seconds). */
const CLEANUP_INTERVAL_MS = 60 * 1000;

/**
 * Cached admin client entry.
 */
interface CachedAdmin {
  /** The kafkajs Admin instance. */
  admin: Admin;
  /** The underlying Kafka client (needed for disconnect). */
  kafka: Kafka;
  /** Timestamp when this entry was last accessed. */
  lastAccess: number;
  /** Whether this client is currently connected. */
  connected: boolean;
}

/**
 * Generates a cache key for an Admin client.
 * @param cluster The Kafka cluster.
 * @returns A unique cache key.
 */
function generateCacheKey(cluster: KafkaCluster): string {
  return `${cluster.connectionId}:${cluster.id}`;
}

/**
 * Singleton manager for kafkajs Admin clients.
 *
 * Features:
 * - Connection pooling by connection+cluster ID
 * - 5-minute expiry for inactive clients (matching sidecar)
 * - Automatic cleanup timer
 * - Connection invalidation for logout/disconnect
 */
export class AdminClientManager implements Disposable {
  private static instance: AdminClientManager | null = null;

  private readonly cache: Map<string, CachedAdmin> = new Map();
  private readonly expiryMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  private constructor(expiryMs: number = DEFAULT_EXPIRY_MS) {
    this.expiryMs = expiryMs;
    this.startCleanupTimer();
  }

  /**
   * Gets the singleton instance of the AdminClientManager.
   */
  static getInstance(): AdminClientManager {
    if (!AdminClientManager.instance) {
      AdminClientManager.instance = new AdminClientManager();
    }
    return AdminClientManager.instance;
  }

  /**
   * Resets the singleton instance.
   * Used for testing purposes only.
   */
  static resetInstance(): void {
    if (AdminClientManager.instance) {
      AdminClientManager.instance.dispose();
      AdminClientManager.instance = null;
    }
  }

  /**
   * Gets or creates an Admin client for the given Kafka cluster.
   *
   * If a cached client exists and is still valid, it will be reused.
   * Otherwise, a new client is created and cached.
   *
   * @param cluster The Kafka cluster to connect to.
   * @returns A connected Admin client.
   * @throws KafkaAdminError if connection fails.
   */
  async getAdmin(cluster: KafkaCluster): Promise<Admin> {
    if (this.disposed) {
      throw new KafkaAdminError(
        "AdminClientManager has been disposed",
        KafkaAdminErrorCategory.INVALID,
      );
    }

    const key = generateCacheKey(cluster);
    let entry = this.cache.get(key);

    if (entry) {
      entry.lastAccess = Date.now();

      if (entry.connected) {
        logger.debug(`reusing cached Admin client for cluster ${cluster.id}`);
        return entry.admin;
      }

      // Client exists but is disconnected, try to reconnect
      logger.debug(`reconnecting cached Admin client for cluster ${cluster.id}`);
      try {
        await entry.admin.connect();
        entry.connected = true;
        return entry.admin;
      } catch {
        // Remove stale entry and create new one
        logger.warn(`failed to reconnect Admin client for cluster ${cluster.id}, creating new one`);
        await this.removeEntry(key, entry);
        entry = undefined;
      }
    }

    // Create new client
    logger.debug(`creating new Admin client for cluster ${cluster.id}`);
    const { kafka, admin } = await this.createAdminClient(cluster);

    try {
      await admin.connect();
    } catch (error) {
      throw KafkaAdminError.fromKafkaJsError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    this.cache.set(key, {
      admin,
      kafka,
      lastAccess: Date.now(),
      connected: true,
    });

    return admin;
  }

  /**
   * Invalidates all cached clients for a given connection.
   *
   * Called when a connection is logged out or disconnected.
   *
   * @param connectionId The connection ID to invalidate.
   */
  async invalidateConnection(connectionId: string): Promise<void> {
    const keysToRemove: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(`${connectionId}:`)) {
        keysToRemove.push(key);
        await this.removeEntry(key, entry);
      }
    }

    if (keysToRemove.length > 0) {
      logger.debug(
        `invalidated ${keysToRemove.length} Admin client(s) for connection ${connectionId}`,
      );
    }
  }

  /**
   * Invalidates a specific cached client.
   *
   * @param cluster The Kafka cluster whose client should be invalidated.
   */
  async invalidateCluster(cluster: KafkaCluster): Promise<void> {
    const key = generateCacheKey(cluster);
    const entry = this.cache.get(key);

    if (entry) {
      await this.removeEntry(key, entry);
      logger.debug(`invalidated Admin client for cluster ${cluster.id}`);
    }
  }

  /**
   * Gets the current number of cached clients.
   * Used for testing and monitoring.
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Disposes all cached clients and stops the cleanup timer.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.stopCleanupTimer();

    // Disconnect all cached clients
    const disconnectPromises: Promise<void>[] = [];
    for (const [key, entry] of this.cache.entries()) {
      disconnectPromises.push(this.removeEntry(key, entry));
    }

    // Fire and forget - we can't await in dispose()
    Promise.all(disconnectPromises).catch((error) => {
      logger.warn("error during AdminClientManager disposal", error);
    });
  }

  /**
   * Creates a new kafkajs Admin client for the given cluster.
   */
  private async createAdminClient(cluster: KafkaCluster): Promise<{ kafka: Kafka; admin: Admin }> {
    const config = await this.buildKafkaConfig(cluster);

    // Dynamic import of kafkajs to ensure it's only loaded in desktop environment
    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka(config);
    const admin = kafka.admin();

    return { kafka, admin };
  }

  /**
   * Builds kafkajs configuration for the given cluster.
   */
  private async buildKafkaConfig(cluster: KafkaCluster): Promise<KafkaConfig> {
    const credentials = await this.getCredentialsForCluster(cluster);
    const sasl = toSaslOptions(credentials);

    const config: KafkaConfig = {
      clientId: `vscode-confluent-${cluster.id}`,
      brokers: cluster.bootstrapServers.split(",").map((b) => b.trim()),
      connectionTimeout: 10000,
      requestTimeout: 30000,
      logLevel: 1, // ERROR only
    };

    // Configure SASL if credentials provided
    if (sasl) {
      config.sasl = sasl;
      // SASL typically requires SSL
      config.ssl = true;
    }

    // Configure SSL based on connection type
    if (cluster.connectionType === ConnectionType.Local) {
      // Local connections typically don't use SSL
      config.ssl = false;
    } else if (cluster.connectionType === ConnectionType.Direct) {
      // Direct connections may need SSL based on configuration
      // For now, enable SSL if using SASL
      if (sasl) {
        config.ssl = true;
      }
    }

    return config;
  }

  /**
   * Gets credentials for a cluster based on connection type.
   */
  private async getCredentialsForCluster(cluster: KafkaCluster): Promise<Credentials | undefined> {
    switch (cluster.connectionType) {
      case ConnectionType.Local:
        // Local connections don't require authentication
        return undefined;

      case ConnectionType.Direct: {
        // Direct connections may have credentials stored
        const resourceManager = getResourceManager();
        const spec = await resourceManager.getDirectConnection(cluster.connectionId);
        return spec?.kafkaCluster?.credentials;
      }

      case ConnectionType.Ccloud:
        // CCloud should not use kafkajs - it uses REST API with OAuth
        throw new KafkaAdminError(
          "CCloud connections should use REST API, not kafkajs Admin client",
          KafkaAdminErrorCategory.INVALID,
        );
    }
  }

  /**
   * Removes an entry from the cache and disconnects the client.
   */
  private async removeEntry(key: string, entry: CachedAdmin): Promise<void> {
    this.cache.delete(key);

    if (entry.connected) {
      try {
        await entry.admin.disconnect();
        entry.connected = false;
      } catch (error) {
        logger.warn(`error disconnecting Admin client: ${error}`);
      }
    }
  }

  /**
   * Starts the cleanup timer.
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries().catch((error) => {
        logger.warn("error during cleanup", error);
      });
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Stops the cleanup timer.
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Removes expired entries from the cache.
   */
  private async cleanupExpiredEntries(): Promise<void> {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.lastAccess > this.expiryMs) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      const entry = this.cache.get(key);
      if (entry) {
        logger.debug(`cleaning up expired Admin client: ${key}`);
        await this.removeEntry(key, entry);
      }
    }
  }
}

/**
 * Gets the singleton AdminClientManager instance.
 */
export function getAdminClientManager(): AdminClientManager {
  return AdminClientManager.getInstance();
}

/**
 * Disposes all topic services and related resources.
 * Called during extension deactivation.
 */
export function disposeTopicServices(): void {
  AdminClientManager.resetInstance();
}
