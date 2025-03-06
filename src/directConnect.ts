import { randomUUID } from "crypto";
import { Uri, ViewColumn, window } from "vscode";
import {
  AuthErrors,
  ConnectedState,
  Connection,
  ConnectionType,
  instanceOfApiKeyAndSecret,
  instanceOfBasicCredentials,
  instanceOfOAuthCredentials,
  instanceOfScramCredentials,
} from "./clients/sidecar";
import { DirectConnectionManager, mergeSecrets } from "./directConnectManager";
import { WebviewPanelCache } from "./webview-cache";
import { handleWebviewMessage } from "./webview/comms/comms";
import { post, PostResponse, TestResponse } from "./webview/direct-connect-form";
import connectionFormTemplate from "./webview/direct-connect-form.html";
import { CustomConnectionSpec } from "./storage/resourceManager";
import { ConnectionId } from "./models/resource";

type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
>;

const directConnectWebviewCache = new WebviewPanelCache();

export function openDirectConnectionForm(connection: CustomConnectionSpec | null): void {
  const connectionUUID = connection?.id || (randomUUID() as ConnectionId);
  const action: "new" | "update" | "import" = !connection?.id
    ? "new"
    : connection.id === "FILE_UPLOAD"
      ? "import"
      : "update";
  // Set up the webview, checking for existing form for this connection
  const title = `${action.charAt(0).toUpperCase() + action.slice(1)} Connection`;
  const [directConnectForm, formExists] = directConnectWebviewCache.findOrCreate(
    { id: connectionUUID, multiple: false, template: connectionFormTemplate },
    `direct-connect-${connectionUUID}`,
    title,
    ViewColumn.One,
    {
      enableScripts: true,
    },
  );

  if (formExists) {
    directConnectForm.reveal();
    return;
  }

  /** Communicates with the webview Form & connection manager
   * Takes form data and processes it to send along to the directConnectManager.ts
   * Gets response from manager and passes back to Form in the PostResponse format */
  async function saveConnection(body: any): Promise<PostResponse> {
    let updatedSpec = getConnectionSpecFromFormData(body);
    // Merge secrets back in from the original connection when importing
    if (connection && action === "import") {
      // @ts-expect-error TODO: fix type, mergeSecrets returns ConnectionSpec we have CustomConnectionSpec
      updatedSpec = mergeSecrets(connection, updatedSpec);
    }
    let result: PostResponse = { success: false, message: "" };
    const manager = DirectConnectionManager.getInstance();
    const { connection: newConnection, errorMessage } = await manager.createConnection(
      updatedSpec,
      false,
    );
    if (errorMessage || !newConnection) {
      return {
        success: false,
        message: errorMessage ?? "Unknown error while creating connection",
      };
    } else {
      result.success = true;
      // save and close the form
      await window.showInformationMessage("New Connection Created", {
        modal: true,
        detail: `View and interact with it in the Resources sidebar`,
      });
      directConnectForm.dispose();
    }
    return result;
  }

  async function testConnection(body: any): Promise<TestResponse> {
    let connectionId = undefined;
    // for a Test on "Edit" form; sending the id so we can look up secrets
    if (action === "update") connectionId = connection?.id as ConnectionId;
    const spec: CustomConnectionSpec = getConnectionSpecFromFormData(body, connectionId);
    const manager = DirectConnectionManager.getInstance();
    const { connection: testConnection, errorMessage } = await manager.createConnection(spec, true);
    if (errorMessage || !testConnection) {
      return {
        success: false,
        message: errorMessage ?? "Unknown error while testing connection.",
        testResults: {},
      };
    }

    return parseTestResult(testConnection);
  }

  async function updateConnection(body: any): Promise<PostResponse> {
    const connectionId = connection?.id as ConnectionId;
    let newSpec: CustomConnectionSpec = getConnectionSpecFromFormData(body, connectionId);
    const manager = DirectConnectionManager.getInstance();
    try {
      await manager.updateConnection(newSpec);
      return { success: true, message: "Connection updated successfully." };
    } catch (error) {
      return { success: false, message: JSON.stringify(error) };
    }
  }

  async function getAbsoluteFilePath(body: { inputId: string }): Promise<string> {
    const fileIUris: Uri[] | undefined = await window.showOpenDialog({
      openLabel: "Select",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
    });
    const path = fileIUris?.[0].fsPath || "";
    updateSpecValue(body.inputId, path);
    return path;
  }
  /** Stores state of spec updates in progress; updated on form input
   * This also makes it so that users don't lose inputs when the form goes in the background
   */
  let specUpdatedValues: Partial<CustomConnectionSpec> = {};
  function updateSpecValue(inputName: string, value: string) {
    setValueAtPath(specUpdatedValues, inputName, value);
  }
  function getSpec() {
    if (connection) {
      if (action === "import") {
        return { ...connection, ...specUpdatedValues };
      } else if (action === "update") {
        return { ...cleanSpec(connection), ...specUpdatedValues };
      }
    }
    return { ...specUpdatedValues };
  }

  const processMessage = async (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      case "Test":
        return (await testConnection(body)) satisfies MessageResponse<"Test">;
      case "Submit":
        return (await saveConnection(body)) satisfies MessageResponse<"Submit">;
      case "Update":
        return (await updateConnection(body)) satisfies MessageResponse<"Update">;
      case "GetConnectionSpec": {
        return getSpec() satisfies MessageResponse<"GetConnectionSpec">;
      }
      case "GetFilePath":
        return (await getAbsoluteFilePath(body)) satisfies MessageResponse<"GetFilePath">;
      case "UpdateSpecValue":
        updateSpecValue(body.inputName, body.inputValue.toString());
        return null satisfies MessageResponse<"UpdateSpecValue">;
    }
  };
  const disposable = handleWebviewMessage(directConnectForm.webview, processMessage);
  directConnectForm.onDidDispose(() => disposable.dispose());
}

