function createTrackingStabilizer(options = {}) {
  const acquireDelayMs = Math.max(
    0,
    options.acquireDelayMs === undefined ? 250 : options.acquireDelayMs,
  );
  const lossGraceMs = Math.max(
    0,
    options.lossGraceMs === undefined ? 800 : options.lossGraceMs,
  );
  const reacquireDelayMs = Math.max(
    0,
    options.reacquireDelayMs === undefined ? 100 : options.reacquireDelayMs,
  );
  const reacquireWindowMs = Math.max(
    0,
    options.reacquireWindowMs === undefined ? 2500 : options.reacquireWindowMs,
  );
  const schedule = options.schedule || setTimeout;
  const cancel = options.cancel || clearTimeout;
  const now = options.now || Date.now;
  const onChange = options.onChange || (() => {});

  const activeTargets = new Set();
  const confirmedTargets = new Set();
  const confirmationOrder = [];
  const acquireTimers = new Map();
  const recentlyLostAt = new Map();
  let lossTimer = null;
  let visibleModelId = '';
  let disposed = false;

  function removeConfirmed(modelId) {
    confirmedTargets.delete(modelId);
    const index = confirmationOrder.indexOf(modelId);
    if (index >= 0) confirmationOrder.splice(index, 1);
  }

  function confirm(modelId) {
    if (confirmedTargets.has(modelId)) return;
    confirmedTargets.add(modelId);
    confirmationOrder.push(modelId);
  }

  function clearAcquireTimer(modelId) {
    const timer = acquireTimers.get(modelId);
    if (timer !== undefined) {
      cancel(timer);
      acquireTimers.delete(modelId);
    }
  }

  function clearLossTimer() {
    if (lossTimer !== null) {
      cancel(lossTimer);
      lossTimer = null;
    }
  }

  function setVisibleModel(modelId, reason) {
    if (visibleModelId === modelId) return;
    visibleModelId = modelId;
    onChange(modelId, { reason });
  }

  function chooseConfirmedActiveTarget() {
    return confirmationOrder.find(
      (modelId) =>
        confirmedTargets.has(modelId) && activeTargets.has(modelId),
    ) || '';
  }

  function handleActive(modelId) {
    activeTargets.add(modelId);

    if (modelId === visibleModelId) {
      clearLossTimer();
      confirm(modelId);
      return;
    }

    if (confirmedTargets.has(modelId) || acquireTimers.has(modelId)) return;

    const lostAt = recentlyLostAt.get(modelId);
    const fastReacquire =
      lostAt !== undefined && now() - lostAt <= reacquireWindowMs;
    const confirmationDelay = fastReacquire
      ? Math.min(acquireDelayMs, reacquireDelayMs)
      : acquireDelayMs;
    const timer = schedule(() => {
      acquireTimers.delete(modelId);
      if (disposed || !activeTargets.has(modelId)) return;

      confirm(modelId);
      recentlyLostAt.delete(modelId);
      if (!visibleModelId) {
        setVisibleModel(modelId, fastReacquire ? 'reacquired' : 'acquired');
      }
    }, confirmationDelay);
    acquireTimers.set(modelId, timer);
  }

  function handleInactive(modelId) {
    const wasActive = activeTargets.has(modelId);
    activeTargets.delete(modelId);
    clearAcquireTimer(modelId);

    if (modelId !== visibleModelId) {
      removeConfirmed(modelId);
      return;
    }

    if (!wasActive && lossTimer !== null) return;

    clearLossTimer();
    lossTimer = schedule(() => {
      lossTimer = null;
      if (disposed || activeTargets.has(modelId)) return;

      removeConfirmed(modelId);
      recentlyLostAt.set(modelId, now());
      setVisibleModel(chooseConfirmedActiveTarget(), 'lost');
    }, lossGraceMs);
  }

  function update(modelId, active) {
    if (disposed || !modelId) return;
    if (active) {
      handleActive(modelId);
    } else {
      handleInactive(modelId);
    }
  }

  function reset({ emit = true } = {}) {
    for (const timer of acquireTimers.values()) cancel(timer);
    acquireTimers.clear();
    clearLossTimer();
    activeTargets.clear();
    confirmedTargets.clear();
    recentlyLostAt.clear();
    confirmationOrder.splice(0);

    if (emit) {
      setVisibleModel('', 'reset');
    } else {
      visibleModelId = '';
    }
  }

  function dispose() {
    reset({ emit: false });
    disposed = true;
  }

  return {
    update,
    reset,
    dispose,
    getVisibleModelId: () => visibleModelId,
  };
}

module.exports = {
  createTrackingStabilizer,
};
