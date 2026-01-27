/**
 * Central connection management singleton.
 *
 * Manages all connection handlers and provides a unified API for
 * creating, updating, deleting, and controlling connections.
 */

import { EventEmitter } from "vscode";
import { DisposableCollection } from "../utils/disposables";
import { ConnectionType, type ConnectionId, type ConnectionStatus } from "./types";
import type { ConnectionSpec } from "./spec";
import { ConnectionStorage } from "./storage";
import {
  type ConnectionHandler,
  type ConnectionStatusChangeEvent,
  type ConnectionTestResult,
  CCloudConnectionHandler,
  DirectConnectionHandler,
  LocalConnectionHandler,
} from "./handlers";

/** Event fired when a connection is created. */
export interface ConnectionCreatedEvent {
  connectionId: ConnectionId;
  spec: ConnectionSpec;
}

/** Event fired when a connection is updated. */
export interface ConnectionUpdatedEvent {
  connectionId: ConnectionId;
  previousSpec: ConnectionSpec;
  currentSpec: ConnectionSpec;
}

/** Event fired when a connection is deleted. */
export interface ConnectionDeletedEvent {
  connectionId: ConnectionId;
  spec: ConnectionSpec;
}

/**
 * Central connection management singleton.
 *
 * Responsibilities:
 * - Create and manage connection handlers based on connection type
 * - Persist connections using ConnectionStorage
 * - Provide connection lifecycle methods
 * - Emit events for connection changes
 *
 * @example
 * ```typescript
 * const manager = ConnectionManager.getInstance();
 * const connection = await manager.createConnection({
 *   id: 'my-connection' as ConnectionId,
 *   name: 'My Kafka Connection',
 *   type: ConnectionType.DIRECT,
 *   kafkaCluster: { bootstrapServers: 'localhost:9092' }
 * });
 * await manager.connect(connection.connectionId);
 * ```
 */
export class ConnectionManager extends DisposableCollection {
  private static instance: ConnectionManager | null = null;

  /** Map of active connection handlers by ID. */
  private readonly handlers = new Map<ConnectionId, ConnectionHandler>();

  /** Connection storage for persistence. */
  private storage: ConnectionStorage | null = null;

  /** Event emitter for connection created events. */
  private readonly _onConnectionCreated = new EventEmitter<ConnectionCreatedEvent>();

  /** Event emitter for connection updated events. */
  private readonly _onConnectionUpdated = new EventEmitter<ConnectionUpdatedEvent>();

  /** Event emitter for connection deleted events. */
  private readonly _onConnectionDeleted = new EventEmitter<ConnectionDeletedEvent>();

  /** Event emitter for connection status changes (forwarded from handlers). */
  private readonly _onConnectionStatusChanged = new EventEmitter<ConnectionStatusChangeEvent>();

  /** Event fired when a connection is created. */
  readonly onConnectionCreated = this._onConnectionCreated.event;

  /** Event fired when a connection is updated. */
  readonly onConnectionUpdated = this._onConnectionUpdated.event;

  /** Event fired when a connection is deleted. */
  readonly onConnectionDeleted = this._onConnectionDeleted.event;

  /** Event fired when a connection's status changes. */
  readonly onConnectionStatusChanged = this._onConnectionStatusChanged.event;

  /** Private constructor for singleton pattern. */
  private constructor() {
    super();
    this.disposables.push(
      this._onConnectionCreated,
      this._onConnectionUpdated,
      this._onConnectionDeleted,
      this._onConnectionStatusChanged,
    );
  }

  /**
   * Gets the singleton instance of ConnectionManager.
   * @returns The ConnectionManager instance.
   */
  static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  /**
   * Resets the singleton instance. Used for testing.
   */
  static resetInstance(): void {
    if (ConnectionManager.instance) {
      ConnectionManager.instance.dispose();
      ConnectionManager.instance = null;
    }
  }

  /**
   * Initializes the connection manager with storage.
   * Must be called before using the manager.
   * @throws Error if storage is not initialized.
   */
  async initialize(): Promise<void> {
    this.storage = ConnectionStorage.getInstance();

    // Load existing connections from storage
    const stored = await this.storage.getAllConnections();
    for (const spec of stored.values()) {
      const handler = this.createHandler(spec);
      this.registerHandler(handler);
    }
  }

  /**
   * Creates a new connection.
   * @param spec The connection specification.
   * @param dryRun If true, validates but doesn't persist the connection.
   * @returns The created connection handler.
   * @throws Error if connection with same ID already exists.
   */
  async createConnection(spec: ConnectionSpec, dryRun = false): Promise<ConnectionHandler> {
    // Check for duplicate
    if (this.handlers.has(spec.id)) {
      throw new Error(`Connection already exists: ${spec.id}`);
    }

    // Create handler
    const handler = this.createHandler(spec);

    if (!dryRun) {
      // Persist
      await this.ensureStorage().saveConnection(spec);

      // Register handler
      this.registerHandler(handler);

      // Fire event
      this._onConnectionCreated.fire({
        connectionId: spec.id,
        spec,
      });
    }

    return handler;
  }

