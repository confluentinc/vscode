import { randomUUID } from "crypto";
import { ViewColumn, window } from "vscode";
import { ConnectionSpec, KafkaClusterConfig, SchemaRegistryConfig } from "./clients/sidecar";
import { DirectConnectionManager } from "./directConnectManager";
import { WebviewPanelCache } from "./webview-cache";
import { handleWebviewMessage } from "./webview/comms/comms";
import { post } from "./webview/direct-connect-form";
import connectionFormTemplate from "./webview/direct-connect-form.html";

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

  // async function getExistingSpec() {
  //   const manager = DirectConnectionManager.getInstance();
  //   const spec = await manager.getConnection(connection?.id);
  //   return spec;
  // }

  // async function updateSpec(spec: ConnectionSpec) {
  //   const manager = DirectConnectionManager.getInstance();
  //   // update and send it to the manager to update the sidecar + secret storage
  //   const updatedSpec: ConnectionSpec = {
  //     ...spec,
  //   };
  //   await manager.getInstance().updateConnection(updatedSpec);
  // }

  async function testConnect(body: any): Promise<{ success: boolean; message: string | null }> {
    console.log(body);
    throw new Error("Not implemented");
  }

  async function createConnection(
    body: any,
  ): Promise<{ success: boolean; message: string | null }> {
    // XXX: only enable for local debugging:
    // logger.debug("creating connection from form data:", body);

    let kafkaConfig: KafkaClusterConfig | undefined = undefined;
    if (body["clusterConfig"]) {
      kafkaConfig = { ...body["clusterConfig"] };
    }

    let schemaRegistryConfig: SchemaRegistryConfig | undefined = undefined;
    if (body["schemaConfig"]) {
      schemaRegistryConfig = { ...body["schemaConfig"] };
    }

    const manager = DirectConnectionManager.getInstance();
    const result = await manager.createConnection(
      kafkaConfig,
      schemaRegistryConfig,
      body["name"],
      body["platform"],
    );
    let name = body["name"] || "the connection";
    if (result.success) {
      await window.showInformationMessage(`🎉 New Connection Created`, {
        modal: true,
        detail: `View and interact with ${name} in the Resources sidebar`,
      });
      directConnectForm.dispose();
    }
    return result;
  }

  async function updateConnection(
    body: any,
  ): Promise<{ success: boolean; message: string | null }> {
    // XXX: only enable for local debugging:
    // logger.debug("updating connection from form data:", body);
    // TODO fetch connection details (with secrets) from secret storage and combine with updated data
    const manager = DirectConnectionManager.getInstance();
    const result = await manager.updateConnection(body);
    let name = body["name"] || "the connection";
    if (result.success) {
      await window.showInformationMessage(`🎉 Connection Updated`, {
        modal: true,
        detail: `View and interact with ${name} in the Resources sidebar`,
      });
      directConnectForm.dispose();
    }
    return result;
  }

  const processMessage = async (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      case "GetConnectionSpec": {
        const spec = connection ? cleanSpec(connection) : null;
        return spec satisfies MessageResponse<"GetConnectionSpec">;
      }
      case "TestConnection":
        return (await testConnect(body)) satisfies MessageResponse<"TestConnection">;
      case "Submit":
        return (await createConnection(body)) satisfies MessageResponse<"Submit">;
      case "Update":
        return (await updateConnection(body)) satisfies MessageResponse<"Update">;
    }
  };
  const disposable = handleWebviewMessage(directConnectForm.webview, processMessage);
  directConnectForm.onDidDispose(() => disposable.dispose());
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
