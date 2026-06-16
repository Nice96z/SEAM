/**
 * @file examples/minimal_setup.js
 *
 * SEAM Engine — Minimal Setup Example
 * ─────────────────────────────────────────────────────────────────────────────
 * This file is the "Hello World" of the SEAM engine. It demonstrates:
 *
 *   1. Creating a SeamCore instance
 *   2. Writing a Module from scratch (StitchTrackerModule)
 *   3. Registering it with the engine
 *   4. Building a graph and observing the events fire
 *   5. Using ctx.cancel() to block an unwanted operation
 *   6. Sending a ripple through the graph
 *
 * Run this file with:
 *   node examples/minimal_setup.js
 *
 * No build step. No dependencies. Pure ES6.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { SeamCore, SeamModule } from '../src/SeamCore.js';

// ═════════════════════════════════════════════════════════════════════════════
// STEP 1: Create the engine
// ═════════════════════════════════════════════════════════════════════════════

// SeamCore is a single JS class with no configuration required.
// Create one instance per game/scene. Multiple instances can coexist.
const engine = new SeamCore();

// ═════════════════════════════════════════════════════════════════════════════
// STEP 2: Write a Module
// ═════════════════════════════════════════════════════════════════════════════

/**
 * StitchTrackerModule
 *
 * A simple observer that logs a running history of all Stitch operations.
 * It demonstrates:
 *   - Subscribing to before_ and after_ events
 *   - Using ctx.cancel() to block an operation
 *   - Reading ctx.meta written by an earlier listener
 *   - Collecting unsubscribe functions for clean teardown
 */
class StitchTrackerModule extends SeamModule {
  constructor() {
    super();

    /**
     * A history log of every stitch operation that completed successfully.
     * Useful for undo systems, game replays, or debugging.
     * @type {Array<{ from: string, to: string, timestamp: number, meta: object }>}
     */
    this.history = [];
  }

  /**
   * Called once by engine.use(). This is where all subscriptions live.
   * @param {SeamCore} engine
   */
  install(engine) {
    // ── Hook 1: before_stitch ──────────────────────────────────────────────
    // Fires BEFORE the edge is added to the graph.
    // This is where you validate, modify ctx.meta, or cancel the operation.
    this._unsubs.push(
      engine.on('before_stitch', (ctx) => {
        console.log(`  [Tracker] before_stitch: "${ctx.fromId}" ──▶ "${ctx.toId}"`);

        // Example: Block any stitch that would create a self-loop.
        // ctx.cancel() takes a human-readable reason string.
        if (ctx.fromId === ctx.toId) {
          ctx.cancel('Self-loops are not allowed by StitchTrackerModule.');
          return; // Early return — no point continuing this handler
        }

        // Example: Attach metadata that later listeners (and after_stitch) can read.
        // ctx.meta is a plain object shared across ALL listeners for this event.
        ctx.meta.trackedAt = Date.now();
      })
    );

    // ── Hook 2: after_stitch ───────────────────────────────────────────────
    // Fires AFTER the edge has been successfully added.
    // ctx.cancelled is always false here — cancelled ops never reach after_stitch.
    // ctx.meta carries everything written in before_stitch.
    this._unsubs.push(
      engine.on('after_stitch', (ctx) => {
        const entry = {
          from:      ctx.fromId,
          to:        ctx.toId,
          timestamp: ctx.meta.trackedAt ?? Date.now(),
          meta:      { ...ctx.meta }, // Snapshot meta — don't hold a reference
        };

        this.history.push(entry);

        console.log(
          `  [Tracker] after_stitch:  recorded. ` +
          `Total stitches this session: ${this.history.length}`
        );
      })
    );

    // ── Hook 3: ripple_arrival ─────────────────────────────────────────────
    // Fires once per node during a ripple BFS traversal.
    // ctx.depth tells you how many hops from the origin.
    // ctx.payload is whatever was passed to engine.ripple().
    this._unsubs.push(
      engine.on('ripple_arrival', (ctx) => {
        console.log(
          `  [Tracker] ripple_arrival: node="${ctx.nodeId}" ` +
          `depth=${ctx.depth} payload=`, ctx.payload
        );
      })
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 3: Register the module
// ═════════════════════════════════════════════════════════════════════════════

// engine.use() calls module.install(engine) and returns `this` for chaining.
engine.use(new StitchTrackerModule());

// ═════════════════════════════════════════════════════════════════════════════
// STEP 4: Build the graph
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── Adding Nodes ────────────────────────────────────────────────\n');

// engine.addNode(id, data) — data is any object you want to attach.
engine.addNode('hub',    { label: 'Central Hub',  active: false });
engine.addNode('room_a', { label: 'Room A',        active: false });
engine.addNode('room_b', { label: 'Room B',        active: false });
engine.addNode('room_c', { label: 'Dead End',      active: false });

// ═════════════════════════════════════════════════════════════════════════════
// STEP 5: Stitch the graph together
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── Stitching ───────────────────────────────────────────────────\n');

// Each stitch call triggers:  before_stitch → (mutation) → after_stitch
engine.stitch('hub',    'room_a');  // ✅ normal stitch
engine.stitch('hub',    'room_b');  // ✅ normal stitch
engine.stitch('room_a', 'room_c'); // ✅ normal stitch

// ── Demonstrating Cancellation ────────────────────────────────────────────
console.log('\n── Attempting Self-Loop (will be blocked) ──────────────────────\n');

const result = engine.stitch('hub', 'hub'); // ❌ StitchTrackerModule cancels this
console.log('  stitch result:', result);
// { success: false, reason: 'Self-loops are not allowed by StitchTrackerModule.' }

// ═════════════════════════════════════════════════════════════════════════════
// STEP 6: Send a ripple through the graph
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── Ripple from hub ─────────────────────────────────────────────\n');

// engine.ripple(originId, payload) — BFS from origin, fires ripple_arrival
// at every reachable node. The payload is any value you choose.
engine.ripple('hub', { type: 'ACTIVATE', source: 'player' });

// ═════════════════════════════════════════════════════════════════════════════
// STEP 7: Inspect the tracker's history
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n── Stitch History ──────────────────────────────────────────────\n');

// Access module state directly on the instance.
// In a real game, you'd hold a reference to the module at registration time:
//   const tracker = new StitchTrackerModule();
//   engine.use(tracker);
//   tracker.history; // Always available
const tracker = engine._modules[0]; // Demo shortcut — prefer holding a reference
console.log('  history:', JSON.stringify(tracker.history, null, 2));

// ── Snapshot ──────────────────────────────────────────────────────────────
console.log('\n── Graph Snapshot ──────────────────────────────────────────────\n');

// engine.snapshot() returns { nodes, edges } — fully JSON-serializable.
console.log(JSON.stringify(engine.snapshot(), null, 2));
