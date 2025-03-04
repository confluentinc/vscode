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

test("data-text", async ({ execute, page }) => {
  let vm = await execute(async () => {
    let { ObservableScope } = await import("inertial");
    let os = ObservableScope();
    return {
      os,
      counter: os.signal(0),
    };
  });

  let dispose = await execute(async (vm) => {
    let { applyBindings } = await import("./bindings");
    let root = document.createElement("main");
    root.innerHTML = /* html */ `
      <span data-text="this.counter()"></span>
    `;
    document.body.append(root);
    return applyBindings(root, vm.os, vm);
  }, vm);

  await expect(page.locator("span")).toHaveText("0");
  await execute((vm) => vm.counter((v) => v + 1), vm);
  await expect(page.locator("span")).toHaveText("1");
  await execute((dispose) => dispose(), dispose);
  await execute((vm) => vm.counter((v) => v + 1), vm);
  await expect(page.locator("span")).toHaveText("1");
});

test("data-html", async ({ execute, page }) => {
  let vm = await execute(async () => {
    let { ObservableScope } = await import("inertial");
    let os = ObservableScope();
    return {
      os,
      message: os.signal("hello <strong>world</strong>"),
    };
  });

  await execute(async (vm) => {
    let { applyBindings } = await import("./bindings");
    let root = document.createElement("main");
    root.innerHTML = /* html */ `
      <span data-html="this.message()"></span>
    `;
    document.body.append(root);
    return applyBindings(root, vm.os, vm);
  }, vm);

  await expect(page.locator("span")).toHaveText("hello world");
  await expect(page.locator("strong")).toHaveText("world");
});

test("data-children", async ({ execute, page }) => {
  let vm = await execute(async () => {
    let { ObservableScope } = await import("inertial");
    let os = ObservableScope();
    let vm = {
      os,
      message: os.signal("hello world"),
      highlightMessage() {
        let input = this.message();
        let index = input.indexOf("world");
        if (index >= 0) {
          let nodes = document.createDocumentFragment();
          nodes.append(document.createTextNode(input.substring(0, index)));
          let mark = document.createElement("mark");
          mark.append(document.createTextNode(input.substring(index, index + 5)));
          nodes.append(mark);
          nodes.append(document.createTextNode(input.substring(index + 5)));
          return nodes;
        }
        return input;
      },
    };
    return vm;
  });

  await execute(async (vm) => {
    let { applyBindings } = await import("./bindings");
    let root = document.createElement("main");
    root.innerHTML = /* html */ `
      <span data-children="this.highlightMessage()"></span>
    `;
    document.body.append(root);
    return applyBindings(root, vm.os, vm);
  }, vm);

  await expect(page.locator("span")).toHaveText("hello world");
  await expect(page.locator("mark")).toHaveText("world");
});

test("data-on-*", async ({ execute, page }) => {
  let vm = await execute(async () => {
    let { ObservableScope } = await import("inertial");
    let os = ObservableScope();
    let counter = os.signal(0);
    return {
      os,
      counter,
      increment: () => counter((v) => v + 1),
    };
  });

  await execute(async (vm) => {
    let { applyBindings } = await import("./bindings");
    let root = document.createElement("main");
    root.innerHTML = /* html */ `
      <button data-on-click="this.increment()">+</button>
      <span data-text="this.counter()"></span>
    `;
    document.body.append(root);
    return applyBindings(root, vm.os, vm);
  }, vm);

  await expect(page.locator("span")).toHaveText("0");
  await page.locator("button").click();
  await expect(page.locator("span")).toHaveText("1");
});

test("data-value + data-on-input", async ({ execute, page }) => {
  let vm = await execute(async () => {
    let { ObservableScope } = await import("inertial");
    let os = ObservableScope();
    return {
      os,
      message: os.signal("hello"),
    };
  });

  await execute(async (vm) => {
    let { applyBindings } = await import("./bindings");
    let root = document.createElement("main");
    root.innerHTML = /* html */ `
      <div>
        <input data-value="this.message()" data-on-input="this.message(event.target.value)">
        <span 
          data-text="this.message()" 
          data-prop-css-text="'color:' + this.message() == 'hello' ? 'red': 'blue'"
        ></span>
      </div>
    `;
    document.body.append(root);
    return applyBindings(root, vm.os, vm);
  }, vm);

  await expect(page.locator("input")).toHaveValue("hello");
  await expect(page.locator("span")).toHaveText("hello");
  await page.locator("input").fill("world");
  await expect(page.locator("span")).toHaveText("world");
});

