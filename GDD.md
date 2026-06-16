# SEAM — Game Design Document

*Version 1.0.0 · This document is the canonical source of architectural truth for the SEAM engine. Code that contradicts this document is wrong; this document is not.*

---

## Table of Contents

1. [Vision Statement](#1-vision-statement)
2. [Complexity Through Simplicity](#2-complexity-through-simplicity)
3. [The Blind Dispatcher Architecture](#3-the-blind-dispatcher-architecture)
4. [The Two Primitives](#4-the-two-primitives)
5. [The Ripple System](#5-the-ripple-system)
6. [The Module Contract](#6-the-module-contract)
7. [The Visualizer Contract](#7-the-visualizer-contract)
8. [Design Anti-Patterns](#8-design-anti-patterns)
9. [Worked Example: A Puzzle Game in SEAM](#9-worked-example-a-puzzle-game-in-seam)

---

## 1. Vision Statement

SEAM exists because most game frameworks conflate two separate concerns: **topology** (what is connected to what) and **semantics** (what those connections *mean*). A physics engine, a scene graph, a UI framework — all of them bake in opinions about what your game *is*.

SEAM refuses to have an opinion. It models a single universal concept — **a graph that can change over time and emit signals** — and then gets out of the way entirely.

The name is deliberate. A seam is the line where two pieces of fabric are joined. The engine manages those joins — the stitches and the severances — and nothing more.

---

## 2. Complexity Through Simplicity

### The Core Thesis

Virtually every interactive mechanic in every game ever made can be modelled as:

> *"Some things are connected. Some things become connected. Some things become disconnected. Sometimes a signal travels between connected things."*

Consider:

- **A dungeon** — rooms are nodes, doorways are edges, a key-pickup event is a ripple that unlocks (re-stitches) a locked room connection.
- **An electrical circuit puzzle** — components are nodes, wires are edges, current is a ripple. A short-circuit module listens for closed loops.
- **A social deduction game** — players are nodes, alliances are edges, a vote is a ripple. A betrayal module listens for `before_sever` to trigger consequences.
- **A real-time strategy game** — territories are nodes, supply routes are edges, an attack ripples damage through the network.

None of these games required changing the engine. They required writing the right Modules.

### The Two-Layer Model

```
┌─────────────────────────────────────────────────────┐
│                   YOUR GAME LAYER                   │
│  PhysicsModule  ·  RendererModule  ·  AudioModule   │
│  WinConditionModule  ·  PlayerModule  ·  AIModule   │
│  (any number of Modules you write or import)        │
├─────────────────────────────────────────────────────┤
│                   SEAM ENGINE CORE                  │
│                                                     │
│  Nodes (Map)  ·  Edges (Sets)  ·  EventEmitter      │
│  stitch()  ·  sever()  ·  ripple()  ·  snapshot()   │
│                                                     │
│  ★  Zero gameplay knowledge  ★                      │
└─────────────────────────────────────────────────────┘
```

The boundary between these layers is sacred. Crossing it — adding game logic into `SeamCore`, or calling internal engine methods from modules — is the only way to break SEAM.

---

## 3. The Blind Dispatcher Architecture

### What "Blind" Means

The `SeamCore` class is described as a **Blind Dispatcher** because it dispatches events with no knowledge of what those events will be used for. When you call `engine.stitch('room_a', 'room_b')`, SeamCore:

1. Looks up both nodes in its `Map`.
2. Builds a context object describing the operation.
3. Fires it at every listener on `before_stitch`.
4. Checks if any listener cancelled it.
5. If not cancelled, adds the edge and fires `after_stitch`.

At no point does it know whether this stitch represents a door, a wire, a friendship, or a quantum entanglement. That interpretation is 100% the responsibility of whichever Module is listening.

### Why Blindness Is a Feature

1. **Testability** — SeamCore can be tested in complete isolation. No mocks needed.
2. **Composability** — Any combination of Modules can be registered without them needing to know about each other.
3. **Stability** — Because SeamCore never changes for gameplay reasons, it can reach 1.0 and stay there.
4. **Portability** — The same SeamCore can power a puzzle game, a simulation, and a network diagram tool simultaneously, in the same page, as three separate engine instances.

### The Event Spine

Every meaningful action in SEAM passes through the same five-event spine:

```
USER CALLS engine.stitch('a', 'b')
    │
    ▼
[before_stitch]  ◄── Modules may call ctx.cancel() here
    │
    ├── if ctx.cancelled: STOP. Return { success: false, reason }.
    │
    ▼
[TOPOLOGY MUTATION: from.edges.add(toId)]
    │
    ▼
[after_stitch]   ◄── Modules react here (draw a line, play a sound, etc.)
    │
    ▼
Return { success: true }
```

The same pattern applies to `sever`. The `ripple` system uses its own BFS loop but emits `ripple_arrival` at each node with the same predictable context shape.

---

## 4. The Two Primitives

SEAM has exactly two topology-mutating operations. This is intentional.

### `stitch(fromId, toId)`

Creates a **directed edge** from `fromId` to `toId`. An edge is stored as an entry in the origin node's `edges: Set<string>`. This means:

- `stitch('a', 'b')` does NOT automatically create `stitch('b', 'a')`.
- To create a bidirectional connection, call `stitch` twice.
- This is deliberate: many game relationships are naturally asymmetric (a trap springs toward a player, not the other way around).

### `sever(fromId, toId)`

Removes a directed edge. The mirror image of `stitch`, with the same cancellable lifecycle.

### Everything Else Is a Module

There is no `merge()`, `split()`, `lock()`, `unlock()`, `activate()`, or any other operation in SeamCore. All of those are **semantic interpretations** of stitch and sever, and they live in Modules.

A `LockModule` that prevents stitch until a key is held is just a Module that calls `ctx.cancel()` in `before_stitch` when a condition isn't met. A `TimedSeverModule` that auto-removes edges is a Module that calls `engine.sever()` after a `setTimeout`. SeamCore does not need to know these use cases exist.

---

## 5. The Ripple System

### Purpose

`engine.ripple(originId, payload)` propagates a payload object through the graph via **breadth-first search**, firing `ripple_arrival` at every reachable node. It is the mechanism for:

- Cascade effects (chain reactions, combos)
- Flood-fill operations (territory detection, region colouring)
- Broadcast messages (a global event that all connected nodes should respond to)
- Pathfinding preprocessing (marking nodes at known BFS depth)

### Cycle Safety

The ripple system maintains a `visited: Set<string>` and will never visit a node twice in a single ripple call, regardless of cycles in the graph. This Set is exposed on the `RippleContext` so Modules with advanced traversal needs can inspect or — carefully — modify it.

### Payload Contract

The `payload` is an arbitrary object. By convention, it should always include a `type` string so that Modules can filter for the signals they care about:

```js
// ✅ Good — Modules can filter on payload.type
engine.ripple('generator', { type: 'POWER_ON', voltage: 12 });

// ⚠️ Acceptable but harder to filter
engine.ripple('source', 42);

// ❌ Avoid — No signal type, every Module has to guess intent
engine.ripple('node', {});
```

---

## 6. The Module Contract

Any class that extends `SeamModule` and implements `install(engine)` is a valid Module. There are four obligations:

### Obligation 1: Subscribe Only in `install()`

All `engine.on()` calls must happen inside `install()`, not in the constructor. The constructor has no engine reference.

### Obligation 2: Collect Unsubscribe Functions

Every call to `engine.on()` returns an unsubscribe function. Collect them:

```js
install(engine) {
  this._unsubs.push(
    engine.on('after_stitch', this._onStitch.bind(this))
  );
}
```

This is what enables `module.destroy()` to cleanly remove the module at runtime.

### Obligation 3: Use `meta` for Inter-Module Communication

Modules must not import each other. If Module A needs to tell Module B something happened, it writes to `ctx.meta`:

```js
// Module A (runs first, e.g. a cost calculator)
engine.on('before_stitch', (ctx) => {
  ctx.meta.stitchCost = calculateCost(ctx.from, ctx.to);
});

// Module B (runs second, e.g. a resource deductor)
engine.on('before_stitch', (ctx) => {
  if (player.gold < ctx.meta.stitchCost) ctx.cancel('Insufficient gold.');
});
```

### Obligation 4: Never Call Private Engine Methods

Methods prefixed with `_` on `SeamCore` are internal. Calling `engine._requireNode()` or accessing `engine._emitter` from a Module is a violation of the contract. Use only the public API.

---

## 7. The Visualizer Contract

A **Visualizer** is a special category of Module with one job: **make the graph visible**. It has no gameplay logic. It does not cancel events. It only reads state and draws.

This distinction matters because it separates the concerns of "what is happening" (gameplay modules) from "how it looks" (visualizer modules), enabling the same engine to drive multiple simultaneous renderers.

### The Minimal Visualizer Interface

A compliant Visualizer Module must:

1. Accept a rendering target (Canvas context, SVG element, Three.js scene, etc.) in its constructor.
2. Implement a `render()` method that can redraw the entire graph state.
3. Listen to `after_stitch`, `after_sever`, and `ripple_arrival` — and only those events.
4. Call `engine.snapshot()` to get the full graph state on initialization.
5. Never call `engine.stitch()`, `engine.sever()`, or `engine.ripple()`. Visualizers are **read-only observers**.

### Reference Visualizer Skeleton

```js
class MyVisualizer extends SeamModule {
  /**
   * @param {HTMLCanvasElement} canvas - The canvas to draw onto.
   */
  constructor(canvas) {
    super();
    this.ctx = canvas.getContext('2d');
    // ── CONTRIBUTOR HOOK ─────────────────────────────────────
    // Initialize your renderer here. Load textures, set up your
    // Three.js scene, create your D3 force simulation, etc.
    // ─────────────────────────────────────────────────────────
  }

  install(engine) {
    this.engine = engine;
    this.render(); // Initial draw from snapshot

    this._unsubs.push(
      // ── CONTRIBUTOR HOOK ───────────────────────────────────
      // React to topology changes. Add a line, remove a line,
      // animate a connection forming, etc.
      // ─────────────────────────────────────────────────────
      engine.on('after_stitch', (ctx) => this.render()),
      engine.on('after_sever',  (ctx) => this.render()),

      // ── CONTRIBUTOR HOOK ───────────────────────────────────
      // Ripple arrival is where you animate signals traveling
      // through the graph (pulsing nodes, travelling particles).
      // ctx.depth tells you how far from the origin this node is.
      // ─────────────────────────────────────────────────────
      engine.on('ripple_arrival', (ctx) => this.animateRipple(ctx))
    );
  }

  render() {
    const { nodes, edges } = this.engine.snapshot();
    // ── CONTRIBUTOR HOOK ─────────────────────────────────────
    // Full redraw from snapshot. This is called on init and
    // after every topology change.
    // ─────────────────────────────────────────────────────────
  }

  animateRipple(ctx) {
    // ── CONTRIBUTOR HOOK ─────────────────────────────────────
    // Visual feedback for ripple propagation.
    // ctx.depth, ctx.nodeId, ctx.payload are all available.
    // ─────────────────────────────────────────────────────────
  }
}
```

---

## 8. Design Anti-Patterns

These patterns have been explicitly considered and rejected. If you find yourself reaching for one, consult this section before proceeding.

| Anti-Pattern | Why It's Wrong | The SEAM Way |
|---|---|---|
| Adding a `lock()` method to SeamCore | Adds semantic knowledge to core | Write a `LockModule` that cancels `before_stitch` |
| Importing Module A inside Module B | Creates hidden coupling | Use `ctx.meta` to pass data between modules in the same event |
| Storing gameplay state on SeamCore | Core should be stateless beyond the graph | Store state inside the Module instance |
| Using `ripple_arrival` to mutate the graph | Ripple traversal + topology mutation = undefined order | Queue mutations and apply them after the ripple completes |
| Calling `engine._emitter.emit()` from a module | Bypasses the cancellation and lifecycle system | Use `engine.stitch()` / `engine.sever()` / `engine.ripple()` |
| A Module that subscribes to all 5 events | A Module doing too much. Split it. | Each Module has one responsibility |

---

## 9. Worked Example: A Puzzle Game in SEAM

*"PowerGrid" — Connect power sources to receivers without overloading any node.*

### The Graph

- **Nodes**: Power sources, conductors, receivers, fuses
- **Edges**: Wire connections (created by the player via `stitch`)

### The Modules

```
PowerSourceModule   — marks certain nodes as sources; tracks output wattage
ConductorModule     — on ripple_arrival({ type: 'POWER' }), relays payload to edges
ReceiverModule      — on ripple_arrival, checks if wattage matches requirement; fires win
FuseModule          — on before_stitch, counts incoming ripple load; cancels if overloaded
PowerGridVisualizer — draws the graph, animates power ripples as travelling sparks
```

### The Gameplay Loop

1. Player calls `engine.stitch('source_1', 'conductor_a')` to place a wire.
2. `before_stitch` fires → `FuseModule` checks load capacity. If OK, stitch proceeds.
3. `after_stitch` fires → `PowerGridVisualizer` draws the new wire.
4. `PowerSourceModule` listens to `after_stitch` and calls `engine.ripple('source_1', { type: 'POWER', watts: 60 })`.
5. `ripple_arrival` fires at each connected node → `ConductorModule` relays, `ReceiverModule` checks win condition.

**SeamCore never knew any of this was a power grid puzzle.** It just stitched two nodes and fired events. The game emerged from the Modules.

---

*End of Game Design Document.*
*For API specifics, see [RULEBOOK.md](./RULEBOOK.md).*
*For contributor onboarding, see [README.md](./README.md).*
