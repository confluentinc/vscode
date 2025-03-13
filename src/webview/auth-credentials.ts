import { ObservableScope } from "inertial";
import {
  type KerberosCredentials,
  type ApiKeyAndSecret,
  type BasicCredentials,
  type OAuthCredentials,
  type ScramCredentials,
} from "../clients/sidecar";
import { FormConnectionType, SupportedAuthTypes } from "../directConnections/types";
import { applyBindings, html } from "./bindings/bindings";

type SupportedCredentialTypes =
  | BasicCredentials
  | ApiKeyAndSecret
  | ScramCredentials
  | OAuthCredentials
  | KerberosCredentials;

/** Reusable Custom HTML Element (Web Component) for Authentication Credentials
 * This component manages Schema Registry or Kafka cluster configuration for credentials
 * Fields are rendered dynamically based on the selected authentication type in Direct Connect Form
 * @element auth-credentials
 * @attr {string} namespace - ensure form inputs have unique ids for resource types (schema/kafka)
 * @attr {object} credentials - the original spec's credentials to be updated, if it exists
 */
export class AuthCredentials extends HTMLElement {
  static formAssociated = true;
  private _internals: ElementInternals;
  constructor() {
    super();
    this._internals = this.attachInternals();
  }

  os = ObservableScope();
  entries = new FormData();
  identifier = this.os.signal<string>("");
  authType = this.os.signal<SupportedAuthTypes>("None");
  connectionType = this.os.signal<FormConnectionType>("Confluent Cloud");
  creds = this.os.signal<SupportedCredentialTypes | null>(null);

  // Setters for component props
  set credentials(value: SupportedCredentialTypes) {
    this.creds(value);
  }
  set namespace(value: string) {
    this.identifier(value);
  }
  set type(value: SupportedAuthTypes) {
    this.authType(value);
  }
  set platform(value: FormConnectionType) {
    this.connectionType(value);
  }

  getInputId(name: string) {
    return this.identifier() + ".credentials." + name;
  }

  // Helper method to validate a single input
  validateInput(input: HTMLInputElement): boolean {
    if (!input.validity.valid) {
      input.classList.add("error");
      // Determine the specific validation error
      if (input.validity.patternMismatch) {
        this._internals.setValidity(
          { patternMismatch: true },
          "Value does not match expected pattern",
          input,
        );
      } else if (input.validity.valueMissing) {
        this._internals.setValidity({ valueMissing: true }, "This field is required", input);
      } else if (input.validity.typeMismatch) {
        this._internals.setValidity(
          { typeMismatch: true },
          `Please enter a valid ${input.type}`,
          input,
        );
      } else {
        this._internals.setValidity({ customError: true }, "Invalid input", input);
      }
      return false;
    } else {
      input.classList.remove("error");
      this._internals.setValidity({});
      return true;
    }
  }

