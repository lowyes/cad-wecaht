function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeInOutCubic(value) {
  const progress = clamp01(value);
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function interpolateVector(from, to, progress) {
  const eased = easeInOutCubic(progress);
  return from.map((value, index) => value + (to[index] - value) * eased);
}

function vectorToAttribute(vector) {
  return vector.map((value) => Number(value.toFixed(4))).join(' ');
}

module.exports = {
  clamp01,
  easeInOutCubic,
  interpolateVector,
  vectorToAttribute,
};