export function getConnectionSpecFromFormData(
  formData: { [key: string]: any },
  connectionId?: ConnectionId,
): CustomConnectionSpec {
  const spec: CustomConnectionSpec = {
    id: connectionId ?? (randomUUID() as ConnectionId),
    name: formData["name"] || "New Connection",
    type: ConnectionType.Direct,
    formConnectionType: formData["formconnectiontype"],
  };

  if (formData["kafka_cluster.bootstrap_servers"]) {
    spec.kafka_cluster = {
      bootstrap_servers: formData["kafka_cluster.bootstrap_servers"],
    };
    if (formData["kafka_cluster.ssl.enabled"]) {
      spec.kafka_cluster.ssl = {
        ...spec.kafka_cluster.ssl,
        enabled: true,
        verify_hostname: formData["kafka_cluster.ssl.verify_hostname"],
      };
      if (formData["kafka_cluster.ssl.truststore.path"]) {
        spec.kafka_cluster.ssl = {
          ...spec.kafka_cluster.ssl,
          truststore: {
            type: formData["kafka_cluster.ssl.truststore.type"],
            path: formData["kafka_cluster.ssl.truststore.path"],
            password: formData["kafka_cluster.ssl.truststore.password"],
          },
        };
      }
      if (formData["kafka_cluster.ssl.keystore.path"]) {
        spec.kafka_cluster.ssl = {
          ...spec.kafka_cluster.ssl,
          keystore: {
            path: formData["kafka_cluster.ssl.keystore.path"],
            password: formData["kafka_cluster.ssl.keystore.password"],
            type: formData["kafka_cluster.ssl.keystore.type"],
            key_password: formData["kafka_cluster.ssl.keystore.key_password"],
          },
        };
      }
    } else {
      // since we default the input to true, this case means the user unchecked the box for ssl enabled
      spec.kafka_cluster.ssl = {
        enabled: false,
      };
    }
    if (formData["kafka_cluster.auth_type"] === "Basic") {
      spec.kafka_cluster.credentials = {
        username: formData["kafka_cluster.credentials.username"],
        password: formData["kafka_cluster.credentials.password"],
      };
    } else if (formData["kafka_cluster.auth_type"] === "API") {
      spec.kafka_cluster.credentials = {
        api_key: formData["kafka_cluster.credentials.api_key"],
        api_secret: formData["kafka_cluster.credentials.api_secret"],
      };
    } else if (formData["kafka_cluster.auth_type"] === "SCRAM") {
      spec.kafka_cluster.credentials = {
        hash_algorithm: formData["kafka_cluster.credentials.hash_algorithm"],
        scram_username: formData["kafka_cluster.credentials.scram_username"],
        scram_password: formData["kafka_cluster.credentials.scram_password"],
      };
    } else if (formData["kafka_cluster.auth_type"] === "OAuth") {
      spec.kafka_cluster.credentials = {
        tokens_url: formData["kafka_cluster.credentials.tokens_url"],
        client_id: formData["kafka_cluster.credentials.client_id"],
        client_secret: formData["kafka_cluster.credentials.client_secret"],
        scope: formData["kafka_cluster.credentials.scope"],
        connect_timeout_millis: formData["kafka_cluster.credentials.connect_timeout_millis"],
        ccloud_logical_cluster_id: formData["kafka_cluster.credentials.ccloud_logical_cluster_id"],
        ccloud_identity_pool_id: formData["kafka_cluster.credentials.ccloud_identity_pool_id"],
      };
    }
  }

  if (formData["schema_registry.uri"]) {
    spec.schema_registry = {
      uri: formData["schema_registry.uri"],
    };
    if (formData["schema_registry.ssl.enabled"]) {
      spec.schema_registry.ssl = {
        ...spec.schema_registry.ssl,
        enabled: true,
        verify_hostname: formData["schema_registry.ssl.verify_hostname"],
      };
      if (formData["schema_registry.ssl.truststore.path"]) {
        spec.schema_registry.ssl = {
          ...spec.schema_registry.ssl,
          truststore: {
            type: formData["schema_registry.ssl.truststore.type"],
            path: formData["schema_registry.ssl.truststore.path"],
            password: formData["schema_registry.ssl.truststore.password"],
          },
        };
      }
      if (formData["schema_registry.ssl.keystore.path"]) {
        spec.schema_registry.ssl = {
          ...spec.schema_registry.ssl,
          keystore: {
            path: formData["schema_registry.ssl.keystore.path"],
            password: formData["schema_registry.ssl.keystore.password"],
            type: formData["schema_registry.ssl.keystore.type"],
            key_password: formData["schema_registry.ssl.keystore.key_password"],
          },
        };
      }
    } else {
      // since we default the input to true, this case means the user unchecked the box for ssl enabled
      spec.schema_registry.ssl = {
        enabled: false,
      };
    }
    if (formData["schema_registry.auth_type"] === "Basic") {
      spec.schema_registry.credentials = {
        username: formData["schema_registry.credentials.username"],
        password: formData["schema_registry.credentials.password"],
      };
    } else if (formData["schema_registry.auth_type"] === "API") {
      spec.schema_registry.credentials = {
        api_key: formData["schema_registry.credentials.api_key"],
        api_secret: formData["schema_registry.credentials.api_secret"],
      };
    }
  }

  return spec;
}

