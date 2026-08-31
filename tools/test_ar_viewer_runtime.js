const assert = require('assert');
const path = require('path');

let pageDefinition = null;
global.Page = (definition) => {
  pageDefinition = definition;
};

require(path.join(
  __dirname,
  '..',
  'miniprogram',
  'pages',
  'ar-viewer',
  'ar-viewer.js',
));
delete global.Page;

function createPage() {
  const updates = [];
  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(update) {
      updates.push(update);
      Object.assign(this.data, update);
    },
  };
  return { page, updates };
}

{
  const { page, updates } = createPage();
  page.runtimeActive = false;
  page.initializeTrackingStabilizer = () => {
    throw new Error('stale event must not recreate the stabilizer');
  };
  page.handleTrackerChange({
    detail: { modelId: 'part_0001', active: true },
  });
  assert.deepStrictEqual(updates, []);
  console.log('PASS stale tracker event is ignored after disposal');
}

{
  const { page, updates } = createPage();
  page.runtimeActive = true;
  page.lastReportedAssetProgress = -1;
  for (const progress of [0.01, 0.02, 0.05, 0.07, 0.1, 1]) {
    page.handleAssetsProgress({ detail: { progress } });
  }
  assert.strictEqual(updates.length, 3);
  assert.strictEqual(page.lastReportedAssetProgress, 100);
  console.log('PASS asset progress updates are coalesced');
}

{
  const { page, updates } = createPage();
  page.data.arStarted = true;
  page.queueModelTransform({ modelRotationX: -80 });
  page.queueModelTransform({ modelRotationY: 45 });
  page.flushModelTransform();
  assert.deepStrictEqual(updates, [
    { modelRotationX: -80, modelRotationY: 45 },
  ]);
  console.log('PASS gesture transforms are merged into one update');
}

{
  const { page } = createPage();
  let disposed = false;
  page.runtimeActive = true;
  page.trackingStabilizer = {
    dispose() {
      disposed = true;
    },
  };
  page.disposeRuntimeState();
  assert.strictEqual(page.runtimeActive, false);
  assert.strictEqual(disposed, true);
  assert.strictEqual(page.trackingStabilizer, null);
  console.log('PASS runtime disposal releases tracking state');
}
