import * as vscode from "vscode";
import { CCloudEnvironment } from "./models/environment";
import { KafkaCluster } from "./models/kafkaCluster";
import { SchemaRegistryCluster } from "./models/schemaRegistry";

// NOTE: these are kept at the global level to allow for easy access from any file and track where
// we .fire() events and where we react to them via .event()

/** Indicate whether or not we have a CCloud connection (controlled by our auth provider). */
export const ccloudConnected = new vscode.EventEmitter<boolean>();
/** Signal to the auth provider that we no longer have a valid auth status for the current CCloud connection. */
export const ccloudAuthSessionInvalidated = new vscode.EventEmitter<void>();
export const ccloudOrganizationChanged = new vscode.EventEmitter<void>();

export const currentCCloudEnvironmentChanged = new vscode.EventEmitter<CCloudEnvironment | null>();

export const currentKafkaClusterChanged = new vscode.EventEmitter<KafkaCluster | null>();
/**
 * Fires an event when the list of topics for the focused Kafka cluster changes (i.e. a topic is
 * added, removed, or updated).
 */
export const currentKafkaClusterTopicsChanged = new vscode.EventEmitter<void>();

export const currentSchemaRegistryChanged = new vscode.EventEmitter<SchemaRegistryCluster | null>();