  /**
   * Updates an existing connection.
   * @param id The connection ID.
   * @param spec The updated connection specification.
   * @throws Error if connection doesn't exist.
   */
  async updateConnection(id: ConnectionId, spec: ConnectionSpec): Promise<void> {
    const handler = this.handlers.get(id);
    if (!handler) {
      throw new Error(`Connection not found: ${id}`);
    }

    const previousSpec = handler.spec;

    // Update handler
    handler.updateSpec(spec);

    // Persist
    await this.ensureStorage().saveConnection(spec);

    // Fire event
    this._onConnectionUpdated.fire({
      connectionId: id,
      previousSpec,
      currentSpec: spec,
    });
  }

  /**
   * Deletes a connection.
   * @param id The connection ID.
   * @throws Error if connection doesn't exist.
   */
  async deleteConnection(id: ConnectionId): Promise<void> {
    const handler = this.handlers.get(id);
    if (!handler) {
      throw new Error(`Connection not found: ${id}`);
    }

    const spec = handler.spec;

    // Disconnect if connected
    if (handler.isConnected()) {
      await handler.disconnect();
    }

    // Remove from storage
    await this.ensureStorage().deleteConnection(id);

    // Dispose and remove handler
    handler.dispose();
    this.handlers.delete(id);

    // Fire event
    this._onConnectionDeleted.fire({
      connectionId: id,
      spec,
    });
  }

  /**
   * Gets a connection handler by ID.
   * @param id The connection ID.
   * @returns The connection handler, or undefined if not found.
   */
  getConnection(id: ConnectionId): ConnectionHandler | undefined {
    return this.handlers.get(id);
  }

  /**
   * Gets all connection handlers.
   * @returns Array of all connection handlers.
   */
  getAllConnections(): ConnectionHandler[] {
    return Array.from(this.handlers.values());
  }

  /**
   * Gets all connection IDs.
   * @returns Array of all connection IDs.
   */
  getAllConnectionIds(): ConnectionId[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Connects a connection by ID.
   * @param id The connection ID.
   * @throws Error if connection doesn't exist.
   */
  async connect(id: ConnectionId): Promise<void> {
    const handler = this.handlers.get(id);
    if (!handler) {
      throw new Error(`Connection not found: ${id}`);
    }
    await handler.connect();
  }

  /**
   * Disconnects a connection by ID.
   * @param id The connection ID.
   * @throws Error if connection doesn't exist.
   */
  async disconnect(id: ConnectionId): Promise<void> {
    const handler = this.handlers.get(id);
    if (!handler) {
      throw new Error(`Connection not found: ${id}`);
    }
    await handler.disconnect();
  }

  /**
   * Tests a connection by ID.
   * @param id The connection ID.
   * @returns The result of the connection test.
   * @throws Error if connection doesn't exist.
   */
  async testConnection(id: ConnectionId): Promise<ConnectionTestResult> {
    const handler = this.handlers.get(id);
    if (!handler) {
      throw new Error(`Connection not found: ${id}`);
    }
    return handler.testConnection();
  }

  /**
   * Gets the status of a connection by ID.
   * @param id The connection ID.
   * @returns The connection status.
   * @throws Error if connection doesn't exist.
   */
  async getConnectionStatus(id: ConnectionId): Promise<ConnectionStatus> {
    const handler = this.handlers.get(id);
    if (!handler) {
      throw new Error(`Connection not found: ${id}`);
    }
    return handler.getStatus();
  }

  /**
   * Checks if a connection is currently connected.
   * @param id The connection ID.
   * @returns true if connected, false otherwise.
   */
  isConnected(id: ConnectionId): boolean {
    const handler = this.handlers.get(id);
    return handler?.isConnected() ?? false;
  }

  /**
   * Creates an appropriate handler based on connection type.
   */
  private createHandler(spec: ConnectionSpec): ConnectionHandler {
    switch (spec.type) {
      case ConnectionType.CCLOUD:
        return new CCloudConnectionHandler(spec);
      case ConnectionType.LOCAL:
        return new LocalConnectionHandler(spec);
      case ConnectionType.DIRECT:
        return new DirectConnectionHandler(spec);
      default:
        throw new Error(`Unknown connection type: ${spec.type}`);
    }
  }

  /**
   * Registers a handler and sets up event forwarding.
   */
  private registerHandler(handler: ConnectionHandler): void {
    this.handlers.set(handler.connectionId, handler);

    // Forward status change events
    const subscription = handler.onStatusChange((event) => {
      this._onConnectionStatusChanged.fire(event);
    });

    // Track subscription for cleanup
    this.disposables.push(subscription);
  }

  /**
   * Ensures storage is initialized.
   * @throws Error if storage is not initialized.
   */
  private ensureStorage(): ConnectionStorage {
    if (!this.storage) {
      throw new Error("ConnectionManager not initialized. Call initialize() first.");
    }
    return this.storage;
  }

  /**
   * Disposes of the manager and all handlers.
   */
  dispose(): void {
    // Dispose all handlers
    for (const handler of this.handlers.values()) {
      handler.dispose();
    }
    this.handlers.clear();

    super.dispose();
  }
}
