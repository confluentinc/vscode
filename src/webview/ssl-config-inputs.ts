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
    if (this.configObj()?.verify_hostname === false) return false;
    else return true;
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
  keystoreType = this.os.derive(() => {
    return this.configObj()?.keystore?.type;
  });
  keystoreKeyPassword = this.os.derive(() => {
    return this.configObj()?.keystore?.key_password;
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
    <label class="checkbox" data-attr-for="this.getInputId('verify_hostname')">
      <input
        type="checkbox"
        data-attr-id="this.getInputId('verify_hostname')"
        data-attr-name="this.getInputId('verify_hostname')"
        data-attr-checked="this.verifyHostname()"
        data-on-change="this.updateValue(event);"
        data-attr-value="this.verifyHostname()"
      />
      <span>Verify Server Hostname</span>
    </label>
    <div class="input-sub-group">
      <p
        data-on-click="this.showTLS(!this.showTLS())"
        data-attr-aria-expanded="this.showTLS()"
        class="heading clickable"
      >
        <span data-text="this.showTLS() ? '-' : '+'"></span>
        Advanced SSL Configuration
      </p>
      <template data-if="this.showTLS()">
        <p class="info">Optional settings for advanced SSL configuration</p>
        <div class="input-container">
          <label class="label">TrustStore Configuration</label>
          <div class="input-row">
            <div class="input-container" style="flex: 1">
              <label data-attr-for="this.getInputId('truststore.type')" class="info">Type</label>
              <select
                class="input dropdown"
                data-attr-id="this.getInputId('truststore.type')"
                data-attr-name="this.getInputId('truststore.type')"
                data-attr-value="this.truststoreType()"
                data-on-change="this.updateValue(event)"
              >
                <option value="JKS" data-attr-selected="this.truststoreType() === 'JKS'">
                  JKS
                </option>
                <option value="PKCS12" data-attr-selected="this.truststoreType() === 'PKCS12'">
                  PKCS12
                </option>
                <option value="PEM" data-attr-selected="this.truststoreType() === 'PEM'">
                  PEM
                </option>
              </select>
            </div>
            <div class="input-container">
              <label data-attr-for="this.getInputId('truststore.path')" class="info"
                >Path
                <span
                  class="button secondary"
                  data-attr-id="this.getInputId('truststore.path')"
                  data-attr-name="this.getInputId('truststore.path')"
                  data-on-click="this.handleFileSelection(this.getInputId('truststore.path'))"
                  >Choose file</span
                ></label
              >
              <input
                class="input"
                data-attr-id="this.getInputId('truststore.path')"
                data-attr-name="this.getInputId('truststore.path')"
                type="text"
                placeholder="/path/to/truststore"
                data-attr-value="this.truststorePath()"
                data-on-change="this.updateValue(event)"
              />
            </div>
            <div class="input-container">
              <label data-attr-for="this.getInputId('truststore.password')" class="info"
                >Password</label
              >
              <input
                class="input"
                data-attr-id="this.getInputId('truststore.password')"
                data-attr-name="this.getInputId('truststore.password')"
                type="password"
                data-attr-value="this.truststorePassword()"
                data-on-change="this.updateValue(event)"
              />
            </div>
          </div>
        </div>
        <div class="input-container">
          <label class="label">KeyStore Configuration</label>
          <div class="input-row">
            <div class="input-container" style="flex: 1">
              <label data-attr-for="this.getInputId('keystore.type')" class="info">Type</label>
              <select
                class="input dropdown"
                data-attr-id="this.getInputId('keystore.type')"
                data-attr-name="this.getInputId('keystore.type')"
                data-attr-value="this.keystoreType()"
                data-on-change="this.updateValue(event)"
              >
                <option value="JKS" data-attr-selected="this.keystoreType() === 'JKS'">JKS</option>
                <option value="PKCS12" data-attr-selected="this.keystoreType() === 'PKCS12'">
                  PKCS12
                </option>
                <option value="PEM" data-attr-selected="this.keystoreType() === 'PEM'">PEM</option>
              </select>
            </div>
            <div class="input-container">
              <label data-attr-for="this.getInputId('keystore.path')" class="info"
                >Path
                <span
                  class="button secondary"
                  data-attr-id="this.getInputId('keystore.path')"
                  data-attr-name="this.getInputId('keystore.path')"
                  data-on-click="this.handleFileSelection(this.getInputId('keystore.path'))"
                  >Choose file</span
                ></label
              >
              <input
                class="input"
                data-attr-id="this.getInputId('keystore.path')"
                data-attr-name="this.getInputId('keystore.path')"
                type="text"
                placeholder="/path/to/keystore"
                data-attr-value="this.keystorePath()"
                data-on-change="this.updateValue(event)"
              />
            </div>
          </div>
          <div class="input-row">
            <div class="input-container">
              <label data-attr-for="this.getInputId('keystore.password')" class="info"
                >Password</label
              >
              <input
                class="input"
                data-attr-id="this.getInputId('keystore.password')"
                data-attr-name="this.getInputId('keystore.password')"
                type="password"
                data-attr-value="this.keystorePassword()"
                data-on-change="this.updateValue(event)"
              />
            </div>
            <div class="input-container">
              <label data-attr-for="this.getInputId('keystore.key_password')" class="info"
                >Key Password</label
              >
              <input
                class="input"
                data-attr-id="this.getInputId('keystore.key_password')"
                data-attr-name="this.getInputId('keystore.key_password')"
                type="password"
                data-attr-value="this.keystoreKeyPassword()"
                data-on-change="this.updateValue(event)"
              />
            </div>
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
  }
}

// Register the custom element in the ts file for the webview where it will be used (in this case, direct-connect-form.ts)
// customElements.define("ssl-config", SslConfig);
