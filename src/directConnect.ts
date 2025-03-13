import { randomUUID } from "crypto";
import { Uri, ViewColumn, window } from "vscode";
import {
  AuthErrors,
  ConnectedState,
  Connection,
  ConnectionType,
  instanceOfApiKeyAndSecret,
  instanceOfBasicCredentials,
  instanceOfKerberosCredentials,
  instanceOfOAuthCredentials,
  instanceOfScramCredentials,
} from "./clients/sidecar";
import { DirectConnectionManager } from "./directConnectManager";
import { WebviewPanelCache } from "./webview-cache";
import { handleWebviewMessage } from "./webview/comms/comms";
import {
  post,
  PostResponse,
  SupportedAuthTypes,
  TestResponse,
} from "./webview/direct-connect-form";
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
    // Merge things that were not updated in form back in from the imported connection
    if (connection && action === "import") {
      updatedSpec = deepMerge(connection, updatedSpec);
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
    let testSpec: CustomConnectionSpec = getConnectionSpecFromFormData(body, connectionId);
    if (connection && (action === "import" || action === "update")) {
      testSpec = deepMerge(connection, testSpec);
    }
    const manager = DirectConnectionManager.getInstance();
    const { connection: testConnection, errorMessage } = await manager.createConnection(
      testSpec,
      true,
    );
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
    newSpec = deepMerge(connection, newSpec);
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
  function getCredentialsType(creds: any): SupportedAuthTypes {
    if (!creds || typeof creds !== "object") return "None";
    if (instanceOfBasicCredentials(creds)) return "Basic";
    if (instanceOfApiKeyAndSecret(creds)) return "API";
    if (instanceOfScramCredentials(creds)) return "SCRAM";
    if (instanceOfOAuthCredentials(creds)) return "OAuth";
    if (instanceOfKerberosCredentials(creds)) return "Kerberos";
    return "None";
  }
  // Initialize auth type to whatever matches incoming connection
  let kafkaClusterAuthType = getCredentialsType(connection?.kafka_cluster?.credentials);
  let schemaRegistryAuthType = getCredentialsType(connection?.schema_registry?.credentials);
  // Update auth types when the user changes it in the form
  function updateAuthType(inputName: string, value: SupportedAuthTypes) {
    const namespace = inputName.split(".")[0];
    if (namespace === "kafka_cluster") {
      kafkaClusterAuthType = value;
    } else if (namespace === "schema_registry") {
      schemaRegistryAuthType = value;
    }
  }
  function getAuthTypes() {
    return { kafka: kafkaClusterAuthType, schema: schemaRegistryAuthType };
  }

  function getSpec() {
    if (connection) {
      if (action === "import" || action === "update") {
        return { ...connection, ...specUpdatedValues };
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
      case "GetAuthTypes":
        return getAuthTypes() satisfies MessageResponse<"GetAuthTypes">;
      case "GetFilePath":
        return (await getAbsoluteFilePath(body)) satisfies MessageResponse<"GetFilePath">;
      case "UpdateSpecValue":
        updateSpecValue(body.inputName, body.inputValue.toString());
        return null satisfies MessageResponse<"UpdateSpecValue">;
      case "SaveFormAuthType":
        updateAuthType(body.inputName, body.inputValue);
        return null satisfies MessageResponse<"SaveFormAuthType">;
    }
  };
  const disposable = handleWebviewMessage(directConnectForm.webview, processMessage);
  directConnectForm.onDidDispose(() => disposable.dispose());
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

/** This function takes the form data as submitted and builds a CustomConnectionSpec object
 * In the form, input names match a path in CustomConnectionSpec interface, so the form data aligns to spec paths
 * For example, a form data key/value pair might be: "kafka_cluster.bootstrap_servers" : "localhost:9092"
 * It will throw out empty, undefined, or invalid values (such as missing required fields, creds not matching auth type)
 */
export function getConnectionSpecFromFormData(
  formData: { [key: string]: any },
  connectionId?: ConnectionId,
): CustomConnectionSpec {
  // Initialize with top level properties from formData
  const spec: CustomConnectionSpec = {
    id: connectionId ?? (randomUUID() as ConnectionId),
    name: formData["name"] || "New Connection",
    type: ConnectionType.Direct,
    formConnectionType: formData["formconnectiontype"],
  };

  // Group form data by resource type - either kafka_cluster or schema_registry
  const resources: { [key: string]: string[] } = {};
  for (const path in formData) {
    if (formData[path] === undefined || formData[path] === "") continue;
    const namespace = path.split(".")[0];
    if (!resources[namespace]) resources[namespace] = [];
    resources[namespace].push(path);
  }

  // Process each resource
  for (const namespace of ["kafka_cluster", "schema_registry"]) {
    if (!resources[namespace]) continue;
    // We only want to create the objects in spec if required fields exist
    const kafkaValid = formData["kafka_cluster.bootstrap_servers"];
    const schemaValid = formData["schema_registry.uri"];
    if (
      (namespace === "kafka_cluster" && kafkaValid) ||
      (namespace === "schema_registry" && schemaValid)
    ) {
      for (const path of resources[namespace]) {
        // Skip these, handled next
        if (
          path.includes(".auth_type") ||
          path.includes(".credentials.") ||
          path.includes(".ssl.truststore") ||
          path.includes(".ssl.keystore")
        ) {
          continue;
        }
        setValueAtPath(spec, path, formData[path]);
      }

      // Only create truststore object if path is provided
      if (
        formData[`${namespace}.ssl.truststore.path`] &&
        formData[`${namespace}.ssl.truststore.path`].trim() !== ""
      ) {
        const truststoreFields = resources[namespace].filter((path) =>
          path.includes(".ssl.truststore."),
        );
        for (const field of truststoreFields) {
          setValueAtPath(spec, field, formData[field]);
        }
      }

      // Only create keystore object if path is provided
      if (
        formData[`${namespace}.ssl.keystore.path`] &&
        formData[`${namespace}.ssl.keystore.path`].trim() !== ""
      ) {
        const keystoreFields = resources[namespace].filter((path) =>
          path.includes(".ssl.keystore."),
        );
        for (const field of keystoreFields) {
          setValueAtPath(spec, field, formData[field]);
        }
      }

      // Create credentials object if auth type is not "None"
      const authType = formData[`${namespace}.auth_type`];
      if (authType && authType !== "None") {
        // Use the auth type submitted with form to filter out invalid credential paths
        const credentialFields = resources[namespace].filter(
          (path) => path.includes(".credentials.") && isValidCredentialForAuthType(path, authType),
        );
        for (const field of credentialFields) {
          setValueAtPath(spec, field, formData[field]);
        }
      }
    }
  }
  return spec;
}

// Helper function to check if a credential path is valid for the given auth type
function isValidCredentialForAuthType(path: string, authType: string): boolean {
  const credentialField = path.split(".credentials.")[1];

  switch (authType) {
    case "Basic":
      return ["username", "password"].includes(credentialField);
    case "API":
      return ["api_key", "api_secret"].includes(credentialField);
    case "SCRAM":
      return ["hash_algorithm", "scram_username", "scram_password"].includes(credentialField);
    case "OAuth":
      return [
        "tokens_url",
        "client_id",
        "client_secret",
        "scope",
        "connect_timeout_millis",
        "ccloud_logical_cluster_id",
        "ccloud_identity_pool_id",
      ].includes(credentialField);
    case "Kerberos":
      return ["principal", "keytab_path", "service_name"].includes(credentialField);
    default:
      return false;
  }
}
// Deep merging nested spec object, keeping existing values if they aren't in updated spec
function deepMerge(current: any, updated: any): any {
  const result = { ...current };

  for (const key in updated) {
    if (updated[key] !== undefined) {
      if (isObject(updated[key]) && isObject(current[key])) {
        // If both values are objects, merge them recursively
        result[key] = deepMerge(current[key], updated[key]);
      } else {
        // Otherwise use the value from source
        result[key] = updated[key];
      }
    }
  }

  return result;
}

function isObject(item: any): boolean {
  return item && typeof item === "object" && !Array.isArray(item);
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
