# SEAM — Developer's Rulebook

*The Developer's Bible. Read this before you write a single line against the SEAM API.*

---

## Table of Contents

1. [The Golden Rule](#1-the-golden-rule)
2. [API Reference: SeamCore](#2-api-reference-seamcore)
3. [API Reference: Event Hooks](#3-api-reference-event-hooks)
4. [API Reference: SeamModule](#4-api-reference-seammodule)
5. [API Reference: SeamNode](#5-api-reference-seamnode)
6. [Writing Your First Module](#6-writing-your-first-module)
7. [Contribution Workflow](#7-contribution-workflow)
8. [Versioning & Stability Guarantees](#8-versioning--stability-guarantees)

---

## 1. The Golden Rule

> **Never modify `src/SeamCore.js` to add gameplay logic.**

`SeamCore.js` is a sealed unit. It manages graph topology and event dispatch. That is all it will ever do. Any pull request that adds a gameplay concept — collision, scoring, physics, pathfinding, win states, player data — to `SeamCore.js` will be closed without review.

If you find yourself wanting to add logic to core, you are one step away from the correct solution: write a Module.

### The Corollaries

- **Corollary 1:** The surface area of `SeamCore`'s public API is fixed at: `use()`, `on()`, `once()`, `addNode()`, `getNode()`, `removeNode()`, `stitch()`, `sever()`, `ripple()`, `snapshot()`. No new public methods will be added without a major version increment.
- **Corollary 2:** Modules must not access `engine._emitter`, `engine._modules`, or any other `_`-prefixed property. These are internal implementation details with no stability guarantee.
- **Corollary 3:** Modules must not call each other directly. They communicate through the event `ctx.meta` object or through shared engine state only.

---

## 2. API Reference: SeamCore

### `new SeamCore()`

Creates a new engine instance. Multiple instances can coexist in the same application with zero interference.

---

### `engine.use(module) → SeamCore`

Registers a Module with the engine. Calls `module.install(engine)` immediately.

Returns `this` for chaining:
```js
engine.use(new LoggerModule()).use(new PhysicsModule()).use(new RendererModule());
```

**Throws** `TypeError` if the argument does not implement `install(engine)`.

---

### `engine.on(event, listener) → Function`

Subscribes a listener to a lifecycle event. Returns an **unsubscribe function** — call it to remove the listener.

```js
const off = engine.on('after_stitch', (ctx) => console.log(ctx));
// Later:
off(); // Listener is removed.
```

---

### `engine.once(event, listener) → Function`

Like `on()`, but the listener fires only once and is then automatically removed.

---

### `engine.addNode(id, data?) → SeamNode`

Adds a node to the graph.

| Parameter | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier. Throws if already exists. |
| `data` | `object` | Arbitrary payload attached to the node. Default: `{}`. |

```js
engine.addNode('junction_4', { type: 'conductor', maxLoad: 100 });
```

---

### `engine.getNode(id) → SeamNode | undefined`

Returns the node with the given ID, or `undefined` if not found. Does not throw.

---

### `engine.removeNode(id) → boolean`

Removes a node and all edges pointing to or from it. Returns `true` if the node existed.

> ⚠️ Does **not** fire `before_sever` or `after_sever` for the removed edges. If you need those events, call `engine.sever()` manually for each edge before removing the node.

---

### `engine.stitch(fromId, toId) → Result`

Creates a directed edge from `fromId` to `toId`.

**Returns** `{ success: true }` on completion, or `{ success: false, reason: string }` if any listener cancelled the operation.

**Fires:** `before_stitch` → *(mutation)* → `after_stitch`

**Throws** `Error` if either node ID does not exist.

---

### `engine.sever(fromId, toId) → Result`

Removes the directed edge from `fromId` to `toId`.

**Returns** `{ success: true }` or `{ success: false, reason: string }`.

**Fires:** `before_sever` → *(mutation)* → `after_sever`

**Throws** `Error` if either node ID does not exist.

---

### `engine.ripple(originId, payload) → void`

Propagates `payload` through the graph via BFS starting from `originId`. Fires `ripple_arrival` at every reachable node (including the origin).

**Throws** `Error` if `originId` does not exist.

```js
engine.ripple('epicenter', { type: 'SHOCKWAVE', damage: 25, radius: 3 });
```

---

### `engine.snapshot() → { nodes: object[], edges: object[] }`

Returns a plain, JSON-serializable representation of the current graph topology.

```js
const state = engine.snapshot();
localStorage.setItem('graph', JSON.stringify(state));
```

---

## 3. API Reference: Event Hooks

All events are fired synchronously. Listeners are called in **registration order** (the order `engine.use()` was called).

---

### `before_stitch`

**Fired:** Before `engine.stitch()` mutates the graph.
**Cancellable:** ✅ Yes — call `ctx.cancel(reason)` to abort.

| Property | Type | Description |
|---|---|---|
| `ctx.fromId` | `string` | Origin node ID |
| `ctx.toId` | `string` | Target node ID |
| `ctx.from` | `SeamNode` | Origin node instance |
| `ctx.to` | `SeamNode` | Target node instance |
| `ctx.meta` | `object` | Shared mutable scratchpad for inter-module communication |
| `ctx.cancelled` | `boolean` | Whether the operation has been cancelled |
| `ctx.cancelReason` | `string\|null` | Reason string from the cancelling module |
| `ctx.cancel(reason)` | `Function` | Call to abort this stitch |

```js
engine.on('before_stitch', (ctx) => {
  if (ctx.from.data.locked) {
    ctx.cancel(`Node "${ctx.fromId}" is locked.`);
  }
});
```

---

### `after_stitch`

**Fired:** After `engine.stitch()` has successfully added the edge.
**Cancellable:** ❌ No — the mutation has already occurred.

| Property | Type | Description |
|---|---|---|
| `ctx.fromId` | `string` | Origin node ID |
| `ctx.toId` | `string` | Target node ID |
| `ctx.from` | `SeamNode` | Origin node instance |
| `ctx.to` | `SeamNode` | Target node instance |
| `ctx.meta` | `object` | The same `meta` object from `before_stitch` |

```js
engine.on('after_stitch', (ctx) => {
  audioModule.play('wire_connect.wav');
  renderer.drawEdge(ctx.from, ctx.to);
});
```

---

### `before_sever`

**Fired:** Before `engine.sever()` removes an edge.
**Cancellable:** ✅ Yes — call `ctx.cancel(reason)` to abort.

Same context shape as `before_stitch`.

```js
engine.on('before_sever', (ctx) => {
  if (ctx.from.data.permanentLink) {
    ctx.cancel('This connection cannot be severed.');
  }
});
```

---

### `after_sever`

**Fired:** After `engine.sever()` has successfully removed the edge.
**Cancellable:** ❌ No.

Same context shape as `after_stitch`.

---

### `ripple_arrival`

**Fired:** Once per node during a `engine.ripple()` BFS traversal.
**Cancellable:** ❌ No — but you can manipulate `ctx.visited` to alter further traversal.

| Property | Type | Description |
|---|---|---|
| `ctx.originId` | `string` | The ID of the node where ripple started |
| `ctx.nodeId` | `string` | The ID of the node currently being visited |
| `ctx.node` | `SeamNode` | The node instance being visited |
| `ctx.payload` | `any` | The payload passed to `engine.ripple()` |
| `ctx.visited` | `Set<string>` | All node IDs visited so far (including this one) |
| `ctx.depth` | `number` | BFS depth from origin (origin = 0) |

```js
engine.on('ripple_arrival', (ctx) => {
  if (ctx.payload?.type === 'DAMAGE') {
    const falloff = 1 / (ctx.depth + 1);
    ctx.node.data.health -= ctx.payload.amount * falloff;
  }
});
```

---

## 4. API Reference: SeamModule

All Modules extend `SeamModule`. The base class provides:

### `this._unsubs: Function[]`

An array to collect unsubscribe functions returned by `engine.on()`. The base `destroy()` method iterates this array and calls each function.

**Always push your unsubscribes here:**

```js
install(engine) {
  this._unsubs.push(
    engine.on('after_stitch', this._handler.bind(this))
  );
}
```

### `module.install(engine): void` — **Abstract**

Called once by `engine.use()`. Override this to subscribe to events. Calling `super.install()` will throw — this method is intentionally abstract.

### `module.destroy(): void`

Calls all collected unsubscribe functions and clears `this._unsubs`. Safe to call multiple times. Call this when removing a module at runtime.

---

## 5. API Reference: SeamNode

Nodes are created by `engine.addNode()` and should not be constructed directly.

| Property | Type | Description |
|---|---|---|
| `node.id` | `string` | Unique identifier. Read-only. |
| `node.data` | `object` | User-defined payload. Read/write freely. |
| `node.edges` | `Set<string>` | Outgoing edge target IDs. Do not mutate directly — use `engine.stitch()` / `engine.sever()`. |

> ⚠️ Mutating `node.edges` directly bypasses the event system entirely. The `before_*` and `after_*` events will not fire. Only do this if you have a specific reason and know exactly what you are doing.

---

## 6. Writing Your First Module

A complete annotated example of a well-formed Module:

```js
import { SeamModule } from '../src/SeamCore.js';

/**
 * RateLimiterModule
 *
 * Prevents any single node from forming more than `maxOpsPerSecond`
 * new stitch OR sever operations per second. Useful for preventing
 * player spam mechanics from causing graph explosions.
 *
 * @extends SeamModule
 *
 * @example
 * engine.use(new RateLimiterModule({ maxOpsPerSecond: 3 }));
 */
class RateLimiterModule extends SeamModule {
  /**
   * @param {object} options
   * @param {number} options.maxOpsPerSecond - Max operations per node per second.
   */
  constructor({ maxOpsPerSecond = 5 } = {}) {
    super();
    // Store config on the instance, not on the engine.
    this.maxOps = maxOpsPerSecond;
    // Module-private state: tracks op timestamps per node ID.
    this._opLog = new Map(); // nodeId → number[] (timestamps)
  }

  /** @param {import('../src/SeamCore.js').SeamCore} engine */
  install(engine) {
    // Use bind or arrow functions so `this` is correct inside handlers.
    // Push the unsubscribe function into this._unsubs for clean teardown.
    this._unsubs.push(
      engine.on('before_stitch', (ctx) => this._checkRate(ctx)),
      engine.on('before_sever',  (ctx) => this._checkRate(ctx))
    );
  }

  /**
   * Shared handler for both before_stitch and before_sever.
   * @param {import('../src/SeamCore.js').StitchContext} ctx
   * @private
   */
  _checkRate(ctx) {
    const now = Date.now();
    const window = 1000; // 1 second rolling window
    const id = ctx.fromId;

    // Get or initialise the log for this node.
    if (!this._opLog.has(id)) this._opLog.set(id, []);
    const log = this._opLog.get(id);

    // Prune timestamps outside the window.
    while (log.length > 0 && now - log[0] > window) log.shift();

    if (log.length >= this.maxOps) {
      ctx.cancel(`RateLimiterModule: Node "${id}" has exceeded ${this.maxOps} ops/sec.`);
      return;
    }

    // Record this operation.
    log.push(now);

    // Optionally communicate to other modules via meta.
    ctx.meta.opsThisSecond = log.length;
  }

  /** Cleans up listeners AND clears internal state. */
  destroy() {
    super.destroy(); // Calls all unsubscribes from this._unsubs
    this._opLog.clear();
  }
}

export { RateLimiterModule };
```

---

## 7. Contribution Workflow

### Branch Naming

| Type | Pattern | Example |
|---|---|---|
| New Module | `module/<name>` | `module/weighted-edges` |
| Visualizer | `viz/<name>` | `viz/d3-force-graph` |
| Core Bug Fix | `fix/<issue-number>` | `fix/42` |
| Documentation | `docs/<topic>` | `docs/ripple-api` |

> ⚠️ Branches named `core/*` will be scrutinised heavily. Contributions to `SeamCore.js` are rarely accepted.

### Pull Request Checklist

Before opening a PR, confirm all of the following:

- [ ] My Module extends `SeamModule` and implements `install(engine)`.
- [ ] All `engine.on()` calls are inside `install()` and their return values are pushed to `this._unsubs`.
- [ ] My Module does not import any other Module.
- [ ] My Module does not access `engine._`-prefixed properties.
- [ ] My Module does not call `engine.stitch()` / `engine.sever()` from inside a `ripple_arrival` listener.
- [ ] I have added JSDoc to my class, constructor, and public methods.
- [ ] I have tested my Module in isolation using a minimal engine instance.
- [ ] If my Module is a Visualizer, it only subscribes to `after_stitch`, `after_sever`, and `ripple_arrival`, and never calls topology-mutating methods.
- [ ] I have added my Module to the relevant section of `README.md`'s "Coming Soon" list (or moved it out of that list if it previously existed).

### Commit Style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(module): add WeightedEdgeModule with cost-based cancellation
fix(core): correct ripple BFS depth counter off-by-one
docs(rulebook): add rate limiter example to module writing guide
viz(demo): add D3 force-directed graph visualizer
```

---

## 8. Versioning & Stability Guarantees

SEAM follows [Semantic Versioning](https://semver.org/).

| Version Bump | Trigger |
|---|---|
| **Patch** (1.0.x) | Bug fixes, documentation corrections, typos |
| **Minor** (1.x.0) | New public methods on SeamCore, new event types, new built-in Modules |
| **Major** (x.0.0) | Changes to existing event context shapes, removal of public methods, rename of events |

### Stability Tiers

| Component | Stability | What This Means |
|---|---|---|
| `SeamCore` public API | **Stable** | No breaking changes without a major version |
| Event context shapes | **Stable** | Fields won't be removed; new fields may be added in minor versions |
| `SeamModule` base class | **Stable** | `install()`, `destroy()`, `_unsubs` contract is permanent |
| `SeamNode` properties | **Stable** | `id`, `data`, `edges` are permanent |
| `engine._emitter` | **Internal** | No stability guarantee. May change or be removed. |
| Demo code | **Experimental** | Not API; may be refactored freely |

---

*End of Rulebook.*
*For architecture philosophy, see [GDD.md](./GDD.md).*
*For getting started, see [README.md](./README.md).*
