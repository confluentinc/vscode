import { ViewItem } from "./ViewItem";

export class LocalConnectionItem extends ViewItem {
  /**
   * Click the "Start Local Resources" inline action to start local Kafka and/or Schema Registry
   * containers through Docker.
   */
  async clickStartResources(): Promise<void> {
    await this.clickInlineAction("Start Local Resources");
  }

  /**
   * Click the "Stop Local Resources" inline action to stop local Kafka and/or Schema Registry
   * containers through Docker.
   */
  async clickStopResources(): Promise<void> {
    await this.clickInlineAction("Stop Local Resources");
  }
}
