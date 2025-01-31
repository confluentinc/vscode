import { type Scope } from "inertial";

export function applyBindings(root: Element | ShadowRoot, os: Scope, vm: object) {
  let tree = walk(root);
  let disposables: Array<() => void> = [];
  for (let node: Node | null = tree.currentNode; node != null; node = tree.nextNode()) {
    if (node instanceof HTMLElement) {
      if (Object.hasOwn(node.dataset, "for")) {
        assert(node instanceof HTMLTemplateElement, "data-for should be applied to <template>");
        let expression = node.dataset.for as string;
        // parses `<item> of <list> by <key>`, for example "user of this.friends() by user.id"
        let rek = /([\S]+)\s+of\s+([\S]+)\s+by\s+([\S]+)/;
        // parses `<item> of <list>`, key by index instead
        let re = /([\S]+)\s+of\s+([\S]+)/;
        let results = rek.exec(expression) ?? re.exec(expression);
        assert(results != null, `data-for unable to parse expression "${expression}"`);
        let vars = { item: results[1], list: results[2], key: results[3] };
        // an accessor used to extract the list we iterate over
        let get = new Function(`return (${vars.list});`);
        // an accessor to get unique item's key, if the param is present, otherwise just index
        let getKey =
          vars.key != null
            ? new Function(vars.item, `return (${vars.key});`)
            : (_: any, index: any) => String(index);
        let keyToIndex = new Map<string, number>();
        let keyToNode = new Map<
          string,
          { node: Element; update: (value: any) => void; dispose: () => void }
        >();
        let watcher = os.watch(() => {
          let items = get.call(vm) as Array<any>;
          let prevKeyToIndex = keyToIndex;
          let prevKeyToNode = keyToNode;
          keyToIndex = new Map();
          keyToNode = new Map();
          for (let index = 0; index < items.length; index++) {
            keyToIndex.set(getKey.call(vm, items[index], index), index);
          }

          // remove elements that are not present in updated list
          for (let key of prevKeyToIndex.keys()) {
            if (!keyToIndex.has(key)) {
              let n = prevKeyToNode.get(key)!;
              n.dispose();
              n.node.remove();
            }
          }

          for (let index = 0; index < items.length; index++) {
            let key = getKey.call(vm, items[index], index);
            let prevIndex = prevKeyToIndex.get(key);
            if (prevIndex == null) {
              // this item is new, render a template for it
              let clone = (node.content.cloneNode(true) as DocumentFragment).firstElementChild!;

              let child = Object.create(vm);
              child[vars.item] = os.signal(items[index]);
              let disposeSignal = () => os.deref(child[vars.item]);
              let id: number;
              let disposeBind = () => cancelAnimationFrame(id);
              // TODO make a single rAF for the whole list
              id = requestAnimationFrame(() => {
                disposeBind = applyBindings(clone, os, child);
              });
              keyToNode.set(key, {
                node: clone,
                update: (value: any) => child[vars.item](value),
                dispose: () => {
                  disposeSignal();
                  disposeBind();
                },
              });
              // insert after previous
              if (index === 0) {
                node.before(clone);
              } else {
                let { node } = keyToNode.get(getKey.call(vm, items[index - 1], index - 1))!;
                node.after(clone);
              }
            } else {
              // this item was in the list before, let's update its value
              let item = prevKeyToNode.get(key)!;
              // QUESTION can I batch this?
              item.update(items[index]);
              keyToNode.set(key, item);
              if (prevIndex !== index) {
                // the item was also moved in other position, the elements needs to be moved as well
                if (index === 0) {
                  node.before(item.node);
                } else {
                  let { node } = keyToNode.get(getKey.call(vm, items[index - 1], index - 1))!;
                  node.after(item.node);
                }
              }
            }
          }
        });
        disposables.push(watcher, () => {
          for (let node of keyToNode.values()) {
            node.dispose();
          }
        });
      } else if (Object.hasOwn(node.dataset, "if")) {
        assert(node instanceof HTMLTemplateElement, "data-if should be applied to <template>");
        let get = new Function(`return (${node.dataset.if});`);
        let content: ChildNode[] | null = null;
        let dispose: (() => void) | null = null;
        let watcher = os.watch(() => {
          let result = get.call(vm);
          if (content == null && result) {
            let clone = node.content.cloneNode(true);
            content = Array.from(clone.childNodes.values());
            node.before(...content);
            let local = content;
            let id: number;
            dispose = () => cancelAnimationFrame(id);
            id = requestAnimationFrame(() => {
              let disposes = local.map((content) => applyBindings(content as Element, os, vm));
              dispose = () => disposes.forEach((fn) => fn());
            });
            return () => {};
          }
          if (content != null && dispose != null && !result) {
            content.forEach((node) => node.remove());
            dispose();
            content = dispose = null;
          }
        });
        disposables.push(watcher, () => dispose?.());
      } else if (Object.hasOwn(node.dataset, "text")) {
        let expression = node.dataset.text as string;
        disposables.push(nodeProperty(node, "textContent", expression, os, vm));
      } else if (Object.hasOwn(node.dataset, "html")) {
        let expression = node.dataset.html as string;
        disposables.push(nodeProperty(node, "innerHTML", expression, os, vm));
      } else if (Object.hasOwn(node.dataset, "children")) {
        let expression = node.dataset.children as string;
        let get = new Function(`return (${expression});`);
        let dispose = os.watch(() => {
          node.replaceChildren(get.call(vm));
        });
        disposables.push(dispose);
      } else if (Object.hasOwn(node.dataset, "value")) {
        assert(
          node instanceof HTMLInputElement ||
            node instanceof HTMLSelectElement ||
            node instanceof HTMLOptionElement,
          "data-value should be applied to <input>, <select>, or <option>",
        );
        let expression = node.dataset.value as string;
        disposables.push(nodeProperty(node, "value", expression, os, vm));
      }
      for (let key in node.dataset) {
        if (key.startsWith("on")) {
          let event = key.slice(2).toLowerCase();
          let expression = node.dataset[key] as string;
          let effect = new Function("event", expression);
          let handler = (event: Event) => effect.call(vm, event);
          node.addEventListener(event, handler);
          disposables.push(() => node.removeEventListener(event, handler));
        } else if (key.startsWith("attr")) {
          let attr = key
            .slice(4)
            .replace(/^(.{1})/, (_sub, match) => match.toLowerCase())
            .replace(/(?<=[a-z])([A-Z])/g, (_sub, match) => "-" + match.toLowerCase());
          let expression = node.dataset[key] as string;
          disposables.push(nodeAttribute(node, attr, expression, os, vm));
        } else if (key.startsWith("prop")) {
          let prop = key.slice(4).replace(/^(.{1})/, (_sub, match) => match.toLowerCase());
          let expression = node.dataset[key] as string;
          disposables.push(nodeProperty(node, prop as keyof typeof node, expression, os, vm));
        }
      }
    }
  }
  return () => {
    for (let fn of disposables) fn();
  };
}

