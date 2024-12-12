import { randomUUID } from "crypto";
import { ViewColumn, window } from "vscode";
import { KafkaClusterConfig, SchemaRegistryConfig } from "./clients/sidecar";
import { DirectConnectionManager } from "./directConnectManager";
import { WebviewPanelCache } from "./webview-cache";
import { handleWebviewMessage } from "./webview/comms/comms";
import { post } from "./webview/direct-connect-form";
import connectionFormTemplate from "./webview/direct-connect-form.html";

type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any, dry_run: boolean) => any>>
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

  async function createConnection(
    body: any,
    dry_run: boolean,
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
      dry_run,
      body["name"],
    );
    let name = body["name"] || "the connection";
    if (result.success && !dry_run) {
      await window.showInformationMessage(`🎉 New Connection Created`, {
        modal: true,
        detail: `View and interact with ${name} in the Resources sidebar`,
      });
      directConnectForm.dispose();
    }
    return result;
  }

  const processMessage = async ([type, body]: Parameters<MessageSender>, dry_run: boolean) => {
    return (await createConnection(body, dry_run)) satisfies MessageResponse<"Submit">;
  };
  const disposable = handleWebviewMessage(directConnectForm.webview, processMessage);
  directConnectForm.onDidDispose(() => disposable.dispose());
}
