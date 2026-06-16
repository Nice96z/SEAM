/**
 * @fileoverview SeamCore — Event-Driven Modular Graph Engine
 *
 * SeamCore manages a non-Euclidean graph of nodes via two primitive operations:
 *   - **Stitch**: Connect two nodes (directed edge)
 *   - **Sever**: Disconnect two nodes
 *
 * All game mechanics (physics, win conditions, visuals) live in **Modules** that
 * subscribe to core events. SeamCore itself has zero gameplay knowledge.
 *
 * @example
 * // Bootstrap
 * const engine = new SeamCore();
 * engine.use(new LoggerModule());
 * engine.use(new CollisionModule());
 *
 * engine.addNode('room_a', { label: 'Entry Hall' });
 * engine.addNode('room_b', { label: 'Vault' });
 * engine.stitch('room_a', 'room_b');
 *
 * @module SeamCore
 * @version 1.0.0
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// EventEmitter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A lightweight, typed EventEmitter that forms the communication backbone of
 * SeamCore. Intentionally kept separate from SeamCore so it can be extracted
 * or replaced independently.
 *
 * @template {string} EventName
 */
class EventEmitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Register a listener for a named event.
   * Returns an unsubscribe function for easy cleanup inside modules.
   *
   * @param {string}   event    - The event name to listen to.
   * @param {Function} listener - Callback invoked with the event context object.
   * @returns {Function} Unsubscribe — call it to remove this listener.
   *
   * @example
   * const off = emitter.on('after_stitch', (ctx) => console.log(ctx));
   * // Later:
   * off(); // Removes just this listener.
   */
  on(event, listener) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }

  /**
   * Register a one-time listener. Automatically removed after first invocation.
   *
   * @param {string}   event
   * @param {Function} listener
   * @returns {Function} Unsubscribe.
   */
  once(event, listener) {
    const wrapper = (ctx) => {
      listener(ctx);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove a specific listener from an event.
   *
   * @param {string}   event
   * @param {Function} listener
   */
  off(event, listener) {
    this._listeners.get(event)?.delete(listener);
  }

  /**
   * Emit an event, invoking all registered listeners synchronously in
   * registration order. The same `ctx` object is passed to every listener,
   * allowing earlier listeners to mutate state that later ones can read.
   *
   * @param {string} event - The event name.
   * @param {object} ctx   - The mutable context object passed to all listeners.
   * @returns {object} The (potentially mutated) ctx object.
   */
  emit(event, ctx) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        listener(ctx);
      }
    }
    return ctx;
  }

  /**
   * Remove all listeners for a given event, or all listeners entirely.
   *
   * @param {string} [event] - If omitted, clears everything.
   */
  clear(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Factories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} StitchContext
 * @property {string}      fromId      - ID of the origin node.
 * @property {string}      toId        - ID of the target node.
 * @property {SeamNode}    from        - The origin SeamNode instance.
 * @property {SeamNode}    to          - The target SeamNode instance.
 * @property {object}      meta        - Arbitrary metadata modules may attach.
 * @property {boolean}     cancelled   - If true, the operation will be aborted.
 * @property {string|null} cancelReason - Human-readable reason for cancellation.
 * @property {Function}    cancel      - Call this to abort the operation.
 */

/**
 * @typedef {object} SeverContext
 * @property {string}      fromId
 * @property {string}      toId
 * @property {SeamNode}    from
 * @property {SeamNode}    to
 * @property {object}      meta
 * @property {boolean}     cancelled
 * @property {string|null} cancelReason
 * @property {Function}    cancel
 */

/**
 * @typedef {object} RippleContext
 * @property {string}   originId  - The node ID where the ripple started.
 * @property {string}   nodeId    - The node ID currently receiving the ripple.
 * @property {SeamNode} node      - The SeamNode instance receiving the ripple.
 * @property {any}      payload   - Arbitrary data carried by the ripple.
 * @property {Set<string>} visited - Node IDs already visited (prevents cycles).
 * @property {number}   depth     - How many hops from origin (0 = origin itself).
 */

/**
 * Create a cancellable event context shared across all `before_*` listeners.
 *
 * @param {object} base - Base properties to merge in.
 * @returns {StitchContext|SeverContext}
 * @private
 */
