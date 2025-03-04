# YATE: Yet Another Template Engine

Low-overhead DOM-driven template engine with small API footprint powered by reactive values from
[inertial](https://unknownprinciple.github.io/inertial/). Can be used for creating interactive UI in
webviews.

## User Guide

This guide will help you understand how to create a view model using reactive values and bind it to
an HTML template using our custom DOM template engine.

### Creating a View Model

First, let's create a view model using the `ObservableScope` function:

```js
import { ObservableScope } from "inertial";

const os = ObservableScope();
const vm = {
  message: os.signal("Hello, World!"),
  count: os.signal(0),
  items: os.signal(["Apple", "Banana", "Cherry"]),
  isVisible: os.signal(true),
  increment: () => vm.count((c) => c + 1),
};
```

### Writing the HTML Template

Now, let's create an HTML template that uses our binding directives. Remember to always use the
`this` keyword when referencing view model properties in your templates.

```html
<div>
  <h1 data-text="this.message()"></h1>
  <p>Count: <span data-text="this.count()"></span></p>
  <button data-on-click="this.increment()">Increment</button>

  <ul>
    <template data-for="item of this.items()">
      <li data-text="this.item()"></li>
    </template>
  </ul>

  <template data-if="this.isVisible()">
    <p>This paragraph is visible!</p>
  </template>

  <input data-prop-value="this.message()" data-on-input="this.message(event.target.value)" />

  <a data-attr-href="'https://example.com/' + this.message()">Link</a>
</div>
```

### Binding the View Model to the Template

To bind the view model to the template, use the `applyBindings()` function:

```js
import { applyBindings } from "./bindings";

const root = document.querySelector("#root");
const dispose = applyBindings(root, os, vm);
```

### Understanding the Directives

1. `data-text`: Binds the text content of an element to a reactive value.

   ```html
   <span data-text="this.message()"></span>
   ```

2. `data-for`: Creates a list of elements based on an array of items.

   ```html
   <template data-for="item of this.items()">
     <li data-text="this.item()"></li>
   </template>
   ```

3. `data-if`: Conditionally renders an element based on a boolean value.

   ```html
   <template data-if="this.isVisible()">
     <p>This is visible when isVisible is true</p>
   </template>
   ```

4. `data-attr-*`: Binds an attribute to a reactive value.

   ```html
   <a data-attr-href="'https://example.com/' + this.message()">Link</a>
   ```

5. `data-prop-*`: Binds a property to a reactive value.

   ```html
   <input data-prop-value="this.message()" />
   ```

6. `data-on-*`: Binds an event handler to an element.

   ```html
   <button data-on-click="this.increment()">Increment</button>
   ```

## Cleaning Up

When you're done with the view model and bindings, call the dispose function:

```javascript
dispose();
```

This will clean up all the reactive subscriptions and event listeners.

## Creating custom components

Following example explains how
[custom elements](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements)
can be used for defining a custom component with its own lifecycle.

```js
import { ObservableScope } from "inertial";
import { applyBindings, html } from "./bindings";

// Using custom elements, we define custom component as a class that extends HTMLElement
// On the inside, it behaves just like another class
// Custom elements provide certain methods that can be defined to react on host events: element attached/detached, attributes changed
class CustomComponent extends HTMLElement {
  // Each instance of a custom component going to have its own scope for reactive values so they don't interfere
  os = ObservableScope();

  // Using the scope, we define internal state in the same way we define a View Model
  internalState = this.os.signal(/* initial state */);

  // The parent scope needs a way to pass data down to a custom component
  // Here we use property setters so any kind of data can be passed, unlike attributes that only handle strings
  // Following setter triggers when you do `element.someValue = ...`
  //   which is what happens when you bind `data-prop-some-value="..."`
  set someValue(value) {
    // Triggering changes in internal state is how we update the component based on what the parent scope needs
    this.internalState(value);
  }

  // Since the class context is being used as View Model for its own template bindings,
  // we can define custom methods to describe certain behaviors outside of the template
  someMethod() {
    // We can use custom events to trigger reaction in the parent scope
    //   that can bind to the event e.g. `data-on-something="this.handle(event.detail)"`
    this.dispatchEvent(new CustomEvent("something", { detail: info }));
  }

  // To make it easier to navigate, I defined the component's template as a separate property
  // It uses JS template strings for convenient multiline editing
  // `html` tag (imported from bindings module) does nothing in runtime, but can enable HTML syntax highlight
  template = html`
    <p data-text="this.internalState()"></p>
    <button data-on-click="this.someMethod()"></button>
  `;

  // This part is what makes everything work
  // This method is triggered by the browser when the custom element is attached to the page
  connectedCallback() {
    // Here we hide the internal template from the parent scope, so parent bindings don't see internal template
    const shadow = this.attachShadow({ mode: "open" });
    // The shadow DOM of an element receives the template defined earlier
    shadow.innerHTML = this.template;
    // And gets bindings applied, using the instance of the class as view model
    applyBindings(shadow, this.os, this);
  }
}

// Here we register the class we implement as a custom HTML element so it can be used in a parent template
customElements.define("custom-component", CustomComponent);
```

The example component going to be used in another template:

```html
<!-- per example above, using property binding to pass data down -->
<!-- and using event binding to react to internal events bubbling up  -->
<custom-component
  data-prop-some-value="this.state()"
  data-prop-on-something="this.handleEvent(event.detail)"
></custom-component>
```
