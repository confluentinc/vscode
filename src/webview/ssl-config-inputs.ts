import { ObservableScope } from "inertial";
import { applyBindings, html } from "./bindings/bindings";
import { TLSConfig } from "../clients/sidecar";

export class SslConfig extends HTMLElement {
  static formAssociated = true;
  private _internals: ElementInternals;
  constructor() {
    super();
    this._internals = this.attachInternals();
  }
  os = ObservableScope();
  entries = new FormData();
  identifier = this.os.signal<string>("");
  configObj = this.os.signal<TLSConfig | undefined>(undefined);
  verifyHostname = this.os.derive(() => {
    return this.configObj()?.verify_hostname || true;
  });
  truststorePath = this.os.derive(() => {
    return this.configObj()?.truststore?.path;
  });
  truststorePassword = this.os.derive(() => {
    return this.configObj()?.truststore?.password;
  });
  truststoreType = this.os.derive(() => {
    return this.configObj()?.truststore?.type;
  });
  keystorePath = this.os.derive(() => {
    return this.configObj()?.keystore?.path;
  });
  keystorePassword = this.os.derive(() => {
    return this.configObj()?.keystore?.password;
  });

  // Setter for message prop
  set config(value: TLSConfig) {
    this.configObj(value);
  }
  set namespace(value: string) {
    this.identifier(value);
  }

  /** update the form data so it contains all the changed values on submit
   * and dispatch a bubble event to the parent (host) for other actions
   */
  updateValue(event: Event) {
    const input = event.target as HTMLInputElement;
    const name = input.name;
    const value = input.value;
    const n = this.identifier() + "_ssl";
    this.entries.set(n + "_" + name, value);
    this._internals.setFormValue(this.entries);
    this.dispatchEvent(
      new CustomEvent("bubble", {
        detail: { namespace: this.identifier(), inputName: name, inputValue: value },
      }),
    );
  }

  // Template for the component
  template = html`
    <label class="checkbox" for="verify_hostname">
      <input
        type="checkbox"
        id="verify_hostname"
        name="verify_hostname"
        data-attr-checked="this.verifyHostname() ? true : false"
        data-on-change="this.updateValue(event)"
      />
      Verify Hostname
    </label>
    <div class="input-container">
      <label for="truststore_type" class="label">TrustStore Type</label>
      <select
        class="input dropdown"
        id="truststore_type"
        name="truststore_type"
        data-attr-value="this.truststoreType()"
        data-on-change="this.updateValue(event)"
      >
        <option value="JKS" selected>JKS</option>
        <option value="PKCS12">PKCS12</option>
        <option value="PEM">PEM</option>
      </select>
    </div>
    <div class="input-row">
      <div class="input-container">
        <label for="truststore_path" class="label">TrustStore Path</label>
        <input
          class="input"
          id="truststore_path"
          name="truststore_path"
          type="text"
          placeholder="/path/to/truststore"
          data-attr-value="this.truststorePath()"
          data-on-change="this.updateValue(event)"
        />
      </div>
      <div class="input-container">
        <label for="truststore_password" class="label">TrustStore Password</label>
        <input
          class="input"
          id="truststore_password"
          name="truststore_password"
          type="password"
          data-attr-value="this.truststorePassword()"
          data-on-change="this.updateValue(event)"
        />
      </div>
    </div>

    <div class="input-container">
      <label for="keystore_path" class="label">KeyStore Path</label>
      <input
        class="input"
        id="keystore_path"
        name="keystore_path"
        type="text"
        placeholder="/path/to/keystore"
        data-attr-value="this.keystorePath()"
        data-on-change="this.updateValue(event)"
      />
    </div>
    <div class="input-container">
      <label for="keystore_password" class="label">KeyStore Password</label>
      <input
        class="input"
        id="keystore_password"
        name="keystore_password"
        type="password"
        data-attr-value="this.keystorePassword()"
        data-on-change="this.updateValue(event)"
      />
    </div>
  `;

  // Method called when the component is attached to the DOM
  connectedCallback() {
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = this.template;
    applyBindings(shadow, this.os, this);
  }
}

// Register the custom element
// customElements.define("ssl-config", SslConfig);
