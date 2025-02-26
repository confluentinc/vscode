import { ObservableScope } from "inertial";
import { applyBindings, html } from "./bindings/bindings";
import { TLSConfig } from "../clients/sidecar";

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

  // Setters for component props
  set config(value: TLSConfig) {
    console.log("setting config obj =>", this.identifier(), value);
    this.configObj(value);
  }
  set namespace(value: string) {
    this.identifier(value);
  }

  /** Update the host form data so it contains all the changed values on submit
   * and dispatch a bubble event to the host for other actions
   */
  updateValue(event: Event) {
    const input = event.target as HTMLInputElement;
    const name = input.name;
    const value = input.type === "checkbox" ? input.checked : input.value;
    this.entries.set(name, value.toString());
    this._internals.setFormValue(this.entries);

    this.dispatchEvent(
      new CustomEvent("bubble", {
        detail: { inputName: name, inputValue: value },
      }),
    );
  }

  inputId(name: string) {
    return this.identifier() + ".ssl." + name;
  }
  // Template for the component
  template = html`
    <label class="checkbox" data-attr-for="this.inputId('verify_hostname')">
      <input
        type="checkbox"
        data-attr-id="this.inputId('verify_hostname')"
        data-attr-name="this.inputId('verify_hostname')"
        data-attr-checked="this.verifyHostname()"
        data-on-change="this.updateValue(event);"
        data-attr-value="this.verifyHostname()"
      />
      <span>Verify Server Hostname</span>
    </label>
    <div data-attr-class="this.showTLS() ? 'input-sub-group' : 'input-sub-group hidden'">
      <p
        data-on-click="this.showTLS(!this.showTLS())"
        data-attr-aria-expanded="this.showTLS()"
        class="heading"
      >
        <span data-text="this.showTLS() ? '^' : '>'"></span>
        SSL Configuration
      </p>
      <template data-if="this.showTLS()">
        <p class="info">Optional settings for advanced SSL configuration</p>
        <div class="input-container">
          <label class="label">TrustStore Configuration</label>
          <div class="input-row">
            <div class="input-container" style="flex: 1">
              <label data-attr-for="this.inputId('truststore.type')" class="info">Type</label>
              <select
                class="input dropdown"
                data-attr-id="this.inputId('truststore.type')"
                data-attr-name="this.inputId('truststore.type')"
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
              <label data-attr-for="this.inputId('truststore.path')" class="info">Path</label>
              <input
                class="input"
                data-attr-id="this.inputId('truststore.path')"
                data-attr-name="this.inputId('truststore.path')"
                type="text"
                placeholder="/path/to/truststore"
                data-attr-value="this.truststorePath()"
                data-on-change="this.updateValue(event)"
              />
            </div>
            <div class="input-container">
              <label data-attr-for="this.inputId('truststore.password')" class="info"
                >Password</label
              >
              <input
                class="input"
                data-attr-id="this.inputId('truststore.password')"
                data-attr-name="this.inputId('truststore.password')"
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
              <label data-attr-for="this.inputId('keystore.type')" class="info">Type</label>
              <select
                class="input dropdown"
                data-attr-id="this.inputId('keystore.type')"
                data-attr-name="this.inputId('keystore.type')"
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
              <label data-attr-for="this.inputId('keystore.path')" class="info">Path</label>
              <input
                class="input"
                data-attr-id="this.inputId('keystore.path')"
                data-attr-name="this.inputId('keystore.path')"
                type="text"
                placeholder="/path/to/keystore"
                data-attr-value="this.keystorePath()"
                data-on-change="this.updateValue(event)"
              />
            </div>
            <div class="input-container">
              <label data-attr-for="this.inputId('keystore.password')" class="info">Password</label>
              <input
                class="input"
                data-attr-id="this.inputId('keystore.password')"
                data-attr-name="this.inputId('keystore.password')"
                type="password"
                data-attr-value="this.keystorePassword()"
                data-on-change="this.updateValue(event)"
              />
            </div>
            <div class="input-container">
              <label data-attr-for="this.inputId('keystore.key_password')" class="info"
                >Key Password</label
              >
              <input
                class="input"
                data-attr-id="this.inputId('keystore.key_password')"
                data-attr-name="this.inputId('keystore.key_password')"
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
