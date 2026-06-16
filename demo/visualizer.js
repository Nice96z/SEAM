// visualizer.js is intentionally omitted from this minimal demo.
// The visualizer logic lives directly in demo/index.html as a DemoVisualizer
// class — keeping it in one file makes it easier to read as a template.
//
// When you are ready to build a real visualizer, the pattern to follow is:
//
//   class MyVisualizer extends SeamModule {
//     install(engine) {
//       this._unsubs.push(
//         engine.on('after_stitch',   (ctx) => { /* draw edge  */ }),
//         engine.on('after_sever',    (ctx) => { /* erase edge */ }),
//         engine.on('ripple_arrival', (ctx) => { /* animate    */ }),
//       );
//     }
//   }
//
// See GDD.md § "The Visualizer Contract" for the full rules.
