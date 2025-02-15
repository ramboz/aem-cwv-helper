# A JavaScript Library for improving Core Web Vitals

The library is a lightweight JavaScript library providing helper functions to improve the performance of your web pages and enhance Core Web Vitals (CWV) metrics. It offers utilities to prioritize resources, defer non-urgent tasks, and break up long-running operations, ultimately leading to a smoother and faster user experience.

## Installation

Directly include `aem-cwv-helper.js` in your project.

## Usage

This library provides several functions to optimize different aspects of your web page's performance. Here's a breakdown of each function and how to use them:

### `prioritizeImages(selector)`

Prioritizes the loading of images that are critical for the Largest Contentful Paint (LCP). This function finds images matching the provided CSS selector and sets their `loading` attribute to `eager` and `fetchpriority` to `high`, ensuring they are loaded with higher priority.

```javascript
import { prioritizeImages } from './aem-cwv-helper.js'; // Adjust path if needed

// Prioritize the main banner image (assuming it's the LCP element)
prioritizeImages('.banner-image');

// You can also prioritize multiple images with a more general selector
prioritizeImages('img.hero-image, img.featured-product');
```

### `callCostlyApi(fn)`

Executes a function `fn` that performs a costly API call during browser idle time using `requestIdleCallback` behind the scene. This is ideal for non-urgent API requests that can be deferred without impacting the initial page load or user interaction.

```javascript
import { callCostlyApi } from './aem-cwv-helper.js';

async function formatDate(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
  }
  formatter.format(date);
}

callCostlyApi(() => formatDate(new Date()); // Format a date for a given region
```

### `callCostlyUiApi(fn)`

Executes a function `fn` that performs a costly UI update using `requestAnimationFrame` behind the scene. This ensures that UI updates are synchronized with the browser's rendering pipeline, leading to smoother animations and transitions and preventing jank.

```javascript
import { callCostlyUiApi } from './aem-cwv-helper.js';

function updateLargeList() {
  const dialog = document.getElementById('modal-dialog');
  dialog.showModal();
}

callCostlyUiApi(showDialog); // Show a modal dialog
```

### `splitLongTask()`

Breaks up the current task and yields to the main thread, while still guaranteeing the rest of the logic will eventually run. Use this function to explicitly yield to the main thread within long-running tasks, making your application more responsive.

```javascript
import { splitLongTask } from './aem-cwv-helper.js';

async function processData() {
  const data = [...Array(10000).keys()]; // Example large dataset

  for (const item of data) {
    // ... process each item ...
    if (item % 1000 === 0) {
      await splitLongTask(); // Yield every 1000 items
      console.log(`Processed ${item} items, yielding...`);
    }
  }
  console.log('Data processing complete.');
}

processData();
```

### `performAsyncUiUpdate(fn)`

Executes a function `fn` after the next browser animation frame. This is useful for performing UI updates that should happen soon after the current paint cycle is complete, ensuring visual consistency, but are not urgent enough that they need to run immediately.

```javascript
import { performAsyncUiUpdate } from './aem-cwv-helper.js';

function updateNotificationBadge() {
  const badge = document.getElementById('notification-badge');
  badge.textContent = 'New!';
  console.log('Notification badge updated.');
}

performAsyncUiUpdate(updateNotificationBadge); // Update badge after next paint
```

### `readCostlyDomValue(fn)`

An alias for `performAsyncUiUpdate`. Use this function when you need to read a costly DOM value (like `offsetWidth`, `offsetHeight`, etc.) that can potentially cause layout thrashing. Performing these reads asynchronously after the next paint can help mitigate layout thrashing issues.

```javascript
import { readCostlyDomValue } from './aem-cwv-helper.js';

async function adjustElementPosition() {
  const element = document.getElementById('my-element');
  let elementWidth;

  await readCostlyDomValue(() => { // Read width asynchronously
    elementWidth = element.offsetWidth;
  });

  // Now use elementWidth without causing immediate layout
  element.style.left = `${elementWidth / 2}px`;
  console.log(`Element width read and position adjusted.`);
}

adjustElementPosition();
```

### `splitLongIteration(items, fn, limit = 48)`

Iterates over an array of `items` and applies the function `fn` to each item. It intelligently yields to the main thread periodically within the loop to prevent long tasks, using a time-based limit (`limit` in milliseconds, defaults to 48ms) to determine when to yield.

```javascript
import { splitLongIteration } from './aem-cwv-helper.js';

const productList = [...Array(500).keys()]; // Example list of products

async function renderProduct(productId) {
  // ... logic to render a single product in the UI ...
  console.log(`Rendering product ${productId}`);
}

async function renderAllProducts() {
  await splitLongIteration(productList, renderProduct);
  console.log('All products rendered.');
}

renderAllProducts();
```

### `removeDomNode(el)`

Removes a DOM element `el` in a way that minimizes layout thrashing. It first hides the node, and then defers the actual removal to avoid blocking the current animation frame.

```javascript
import { removeDomNode } from './aem-cwv-helper.js';

const elementToRemove = document.getElementById('old-element');

removeDomNode(elementToRemove).then(() => {
  console.log('Element removed.');
});
```

### `patchDatalayer(dl)`

Patches the `push` method of a data layer object (typically `window.dataLayer`) to automatically break up long tasks triggered by dataLayer events. This is useful for improving performance when using tag managers and data layers that might push events that trigger heavy processing.

```javascript
import { patchDatalayer } from './aem-cwv-helper.js';

if (window.dataLayer) {
  patchDatalayer(window.dataLayer);

  // Now, any dataLayer.push calls will automatically yield to the main thread
  window.dataLayer.push({ event: 'userInteraction', action: 'click' });
}
```

### `patchEventListeners(types = ['load', 'domcontentloaded', 'click'], pattern)`

Patches `window.addEventListener` and `document.addEventListener` to wrap event listeners for specified event `types` (defaults to `load`, `domcontentloaded` and `click`).  If the event listener is likely added by an external library (a martech library likely to bloat the main thread) or by a 1st party library that matches the specified `pattern`, it proxies the listener to yield to the main thread before executing the original listener. This helps to break up long tasks triggered by event handlers, especially from third-party scripts, so you can prioritize UI updates from your project code.

```javascript
import { patchEventListeners } from './aem-cwv-helper.js';

patchEventListeners(); // Patch 'click' and 'domcontentloaded' event listeners (default)
// or
patchEventListeners(['click', 'touchstart', 'scroll']); // Patch specific event types

document.addEventListener('click', () => {
  console.log('Click event listener executed (potentially yielded).');
});
```
