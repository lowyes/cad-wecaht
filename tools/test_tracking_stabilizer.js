const assert = require('assert');
const path = require('path');

const { createTrackingStabilizer } = require(path.join(
  __dirname,
  '..',
  'miniprogram',
  'utils',
  'tracking_stabilizer.js',
));

function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();

  function schedule(callback, delay) {
    const id = nextId++;
    tasks.set(id, { callback, at: now + delay });
    return id;
  }

  function cancel(id) {
    tasks.delete(id);
  }

  function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const due = Array.from(tasks.entries())
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;

      const [id, task] = due;
      tasks.delete(id);
      now = task.at;
      task.callback();
    }
    now = target;
  }

  return {
    schedule,
    cancel,
    advance,
    now: () => now,
    pending: () => tasks.size,
  };
}

function createHarness() {
  const clock = createFakeClock();
  const changes = [];
  const stabilizer = createTrackingStabilizer({
    acquireDelayMs: 200,
    lossGraceMs: 1000,
    reacquireDelayMs: 100,
    reacquireWindowMs: 2500,
    schedule: clock.schedule,
    cancel: clock.cancel,
    now: clock.now,
    onChange(modelId, meta) {
      changes.push({ modelId, reason: meta.reason });
    },
  });
  return { clock, changes, stabilizer };
}

{
  const { clock, changes, stabilizer } = createHarness();
  stabilizer.update('part_0001', true);
  clock.advance(120);
  stabilizer.update('part_0001', false);
  clock.advance(500);
  assert.deepStrictEqual(changes, []);
  console.log('PASS transient detection does not become visible');
}

{
  const { clock, changes, stabilizer } = createHarness();
  stabilizer.update('part_0001', true);
  clock.advance(200);
  assert.deepStrictEqual(changes, [
    { modelId: 'part_0001', reason: 'acquired' },
  ]);

  stabilizer.update('part_0001', false);
  clock.advance(700);
  stabilizer.update('part_0001', true);
  clock.advance(500);
  assert.strictEqual(changes.length, 1);
  console.log('PASS short target loss is hidden by the grace period');

  stabilizer.update('part_0001', false);
  clock.advance(900);
  stabilizer.update('part_0001', false);
  clock.advance(100);
  assert.deepStrictEqual(changes.at(-1), { modelId: '', reason: 'lost' });
  console.log('PASS repeated loss events do not extend the grace period');
}

{
  const { clock, changes, stabilizer } = createHarness();
  stabilizer.update('part_0001', true);
  clock.advance(200);
  stabilizer.update('part_0002', true);
  clock.advance(200);
  assert.strictEqual(stabilizer.getVisibleModelId(), 'part_0001');
  assert.strictEqual(changes.length, 1);
  console.log('PASS current target remains locked while another target appears');

  stabilizer.update('part_0001', false);
  clock.advance(1000);
  assert.deepStrictEqual(changes.at(-1), {
    modelId: 'part_0002',
    reason: 'lost',
  });
  console.log('PASS confirmed alternate target takes over after loss');
}

{
  const { clock, changes, stabilizer } = createHarness();
  stabilizer.update('part_0001', true);
  clock.advance(200);
  stabilizer.update('part_0001', false);
  clock.advance(1000);
  assert.deepStrictEqual(changes.at(-1), { modelId: '', reason: 'lost' });

  stabilizer.update('part_0001', true);
  clock.advance(99);
  assert.strictEqual(stabilizer.getVisibleModelId(), '');
  clock.advance(1);
  assert.deepStrictEqual(changes.at(-1), {
    modelId: 'part_0001',
    reason: 'reacquired',
  });
  console.log('PASS recently lost target is reacquired faster');
}

{
  const { clock, changes, stabilizer } = createHarness();
  stabilizer.update('part_0002', true);
  clock.advance(200);
  stabilizer.update('part_0002', false);
  clock.advance(1000);
  clock.advance(2501);

  stabilizer.update('part_0002', true);
  clock.advance(100);
  assert.strictEqual(stabilizer.getVisibleModelId(), '');
  clock.advance(100);
  assert.deepStrictEqual(changes.at(-1), {
    modelId: 'part_0002',
    reason: 'acquired',
  });
  console.log('PASS expired reacquire window uses normal confirmation');
}

{
  const { clock, changes, stabilizer } = createHarness();
  stabilizer.update('part_0003', true);
  stabilizer.dispose();
  clock.advance(1000);
  assert.deepStrictEqual(changes, []);
  assert.strictEqual(clock.pending(), 0);
  console.log('PASS dispose cancels delayed callbacks');
}
