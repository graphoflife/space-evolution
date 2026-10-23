// Particle systems ported from the Unity prefabs. Every value below was read from the
// ParticleSystem components of the v1.4 APK (rate, lifetime, shape, speed, size and colour curves, trails).
// Simulation runs on the CPU; all particles are drawn through a few batched meshes.
(function () {
  'use strict';

  const SE = window.SE;
  const THREE = window.THREE;
  const DEG = Math.PI / 180;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (v) => (Array.isArray(v) ? rand(v[0], v[1]) : v);

  // Piecewise-linear [[t, value], ...] curves (Unity's keys are close enough to linear here).
  function evalCurve(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const b = keys[i];
      if (t <= b[0]) {
        const a = keys[i - 1];
        return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
      }
    }
    return keys[keys.length - 1][1];
  }

  // Gradient { c: [[t, r, g, b], ...], a: [[t, alpha], ...] }; missing parts stay white / opaque.
  function evalGradient(g, t, out) {
    if (g.c) {
      const c = g.c;
      let i = 0;
      while (i < c.length - 1 && t > c[i + 1][0]) i++;
      const a = c[i];
      const b = c[Math.min(i + 1, c.length - 1)];
      const k = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
      out[0] = a[1] + (b[1] - a[1]) * k;
      out[1] = a[2] + (b[2] - a[2]) * k;
      out[2] = a[3] + (b[3] - a[3]) * k;
    } else {
      out[0] = out[1] = out[2] = 1;
    }
    out[3] = g.a ? evalCurve(g.a, t) : 1;
    return out;
  }

  const FADE = [[0, 0], [0.1, 1], [0.9, 1], [1, 0]];
  const BLACK_HOLE_COLORS = { c: [[0, 1, 1, 1], [0.29, 0.89, 0.558, 0.203], [0.78, 0, 0.216, 0.324]], a: FADE };

  // ---------------------------------------------------------------- system definitions

  const SYSTEMS = {
    // SOStardust: bright dust is pulled inwards from a 0.75 sphere, dark dust pushes out from the core.
    brightDust: {
      rate: 8, lifetime: 2, speed: -0.45, size: 0.6, bucket: 'add', intensity: 0.55,
      startColor: { gradient: { c: [[0, 0.743, 0, 0.722], [0.3, 0, 0, 0], [0.72, 0.334, 0.523, 0.709], [1, 0.129, 0.09, 0.422]] } },
      shape: { type: 'sphere', radius: 0.75 },
      sizeCurve: [[0, 0], [0.11, 0.438], [0.92, 0.987], [1, 0]],
    },
    darkDust: {
      rate: 8, lifetime: 1, speed: 0.3, size: 0.5, bucket: 'alpha',
      startColor: { gradient: { c: [[0, 0.466, 0, 0.453], [0.3, 0, 0, 0], [0.72, 0.246, 0.385, 0.522], [1, 0.129, 0.09, 0.422]] } },
      shape: { type: 'sphere', radius: 0.2 },
      sizeCurve: [[0, 0], [0.92, 0.987], [1, 0]],
    },
    // SOSun/Sun Model/SphereEffect: big glow clouds sitting on the sun's surface.
    sunSurface: {
      rate: 10, lifetime: 5, speed: 0, size: 4, spin: true, bucket: 'sun', frontOnly: true, intensity: 0.22,
      startColor: { color: [0.86, 0.762, 0.215, 1] },
      colorOverLifetime: { a: FADE },
      shape: { type: 'sphere', radius: 1.01 },
    },
    // SOSun/Border: pale clouds on a ring around the rim (drawn a bit larger than the original).
    sunRim: {
      rate: 5, lifetime: 3, speed: 0, size: [1.3, 1.95], spin: true, bucket: 'sun', intensity: 0.6,
      startColor: { between: [[1, 0.993, 0.735, 1], [1, 0.883, 0.735, 1]] },
      colorOverLifetime: { a: FADE },
      shape: { type: 'circle', radius: 1.1 },
    },
    // SOBlackHole/.../Ring: slow particles on a disk, only their world-space trails are drawn.
    blackHoleDisk: {
      rate: 30, lifetime: 3, speed: 0.1, size: 0.1, render: false, intensity: 0.4,
      startColor: { color: [1, 1, 1, 1] },
      colorOverLifetime: BLACK_HOLE_COLORS,
      shape: { type: 'circle', radius: 0.9, thickness: 0.6, rotation: [90, 0, 0] },
      trail: { length: 1, world: true, width: 1, bucket: 'add' },
    },
    // Top Ray / Bot Ray: jets along the local Y axis, drawn as trails in local space.
    blackHoleJet: {
      rate: 2, lifetime: 5, speed: 2, size: 2, render: false, intensity: 0.5,
      startColor: { color: [1, 1, 1, 1] },
      colorOverLifetime: BLACK_HOLE_COLORS,
      sizeCurve: [[0, 0.209], [1, 1]],
      shape: { type: 'edge', radius: 0.01, randomDirection: 0.05 },
      trail: { length: 1, world: false, width: 1, bucket: 'add' },
    },
    // SOGalaxy/.../Ring: particles drift outwards for 20 s and leave spiralling trails.
    galaxyDisk: {
      rate: 15, lifetime: 20, speed: [0.05, 0.1], size: [0.1, 0.3], render: false,
      startColor: { color: [1, 1, 1, 1] },
      sizeCurve: [[0, 0], [0.15, 0.72], [0.5, 1], [0.94, 0.9], [1, 0]],
      colorOverLifetime: { c: [[0.18, 0.976, 0.824, 1], [0.43, 0.309, 0.36, 0.875], [0.79, 1, 0.905, 0.507], [1, 0.926, 0.477, 0.477]], a: FADE },
      shape: { type: 'circle', radius: 0.3, thickness: 0.2, rotation: [90, 0, 0] },
      trail: { length: 0.2, world: true, width: [0.8, 1.2], ratio: 0.7, bucket: 'alpha' },
    },
    // CenterConnection: a dense line of red-to-yellow sparks between the center and a neighbour.
    connection: {
      rate: 100, lifetime: 1, speed: [-0.2, 0.2], size: 0.7, bucket: 'add', prewarm: false, intensity: 0.45,
      startColor: { between: [[0.529, 0.148, 0.148, 1], [1, 0.972, 0, 1]] },
      sizeCurve: [[0, 1], [1, 0]],
      shape: { type: 'edge', radius: 1, randomDirection: 0.33 },
    },
    // Background (level0): twinkling dust over the whole view.
    background: {
      rate: 20, lifetime: 10, speed: 0, size: [0.15, 0.2], bucket: 'background',
      startColor: { color: [1, 1, 1, 1] },
      sizeCurve: [[0, 0], [0.9, 1], [1, 0]],
      colorOverLifetime: { a: [[0, 0], [0.1, 1], [0.36, 1], [0.49, 0.337], [0.59, 1], [0.9, 1], [1, 0]] },
      shape: { type: 'box', size: [6.92, 11.9, 0] },
    },
  };

  // ---------------------------------------------------------------- batched renderer

  const BUCKETS = {
    background: { texture: 'particle', additive: false, depthTest: false, order: -10 },
    alpha: { texture: 'particle', additive: false, depthTest: true, order: 5 },
    add: { texture: 'particle', additive: true, depthTest: true, order: 6 },
    sun: { texture: 'sunParticle', additive: true, depthTest: false, order: 7 },
    score: { texture: 'particle', additive: false, depthTest: false, order: 20 },
  };

  const VERTEX = `
    attribute vec4 color;
    varying vec2 vUv;
    varying vec4 vColor;
    void main() {
      vUv = uv;
      vColor = color;
      gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
    }`;

  const FRAGMENT = `
    uniform sampler2D map;
    varying vec2 vUv;
    varying vec4 vColor;
    void main() {
      vec4 t = texture2D(map, vUv);
      gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
    }`;

  class Bucket {
    constructor(def, texture, scene) {
      this.capacity = 0;
      this.count = 0;
      this.geometry = new THREE.BufferGeometry();
      this.material = new THREE.ShaderMaterial({
        uniforms: { map: { value: texture } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: def.depthTest,
        side: THREE.DoubleSide, // ribbons can face either way
        blending: def.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = def.order;
      this.mesh.matrixAutoUpdate = false;
      scene.add(this.mesh);
      this.grow(1024);
    }

    grow(capacity) {
      const old = this;
      const pos = new Float32Array(capacity * 12);
      const uv = new Float32Array(capacity * 8);
      const color = new Float32Array(capacity * 16);
      if (old.pos) {
        pos.set(old.pos);
        uv.set(old.uv);
        color.set(old.color);
      }
      const index = new Uint32Array(capacity * 6);
      for (let q = 0; q < capacity; q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
      this.pos = pos;
      this.uv = uv;
      this.color = color;
      this.capacity = capacity;
      const g = this.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(color, 4).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(new THREE.BufferAttribute(index, 1));
    }

    // Quad with corners a, b, c, d (each [x, y, z]) and texture coordinates u0..u1 x v0..v1.
    quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, u0, u1, r, g, b, a) {
      if (this.count >= this.capacity) this.grow(this.capacity * 2);
      const q = this.count++;
      const p = this.pos;
      const i = q * 12;
      p[i] = ax; p[i + 1] = ay; p[i + 2] = az;
      p[i + 3] = bx; p[i + 4] = by; p[i + 5] = bz;
      p[i + 6] = cx; p[i + 7] = cy; p[i + 8] = cz;
      p[i + 9] = dx; p[i + 10] = dy; p[i + 11] = dz;
      const t = this.uv;
      const j = q * 8;
      t[j] = u0; t[j + 1] = 0; t[j + 2] = u0; t[j + 3] = 1; t[j + 4] = u1; t[j + 5] = 1; t[j + 6] = u1; t[j + 7] = 0;
      const c = this.color;
      const k = q * 16;
      for (let v = 0; v < 16; v += 4) {
        c[k + v] = r; c[k + v + 1] = g; c[k + v + 2] = b; c[k + v + 3] = a;
      }
    }

    // Camera-facing square (the camera never rotates, so world XY is the screen plane).
    billboard(x, y, z, size, angle, r, g, b, a) {
      const h = size / 2;
      const cos = Math.cos(angle) * h;
      const sin = Math.sin(angle) * h;
      this.quad(x - cos + sin, y - sin - cos, z, x - cos - sin, y - sin + cos, z, x + cos - sin, y + sin + cos, z, x + cos + sin, y + sin - cos, z, 0, 1, r, g, b, a);
    }

    // Ribbon through points [x0, y0, z0, x1, ...]; the texture is stretched over the whole length.
    ribbon(pts, n, width, r, g, b, a) {
      if (n < 2) return;
      const h = width / 2;
      let pnx = 0;
      let pny = 0;
      for (let i = 0; i < n - 1; i++) {
        const x0 = pts[i * 3];
        const y0 = pts[i * 3 + 1];
        const x1 = pts[i * 3 + 3];
        const y1 = pts[i * 3 + 4];
        let dx = x1 - x0;
        let dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1e-6;
        dx /= len;
        dy /= len;
        const nx = -dy * h;
        const ny = dx * h;
        if (i === 0) {
          pnx = nx;
          pny = ny;
        }
        // Average the normals at the joint so consecutive segments connect without gaps.
        const jx = (pnx + nx) / 2;
        const jy = (pny + ny) / 2;
        const u0 = i / (n - 1);
        const u1 = (i + 1) / (n - 1);
        this.quad(x0 - jx, y0 - jy, pts[i * 3 + 2], x0 + jx, y0 + jy, pts[i * 3 + 2], x1 + nx, y1 + ny, pts[i * 3 + 5], x1 - nx, y1 - ny, pts[i * 3 + 5], u0, u1, r, g, b, a);
        pnx = nx;
        pny = ny;
      }
    }

    commit() {
      const g = this.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.uv.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
      g.setDrawRange(0, this.count * 6);
    }
  }

  // ---------------------------------------------------------------- emitter

  const tmpV = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpColor = [0, 0, 0, 0];
  const MIN_TRAIL_STEP = 0.08;
  const MAX_TRAIL_POINTS = 1024;

  class Emitter {
    constructor(def, node, options) {
      this.def = def;
      this.node = node;
      this.particles = [];
      this.accumulator = 0;
      this.active = true;
      this.scaleMul = (options && options.scale) || 1;
      this.shapeMatrix = def.shape.rotation
        ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(def.shape.rotation[0] * DEG, def.shape.rotation[1] * DEG, def.shape.rotation[2] * DEG, 'YXZ'))
        : null;
      if (def.prewarm !== false) this.prewarm();
    }

    prewarm() {
      // Start in the steady state: particles of every age, without trail history.
      const steps = 12;
      const dt = this.def.lifetime / steps;
      for (let i = 0; i < steps; i++) this.simulate(dt, false);
    }

    setActive(active) {
      if (active === this.active) return;
      this.active = active;
      if (!active) this.particles.length = 0;
      this.accumulator = 0;
    }

    spawn() {
      const d = this.def;
      const s = d.shape;
      let px = 0;
      let py = 0;
      let pz = 0;
      let dx = 0;
      let dy = 0;
      let dz = 0;
      if (s.type === 'sphere') {
        const u = rand(-1, 1);
        const phi = rand(0, Math.PI * 2);
        const q = Math.sqrt(1 - u * u);
        dx = q * Math.cos(phi);
        dy = q * Math.sin(phi);
        dz = u;
        const r = s.radius * (1 - (s.thickness || 0) * Math.random());
        px = dx * r;
        py = dy * r;
        pz = dz * r;
      } else if (s.type === 'circle') {
        const a = rand(0, Math.PI * 2);
        dx = Math.cos(a);
        dy = Math.sin(a);
        const r = s.radius * (1 - (s.thickness || 0) * Math.random());
        px = dx * r;
        py = dy * r;
      } else if (s.type === 'edge') {
        px = rand(-s.radius, s.radius);
        dy = 1;
      } else if (s.type === 'box') {
        px = rand(-0.5, 0.5) * s.size[0];
        py = rand(-0.5, 0.5) * s.size[1];
        dz = 1;
      }
      if (s.randomDirection) {
        const k = s.randomDirection;
        dx = dx * (1 - k) + rand(-1, 1) * k;
        dy = dy * (1 - k) + rand(-1, 1) * k;
        dz = dz * (1 - k) + rand(-1, 1) * k;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len;
        dy /= len;
        dz /= len;
      }
      if (this.shapeMatrix) {
        tmpV.set(px, py, pz).applyMatrix4(this.shapeMatrix);
        px = tmpV.x;
        py = tmpV.y;
        pz = tmpV.z;
        tmpV.set(dx, dy, dz).applyMatrix4(this.shapeMatrix);
        dx = tmpV.x;
        dy = tmpV.y;
        dz = tmpV.z;
      }
      const speed = pick(d.speed);
      const c = d.startColor;
      let color;
      if (c.color) color = c.color.slice();
      else if (c.between) {
        const k = Math.random();
        color = c.between[0].map((v, i) => v + (c.between[1][i] - v) * k);
      } else color = evalGradient(c.gradient, Math.random(), [0, 0, 0, 0]).slice();
      const hasTrail = d.trail && Math.random() < (d.trail.ratio || 1);
      this.particles.push({
        age: 0,
        x0: px,
        y0: py,
        z0: pz,
        vx: dx * speed,
        vy: dy * speed,
        vz: dz * speed,
        size: pick(d.size),
        angle: d.spin ? rand(-Math.PI, Math.PI) : 0,
        color,
        trailWidth: hasTrail ? pick(d.trail.width) : 0,
        trail: hasTrail && d.trail.world ? [] : null,
      });
    }

    simulate(dt, recordTrails) {
      const d = this.def;
      if (this.active) {
        this.accumulator += d.rate * dt;
        while (this.accumulator >= 1) {
          this.accumulator -= 1;
          this.spawn();
        }
      }
      let kept = 0;
      for (const p of this.particles) {
        p.age += dt;
        if (p.age >= d.lifetime) continue;
        this.particles[kept++] = p;
      }
      this.particles.length = kept;
      if (recordTrails) this.recordTrails();
    }

    localPosition(p, age, out) {
      return out.set(p.x0 + p.vx * age, p.y0 + p.vy * age, p.z0 + p.vz * age);
    }

    recordTrails() {
      const d = this.def;
      if (!d.trail || !d.trail.world) return;
      const maxAge = d.trail.length * d.lifetime;
      const m = this.node.matrixWorld;
      for (const p of this.particles) {
        if (!p.trail) continue;
        this.localPosition(p, p.age, tmpV).applyMatrix4(m);
        const t = p.trail;
        const n = t.length;
        if (n === 0 || Math.hypot(tmpV.x - t[n - 4], tmpV.y - t[n - 3]) >= MIN_TRAIL_STEP) t.push(tmpV.x, tmpV.y, tmpV.z, p.age);
        let drop = 0;
        while (drop < t.length && p.age - t[drop + 3] > maxAge) drop += 4;
        if (drop) t.splice(0, drop);
      }
    }

    draw(buckets, pts) {
      const d = this.def;
      const m = this.node.matrixWorld;
      const scale = tmpScale.setFromMatrixScale(m).x * this.scaleMul;
      if (scale <= 1e-4) return;
      const originZ = m.elements[14];
      const bucket = d.render !== false ? buckets[d.bucket] : null;
      const trailBucket = d.trail ? buckets[d.trail.bucket] : null;
      for (const p of this.particles) {
        const t = p.age / d.lifetime;
        const c = d.colorOverLifetime ? evalGradient(d.colorOverLifetime, t, tmpColor) : null;
        // Unity rendered these in LDR; `intensity` keeps the HDR bloom from blowing them out.
        const k = d.intensity || 1;
        const r = p.color[0] * (c ? c[0] : 1) * k;
        const g = p.color[1] * (c ? c[1] : 1) * k;
        const b = p.color[2] * (c ? c[2] : 1) * k;
        const a = p.color[3] * (c ? c[3] : 1);
        if (a <= 0.003) continue;
        const size = p.size * (d.sizeCurve ? evalCurve(d.sizeCurve, t) : 1) * scale;
        this.localPosition(p, p.age, tmpV).applyMatrix4(m);
        if (bucket && !(d.frontOnly && tmpV.z < originZ)) bucket.billboard(tmpV.x, tmpV.y, tmpV.z, size, p.angle, r, g, b, a);
        if (!p.trailWidth) continue;
        let n = 0;
        if (p.trail) {
          // World-space trail: recorded positions plus the current one.
          const start = Math.max(0, p.trail.length - (MAX_TRAIL_POINTS - 1) * 4);
          for (let i = start; i < p.trail.length; i += 4) {
            pts[n * 3] = p.trail[i];
            pts[n * 3 + 1] = p.trail[i + 1];
            pts[n * 3 + 2] = p.trail[i + 2];
            n++;
          }
        } else {
          // Local-space trail of a straight-moving particle: from its spawn point to now.
          this.localPosition(p, 0, tmpV).applyMatrix4(m);
          pts[0] = tmpV.x;
          pts[1] = tmpV.y;
          pts[2] = tmpV.z;
          n = 1;
        }
        this.localPosition(p, p.age, tmpV).applyMatrix4(m);
        pts[n * 3] = tmpV.x;
        pts[n * 3 + 1] = tmpV.y;
        pts[n * 3 + 2] = tmpV.z;
        n++;
        trailBucket.ribbon(pts, n, size * p.trailWidth, r, g, b, a);
      }
    }
  }

  // ---------------------------------------------------------------- registry

  const Particles = {
    systems: SYSTEMS,
    emitters: new Set(),
    drawers: new Set(), // extra callbacks drawing into the buckets (score particles)
    buckets: {},
    pts: new Float32Array(3 * MAX_TRAIL_POINTS),

    init(scene, textures) {
      for (const key of Object.keys(BUCKETS)) Particles.buckets[key] = new Bucket(BUCKETS[key], textures[BUCKETS[key].texture], scene);
    },

    // Attaches the named system to a scene-graph node; returns the emitter.
    attach(name, node, options) {
      const e = new Emitter(SYSTEMS[name], node, options);
      Particles.emitters.add(e);
      return e;
    },

    detach(emitter) {
      Particles.emitters.delete(emitter);
    },

    // Simulates and redraws everything; node world matrices must be current.
    update(dt) {
      const buckets = Object.values(Particles.buckets);
      for (const b of buckets) b.count = 0;
      for (const e of Particles.emitters) {
        e.simulate(dt, true);
        e.draw(Particles.buckets, Particles.pts);
      }
      for (const draw of Particles.drawers) draw(Particles.buckets);
      for (const b of buckets) b.commit();
    },
  };

  SE.Particles = Particles;
})();
