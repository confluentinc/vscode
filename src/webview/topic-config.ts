import { ObservableScope } from "inertial";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage } from "./comms/comms";
// import all symbols from topicConfigTypes into current namespace
import * as messages from "./topicConfigTypes";

addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const vm = new TopicConfigViewModel(os);
  applyBindings(ui, os, vm);
});

class TopicConfigViewModel extends ViewModel {
  cleanupOptions = [
    { value: "delete", label: "Delete" },
    { value: "compact", label: "Compact" },
    { value: "compact,delete", label: "Compact, Delete" },
  ];

  successfulPost = this.signal("");
  errorPost = this.signal("");

  topic = this.resolve(() => {
    return post(messages.GETTOPIC, null);
  }, null);

  initialConfig = this.resolve(async () => {
    console.log("Getting initial config");
    return post(messages.GETCONFIG, null);
  }, {});

  currentConfig = this.derive((): messages.TopicConfigSetting => {
    console.log("Deriving current config");
    return {};
  });

  // Individual atomic values wired into the form, taking default values
  // from keys found within the initial config.
  cleanupPolicy = this.resolve(async () => {
    console.log("Getting cleanup policy from initial config");
    return this.initialConfig()["cleanup.policy"];
  }, "");

  retentionMs = this.resolve(async () => {
    console.log("Getting retention ms from initial config");
    return this.initialConfig()["retention.ms"];
  }, "");

  async submitForm() {
    console.log("Submitting form");
    try {
      // Assemble all the current widget values into a single
      // list of name / value pairs, and send them to VSCode. That
      // format happens to correspond to the
      // updateKafkaTopicConfigBatch API payload.

      // VSCode then diffs against the current topic config and
      // makes individual update attempts to the topic config through to
      // the Kafka cluster.

      // An error is thrown if any of the updates fail, containing

      // B
      const success: string = await post({
        type: "UpdateTopic",
        data: [
          { name: "cleanup.policy", value: this.cleanupPolicy() },
          { name: "retention.ms", value: this.retentionMs() },
        ],
      });

      console.log("Success", success);
      this.batch(() => {
        this.successfulPost(success);
        this.errorPost("");
      });
    } catch (error) {
      console.log("Error", error);
      this.batch(() => {
        this.errorPost(error as string);
        this.successfulPost("");
      });
    }
  }
}

export function post(type: typeof messages.GETTOPIC, body: null): Promise<messages.SimpleTopic>;
export function post(
  type: typeof messages.GETCONFIG,
  body: null,
): Promise<messages.TopicConfigBatch>;

export function post(
  type: typeof messages.POSTCONFIG,
  body: messages.TopicConfigBatch,
): Promise<messages.TopicConfigBatch>;

export function post(type: any, body: any): Promise<unknown> {
  return sendWebviewMessage(type, body);
}
