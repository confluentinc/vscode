import * as vscode from "vscode";
import { EXTENSION_INSTANCE_ID } from "../constants";
import { getExtensionContext } from "../context/extension";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";

export class StorageManager {
  private globalState: vscode.Memento;
  private workspaceState: vscode.Memento;
  private secrets: vscode.SecretStorage;

  private static instance: StorageManager | null = null;
  private constructor() {
    const context = getExtensionContext();
    if (!context) {
      throw new ExtensionContextNotSetError("StorageManager");
    }
    this.globalState = context.globalState;
    this.workspaceState = context.workspaceState;
    this.secrets = context.secrets;
  }

  static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      const logger = new Logger("StorageManager");
      logger.info("Creating new StorageManager instance", { instanceId: EXTENSION_INSTANCE_ID });
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  async getSecret(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async setSecret(key: string, value: string): Promise<void> {
    return this.secrets.store(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    return this.secrets.delete(key);
  }

  async getGlobalStateKeys(): Promise<readonly string[]> {
    return this.globalState.keys();
  }

  async getGlobalState<T>(key: string): Promise<T | undefined> {
    return this.globalState.get<T>(key);
  }

  async setGlobalState(key: string, value: unknown): Promise<void> {
    return this.globalState.update(key, value);
  }

  async deleteGlobalState(key: string): Promise<void> {
    // setting the value to undefined is the same as deleting it since there's no explicit delete method on Memento
    return this.globalState.update(key, undefined);
  }

  async clearGlobalState(): Promise<void> {
    const keys = await this.getGlobalStateKeys();
    await Promise.all(keys.map((key) => this.deleteGlobalState(key)));
  }

  async getWorkspaceStateKeys(): Promise<readonly string[]> {
    return this.workspaceState.keys();
  }

  async getWorkspaceState<T>(key: string): Promise<T | undefined> {
    return this.workspaceState.get<T>(key);
  }

  async setWorkspaceState(key: string, value: unknown): Promise<void> {
    return this.workspaceState.update(key, value);
  }

  async deleteWorkspaceState(key: string): Promise<void> {
    // setting the value to undefined is the same as deleting it since there's no explicit delete method on Memento
    return this.workspaceState.update(key, undefined);
  }

  async clearWorkspaceState(): Promise<void> {
    const keys = await this.getWorkspaceStateKeys();
    await Promise.all(keys.map((key) => this.deleteWorkspaceState(key)));
  }
}

export function getStorageManager(): StorageManager {
  // should only be called after extension activation and context is set
  return StorageManager.getInstance();
}
