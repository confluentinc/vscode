import { ViewItem } from "./ViewItem";

export class CCloudConnectionItem extends ViewItem {
  /** Click the "Sign in to Confluent Cloud" inline action to start the browser-based auth flow. */
  async clickSignIn(): Promise<void> {
    await this.clickInlineAction("Sign in to Confluent Cloud");
  }

  /**
   * Click the "Sign out of Confluent Cloud" inline action to sign out of the current Confluent
   * Cloud session.
   */
  async clickSignOut(): Promise<void> {
    await this.clickInlineAction("Sign out of Confluent Cloud");
  }
}
