import { ObservableScope } from "inertial";
import { applyBindings, html } from "../bindings/bindings";

export class InfoBanner extends HTMLElement {
  os = ObservableScope();

  // Internal state for the component
  messageText = this.os.signal("");
  statusIcon = this.os.signal(undefined);

  // Setter for message prop
  set message(value: string) {
    this.messageText(value);
  }

  // Setter for type prop
  set status(value: string | undefined) {
    // @ts-expect-error dumbbb
    this.statusIcon(value);
  }

  // Template for the component
  template = html`
    <div class="banner" data-class="this.statusIcon()">
      <p data-text="this.messageText()"></p>
    </div>
    <style>
      .banner {
        padding: 10px;
        border-radius: 5px;
        margin: 10px 0;
      }
      .success {
        background-color: #d4edda;
        color: #155724;
      }
      .error {
        background-color: #f8d7da;
        color: #721c24;
      }
    </style>
  `;

  // Method called when the component is attached to the DOM
  connectedCallback() {
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = this.template;
    applyBindings(shadow, this.os, this);
  }
}

// Register the custom element
customElements.define("info-banner", InfoBanner);
