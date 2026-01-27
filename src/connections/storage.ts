/**
 * Connection storage using VS Code's SecretStorage API.
 * Provides persistent, secure storage for connection specifications.
 */

import { Mutex } from "async-mutex";
import type { Disposable, SecretStorage } from "vscode";
import { getExtensionContext } from "../context/extension";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";
import { getSecretStorage } from "../storage/utils";
import type { ConnectionSpec } from "./spec";
import type { ConnectionId } from "./types";

const logger = new Logger("connections.storage");

/** Storage key for persisted connections. */
const CONNECTIONS_STORAGE_KEY = "confluent.connections";

/** Map of ConnectionId to ConnectionSpec. */
export type ConnectionsById = Map<ConnectionId, ConnectionSpec>;

/**
 * Serializes a ConnectionSpec to a JSON-safe format.
 * Handles Date objects and other non-JSON types.
 */
export function connectionSpecToJSON(spec: ConnectionSpec): object {
  return JSON.parse(JSON.stringify(spec));
}

/**
 * Deserializes a JSON object to a ConnectionSpec.
 * Restores Date objects and validates required fields.
 */
export function connectionSpecFromJSON(json: object): ConnectionSpec {
  // The JSON object should have the required ConnectionSpec fields
  const spec = json as ConnectionSpec;

  // Validate required fields are present
  if (!spec.id || !spec.name || !spec.type) {
    throw new Error("Invalid ConnectionSpec: missing required fields (id, name, or type)");
  }

  return spec;
}

/**
 * Converts a Map to a JSON string for storage.
 */
function mapToString(map: ConnectionsById): string {
  const obj: Record<string, object> = {};
  for (const [id, spec] of map.entries()) {
    obj[id] = connectionSpecToJSON(spec);
  }
  return JSON.stringify(obj);
}

/**
 * Parses a JSON string back to a Map.
 */
function stringToMap(str: string): ConnectionsById {
  const obj = JSON.parse(str) as Record<string, object>;
  const map: ConnectionsById = new Map();
  for (const [id, json] of Object.entries(obj)) {
    try {
      map.set(id as ConnectionId, connectionSpecFromJSON(json));
    } catch (error) {
      logger.warn(`Failed to parse connection ${id}, skipping: ${error}`);
    }
  }
  return map;
}

/**
 * Provides persistent storage for connection specifications using VS Code's SecretStorage.
 *
 * Uses SecretStorage because ConnectionSpec objects may contain sensitive credentials.
 * Implements mutex-based locking for safe concurrent access.
 *
 * @example
 * ```typescript
 * const storage = ConnectionStorage.getInstance();
 *
 * // Save a connection
 * await storage.saveConnection(mySpec);
 *
 * // Get a connection
 * const spec = await storage.getConnection(connectionId);
 *
 * // Get all connections
 * const all = await storage.getAllConnections();
 *
 * // Delete a connection
 * await storage.deleteConnection(connectionId);
 * ```
 */
export class ConnectionStorage implements Disposable {
  private static instance: ConnectionStorage | null = null;

  private readonly secrets: SecretStorage;
  private readonly mutex: Mutex;

  private constructor() {
    if (!getExtensionContext()) {
      throw new ExtensionContextNotSetError("ConnectionStorage");
    }
    this.secrets = getSecretStorage();
    this.mutex = new Mutex();
  }

  /**
   * Gets the singleton instance of ConnectionStorage.
   * @throws ExtensionContextNotSetError if the extension context is not set.
   */
  static getInstance(): ConnectionStorage {
    if (!ConnectionStorage.instance) {
      ConnectionStorage.instance = new ConnectionStorage();
    }
    return ConnectionStorage.instance;
  }

  /**
   * Resets the singleton instance. Only used for testing.
   * @internal
   */
  static resetInstance(): void {
    ConnectionStorage.instance = null;
  }

  /**
   * Retrieves all stored connections.
   * @returns A map of connection IDs to their specifications.
   */
  async getAllConnections(): Promise<ConnectionsById> {
    const connectionsString = await this.secrets.get(CONNECTIONS_STORAGE_KEY);
    if (!connectionsString) {
      return new Map();
    }

    try {
      return stringToMap(connectionsString);
    } catch (error) {
      logger.error(`Failed to parse connections from storage: ${error}`);
      return new Map();
    }
  }

  /**
   * Retrieves a specific connection by ID.
   * @param id The connection ID to look up.
   * @returns The connection specification, or null if not found.
   */
  async getConnection(id: ConnectionId): Promise<ConnectionSpec | null> {
    const connections = await this.getAllConnections();
    return connections.get(id) ?? null;
  }

  /**
   * Saves a connection specification.
   * If a connection with the same ID exists, it will be overwritten.
   * @param spec The connection specification to save.
   */
  async saveConnection(spec: ConnectionSpec): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const connections = await this.getAllConnections();
      connections.set(spec.id, spec);
      await this.secrets.store(CONNECTIONS_STORAGE_KEY, mapToString(connections));
      logger.debug(`Saved connection: ${spec.id} (${spec.name})`);
    });
  }

  /**
   * Deletes a connection by ID.
   * @param id The connection ID to delete.
   * @returns true if the connection was deleted, false if it didn't exist.
   */
  async deleteConnection(id: ConnectionId): Promise<boolean> {
    return await this.mutex.runExclusive(async () => {
      const connections = await this.getAllConnections();
      const existed = connections.has(id);
      if (existed) {
        connections.delete(id);
        await this.secrets.store(CONNECTIONS_STORAGE_KEY, mapToString(connections));
        logger.debug(`Deleted connection: ${id}`);
      }
      return existed;
    });
  }

  /**
   * Deletes all stored connections.
   */
  async deleteAllConnections(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      await this.secrets.delete(CONNECTIONS_STORAGE_KEY);
      logger.debug("Deleted all connections");
    });
  }

  /**
   * Checks if a connection exists.
   * @param id The connection ID to check.
   * @returns true if the connection exists.
   */
  async hasConnection(id: ConnectionId): Promise<boolean> {
    const connections = await this.getAllConnections();
    return connections.has(id);
  }

  /**
   * Gets the count of stored connections.
   * @returns The number of stored connections.
   */
  async getConnectionCount(): Promise<number> {
    const connections = await this.getAllConnections();
    return connections.size;
  }

  /**
   * Gets connection IDs for connections of a specific type.
   * @param type The connection type to filter by.
   * @returns Array of connection IDs matching the type.
   */
  async getConnectionIdsByType(type: ConnectionSpec["type"]): Promise<ConnectionId[]> {
    const connections = await this.getAllConnections();
    const ids: ConnectionId[] = [];
    for (const [id, spec] of connections.entries()) {
      if (spec.type === type) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Disposes of the storage instance.
   */
  dispose(): void {
    // No active resources to dispose, but reset the singleton
    ConnectionStorage.instance = null;
  }
}
