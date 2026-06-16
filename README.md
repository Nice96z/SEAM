# ⚡ SEAM — The Event-Driven Modular Graph Engine

> *"The engine doesn't know what your game is. It only knows that things connect, disconnect, and send signals. Everything else is yours."*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](./package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./RULEBOOK.md#contribution-workflow)
[![ES6+](https://img.shields.io/badge/ES6%2B-Vanilla%20JS-f7df1e?logo=javascript)](./src/SeamCore.js)

---

## The Elevator Pitch

Most game engines ask you to learn their physics, their scene graph, their rules. **SEAM asks you to learn two words: `stitch` and `sever`.**

SEAM is a **zero-dependency, browser-native graph engine** built around a single radical idea: the core should be *completely blind* to gameplay. It manages one thing — the topology of a node graph — and broadcasts lifecycle events to anyone listening. Physics, rendering, win conditions, audio — all of it lives in hot-swappable **Modules** that subscribe to those events and do whatever they want.

The result is an engine that is simultaneously **trivially simple to understand** and **capable of modelling any game mechanic** that can be expressed as nodes, connections, and signals.

Build puzzle games. Build dungeon crawlers. Build network simulators. Build things that don't have a genre yet.

---

## Features

| Feature | Detail |
|---|---|
| 🧠 **Blind Dispatcher** | `SeamCore` has zero knowledge of gameplay. No physics. No rendering. No win states. |
| 🔌 **Module API** | `engine.use(new MyModule())` — one line registration, full lifecycle access. |
| 🚦 **Cancellable Events** | `before_stitch` and `before_sever` can be vetoed by any module via `ctx.cancel(reason)`. |
| 📡 **Ripple Propagation** | BFS signal propagation through the graph with built-in cycle prevention. |
| 🗺️ **O(1) Graph** | Nodes stored in a `Map` for constant-time lookup regardless of graph size. |
| 📸 **Snapshots** | `engine.snapshot()` returns a plain serializable `{ nodes, edges }` object. |
| 🧹 **Clean Teardown** | Every module collects its own unsubscribe functions and disposes cleanly. |
| 📖 **JSDoc Throughout** | Every class, method, and event context fully documented for IDE intelligence. |

---

## Quick Start

```bash
# No build step required. SEAM is pure ES6 — import it directly.
git clone https://github.com/your-org/seam-engine.git
```

```js
import { SeamCore, SeamModule } from './src/SeamCore.js';

// ── 1. Create the engine ─────────────────────────────────────────────────────

const engine = new SeamCore();

// ── 2. Write a Module ────────────────────────────────────────────────────────
//    Modules extend SeamModule and implement install(engine).
//    They are the ONLY place gameplay logic should live.

class AlertOnStitch extends SeamModule {
  install(engine) {
    this._unsubs.push(
      engine.on('after_stitch', ({ fromId, toId }) => {
        console.log(`✅ Connected: ${fromId} ──▶ ${toId}`);
      })
    );
  }
}

// ── 3. Register the module ───────────────────────────────────────────────────

engine.use(new AlertOnStitch());

// ── 4. Build and connect your graph ─────────────────────────────────────────

engine.addNode('start', { label: 'Entry Point' });
engine.addNode('end',   { label: 'Exit' });
engine.stitch('start', 'end');
// Console: ✅ Connected: start ──▶ end

// ── 5. Send a signal through the graph ──────────────────────────────────────

engine.ripple('start', { type: 'ACTIVATE', value: 100 });
```

**That's the whole API.** Everything else — game rules, visuals, physics — is a module you write.

---

## Project Structure

```
seam-engine/
├── src/
│   └── SeamCore.js          # The entire engine. One file. No dependencies.
├── examples/
│   └── minimal_setup.js     # Annotated quick-start example
├── demo/
│   ├── index.html           # Canvas-based proof-of-concept visualizer
│   └── visualizer.js        # Visualizer module — a great contributor template
├── README.md                # You are here
├── GDD.md                   # Game Design Document & architecture philosophy
├── RULEBOOK.md              # Developer's Bible — API reference & contribution rules
└── package.json
```

---

## The Three Laws

These are non-negotiable. They are explained in full in [RULEBOOK.md](./RULEBOOK.md).

1. **Never modify `SeamCore.js` to add gameplay logic.** It is sealed.
2. **All logic lives in Modules** that subscribe to engine events.
3. **Modules communicate through event context `meta` objects**, never through direct imports of each other.

---

## Running the Demo

No build step. No server required for the core — but the Canvas demo needs a local server to respect ES module CORS rules:

```bash
# Python (built into macOS/Linux)
cd seam-engine
python3 -m http.server 8080
# Open: http://localhost:8080/demo/index.html

# Or with Node
npx serve .
# Open: http://localhost:3000/demo/index.html
```

---

## 📣 Call for Contributors

SEAM is explicitly designed to be extended. The engine is finished. **What it needs now is the community layer around it.**

### 🎨 Visualizers Wanted

The `demo/visualizer.js` is a bare-bones Canvas renderer — a proof of concept, not a finished tool. We are actively looking for contributors to build richer visualizers:

- **A D3.js force-directed graph** visualizer
- **A Three.js 3D node** renderer
- **A Cytoscape.js** integration
- **A Pixel-art style** tilemap renderer driven by stitch/sever events

A Visualizer is just a `SeamModule` that listens to `after_stitch`, `after_sever`, and `ripple_arrival` and draws something. If you can draw, you can contribute. See the [Visualizer Contract in GDD.md](./GDD.md#the-visualizer-contract).

### 🎮 Gameplay Modules Wanted

We want to build a standard library of reusable game-logic modules:

- `MaxEdgesGuard` — *(included)* Limits out-degree per node
- `WeightedEdgeModule` — Assigns and checks traversal costs
- `TimedSeverModule` — Automatically severs edges after a duration
- `TeamOwnershipModule` — Assigns nodes to players, blocks cross-team stitching
- `FloodFillModule` — Uses ripple to detect connected regions
- `PathfinderModule` — A\* shortest path on top of the graph

If you build one, submit a PR. See [RULEBOOK.md](./RULEBOOK.md) for the contribution workflow.

---

## License

MIT © SEAM Contributors.

You can use this engine in personal projects, commercial games, and open-source tools. Attribution appreciated but not required. See [LICENSE](./LICENSE) for the full text.

---

*Built on the principle that the best engines get out of your way.*
