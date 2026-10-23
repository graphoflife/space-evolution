// Game constants, decoded from the original Unity build (see docs/SPEC.md), plus level layouts.
(function () {
  'use strict';

  const SE = (window.SE = window.SE || {});

  SE.Type = { stardust: 0, astroid: 1, moon: 2, planet: 3, gasplanet: 4, sun: 5, blackhole: 6, galaxy: 7 };

  // SpaceObjectData assets. The original galaxy reuses the stardust UI icon.
  SE.OBJECTS = [
    { type: 0, name: 'Stardust', next: 1, amountToCombine: 3, spawnProbability: 125, scoreSpawns: 1, pointsPerScore: 1, soundPitch: 0.7, icon: 'img/stardust.webp' },
    { type: 1, name: 'Asteroid', next: 2, amountToCombine: 3, spawnProbability: 40, scoreSpawns: 3, pointsPerScore: 2, soundPitch: 0.85, icon: 'img/asteroid.webp' },
    { type: 2, name: 'Moon', next: 3, amountToCombine: 3, spawnProbability: 6, scoreSpawns: 9, pointsPerScore: 4, soundPitch: 1.0, icon: 'img/moon.webp' },
    { type: 3, name: 'Planet', next: 4, amountToCombine: 3, spawnProbability: 1, scoreSpawns: 20, pointsPerScore: 8, soundPitch: 1.15, icon: 'img/planet.webp' },
    { type: 4, name: 'Gas Planet', next: 5, amountToCombine: 3, spawnProbability: 0, scoreSpawns: 40, pointsPerScore: 25, soundPitch: 1.3, icon: 'img/gasplanet.webp' },
    { type: 5, name: 'Sun', next: 6, amountToCombine: 3, spawnProbability: 0, scoreSpawns: 80, pointsPerScore: 62, soundPitch: 1.45, icon: 'img/sun.webp' },
    { type: 6, name: 'Black Hole', next: 7, amountToCombine: 3, spawnProbability: 0, scoreSpawns: 150, pointsPerScore: 130, soundPitch: 1.6, icon: 'img/blackhole.webp' },
    { type: 7, name: 'Galaxy', next: 7, amountToCombine: 3, spawnProbability: 0, scoreSpawns: 300, pointsPerScore: 500, soundPitch: 1.75, icon: 'img/stardust.webp' },
  ];

  SE.info = (type) => SE.OBJECTS[type];

  SE.CONFIG = {
    combiningTime: 0.3,
    generatingTime: 0.05,
    previewCount: 5, // upcoming objects shown at the top, as in the original
    rotateMap: { amplitude: 10, frequency: 0.15 },
    camera: { minRadius: 3.4, hudFraction: 0.14 },
    queue: { smallScale: 0.9, bigScale: 1.7, spacing: 1.1, gap: 0.25, spawnTime: 0.1 },
    score: { multiplier: 10, spawnPerSecond: 30, velocityRange: [8, 14], veloRatio: 0.9 },
    post: { threshold: 0.74, knee: 0.22, strength: 0.95, saturation: 1.3 },
    colors: {
      background: [0.2, 0.235, 0.25],
      ambient: [0.212, 0.227, 0.259],
      tile: [0.6, 0.64, 0.71],
      tileBorder: [0.547, 0.547, 0.547],
      centerNeighbour: [0.33, 0.74, 0.3],
      center: [0.28, 0.66, 0.26],
      placeholder: [0.538, 0.552, 0.569],
      placeholderBorder: [0.196, 0.196, 0.196],
      lastPlaceholderInner: [0.22, 0.52, 0.2],
      fastTime: '#3ee05a',
      slowTime: '#ff4d5e',
    },
    tileFlashTime: 0.5,
    centerFlashTime: 1.0,
    timeDifferenceFadeTime: 1.6,
  };

  // AnimationCurve "moveCurve": keys [time, value, inSlope, outSlope], clamped outside 0..1.
  const CURVE = [
    [0, 0, 0.01315, 0.01315],
    [0.5992, 0.9569, 0.2251, 0.2251],
    [1, 1, 0.025, 0.025],
  ];

  SE.evalCurve = function (t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const k = t <= CURVE[1][0] ? 0 : 1;
    const a = CURVE[k];
    const b = CURVE[k + 1];
    const dt = b[0] - a[0];
    const s = (t - a[0]) / dt;
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * a[1] + (s3 - 2 * s2 + s) * a[3] * dt + (-2 * s3 + 3 * s2) * b[1] + (s3 - s2) * b[2] * dt;
  };

  // DataManager.floatToMMDD
  SE.formatTime = function (number, sign, withMili) {
    const negative = number < 0;
    if (negative) number = -number;
    if (number === Infinity) return '-';
    const pad = (n) => String(n).padStart(2, '0');
    const minutes = Math.floor(number / 60);
    let text = (negative ? '-' : sign ? '+' : '') + pad(minutes) + ':' + pad(Math.floor(number % 60));
    if (withMili) text += '.' + pad(Math.floor((number * 100) % 100));
    return text;
  };

  SE.rand = (min, max) => min + Math.random() * (max - min);

  // ------------------------------------------------------------------ levels
  // Axial hex coordinates (q, r) map to Unity's map layout: x = q·√3/2, y = r + q/2.

  const AXES = [[0, 1], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1]];
  const axisTiles = (k) => AXES.map(([q, r]) => [q * k, r * k]);
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];

  function ring(k) {
    const out = [];
    for (let q = -k; q <= k; q++) {
      for (let r = -k; r <= k; r++) {
        if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 === k) out.push([q, r]);
      }
    }
    return out;
  }

  const without = (tiles, removed) => tiles.filter((t) => !removed.some((x) => same(t, x)));
  const hexDistance = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[0] + a[1] - b[0] - b[1])) / 2;
  // Tiles of ring k touching one of its six corners (each corner plus its two ring neighbours).
  const cornerTiles = (k) => ring(k).filter((t) => axisTiles(k).some((c) => hexDistance(t, c) <= 1));
  const toWorld = ([q, r]) => [(q * Math.sqrt(3)) / 2, r + q / 2];

  const TILE_HALF_HEIGHT = 0.47;
  const TILE_HALF_WIDTH = 0.54;
  const QUEUE_RADIUS = 0.85; // big preview slot

  // Extent of the board while RotateMap swings it by ±amplitude degrees.
  function swungExtent(world, axis, sign) {
    let best = -Infinity;
    const amp = SE.CONFIG.rotateMap.amplitude;
    for (let deg = -amp; deg <= amp; deg += 2) {
      const a = (deg * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      for (const [x, y] of world) {
        const v = axis === 'x' ? x * cos - y * sin : x * sin + y * cos;
        best = Math.max(best, sign * v);
      }
    }
    return best;
  }

  // spokes = null: a free board without center; any black hole wins and the speedrun
  // times measure the first asteroid, moon, ... created anywhere.
  function level(id, name, tag, tiles, spokes) {
    const world = tiles.map(toWorld);
    const top = swungExtent(world, 'y', 1) + TILE_HALF_HEIGHT;
    const queueY = Math.max(4.5, top + 1.08);
    return {
      id,
      name,
      tag,
      free: spokes === null,
      tiles: world,
      spokes: (spokes || []).map(toWorld),
      queueY,
      bounds: {
        maxX: Math.max(swungExtent(world, 'x', 1), swungExtent(world, 'x', -1)) + TILE_HALF_WIDTH + 0.06,
        minY: -swungExtent(world, 'y', -1) - TILE_HALF_HEIGHT - 0.85,
        maxY: queueY + QUEUE_RADIUS + 0.05,
      },
    };
  }

  const rings23 = [...ring(2), ...ring(3)];
  const triSpokes = [[0, 2], [-2, 0], [2, -2]];

  SE.LEVELS = [
    level('classic', 'Classic', 'Original', without(rings23, [[0, 3], [-3, 0], [3, -3]]), triSpokes),
    level('duo', 'Duo', 'Easy', rings23, [[0, 2], [0, -2]]),
    level('star', 'Star', 'Big', [...rings23, ...cornerTiles(4)], triSpokes),
    level('hexa', 'Hexa', 'Expert', rings23, axisTiles(2)),
    level('free', 'Free', 'Sandbox', [...ring(0), ...ring(1), ...rings23], null),
  ];

  SE.levelById = (id) => SE.LEVELS.find((l) => l.id === id) || SE.LEVELS[0];
})();
