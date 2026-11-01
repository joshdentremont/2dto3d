// Background worker: runs the build away from the page, so the page stays usable meanwhile.
// The Docker build reads this list to make the worker's own minified file, so keep it on one
// line, with paths starting from ../.
importScripts('../vendor/three.min.js', '../src/color.js', '../src/labels.js', '../src/contours.js', '../src/mesh.js', '../src/model.js', '../src/keychain.js', '../src/frame.js', '../src/pipeline.js');

(function (L3D) {
  'use strict';

  const pipeline = L3D.pipeline.create();

  // A message is one build's job, and the answer is { result } or { error }.
  self.onmessage = event => {
    try {
      self.postMessage({ result: pipeline.run(event.data) });
    } catch (err) {
      self.postMessage({ error: err.message });
    }
  };
})(globalThis.L3D);
