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
import { post, PostResponse } from "./webview/direct-connect-form";
import connectionFormTemplate from "./webview/direct-connect-form.html";
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
      name: body.data["name"],
      type: "DIRECT",
    };
    if (body["clusterConfig"]) {
      spec.kafka_cluster = { ...body.data["clusterConfig"] };
    }
    if (body["schemaConfig"]) {
      spec.schema_registry = { ...body.data["schemaConfig"] };
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

  async function testOrSaveConnection(body: {
    data: any;
    dryRun: boolean;
  }): Promise<{ success: boolean; message: string | null }> {
    // XXX: only enable for local debugging:
    // logger.debug("creating connection from form data:", body);
    let kafkaConfig: KafkaClusterConfig | undefined = undefined;
    if (body.data["bootstrap_servers"]) {
      kafkaConfig = transformFormDataToKafkaConfig(body.data);
    }

    let schemaRegistryConfig: SchemaRegistryConfig | undefined = undefined;
    if (body.data["uri"]) {
      schemaRegistryConfig = transformFormDataToSchemaRegistryConfig(body);
    }

    let result: PostResponse = { success: false, message: "" };
    const manager = DirectConnectionManager.getInstance();
    result = await manager.createConnection(
        kafkaConfig,
        schemaRegistryConfig,
        body.data["platform"],
        body.data["name"],
      body.dryRun,
      );
    if (!body.dryRun) {
      let name = body.data["name"] || "the connection";
      if (result.success) {
        await window.showInformationMessage(`🎉 New Connection Created`, {
          modal: true,
          detail: `View and interact with ${name} in the Resources sidebar`,
        });
        directConnectForm.dispose();
      }
    } else {
      result = await testConnect(body);
    }
    return result;
  }

  const processMessage = async (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      // case "TestConnection":
      //   return (await testConnect(body)) satisfies MessageResponse<"TestConnection">;
      case "Submit":
        return (await testOrSaveConnection(body)) satisfies MessageResponse<"Submit">;
    }
  };
  const disposable = handleWebviewMessage(directConnectForm.webview, processMessage);
  directConnectForm.onDidDispose(() => disposable.dispose());
}

function transformFormDataToKafkaConfig(formData: any): KafkaClusterConfig {
  let kafkaClusterConfig: KafkaClusterConfig = { bootstrap_servers: "" };
  if (formData.bootstrap_servers) {
    kafkaClusterConfig["bootstrap_servers"] = formData.bootstrap_servers;
  }
  if (formData.kafka_auth_type === "Basic") {
    kafkaClusterConfig = {
      ...kafkaClusterConfig,
      credentials: {
        username: formData.kafka_username,
        password: formData.kafka_password,
      },
    };
  } else if (formData.kafka_auth_type === "API") {
    kafkaClusterConfig = {
      ...kafkaClusterConfig,
      credentials: {
        api_key: formData.kafka_api_key,
        api_secret: formData.kafka_api_secret,
      },
    };
  }

  return kafkaClusterConfig;
}

function transformFormDataToSchemaRegistryConfig(formData: any) {
  let schemaRegistryConfig: SchemaRegistryConfig = { uri: "" };
  if (formData.uri) {
    schemaRegistryConfig["uri"] = formData.uri;
  }
  if (formData.schema_auth_type === "Basic") {
    schemaRegistryConfig = {
      ...schemaRegistryConfig,
      credentials: {
        username: formData.schema_username,
        password: formData.schema_password,
      },
    };
  } else if (formData.schema_auth_type === "API") {
    schemaRegistryConfig = {
      ...schemaRegistryConfig,
      credentials: {
        api_key: formData.schema_api_key,
        api_secret: formData.schema_api_secret,
      },
    };
  }

  return schemaRegistryConfig;
}
