import { randomUUID } from "crypto";
import { ViewColumn, window } from "vscode";
import {
  ConnectedState,
  ConnectionSpec,
  KafkaClusterConfig,
  SchemaRegistryConfig,
} from "./clients/sidecar";
import { DirectConnectionManager } from "./directConnectManager";
import { WebviewPanelCache } from "./webview-cache";
import { handleWebviewMessage } from "./webview/comms/comms";
import { post } from "./webview/direct-connect-form";
import connectionFormTemplate from "./webview/direct-connect-form.html";
import { CustomConnectionSpec } from "./storage/resourceManager";
import { tryToCreateConnection } from "./sidecar/connections";

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

  async function testConnect(body: any): Promise<{ success: boolean; message: string | null }> {
    console.log(body);
    let result = { success: false, message: "" };
    if (!body.dryRun === true) {
      result.success = false;
      result.message = "dryRun must be true";
    }
    let spec: ConnectionSpec = {
      name: body["name"],
      type: "DIRECT",
    };
    if (body["clusterConfig"]) {
      spec.kafka_cluster = { ...body["clusterConfig"] };
    }
    if (body["schemaConfig"]) {
      spec.schema_registry = { ...body["schemaConfig"] };
    }
    console.log("sending dry run");
    try {
      const res = await tryToCreateConnection(spec, true);
      if (res) {
        console.log("dry run success", res);
        const kafkaState: ConnectedState | undefined = res.status.kafka_cluster?.state;
        const schemaRegistryState: ConnectedState | undefined = res.status.schema_registry?.state;
        if (kafkaState === "FAILED" || schemaRegistryState === "FAILED") {
          result.success = false;
          if (kafkaState === "FAILED") {
            result.message += `Kafka State: ${JSON.stringify(res.status.kafka_cluster?.errors)}`;
          }
          if (schemaRegistryState === "FAILED") {
            result.message += `\nSchema Registry State: ${JSON.stringify(res.status.schema_registry?.errors)}`;
          }
        } else {
          result.success = true;
          if (kafkaState) {
            result.message += `Kafka State: ${JSON.stringify(res.status.kafka_cluster?.state)}`;
          }
          if (schemaRegistryState) {
            result.message += `\nSchema Registry State: ${JSON.stringify(res.status.schema_registry?.state)}`;
          }
        }
      }
    } catch (e) {
      console.error(e);
      result = { success: false, message: JSON.stringify(e) };
    }
    return result;
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
      body["platform"],
      body["name"],
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

  const processMessage = async (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      case "TestConnection":
        return (await testConnect(body)) satisfies MessageResponse<"TestConnection">;
      case "Submit":
        return (await createConnection(body)) satisfies MessageResponse<"Submit">;
    }
  };
  const disposable = handleWebviewMessage(directConnectForm.webview, processMessage);
  directConnectForm.onDidDispose(() => disposable.dispose());
}
