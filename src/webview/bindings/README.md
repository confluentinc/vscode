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
