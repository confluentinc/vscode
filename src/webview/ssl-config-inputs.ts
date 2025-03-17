import { ObservableScope } from "inertial";
import { applyBindings, html } from "./bindings/bindings";
import { StoreType, type TLSConfig } from "../clients/sidecar";

/** Reusable Custom HTML Element (Web Component) for SSL Advanced Config
 * This component is used in the Direct Connection form to configure SSL settings
 * @element ssl-config
 * @attr {string} namespace - ensure form inputs have unique ids, distinguish kafka & schema configs
 * @attr {TLSConfig} config - the original spec's config to be updated, if it exists
 */
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
  showTLS = this.os.derive(() => {
    return this.configObj()?.truststore || this.configObj()?.keystore ? true : false;
  });

  verifyHostname = this.os.derive(() => {
    if (this.configObj()?.verify_hostname?.toString() === "false") return false;
    else return true;
  });
  truststorePath = this.os.derive(() => {
    return this.configObj()?.truststore?.path ?? null;
  });
  truststorePassword = this.os.derive(() => {
    return this.configObj()?.truststore?.password ?? null;
  });
  truststoreType = this.os.derive(() => {
    return this.configObj()?.truststore?.type ?? "JKS";
  });
  keystorePath = this.os.derive(() => {
    return this.configObj()?.keystore?.path ?? null;
  });
  keystorePassword = this.os.derive(() => {
    return this.configObj()?.keystore?.password ?? null;
  });
  keystoreType = this.os.derive(() => {
    return this.configObj()?.keystore?.type ?? "JKS";
  });
  keystoreKeyPassword = this.os.derive(() => {
    return this.configObj()?.keystore?.key_password ?? null;
  });
  getInputId(name: string) {
    return this.identifier() + ".ssl." + name;
  }
  // Setters for component props
  set config(value: TLSConfig) {
    this.configObj(value);
  }
  set namespace(value: string) {
    this.identifier(value);
  }
  // Add all initial form values to the form data, including defaults
  initializeFormValues() {
    // Get all input/select elements in the shadow DOM
    const formElements = this.shadowRoot?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "input, select",
    );
    if (formElements) {
      formElements.forEach((element) => {
        if (element.name && element.value) {
          this.entries.set(element.name, element.value);
        }
      });
    }
    this._internals.setFormValue(this.entries);
  }

  handleFileSelection(inputId: string) {
    this.dispatchEvent(
      new CustomEvent("getfile", {
        detail: { inputId },
      }),
    );
  }
  /** Update the host form data so it contains all the changed values on submit
   * and dispatch a change event to the host for other actions
   */
  updateValue(event: InputEvent) {
    const input = event.target as HTMLInputElement;
    const name = input.name;
    const value = input.type === "checkbox" ? input.checked : input.value;
    // This sets the value in the FormData object for the form submission
    this.entries.set(name, value.toString());
    this._internals.setFormValue(this.entries);
    // This dispatches a change event to the parent html for other actions
    this.dispatchEvent(
      new CustomEvent<InputEvent>("change", {
        detail: event,
      }),
    );
    // This updates the local config object for the component
    // so values are saved even if the section is collapsed
    switch (name) {
      case this.getInputId("verify_hostname"):
        this.verifyHostname(input.checked);
        break;
      case this.getInputId("truststore.type"):
        if (Object.values(StoreType).includes(input.value as StoreType)) {
          this.truststoreType(input.value as StoreType);
        }
        break;
      case this.getInputId("truststore.path"):
        this.truststorePath(input.value);
        break;
      case this.getInputId("truststore.password"):
        this.truststorePassword(input.value);
        break;
      case this.getInputId("keystore.path"):
        this.keystorePath(input.value);
        break;
      case this.getInputId("keystore.password"):
        this.keystorePassword(input.value);
        break;
      case this.getInputId("keystore.type"):
        if (Object.values(StoreType).includes(input.value as StoreType)) {
          this.keystoreType(input.value as StoreType);
        }
        break;
      case this.getInputId("keystore.key_password"):
        this.keystoreKeyPassword(input.value);
        break;
    }
  }

  // Template for the component
  template = html`
    <div class="input-sub-group">
      <div
        data-on-click="this.showTLS(!this.showTLS())"
        data-attr-aria-expanded="this.showTLS()"
        class="clickable-header"
      >
        <span data-text="this.showTLS() ? '-' : '+'"></span>
        <p class="heading">TLS Configuration</p>
        <p class="info">Configure certificates for TLS and mTLS</p>
      </div>
      <template data-if="this.showTLS()">
        <div class="input-container">
          <label class="checkbox" data-attr-for="this.getInputId('verify_hostname')">
            <input
              type="checkbox"
              data-attr-id="this.getInputId('verify_hostname')"
              data-attr-name="this.getInputId('verify_hostname')"
              data-attr-checked="this.verifyHostname()"
              data-on-change="this.updateValue(event);"
              data-attr-value="this.verifyHostname()"
              title="Enable verification of the host name matching the Distinguished Name (DN) in the certificate."
            />
            <span>Verify Server Hostname</span>
          </label>
        </div>
        <div class="input-container">
          <label class="label">Key Store Configuration</label>
          <label class="info" style="margin-bottom: 5px">
            Certificate used to authenticate the client. This is used to configure mutual TLS (mTLS)
            authentication.
            <a
              href="https://docs.confluent.io/cloud/current/security/authenticate/workload-identities/identity-providers/mtls/configure.html#steps-to-configure-mtls-authentication-on-ccloud"
            >
              <span class="link"
                >Click here for steps to configure mTLS authentication on Confluent Cloud.
              </span>
            </a>
          </label>
          <div class="input-row">
            <div class="input-container" style="flex: 1">
              <label data-attr-for="this.getInputId('keystore.type')" class="info">Type</label>
              <select
                class="input dropdown"
                title="File format of the Key Store file."
                data-attr-id="this.getInputId('keystore.type')"
                data-attr-name="this.getInputId('keystore.type')"
                data-value="this.keystoreType()"
                data-on-input="this.updateValue(event)"
              >
                <option value="JKS">JKS</option>
                <option value="PKCS12">PKCS12</option>
                <option value="PEM">PEM</option>
              </select>
            </div>
            <div class="input-container" style="align-items: stretch">
              <label data-attr-for="this.getInputId('keystore.path')" class="info">Path </label>
              <div class="button-input">
                <input
                  class="input"
                  title="The absolute path to the Key Store file."
                  data-attr-id="this.getInputId('keystore.path')"
                  data-attr-name="this.getInputId('keystore.path')"
                  type="text"
                  placeholder="/path/to/keystore"
                  data-value="this.keystorePath()"
                  data-on-change="this.updateValue(event)"
                />
                <span
                  class="button secondary"
                  data-attr-id="this.getInputId('keystore.path')"
                  data-attr-name="this.getInputId('keystore.path')"
                  data-on-click="this.handleFileSelection(this.getInputId('keystore.path'))"
                  >Select file</span
                >
              </div>
            </div>
          </div>
          <div class="input-row">
            <div class="input-container">
              <label data-attr-for="this.getInputId('keystore.password')" class="info"
                >Password</label
              >
              <input
                class="input"
                title="The store password for the Key Store file. Key Store password is not supported for PEM format."
                data-attr-id="this.getInputId('keystore.password')"
                data-attr-name="this.getInputId('keystore.password')"
                type="password"
                data-attr-disabled="this.keystoreType() === 'PEM'"
                data-value="this.keystorePassword()"
                data-on-change="this.updateValue(event)"
              />
            </div>
            <div class="input-container">
              <label data-attr-for="this.getInputId('keystore.key_password')" class="info"
                >Key Password</label
              >
              <input
                class="input"
                title="Private key password (if any)"
                data-attr-id="this.getInputId('keystore.key_password')"
                data-attr-name="this.getInputId('keystore.key_password')"
                type="password"
                data-value="this.keystoreKeyPassword()"
                data-on-change="this.updateValue(event)"
              />
            </div>
          </div>
        </div>
        <div class="input-container">
          <label class="label">Trust Store Configuration</label>
          <label class="info" style="margin-bottom: 5px">
            Certificates for verifying SSL/TLS connections. This is required if a self-signed or a
            non-public Certificate Authority (CA) is used.
          </label>
          <div class="input-row">
            <div class="input-container" style="flex: 1">
              <label data-attr-for="this.getInputId('truststore.type')" class="info">Type</label>
              <select
                class="input dropdown"
                title="The file format of the Trust Store file."
                data-attr-id="this.getInputId('truststore.type')"
                data-attr-name="this.getInputId('truststore.type')"
                data-value="this.truststoreType()"
                data-on-input="this.updateValue(event)"
              >
                <option value="JKS">JKS</option>
                <option value="PKCS12">PKCS12</option>
                <option value="PEM">PEM</option>
              </select>
            </div>
            <div class="input-container" style="align-items: stretch">
              <label data-attr-for="this.getInputId('truststore.path')" class="info">Path </label>
              <div class="button-input">
                <input
                  class="input"
                  title="The absolute path to the Trust Store file."
                  data-attr-id="this.getInputId('truststore.path')"
                  data-attr-name="this.getInputId('truststore.path')"
                  type="text"
                  placeholder="/path/to/truststore"
                  data-value="this.truststorePath()"
                  data-on-change="this.updateValue(event)"
                />
                <span
                  class="button secondary"
                  data-attr-id="this.getInputId('truststore.path')"
                  data-attr-name="this.getInputId('truststore.path')"
                  data-on-click="this.handleFileSelection(this.getInputId('truststore.path'))"
                  >Select file</span
                >
              </div>
            </div>
          </div>
          <div class="input-container">
            <label data-attr-for="this.getInputId('truststore.password')" class="info"
              >Password</label
            >
            <input
              class="input"
              title="The password for the Trust Store file. If a password is not set, the configured Trust Store file will still be used, but integrity checking of the Trust Store file is disabled. Trust Store password is not supported for PEM format."
              data-attr-disabled="this.truststoreType() === 'PEM'"
              data-attr-id="this.getInputId('truststore.password')"
              data-attr-name="this.getInputId('truststore.password')"
              type="password"
              data-value="this.truststorePassword()"
              data-on-change="this.updateValue(event)"
            />
          </div>
        </div>
      </template>
    </div>
  `;

  // This method is called when the component is attached to the DOM
  connectedCallback() {
    const shadow = this.attachShadow({ mode: "open" });
    // Using stylesheet constructor to "adopt" the styles from VSCode host into the shadow DOM
    // https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/adoptedStyleSheets#adopting_a_stylesheet
    const sheet = new CSSStyleSheet();
    for (let sh of document.styleSheets) {
      for (let rule of sh.cssRules) {
        sheet.insertRule(rule.cssText);
      }
    }
    sheet.insertRule(`:host { display: flex; flex-direction: column; gap: 12px; width: 100%; }`);
    shadow.adoptedStyleSheets = [sheet];
    shadow.innerHTML = this.template;
    applyBindings(shadow, this.os, this);
    this.initializeFormValues();
    this.os.watch(() => {
      // re-initialize values when path is changed by host (file selector)
      this.truststorePath();
      this.keystorePath();
      setTimeout(() => this.initializeFormValues(), 50);
    });
  }
}

// Use this line to register the custom element in the ts file for the webview where it will be used (in this case, direct-connect-form.ts)
// customElements.define("ssl-config", SslConfig);