function nodeProperty<T>(node: T, prop: keyof T, expr: string, os: Scope, vm: any) {
  assert(node instanceof HTMLElement, "");
  let get = new Function(`return (${expr});`);
  return os.watch(() => {
    node[prop] = get.call(vm);
  });
}

function nodeAttribute<T>(node: T, attr: string, expr: string, os: Scope, vm: any) {
  assert(node instanceof HTMLElement, "");
  let get = new Function(`return (${expr});`);
  if (isBooleanAttribute(attr)) {
    return os.watch(() => {
      if (get.call(vm)) node.setAttribute(attr, attr);
      else node.removeAttribute(attr);
    });
  }
  return os.watch(() => {
    let value = get.call(vm);
    if (value != null) node.setAttribute(attr, value);
    else node.removeAttribute(attr);
  });
}

function walk(root: Node) {
  let whatToShow = NodeFilter.SHOW_ELEMENT;
  return document.createTreeWalker(root, whatToShow, { acceptNode });
}

function acceptNode(node: HTMLElement) {
  for (const _key in node.dataset) return NodeFilter.FILTER_ACCEPT;
  return NodeFilter.FILTER_SKIP;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// prettier-ignore
const BOOLEAN_ATTRIBUTES = ["allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer", "disabled", "formnovalidate", "inert", "ismap", "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "selected"];
function isBooleanAttribute(name: string) {
  return BOOLEAN_ATTRIBUTES.includes(name);
}