export function parseTestResult(connection: Connection): TestResponse {
  const kafkaState: ConnectedState | undefined = connection.status.kafka_cluster?.state;
  const kafkaErrors: AuthErrors | undefined = connection.status.kafka_cluster?.errors;
  const schemaState: ConnectedState | undefined = connection.status.schema_registry?.state;
  const schemaErrors: AuthErrors | undefined = connection.status.schema_registry?.errors;
  let result: TestResponse = {
    success: true,
    message: null,
    testResults: { kafkaState, schemaState },
  };

  if (kafkaState === "FAILED" || schemaState === "FAILED") {
    result.success = false;
    result.message = "One or more connections failed.";
  } else {
    result.message = "All connection tests successful.";
  }

  if (kafkaState === "FAILED") {
    if (kafkaErrors) {
      const errorMessages = [
        kafkaErrors.auth_status_check?.message,
        kafkaErrors.sign_in?.message,
        kafkaErrors.token_refresh?.message,
      ].filter((message) => message !== undefined);
      result.testResults.kafkaErrorMessage = `${errorMessages.join(" ")}`;
    }
  }
  if (schemaState === "FAILED") {
    if (schemaErrors) {
      const errorMessages = [
        schemaErrors.auth_status_check?.message,
        schemaErrors.sign_in?.message,
        schemaErrors.token_refresh?.message,
      ].filter((message) => message !== undefined);
      result.testResults.schemaErrorMessage = `${errorMessages.join(" ")}`;
    }
  }
  return result;
}
// Replace any sensitive fields from the connection spec before sending to the webview form
export function cleanSpec(connection: CustomConnectionSpec): CustomConnectionSpec {
  const clean = { ...connection };
  if (clean.kafka_cluster?.credentials) {
    if (instanceOfBasicCredentials(clean.kafka_cluster.credentials)) {
      clean.kafka_cluster.credentials.password = "fakeplaceholdersecrethere";
    }
    if (instanceOfApiKeyAndSecret(clean.kafka_cluster.credentials)) {
      clean.kafka_cluster.credentials.api_secret = "fakeplaceholdersecrethere";
    }
    if (instanceOfScramCredentials(clean.kafka_cluster.credentials)) {
      clean.kafka_cluster.credentials.scram_password = "fakeplaceholdersecrethere";
    }
    if (instanceOfOAuthCredentials(clean.kafka_cluster.credentials)) {
      clean.kafka_cluster.credentials.client_secret = "fakeplaceholdersecrethere";
    }
  }
  if (clean.kafka_cluster?.ssl?.truststore?.password) {
    clean.kafka_cluster.ssl.truststore.password = "fakeplaceholdersecrethere";
  }
  if (clean.kafka_cluster?.ssl?.keystore?.password) {
    clean.kafka_cluster.ssl.keystore.password = "fakeplaceholdersecrethere";
  }
  if (clean.kafka_cluster?.ssl?.keystore?.key_password) {
    clean.kafka_cluster.ssl.keystore.key_password = "fakeplaceholdersecrethere";
  }
  if (clean.schema_registry?.credentials) {
    if (instanceOfBasicCredentials(clean.schema_registry.credentials)) {
      clean.schema_registry.credentials.password = "fakeplaceholdersecrethere";
    }
    if (instanceOfApiKeyAndSecret(clean.schema_registry.credentials)) {
      clean.schema_registry.credentials.api_secret = "fakeplaceholdersecrethere";
    }
  }
  if (clean.schema_registry?.ssl?.truststore?.password) {
    clean.schema_registry.ssl.truststore.password = "fakeplaceholdersecrethere";
  }
  if (clean.schema_registry?.ssl?.keystore?.password) {
    clean.schema_registry.ssl.keystore.password = "fakeplaceholdersecrethere";
  }
  if (clean.schema_registry?.ssl?.keystore?.key_password) {
    clean.schema_registry.ssl.keystore.key_password = "fakeplaceholdersecrethere";
  }
  return clean;
}

export function setValueAtPath(obj: any, path: string, value: any): void {
  const keys = path.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }

  current[keys[keys.length - 1]] = value;
}
