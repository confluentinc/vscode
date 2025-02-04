import { test } from "rollwright";
import { expect } from "@playwright/test";
import replace from "@rollup/plugin-replace";
import esbuild from "rollup-plugin-esbuild";

test.use({
  plugins: [
    esbuild({ jsx: "automatic", target: "es2022", exclude: [/node_modules/] }),
    replace({
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
      preventAssignment: true,
    }),
  ],
});

test("custom element with properties passed down", async ({ execute, page }) => {
  /* This is a basic example of custom component having its own lifecycle and 
  internal state, while being provided with values from the outside. */

  await execute(async () => {
    const { ObservableScope } = await import("inertial");
    const { applyBindings, html } = await import("./bindings");

    class XCounter extends HTMLElement {
      os = ObservableScope();
      value = this.os.signal(0);

      // This is sort of a public API of the component. Use `data-prop-counter` to bind it
      // Note: we're binding a property, not an attribute (data-attr-*).
      set counter(value: number) {
        this.value(value);
      }

      template = html`
        <output data-text="this.value()"></output>
        <button data-on-click="this.value(v => v + 1)">Increment</button>
      `;

      connectedCallback() {
        const shadow = this.attachShadow({ mode: "open" });
        shadow.innerHTML = this.template;
        applyBindings(shadow, this.os, this);
      }
    }

    customElements.define("x-counter", XCounter);

    return XCounter;
  });

  /* Here we make use of the custom component several times with different input parameters */
  await execute(async () => {
    const { ObservableScope } = await import("inertial");
    const { applyBindings, html } = await import("./bindings");
    const root = document.createElement("main");
    root.innerHTML = html`
      <x-counter data-prop-counter="13"></x-counter>
      <hr />
      <x-counter data-prop-counter="20"></x-counter>
    `;
    document.body.append(root);
    const os = ObservableScope();
    applyBindings(root, os, {});
  });

  /* We assert that the components manage their own state in isolation */
  await page.locator("button").first().click();
  await expect(page.locator("output")).toHaveText(["14", "20"]);
  await page.locator("button").last().click();
  await expect(page.locator("output")).toHaveText(["14", "21"]);
});

test("custom elements with events bubbling up", async ({ execute, page }) => {
  /* This is an example in which custom component provides feedback to the parent
  scope via dispatching an event. A custom event is being dispatched on the custom
  element itself, so the parent scope can use `data-on-*` binding to handle it. */

  await execute(async () => {
    const { ObservableScope } = await import("inertial");
    const { applyBindings, html } = await import("./bindings");

    class CustomForm extends HTMLElement {
      os = ObservableScope();
      value = this.os.signal("");

      template = html`
        <input
          type="text"
          data-value="this.value()"
          data-on-change="this.value(event.target.value)"
          data-on-blur="this.handelBlur()"
        />
      `;

      handelBlur() {
        this.dispatchEvent(new CustomEvent("bubble", { detail: this.value() }));
      }

      connectedCallback() {
        const shadow = this.attachShadow({ mode: "open" });
        shadow.innerHTML = this.template;
        applyBindings(shadow, this.os, this);
      }
    }

    customElements.define("custom-form", CustomForm);
  });

  const vm = await execute(async () => {
    const { ObservableScope } = await import("inertial");
    const { applyBindings, html } = await import("./bindings");
    const { fake } = await import("sinon");
    const root = document.createElement("main");
    root.innerHTML = html`
      <custom-form data-on-bubble="this.handleBubble(event.detail)"></custom-form>
    `;
    document.body.append(root);
    const os = ObservableScope();
    const vm: Record<string, any> = {
      result: os.signal(""),
      handleBubble: fake((value: string) => vm.result(value)),
    };
    applyBindings(root, os, vm);
    return vm;
  });

  await page.locator("input").fill("hello");
  await page.locator("input").blur();

  expect(await vm.evaluate((vm) => vm.handleBubble.callCount)).toBe(1);
  expect(await vm.evaluate((vm) => vm.result())).toBe("hello");
});
