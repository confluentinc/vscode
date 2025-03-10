// filepath: /kafka-credentials-component/kafka-credentials-component/src/components/auth-credentials.ts
import { ObservableScope } from "inertial";
import { applyBindings, html } from "./bindings/bindings";
import type { BasicCredentials } from "../clients/sidecar/models/BasicCredentials";
import { ApiKeyAndSecret, OAuthCredentials, ScramCredentials } from "../clients/sidecar";

// TODO NC rename and align with support types in parent
type SupportedAuthTypes = "None" | "Basic" | "API" | "SCRAM" | "OAuth";
type SupportedCredentialTypes =
  | BasicCredentials
  | ApiKeyAndSecret
  | ScramCredentials
  | OAuthCredentials;
type FormConnectionType = "Apache Kafka" | "Confluent Cloud" | "Confluent Platform" | "Other";

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

  updateValue(event: Event) {
    const input = event.target as HTMLInputElement;
    const name = input.name;
    const value = input.value;
    // This sets the value in the FormData object for the form submission
    this.entries.set(name, value.toString());
    this._internals.setFormValue(this.entries);
    // This dispatches a change event to the parent html for other actions
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: event,
      }),
    );
    // This updates the local config object for the component
    // so values are saved even if the section is collapsed
    // switch (name) {
    //   default:
    //     console.info("update input", name, value);
    //     break;
    // }
  }

  template = html`
    <div class="auth-credentials">
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
              required
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
              required
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
        <div class="input-container">
          <label for="this.getInputId('hash_algorithm')" class="label">Hash Algorithm</label>
          <select
            class="input dropdown"
            required
            data-attr-id="this.getInputId('hash_algorithm')"
            data-attr-name="this.getInputId('hash_algorithm')"
            data-value="this.creds()?.hash_algorithm ?? null"
            data-on-input="this.updateValue(event)"
          >
            <option
              value="SCRAM_SHA_256"
              data-attr-selected="this.creds()?.hash_algorithm === 'SCRAM_SHA_256' ? true : false"
            >
              SCRAM_SHA_256
            </option>
            <option
              value="SCRAM_SHA_512"
              data-attr-selected="this.creds()?.hash_algorithm === 'SCRAM_SHA_512' ? true : false"
            >
              SCRAM_SHA_512
            </option>
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
              required
            />
          </div>
          <div class="input-container">
            <label for="this.getInputId('scram_password')" class="label">Password</label>
            <input
              class="input"
              required
              data-attr-id="this.getInputId('scram_password')"
              data-attr-name="this.getInputId('scram_password')"
              type="password"
              data-value="this.creds()?.scram_password ?? null"
              required
              data-on-input="this.updateValue(event)"
            />
          </div>
        </div>
      </template>

      <template data-if="this.authType() === 'OAuth'">
        <div class="content-wrapper">
          <div class="input-row">
            <div class="input-container">
              <label class="label" for="this.getInputId('tokens_url')">Tokens URL</label>
              <input
                class="input"
                required
                type="url"
                data-attr-id="this.getInputId('tokens_url')"
                data-attr-name="this.getInputId('tokens_url')"
                required
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

// Register the custom element
// customElements.define("auth-credentials", AuthCredentials);