test("data-attr-*", async ({ execute, page }) => {
  let vm = await execute(async () => {
    let { ObservableScope } = await import("inertial");
    let os = ObservableScope();
    return {
      os,
      counter: os.signal(0),
    };
  });

  await execute(async (vm) => {
    let { applyBindings } = await import("./bindings");
    let root = document.createElement("main");
    root.innerHTML = /* html */ `
      <button 
        data-on-click="this.counter(v => v + 1)"
        data-attr-disabled="this.counter() >= 2"
        data-attr-aria-label="this.counter() >= 2 ? 'no longer clickable' : 'click it'"
      >+</button>
    `;
    document.body.append(root);
    return applyBindings(root, vm.os, vm);
  }, vm);

  let button = page.locator("button");
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-label", "click it");
  await button.click();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "no longer clickable");
  await expect(button).toBeDisabled();
});

test("data-attr-* removal", async ({ execute, page }) => {
  let vm = await execute(async () => {
    let { ObservableScope } = await import("inertial");
    let os = ObservableScope();
    return {
      os,
      pattern: os.signal<string | null>("\\w{3,5}"),
    };
  });

  await execute(async (vm) => {
    let { applyBindings } = await import("./bindings");
    let root = document.createElement("main");
    root.innerHTML = /* html */ `
      <form>
        <input type="text" data-attr-pattern="this.pattern()" />
      </form>
    `;
    document.body.append(root);
    return applyBindings(root, vm.os, vm);
  }, vm);

  await page.locator("input").fill("a");
  await expect(page.locator("input:invalid")).toBeVisible();
  await page.locator("input").fill("abc");
  await expect(page.locator("input:valid")).toBeVisible();
  await page.locator("input").fill("abcdef");
  await expect(page.locator("input:invalid")).toBeVisible();
  await execute((vm) => vm.pattern(null), vm);
  await expect(page.locator("input:valid")).toBeVisible();
});

test("data-if", async ({ execute, page }) => {
  let vm = await execute(async () => {
    let { ObservableScope } = await import("inertial");
    let os = ObservableScope();
    return {
      os,
      counter: os.signal(0),
    };
  });

  await execute(async (vm) => {
    let { applyBindings } = await import("./bindings");
    let root = document.createElement("main");
    root.innerHTML = /* html */ `
      <button data-on-click="this.counter(v => v + 1)">+</button>
      <template data-if="this.counter() < 2">
        <p>This is visible while counter lower than 2. Current value is <span data-text="this.counter()"></span></p>
      </template>
    `;
    document.body.append(root);
    return applyBindings(root, vm.os, vm);
  }, vm);

  await expect(page.locator("p")).toBeVisible();
  await expect(page.locator("p")).toContainText("Current value is 0");
  await page.locator("button").click();
  await expect(page.locator("p")).toContainText("Current value is 1");
  await page.locator("button").click();
  await expect(page.locator("p")).not.toBeVisible();
});

test("data-for", async ({ execute, page }) => {
  let vm = await execute(async () => {
    let { ObservableScope } = await import("inertial");
    let os = ObservableScope();
    return {
      os,
      list: os.signal([{ name: "Liza" }, { name: "Mike" }]),
    };
  });

  let dispose = await execute(async (vm) => {
    let { applyBindings } = await import("./bindings");
    let root = document.createElement("main");
    root.innerHTML = /* html */ `
      <section>
        <ul>
          <template data-for="user of this.list()">
            <li data-text="this.user().name"></li>
          </template>
        </ul>
      </section>
    `;
    document.body.append(root);
    return applyBindings(root, vm.os, vm);
  }, vm);

  await expect(page.locator("li")).toContainText(["Liza", "Mike"]);
  await execute((vm) => vm.list((v) => v.concat({ name: "Ann" })), vm);
  await expect(page.locator("li")).toContainText(["Liza", "Mike", "Ann"]);
  await execute((vm) => vm.list((v) => v.filter((u) => u.name !== "Mike")), vm);
  await expect(page.locator("li")).toContainText(["Liza", "Ann"]);
  await execute((dispose) => dispose(), dispose);
  await execute((vm) => vm.list([]), vm);
  await expect(page.locator("li")).toContainText(["Liza", "Ann"]);
});

test("data-for with key", async ({ execute, page }) => {
  let vm = await execute(async () => {
    let { ObservableScope } = await import("inertial");
    let os = ObservableScope();
    return {
      os,
      list: os.signal([{ name: "Liza" }, { name: "Mike" }]),
    };
  });

  await execute(async (vm) => {
    let { applyBindings } = await import("./bindings");
    let root = document.createElement("main");
    root.innerHTML = /* html */ `
      <section>
        <ul>
          <template data-for="user of this.list() by user.name">
            <li data-text="this.user().name"></li>
          </template>
        </ul>
      </section>
    `;
    document.body.append(root);
    return applyBindings(root, vm.os, vm);
  }, vm);

  await expect(page.locator("li")).toContainText(["Liza", "Mike"]);
  await execute((vm) => vm.list((v) => v.concat({ name: "Ann" })), vm);
  await expect(page.locator("li")).toContainText(["Liza", "Mike", "Ann"]);
  await execute((vm) => vm.list(["Liza", "Ann", "Mike"].map((name) => ({ name }))), vm);
  await expect(page.locator("li")).toContainText(["Liza", "Ann", "Mike"]);
});