function _makeCancellableCtx(base) {
  const ctx = {
    ...base,
    meta: {},
    cancelled: false,
    cancelReason: null,
  };
  ctx.cancel = (reason = 'Cancelled by module') => {
    ctx.cancelled = true;
    ctx.cancelReason = reason;
  };
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// SeamNode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single node in the SEAM graph.
 * Stores its own outgoing edge set and arbitrary user data.
 *
 * Nodes are created by `SeamCore.addNode()` — do not construct directly.
 *
 * @class
 */
class SeamNode {
  /**
   * @param {string} id   - Unique identifier for this node.
   * @param {object} data - Arbitrary data payload (position, type, etc.).
   */
  constructor(id, data = {}) {
    /** @type {string} */
    this.id = id;

    /** @type {object} User-defined data attached to this node. */
    this.data = data;

    /**
     * Outgoing edges: Set of target node IDs this node is stitched to.
     * @type {Set<string>}
     */
    this.edges = new Set();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SeamCore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The central engine of the SEAM architecture.
 *
 * Responsibilities:
 *   1. Maintain a `Map<id, SeamNode>` graph with O(1) node lookups.
 *   2. Expose `stitch()` and `sever()` as the only topology-mutating operations.
 *   3. Fire a lifecycle of events around each operation, allowing modules to
 *      observe, augment, or cancel them.
 *   4. Propagate `ripple()` signals through the graph, respecting visited nodes.
 *
 * SeamCore does **not** know about physics, rendering, scores, or any other
 * game concern. All of that lives in Modules.
 *
 * @class
 *
 * @example
 * const engine = new SeamCore();
 *
 * // Register a module
 * engine.use(new MyModule());
 *
 * // Build the graph
 * engine.addNode('a', { weight: 1 });
 * engine.addNode('b', { weight: 2 });
 * engine.stitch('a', 'b');
 *
 * // Send a signal through the graph
 * engine.ripple('a', { type: 'ACTIVATE', value: 42 });
 */
class SeamCore {
  constructor() {
    /**
     * The node registry. Use `addNode` / `removeNode` to mutate.
     * @type {Map<string, SeamNode>}
     */
    this.nodes = new Map();

    /**
     * Internal event bus. Access via `engine.on()`, not directly.
     * @type {EventEmitter}
     * @private
     */
    this._emitter = new EventEmitter();

    /**
     * Registered modules, in registration order.
     * @type {SeamModule[]}
     * @private
     */
    this._modules = [];
  }

  // ── Module Registration ────────────────────────────────────────────────────

  /**
   * Register a module (plugin) with the engine.
   *
   * The module's `install(engine)` method is called immediately, giving it a
   * chance to subscribe to events, extend the API, or initialize state.
   *
   * Modules are stored internally to enable future `unuse()` support.
   *
   * @param {SeamModule} module - An instance of a class extending `SeamModule`.
   * @returns {SeamCore} `this`, for chaining: `engine.use(A).use(B)`.
   * @throws {TypeError} If the argument is not a valid SeamModule.
   *
   * @example
   * engine.use(new LoggerModule()).use(new PhysicsModule({ gravity: 9.8 }));
   */
  use(module) {
    if (typeof module?.install !== 'function') {
      throw new TypeError(
        `SeamCore.use() expects a SeamModule with an install(engine) method. ` +
        `Got: ${Object.prototype.toString.call(module)}`
      );
    }
    this._modules.push(module);
    module.install(this);
    return this;
  }

  // ── Event Bus Passthrough ─────────────────────────────────────────────────

  /**
   * Subscribe to a SeamCore lifecycle event.
   *
   * Available events:
   * | Event            | When                              | Cancellable |
   * |------------------|-----------------------------------|-------------|
   * | `before_stitch`  | Before two nodes are connected    | ✅          |
   * | `after_stitch`   | After two nodes are connected     | ❌          |
   * | `before_sever`   | Before an edge is removed         | ✅          |
   * | `after_sever`    | After an edge is removed          | ❌          |
   * | `ripple_arrival` | When a ripple reaches a node      | ❌          |
   *
   * @param {string}   event    - One of the lifecycle event names above.
   * @param {Function} listener - Called with the event's context object.
   * @returns {Function} Unsubscribe function.
   */
  on(event, listener) {
    return this._emitter.on(event, listener);
  }

  /**
   * Subscribe to an event once. The listener is removed after first invocation.
   *
   * @param {string}   event
   * @param {Function} listener
   * @returns {Function} Unsubscribe function.
   */
  once(event, listener) {
    return this._emitter.once(event, listener);
  }

  // ── Graph Management ───────────────────────────────────────────────────────

  /**
   * Add a new node to the graph.
   *
   * @param {string} id   - A unique string identifier for this node.
   * @param {object} data - Arbitrary data to attach (position, type, etc.).
   * @returns {SeamNode} The created node.
   * @throws {Error} If a node with that ID already exists.
   *
   * @example
   * const node = engine.addNode('portal_1', { label: 'North Portal', active: true });
   */
  addNode(id, data = {}) {
    if (this.nodes.has(id)) {
      throw new Error(`SeamCore: Node "${id}" already exists.`);
    }
    const node = new SeamNode(id, data);
    this.nodes.set(id, node);
    return node;
  }

  /**
   * Retrieve a node by ID.
   *
   * @param {string} id
   * @returns {SeamNode|undefined}
   */
  getNode(id) {
    return this.nodes.get(id);
  }

  /**
   * Remove a node and all edges leading to or from it.
   * Silently severs every connected edge (no events fired per edge — use
   * `sever()` manually first if you need those events).
   *
   * @param {string} id - The node ID to remove.
   * @returns {boolean} `true` if the node existed and was removed.
   */
  removeNode(id) {
    if (!this.nodes.has(id)) return false;

    // Remove all outgoing edges from this node
    this.nodes.delete(id);

    // Remove all incoming edges pointing to this node from other nodes
    for (const node of this.nodes.values()) {
      node.edges.delete(id);
    }

    return true;
  }

  // ── Core Operations ────────────────────────────────────────────────────────

  /**
   * **Stitch** — Create a directed edge from `fromId` to `toId`.
   *
   * Lifecycle:
   *   1. Emit `before_stitch` (cancellable).
   *   2. If not cancelled, add the edge.
   *   3. Emit `after_stitch`.
   *
   * @param {string} fromId - Origin node ID.
   * @param {string} toId   - Target node ID.
   * @returns {{ success: boolean, reason?: string }} Result object.
   *
   * @example
   * engine.stitch('hub', 'sector_7');
   * // { success: true }
   *
   * @example
   * // A module's before_stitch handler calls ctx.cancel('Too far apart')
   * engine.stitch('a', 'z');
   * // { success: false, reason: 'Too far apart' }
   */
  stitch(fromId, toId) {
    const from = this._requireNode(fromId);
    const to   = this._requireNode(toId);

    const ctx = _makeCancellableCtx({ fromId, toId, from, to });
    this._emitter.emit('before_stitch', ctx);

    if (ctx.cancelled) {
      return { success: false, reason: ctx.cancelReason };
    }

    from.edges.add(toId);
    this._emitter.emit('after_stitch', { fromId, toId, from, to, meta: ctx.meta });

    return { success: true };
  }

  /**
   * **Sever** — Remove the directed edge from `fromId` to `toId`.
   *
   * Lifecycle:
   *   1. Emit `before_sever` (cancellable).
   *   2. If not cancelled, remove the edge.
   *   3. Emit `after_sever`.
   *
   * @param {string} fromId - Origin node ID.
   * @param {string} toId   - Target node ID.
   * @returns {{ success: boolean, reason?: string }}
   *
   * @example
   * engine.sever('hub', 'sector_7');
   */
  sever(fromId, toId) {
    const from = this._requireNode(fromId);
    const to   = this._requireNode(toId);

    const ctx = _makeCancellableCtx({ fromId, toId, from, to });
    this._emitter.emit('before_sever', ctx);

    if (ctx.cancelled) {
      return { success: false, reason: ctx.cancelReason };
    }

    from.edges.delete(toId);
    this._emitter.emit('after_sever', { fromId, toId, from, to, meta: ctx.meta });

    return { success: true };
  }

  /**
   * **Ripple** — Propagate a payload through the graph via BFS from `originId`.
   *
   * Fires `ripple_arrival` for every reachable node (including the origin).
   * The built-in `visited` set in the context prevents infinite loops in
   * cyclic graphs without any module needing to track this themselves.
   *
   * @param {string} originId - The node ID to start propagation from.
   * @param {any}    payload  - Arbitrary data carried by the ripple (event type,
   *                            damage value, signal, etc.).
   *
   * @example
   * engine.ripple('reactor_core', { type: 'EXPLODE', radius: 50 });
   */
  ripple(originId, payload) {
    this._requireNode(originId);

    const visited = new Set();
    const queue   = [{ nodeId: originId, depth: 0 }];

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift();

      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) continue;

      /** @type {RippleContext} */
      const ctx = { originId, nodeId, node, payload, visited, depth };
      this._emitter.emit('ripple_arrival', ctx);

      for (const neighborId of node.edges) {
        if (!visited.has(neighborId)) {
          queue.push({ nodeId: neighborId, depth: depth + 1 });
        }
      }
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  /**
   * Return a plain-object snapshot of the current graph topology.
   * Useful for serialization, debugging, or sending to a renderer.
   *
   * @returns {{ nodes: object[], edges: object[] }}
   */
  snapshot() {
    const nodes = [];
    const edges = [];

    for (const node of this.nodes.values()) {
      nodes.push({ id: node.id, data: node.data });
      for (const toId of node.edges) {
        edges.push({ from: node.id, to: toId });
      }
    }

    return { nodes, edges };
  }

  /**
   * Retrieve a node or throw a descriptive error.
   *
   * @param {string} id
   * @returns {SeamNode}
   * @private
   */
  _requireNode(id) {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`SeamCore: Node "${id}" does not exist. Call addNode() first.`);
    }
    return node;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SeamModule (Base Class)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base class for all SeamCore modules.
 *
 * Modules are the **only** place gameplay logic should live. SeamCore calls
 * `install(engine)` once at registration time. Inside `install`, subscribe to
 * events and store the unsubscribe functions in `this._unsubs` so that
 * `destroy()` can cleanly remove every listener when the module is torn down.
 *
 * @abstract
 *
 * @example
 * class MyModule extends SeamModule {
 *   install(engine) {
 *     this._unsubs.push(
 *       engine.on('after_stitch', (ctx) => {
 *         console.log(`Edge created: ${ctx.fromId} → ${ctx.toId}`);
 *       })
 *     );
 *   }
 * }
 */
class SeamModule {
  constructor() {
    /**
     * Collect unsubscribe functions returned by `engine.on()`.
     * `destroy()` calls them all automatically.
     * @type {Function[]}
     * @protected
     */
    this._unsubs = [];
  }

  /**
   * Called once by `engine.use(module)`. Override to subscribe to events.
   *
   * @param {SeamCore} engine - The engine instance being installed into.
   * @abstract
   */
  // eslint-disable-next-line no-unused-vars
  install(engine) {
    throw new Error(`${this.constructor.name} must implement install(engine).`);
  }

  /**
   * Unsubscribe all listeners registered in `install()`.
   * Call this when removing a module at runtime.
   */
  destroy() {
    for (const off of this._unsubs) off();
    this._unsubs = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── EXAMPLE MODULES ──────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Example Module 1: LoggerModule
 *
 * A zero-dependency observer that logs every topology change to the console.
 * A good starting point for debugging and for understanding the event lifecycle.
 *
 * @extends SeamModule
 *
 * @example
 * engine.use(new LoggerModule({ prefix: '[SEAM]' }));
 */
class LoggerModule extends SeamModule {
  /**
   * @param {object} [options]
   * @param {string} [options.prefix='[SeamCore]'] - Log prefix.
   */
  constructor({ prefix = '[SeamCore]' } = {}) {
    super();
    this.prefix = prefix;
  }

  /** @param {SeamCore} engine */
  install(engine) {
    const p = this.prefix;

    this._unsubs.push(
      engine.on('before_stitch', ({ fromId, toId }) =>
        console.log(`${p} before_stitch  ${fromId} ──▶ ${toId}`)
      ),
      engine.on('after_stitch', ({ fromId, toId }) =>
        console.log(`${p} after_stitch   ${fromId} ══▶ ${toId}  ✓`)
      ),
      engine.on('before_sever', ({ fromId, toId }) =>
        console.log(`${p} before_sever   ${fromId} ──✕ ${toId}`)
      ),
      engine.on('after_sever', ({ fromId, toId }) =>
        console.log(`${p} after_sever    ${fromId} ╌╌✕ ${toId}  ✓`)
      ),
      engine.on('ripple_arrival', ({ nodeId, depth, payload }) =>
        console.log(`${p} ripple_arrival  depth=${depth}  node="${nodeId}"`, payload)
      ),
    );
  }
}

/**
 * Example Module 2: MaxEdgesGuard
 *
 * Cancels any `stitch` that would cause a node to exceed a maximum
 * out-degree. Demonstrates how to use `ctx.cancel()` to block operations.
 *
 * @extends SeamModule
 *
 * @example
 * // No node may have more than 3 outgoing connections:
 * engine.use(new MaxEdgesGuard({ maxOut: 3 }));
 */
class MaxEdgesGuard extends SeamModule {
  /**
   * @param {object} options
   * @param {number} options.maxOut - Maximum allowed outgoing edges per node.
   */
  constructor({ maxOut = 4 } = {}) {
    super();
    this.maxOut = maxOut;
  }

  /** @param {SeamCore} engine */
  install(engine) {
    this._unsubs.push(
      engine.on('before_stitch', (ctx) => {
        if (ctx.from.edges.size >= this.maxOut) {
          ctx.cancel(
            `MaxEdgesGuard: "${ctx.fromId}" already has ${this.maxOut} outgoing edges.`
          );
        }
      })
    );
  }
}

/**
 * Example Module 3: RippleActivator
 *
 * Listens for ripples carrying `{ type: 'ACTIVATE' }` and sets a flag on the
 * receiving node's data. Demonstrates how modules react to ripple propagation.
 *
 * @extends SeamModule
 *
 * @example
 * engine.use(new RippleActivator());
 * engine.ripple('switch_1', { type: 'ACTIVATE', source: 'player' });
 * // All nodes reachable from 'switch_1' will have node.data.active === true
 */
class RippleActivator extends SeamModule {
  /** @param {SeamCore} engine */
  install(engine) {
    this._unsubs.push(
      engine.on('ripple_arrival', (ctx) => {
        if (ctx.payload?.type === 'ACTIVATE') {
          ctx.node.data.active = true;
          ctx.node.data.activatedBy = ctx.payload.source ?? ctx.originId;
          ctx.node.data.activationDepth = ctx.depth;
        }
      })
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── DEMO ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a self-contained demonstration of the SEAM engine.
 * Execute this file directly with `node SeamCore.js` to see the output.
 */
function runDemo() {
  console.log('\n══════════════════════════════════════════');
  console.log('  SeamCore Demo');
  console.log('══════════════════════════════════════════\n');

  // 1. Bootstrap engine with modules (order matters: Logger should be first
  //    so it catches every event before other modules potentially cancel them)
  const engine = new SeamCore();
  engine
    .use(new LoggerModule({ prefix: '  📡' }))
    .use(new MaxEdgesGuard({ maxOut: 2 }))
    .use(new RippleActivator());

  console.log('\n── Building Graph ─────────────────────────\n');

  // 2. Build the graph
  engine.addNode('hub',      { label: 'Central Hub' });
  engine.addNode('sector_a', { label: 'Sector A' });
  engine.addNode('sector_b', { label: 'Sector B' });
  engine.addNode('deep',     { label: 'Deep Node' });

  // 3. Stitch (MaxEdgesGuard allows up to 2 out-edges from 'hub')
  console.log('\n── Stitching Nodes ────────────────────────\n');
  engine.stitch('hub', 'sector_a');              // ✅ 1st edge
  engine.stitch('hub', 'sector_b');              // ✅ 2nd edge
  engine.stitch('sector_a', 'deep');             // ✅ different origin

  console.log('\n── Attempting Blocked Stitch ──────────────\n');
  const blocked = engine.stitch('hub', 'deep');  // ❌ hub already at maxOut=2
  console.log('  Result:', blocked);

  // 4. Ripple an ACTIVATE signal from hub
  console.log('\n── Ripple: ACTIVATE ───────────────────────\n');
  engine.ripple('hub', { type: 'ACTIVATE', source: 'player_input' });

  // 5. Inspect what RippleActivator wrote into node data
  console.log('\n── Node State After Ripple ────────────────\n');
  for (const [id, node] of engine.nodes) {
    console.log(`  ${id}:`, node.data);
  }

  // 6. Sever and inspect snapshot
  console.log('\n── Sever & Snapshot ───────────────────────\n');
  engine.sever('hub', 'sector_b');
  console.log('\n  Graph snapshot:', JSON.stringify(engine.snapshot(), null, 2));
}

runDemo();

// ─────────────────────────────────────────────────────────────────────────────
// Exports (ESM-compatible; also readable as a plain script)
// ─────────────────────────────────────────────────────────────────────────────
export { SeamCore, SeamModule, SeamNode, EventEmitter };
export { LoggerModule, MaxEdgesGuard, RippleActivator };
