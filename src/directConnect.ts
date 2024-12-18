import { randomUUID } from "crypto";
import { ViewColumn, window } from "vscode";
import {
  AuthErrors,
  ConnectedState,
  Connection,
  ConnectionSpec,
  ConnectionType,
} from "./clients/sidecar";
import { DirectConnectionManager } from "./directConnectManager";
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

export function openDirectConnectionForm(connection: ConnectionSpec | null): void {
  console.log("EDIT:", connection?.id);
  const connectionUUID = connection?.id || randomUUID();
  // Set up the webview, checking for existing form for this connection
  const [directConnectForm, formExists] = directConnectWebviewCache.findOrCreate(
    { id: connectionUUID, multiple: false, template: connectionFormTemplate },
    `direct-connect-${connectionUUID}`,
    connection?.id ? "Edit Connection" : "New Connection",
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
    const spec: CustomConnectionSpec = getConnectionSpecFromFormData(body);

    let result: PostResponse = { success: false, message: "" };
    const manager = DirectConnectionManager.getInstance();
    const { connection, errorMessage } = await manager.createConnection(spec, false);
    if (errorMessage || !connection) {
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
    const spec: CustomConnectionSpec = getConnectionSpecFromFormData(body);
    const manager = DirectConnectionManager.getInstance();
    const { connection, errorMessage } = await manager.createConnection(spec, true);
    if (errorMessage || !connection) {
      return {
        success: false,
        message: errorMessage ?? "Unknown error while testing connection.",
        testResults: {},
      };
    }

    return parseTestResult(connection);
  }

  async function updateConnection(body: any): Promise<PostResponse> {
    const connectionId = connection?.id as ConnectionId;
    const spec: CustomConnectionSpec = getConnectionSpecFromFormData(body, connectionId);
    const manager = DirectConnectionManager.getInstance();
    try {
      console.log("spec before send to update: ", spec);
      await manager.updateConnection(spec);
    } catch (error) {
      return { success: false, message: JSON.stringify(error) };
    }
    return { success: true, message: "Connection updated successfully." };
  }

  const processMessage = async (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      case "Test":
        return (await testConnection(body)) satisfies MessageResponse<"Test">;
      case "Submit":
        return (await saveConnection(body)) satisfies MessageResponse<"Submit">;
      case "GetConnectionSpec": {
        const spec = connection ? cleanSpec(connection) : null;
        return spec satisfies MessageResponse<"GetConnectionSpec">;
      }
      case "Update":
        return (await updateConnection(body)) satisfies MessageResponse<"Update">;
    }
  };
  const disposable = handleWebviewMessage(directConnectForm.webview, processMessage);
  directConnectForm.onDidDispose(() => disposable.dispose());
}

export function getConnectionSpecFromFormData(
  formData: any,
  connectionId?: ConnectionId,
): CustomConnectionSpec {
  const spec: CustomConnectionSpec = {
    id: connectionId ?? (randomUUID() as ConnectionId),
    name: formData["name"] || "New Connection",
    type: ConnectionType.Direct,
    formConnectionType: formData["platform"],
  };
  console.log("before adding creds: ", spec);

  if (formData["bootstrap_servers"]) {
    spec.kafka_cluster = {
      bootstrap_servers: formData["bootstrap_servers"],
    };
    if (formData.kafka_auth_type === "Basic") {
      spec.kafka_cluster.credentials = {
        username: formData["kafka_username"],
        password: formData["kafka_password"],
      };
    } else if (formData.kafka_auth_type === "API") {
      spec.kafka_cluster.credentials = {
        api_key: formData["kafka_api_key"],
        api_secret: formData["kafka_api_secret"],
      };
    }
  }

  if (formData["uri"]) {
    spec.schema_registry = {
      uri: formData["uri"],
    };
    if (formData.schema_auth_type === "Basic") {
      spec.schema_registry.credentials = {
        username: formData["schema_username"],
        password: formData["schema_password"],
      };
    } else if (formData.schema_auth_type === "API") {
      spec.schema_registry.credentials = {
        api_key: formData["schema_api_key"],
        api_secret: formData["schema_api_secret"],
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
// Remove sensitive fields from the connection spec before sending to the webview form
function cleanSpec(connection: ConnectionSpec): ConnectionSpec {
  const clean = { ...connection };
  // @ts-expect-error - these fields are not in the TypeScript definition
  delete clean.kafka_cluster?.credentials?.password;
  // @ts-expect-error - these fields are not in the TypeScript definition
  delete clean.kafka_cluster?.credentials?.api_secret;
  // @ts-expect-error - these fields are not in the TypeScript definition
  delete clean.schema_registry?.credentials?.password;
  // @ts-expect-error - these fields are not in the TypeScript definition
  delete clean.schema_registry?.credentials?.api_secret;
  return clean;
}
