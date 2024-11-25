import { randomUUID } from "crypto";
import { ViewColumn } from "vscode";
import { KafkaClusterConfig, SchemaRegistryConfig } from "./clients/sidecar";
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
    throw new Error("Not implemented");
  }

  async function createConnection(
    body: any,
  ): Promise<{ success: boolean; message: string | null }> {
    // XXX: only enable for local debugging:
    // logger.debug("creating connection from form data:", body);

    let kafkaConfig: KafkaClusterConfig | undefined = undefined;
    if (body["bootstrap_servers"]) {
      kafkaConfig = {
        bootstrap_servers: body["bootstrap_servers"],
      };
    }

    let schemaRegistryConfig: SchemaRegistryConfig | undefined = undefined;
    if (body["uri"]) {
      schemaRegistryConfig = {
        uri: body["uri"],
      };
    }

    const manager = DirectConnectionManager.getInstance();
    return await manager.createConnection(kafkaConfig, schemaRegistryConfig, body["name"]);
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
