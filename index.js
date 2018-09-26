const timeline = require('chrome-timeline').timeline;

timeline(async (runner) => {
    // load something in chromium
    await runner.page.goto('http://127.0.0.1:3000');
    // start a timeline profiling
    await runner.tracingStart('LS_TRACE');
    // do something in the remote page
    await runner.remote((done, window) => {
      // this is within remote browser context
      window.term._core.handler('tree\r');
      setTimeout(() => done(), 4000);
    });
    await runner.tracingStop();
});

// .then((summary) => {
//     const textRenderTime = findTraceValue('./lib/renderer/TextRenderLayer.js.TextRenderLayer.onGridChanged').totalTime;
//     console.log(textRenderTime);
// });