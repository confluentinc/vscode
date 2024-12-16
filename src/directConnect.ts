import { randomUUID } from "crypto";
import { ViewColumn, window } from "vscode";
import { ConnectedState, Connection, ConnectionType } from "./clients/sidecar";
import { DirectConnectionManager } from "./directConnectManager";
import { WebviewPanelCache } from "./webview-cache";
import { handleWebviewMessage } from "./webview/comms/comms";
import { post, PostResponse } from "./webview/direct-connect-form";
import connectionFormTemplate from "./webview/direct-connect-form.html";
import { CustomConnectionSpec } from "./storage/resourceManager";
import { ConnectionId } from "./models/resource";

type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
>;

const directConnectWebviewCache = new WebviewPanelCache();

export function openDirectConnectionForm(): void {
  // Set up the webview, checking for existing form for this connection
  const [directConnectForm, formExists] = directConnectWebviewCache.findOrCreate(
    { id: randomUUID(), multiple: false, template: connectionFormTemplate }, // TODO change the UUID handling when we start allowing Edit
    "direct-connect-form",
    `New Connection`,
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
  async function testOrSaveConnection(body: {
    data: any;
    dryRun: boolean;
  }): Promise<{ success: boolean; message: string | null }> {
    const spec: CustomConnectionSpec = getConnectionSpecFromFormData(body.data);

    let result: PostResponse = { success: false, message: "" };
    const manager = DirectConnectionManager.getInstance();
    const { connection, errorMessage } = await manager.createConnection(spec, body.dryRun);
    if (errorMessage || !connection) {
      return {
        success: false,
        message:
          errorMessage ?? "Error: No connection object or error message returned from sidecar", // FIXME
      };
    }
    if (!body.dryRun) {
      let name = body.data["name"] || "the connection";
      if (result.success) {
        await window.showInformationMessage(`🎉 New Connection Created`, {
          modal: true,
          detail: `View and interact with ${name} in the Resources sidebar`,
        });
        directConnectForm.dispose();
      }
    } else result = parseTestResult(connection);

    return result;
  }

  const processMessage = async (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      case "Submit":
        return (await testOrSaveConnection(body)) satisfies MessageResponse<"Submit">;
    }
  };
  const disposable = handleWebviewMessage(directConnectForm.webview, processMessage);
  directConnectForm.onDidDispose(() => disposable.dispose());
}

export function getConnectionSpecFromFormData(formData: any): CustomConnectionSpec {
  const connectionId = randomUUID() as ConnectionId;
  const spec: CustomConnectionSpec = {
    id: connectionId,
    name: formData["name"] || "New Connection",
    type: ConnectionType.Direct,
    formConnectionType: formData["platform"],
  };

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

export function parseTestResult(connection: Connection | null): {
  success: boolean;
  message: string | null;
} {
  if (!connection)
    return { success: false, message: "Error: No connection object returned from sidecar" }; // FIXME will we make it here?
  let result: { success: boolean; message: string | null } = { success: false, message: null };

  const kafkaState: ConnectedState | undefined = connection.status.kafka_cluster?.state;
  const schemaRegistryState: ConnectedState | undefined = connection.status.schema_registry?.state;
  if (kafkaState === "FAILED" || schemaRegistryState === "FAILED") {
    result.success = false;
    if (kafkaState === "FAILED") {
      result.message += `Kafka State: ${JSON.stringify(connection.status.kafka_cluster?.errors)}`;
    }
    if (schemaRegistryState === "FAILED") {
      result.message += `\nSchema Registry State: ${JSON.stringify(connection.status.schema_registry?.errors)}`;
    }
  } else {
    // FIXME check that NO TOKEN state may not return the FAILED status?
    result.success = true;
    if (kafkaState) {
      result.message += `Kafka State: ${JSON.stringify(connection.status.kafka_cluster?.state)}`;
    }
    if (schemaRegistryState) {
      result.message += `\nSchema Registry State: ${JSON.stringify(connection.status.schema_registry?.state)}`;
    }
  }

  return result;
}