  // updateValue called onInput
  updateValue(event: Event) {
    const input = event.target as HTMLInputElement;
    const name = input.name;
    const value = input.value;

    // Sets the value in the FormData object for the form submission
    this.entries.set(name, value.toString());
    this._internals.setFormValue(this.entries);

    // Validate the input
    this.validateInput(input);

    // Dispatch a change event to the parent html for other actions
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: event,
      }),
    );
  }

  // Check validity of all inputs in this (auth) section
  // Handles reporting validation to form before submit
  checkValidity() {
    const inputs: NodeListOf<HTMLInputElement> | undefined =
      this.shadowRoot?.querySelectorAll("input");

    // If no inputs are visible (e.g., auth type is "None"), consider it valid
    if (!inputs || inputs.length === 0) return true;

    let isValid = true;
    let firstInvalidInput: HTMLElement | null = null;

    inputs.forEach((input) => {
      // Force check on required fields even if untouched
      if (input.hasAttribute("required") && !input.value) {
        input.classList.add("error");
      }

      if (!this.validateInput(input)) {
        isValid = false;
        if (!firstInvalidInput) firstInvalidInput = input;
      }
    });

    if (!isValid) {
      this._internals.setValidity(
        { customError: true },
        "Please fill out all required fields correctly",
        firstInvalidInput || undefined,
      );
    } else {
      this._internals.setValidity({});
    }

    return isValid;
  }

  template = html`
    <div class="auth-credentials" data-attr-name="this.identifier() + '.credentials'">
      <template data-if="this.authType() === 'Basic'">
        <div class="input-row">
          <div class="input-container">
            <label for="this.getInputId('username')" class="label">Username</label>
            <input
              class="input"
              required
              data-attr-id="this.getInputId('username')"
              data-attr-name="this.getInputId('username')"
              type="text"
              data-value="this.creds()?.username ?? null"
              data-on-input="this.updateValue(event)"
            />
          </div>
          <div class="input-container">
            <label for="this.getInputId('password')" class="label">Password</label>
            <input
              class="input"
              required
              data-attr-id="this.getInputId('password')"
              data-attr-name="this.getInputId('password')"
              type="password"
              data-value="this.creds()?.password ?? null"
              data-on-input="this.updateValue(event)"
            />
          </div>
        </div>
      </template>

      <template data-if="this.authType() === 'API'">
        <div class="input-row">
          <div class="input-container">
            <label for="this.getInputId('api_key')" class="label">API Key</label>
            <input
              class="input"
              required
              data-attr-id="this.getInputId('api_key')"
              data-attr-name="this.getInputId('api_key')"
              type="text"
              data-value="this.creds()?.api_key ?? null"
              data-on-input="this.updateValue(event)"
            />
          </div>
          <div class="input-container">
            <label for="this.getInputId('api_secret')" class="label">API Secret</label>
            <input
              class="input"
              required
              data-attr-id="this.getInputId('api_secret')"
              data-attr-name="this.getInputId('api_secret')"
              data-attr-value="this.creds()?.api_secret ?? null"
              type="password"
              data-on-input="this.updateValue(event)"
            />
          </div>
        </div>
      </template>
      <!-- No SCRAM for SR -->
      <template data-if="this.identifier() !== 'schema_registry' && this.authType() === 'SCRAM'">
        <div class="flex-column">
          <div class="input-container">
            <label for="this.getInputId('hash_algorithm')" class="label">Hash Algorithm</label>
            <select
              class="input dropdown"
              required
              data-attr-id="this.getInputId('hash_algorithm')"
              data-attr-name="this.getInputId('hash_algorithm')"
              data-value="this.creds()?.hash_algorithm ?? 'SCRAM_SHA_256'"
              data-on-input="this.updateValue(event)"
            >
              <option value="SCRAM_SHA_256">SCRAM_SHA_256</option>
              <option value="SCRAM_SHA_512">SCRAM_SHA_512</option>
            </select>
          </div>
          <div class="input-row">
            <div class="input-container">
              <label for="this.getInputId('scram_username')" class="label">Username</label>
              <input
                class="input"
                required
                data-attr-id="this.getInputId('scram_username')"
                data-attr-name="this.getInputId('scram_username')"
                type="text"
                data-value="this.creds()?.scram_username ?? null"
                data-on-input="this.updateValue(event)"
              />
            </div>
            <div class="input-container">
              <label for="this.getInputId('scram_password')" class="label">Password</label>
              <input
                class="input"
                required
                type="password"
                data-attr-id="this.getInputId('scram_password')"
                data-attr-name="this.getInputId('scram_password')"
                data-value="this.creds()?.scram_password ?? null"
                data-on-input="this.updateValue(event)"
              />
            </div>
          </div>
        </div>
      </template>

      <template data-if="this.authType() === 'OAuth'">
        <div class="flex-column">
          <div class="input-row">
            <div class="input-container">
              <label class="label" for="this.getInputId('tokens_url')">Tokens URL</label>
              <input
                class="input"
                required
                type="url"
                data-attr-id="this.getInputId('tokens_url')"
                data-attr-name="this.getInputId('tokens_url')"
                data-value="this.creds()?.tokens_url ?? null"
                data-on-input="this.updateValue(event)"
                title="The URL of the OAuth 2.0 identity provider's token endpoint. Must be a valid URL."
              />
            </div>
            <div class="input-container">
              <label class="label" for="this.getInputId('scope')">Scope</label>
              <input
                class="input"
                type="text"
                data-attr-id="this.getInputId('scope')"
                data-attr-name="this.getInputId('scope')"
                data-value="this.creds()?.scope ?? null"
                data-on-input="this.updateValue(event)"
                title="The scope to use. The scope is optional and required only when your identity provider doesn't have a default scope or your groups claim is linked to a scope path to use when connecting to the external service."
              />
            </div>
            <div class="input-container">
              <label class="label" for="this.getInputId('connect_timeout_millis')">
                Connect Timeout (ms)
              </label>
              <input
                class="input"
                type="number"
                data-attr-id="this.getInputId('connect_timeout_millis')"
                data-attr-name="this.getInputId('connect_timeout_millis')"
                data-value="this.creds()?.connect_timeout_millis ?? null"
                data-on-input="this.updateValue(event)"
                max="60000"
                min="0"
                step="1000"
                placeholder="0"
                title="The timeout in milliseconds when connecting to your identity provider."
              />
            </div>
          </div>
          <div class="input-row">
            <div class="input-container">
              <label class="label" for="this.getInputId('client_id')">Client ID</label>
              <input
                class="input"
                type="text"
                required
                data-attr-id="this.getInputId('client_id')"
                data-attr-name="this.getInputId('client_id')"
                data-value="this.creds()?.client_id ?? null"
                data-on-input="this.updateValue(event)"
                title="The public identifier for the application as registered with the OAuth 2.0 identity provider."
              />
            </div>
            <div class="input-container">
              <label class="label" for="this.getInputId('client_secret')">Client Secret</label>
              <input
                class="input"
                type="password"
                data-attr-id="this.getInputId('client_secret')"
                data-attr-name="this.getInputId('client_secret')"
                data-value="this.creds()?.client_secret ?? null"
                data-on-input="this.updateValue(event)"
                title="The client secret known only to the application and the OAuth 2.0 identity provider."
              />
            </div>
          </div>

          <template data-if="this.connectionType() === 'Confluent Cloud'">
            <div class="input-row">
              <div class="input-container">
                <label class="label" for="this.getInputId('ccloud_logical_cluster_id')">
                  Logical Cluster ID
                </label>
                <input
                  class="input"
                  type="text"
                  data-attr-id="this.getInputId('ccloud_logical_cluster_id')"
                  data-attr-name="this.getInputId('ccloud_logical_cluster_id')"
                  data-value="this.creds()?.ccloud_logical_cluster_id ?? null"
                  data-on-input="this.updateValue(event)"
                  title="Additional property that can be added in the request header to identify the logical cluster ID to connect to. For example, this may be a Confluent Cloud Kafka or Schema Registry cluster ID."
                />
              </div>
              <div class="input-container">
                <label class="label" for="this.getInputId('ccloud_identity_pool_id')">
                  Identity Pool ID
                </label>
                <input
                  class="input"
                  type="text"
                  data-attr-id="this.getInputId('ccloud_identity_pool_id')"
                  data-attr-name="this.getInputId('ccloud_identity_pool_id')"
                  data-value="this.creds()?.ccloud_identity_pool_id ?? null"
                  data-on-input="this.updateValue(event)"
                  title="Additional property that can be added in the request header to identify the principal ID for authorization. For example, this may be a Confluent Cloud identity pool ID."
                />
              </div>
            </div>
          </template>
        </div>
      </template>
      <template data-if="this.authType() === 'Kerberos'">
        <div class="flex-column">
          <div class="input-row">
            <div class="input-container">
              <label for="this.getInputId('principal')" class="label">Principal</label>
              <input
                class="input"
                required
                data-attr-id="this.getInputId('principal')"
                data-attr-name="this.getInputId('principal')"
                type="text"
                data-value="this.creds()?.principal ?? null"
                data-on-input="this.updateValue(event)"
              />
            </div>
            <div class="input-container">
              <label for="this.getInputId('service_name')" class="label">Service Name</label>
              <input
                class="input"
                required
                data-attr-id="this.getInputId('service_name')"
                data-attr-name="this.getInputId('service_name')"
                type="text"
                placeholder="kafka"
                data-value="this.creds()?.service_name ?? null"
                required
                data-on-input="this.updateValue(event)"
              />
            </div>
          </div>
          <div class="input-row">
            <div class="input-container">
              <label for="this.getInputId('keytab_path')" class="label">Keytab Path</label>
              <input
                class="input"
                required
                data-attr-id="this.getInputId('keytab_path')"
                data-attr-name="this.getInputId('keytab_path')"
                type="text"
                placeholder="/path/to/keytab"
                data-value="this.creds()?.keytab_path ?? null"
                required
                data-on-input="this.updateValue(event)"
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
    sheet.insertRule(`.flex-column { display: flex; flex-direction: column; gap: 5px; }`);
    shadow.adoptedStyleSheets = [sheet];
    shadow.innerHTML = this.template;
    applyBindings(shadow, this.os, this);

    // Before form submits, invoke validation checks
    if (this._internals.form) {
      this._internals.form.addEventListener(
        "submit",
        (event) => {
          console.log("Form submitted:", event);
          // Validate all inputs on form submission
          if (!this.checkValidity()) {
            // Don't prevent default. Since we send validation checks to _internals,
            // the parent form will see element is invalid and prevent submission
          }
        },
        { capture: true },
      );
    }
  }
}

// Use this line to register the custom element in the ts file for the webview where it will be used (in this case, direct-connect-form.ts)
// customElements.define("auth-credentials", AuthCredentials);
