// Three.js scene: camera, tiles, space object models, particle effects and the bloom post pass.
// World units match the Unity scene (1 unit = distance between neighbouring hex tiles).
(function () {
  'use strict';

  const SE = window.SE;
  const C = SE.CONFIG;
  const THREE = window.THREE;
  const DEG = Math.PI / 180;
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  const col = (a) => new THREE.Color(a[0], a[1], a[2]);

  // Space objects float in front of the tiles, like the Unity "Container" at z = -10.
  const OBJECT_Z = 3;

  // Particle modes, selected per material with the MODE define.
  const ORBIT = 0; // aOrbit = radius, start angle, angular speed, phase (local XZ plane)
  const JET = 1; // aOrbit = start, length, speed, phase (along local +Y)
  const DRIFT = 2; // aOrbit = twinkle speed, phase, velocity x, velocity y (wraps inside the view)
  const STATIC = 3; // positions written by the CPU every frame
  const TWINKLE = 4; // fixed position, aOrbit.z = twinkle speed, aOrbit.w = phase

  const PARTICLE_VERTEX = `
    uniform float uTime;
    uniform float uPx;
    uniform vec2 uBoundsMin;
    uniform vec2 uBoundsSize;
    attribute vec4 aOrbit;
    attribute vec2 aSize;
    attribute vec4 aColor;
    varying vec4 vColor;
    void main() {
      vec3 p = position;
      float alpha = aColor.a;
      float size = aSize.x;
    #if MODE == 0
      float a = aOrbit.y + aOrbit.z * uTime;
      p = vec3(cos(a) * aOrbit.x, position.y, sin(a) * aOrbit.x);
      float pulse = sin(uTime * 2.3 + aOrbit.w);
      size *= 1.0 + aSize.y * pulse;
      alpha *= 0.75 + 0.25 * pulse;
    #elif MODE == 1
      float t = fract(uTime * aOrbit.z + aOrbit.w);
      p = vec3(position.x * (0.4 + t), aOrbit.x + t * aOrbit.y, position.z * (0.4 + t));
      alpha *= smoothstep(0.0, 0.15, t) * (1.0 - t);
      size *= 1.0 - 0.5 * t;
    #elif MODE == 2
      vec2 q = position.xy + aOrbit.zw * uTime - uBoundsMin;
      p = vec3(mod(q, uBoundsSize) + uBoundsMin, position.z);
      alpha *= 0.55 + 0.45 * sin(uTime * aOrbit.x + aOrbit.y);
    #elif MODE == 4
      // Per-instance phase from the object's position, so neighbouring clouds don't pulse in sync.
      float phase = aOrbit.w + modelMatrix[3].x * 2.1 + modelMatrix[3].y * 3.7;
      float pulse = sin(uTime * aOrbit.z + phase);
      size *= 1.0 + aSize.y * pulse;
      alpha *= 0.65 + 0.35 * pulse;
    #endif
      vColor = vec4(aColor.rgb, alpha);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      float s = length(modelMatrix[0].xyz);
      gl_PointSize = max(size * uPx * s, 0.0);
    }`;

  const PARTICLE_FRAGMENT = `
    uniform sampler2D uTex;
    varying vec4 vColor;
    void main() {
      gl_FragColor = vec4(vColor.rgb, vColor.a * texture2D(uTex, gl_PointCoord).a);
    }`;

  const BEAM_FRAGMENT = `
    uniform float uTime;
    uniform float uOpacity;
    varying vec2 vUv;
    void main() {
      float y = vUv.y - 0.5;
      float core = exp(-y * y * 140.0);
      float glow = exp(-y * y * 16.0) * 0.35;
      float flow = 0.55 + 0.45 * sin(vUv.x * 28.0 - uTime * 9.0);
      float ends = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
      float a = (core * flow + glow) * ends * uOpacity;
      gl_FragColor = vec4(mix(vec3(1.0, 0.8, 0.18), vec3(1.0, 1.0, 0.85), core * flow), a);
    }`;

  const QUAD_VERTEX = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;

  // ------------------------------------------------------------------ post processing

  // Soft-threshold bright pass, a mip chain of separable Gaussian blurs, and a composite
  // that adds the glow and boosts saturation.
  const BRIGHT_FRAGMENT = `
    uniform sampler2D tDiffuse;
    uniform float uThreshold;
    uniform float uKnee;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float br = max(c.r, max(c.g, c.b));
      float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-4);
      gl_FragColor = vec4(c * max(soft, br - uThreshold) / max(br, 1e-4), 1.0);
    }`;

  const BLUR_FRAGMENT = `
    uniform sampler2D tDiffuse;
    uniform vec2 uStep;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
      c += texture2D(tDiffuse, vUv + uStep * 1.3846153846).rgb * 0.3162162162;
      c += texture2D(tDiffuse, vUv - uStep * 1.3846153846).rgb * 0.3162162162;
      c += texture2D(tDiffuse, vUv + uStep * 3.2307692308).rgb * 0.0702702703;
      c += texture2D(tDiffuse, vUv - uStep * 3.2307692308).rgb * 0.0702702703;
      gl_FragColor = vec4(c, 1.0);
    }`;

  const COMPOSITE_FRAGMENT = `
    uniform sampler2D tScene;
    uniform sampler2D tBloom0;
    uniform sampler2D tBloom1;
    uniform sampler2D tBloom2;
    uniform sampler2D tBloom3;
    uniform sampler2D tBloom4;
    uniform float uStrength;
    uniform float uSaturation;
    varying vec2 vUv;
    void main() {
      vec3 bloom = texture2D(tBloom0, vUv).rgb
        + texture2D(tBloom1, vUv).rgb * 0.85
        + texture2D(tBloom2, vUv).rgb * 0.65
        + texture2D(tBloom3, vUv).rgb * 0.45
        + texture2D(tBloom4, vUv).rgb * 0.3;
      vec3 c = texture2D(tScene, vUv).rgb + bloom * uStrength;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(max(mix(vec3(l), c, uSaturation), 0.0), 1.0);
    }`;

  const BLOOM_LEVELS = 5;

  function createPost(renderer) {
    const webgl2 = renderer.capabilities.isWebGL2;
    const ext = renderer.extensions;
    // Half floats keep additive highlights above 1.0 so they bloom; fall back to 8 bit if unsupported.
    const hdr = webgl2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const target = (samples, depthBuffer) =>
      new THREE.WebGLRenderTarget(1, 1, { type, samples, depthBuffer, stencilBuffer: false });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene().add(quad);
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pass = (fragmentShader, uniforms) =>
      new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VERTEX, fragmentShader, depthTest: false, depthWrite: false });

    const sceneTarget = target(webgl2 ? 4 : 0, true); // 4x MSAA replaces the canvas antialiasing
    const brightTarget = target(0, false);
    const mips = [];
    const brightPass = pass(BRIGHT_FRAGMENT, {
      tDiffuse: { value: sceneTarget.texture },
      uThreshold: { value: C.post.threshold },
      uKnee: { value: C.post.knee },
    });
    const blurPass = pass(BLUR_FRAGMENT, { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } });
    const compositePass = pass(COMPOSITE_FRAGMENT, {
      tScene: { value: sceneTarget.texture },
      uStrength: { value: C.post.strength },
      uSaturation: { value: C.post.saturation },
    });
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const mip = { horizontal: target(0, false), vertical: target(0, false), width: 1, height: 1 };
      mips.push(mip);
      compositePass.uniforms['tBloom' + i] = { value: mip.vertical.texture };
    }

    const draw = (material, output) => {
      quad.material = material;
      renderer.setRenderTarget(output);
      renderer.render(quadScene, quadCamera);
    };

    return {
      setSize(w, h) {
        sceneTarget.setSize(w, h);
        let mw = Math.max(1, w >> 1);
        let mh = Math.max(1, h >> 1);
        brightTarget.setSize(mw, mh);
        for (const m of mips) {
          m.horizontal.setSize(mw, mh);
          m.vertical.setSize(mw, mh);
          m.width = mw;
          m.height = mh;
          mw = Math.max(1, mw >> 1);
          mh = Math.max(1, mh >> 1);
        }
      },

      render(scene, camera) {
        renderer.setRenderTarget(sceneTarget);
        renderer.render(scene, camera);
        draw(brightPass, brightTarget);

        const blur = blurPass.uniforms;
        let input = brightTarget.texture;
        for (const m of mips) {
          blur.tDiffuse.value = input;
          blur.uStep.value.set(1 / m.width, 0);
          draw(blurPass, m.horizontal);
          blur.tDiffuse.value = m.horizontal.texture;
          blur.uStep.value.set(0, 1 / m.height);
          draw(blurPass, m.vertical);
          input = m.vertical.texture;
        }
        draw(compositePass, null);
      },
    };
  }

  // ------------------------------------------------------------------ renderer

  const Render = {
    uTime: { value: 0 },
    uPx: { value: 100 },
    uBoundsMin: { value: new THREE.Vector2(-10, -10) },
    uBoundsSize: { value: new THREE.Vector2(20, 20) },
    visuals: new Set(),
    tex: {},
    geo: {},
    mat: {},
    view: { left: -1, right: 1, top: 1, bottom: -1 },
    size: { width: 1, height: 1, stageWidth: 1 },
    board: null,

    init(canvas) {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
      renderer.setClearColor(col(C.colors.background), 1);
      Render.renderer = renderer;
      Render.post = createPost(renderer);

      Render.scene = new THREE.Scene();
      Render.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
      Render.camera.position.z = 100;

      Render.scene.add(new THREE.AmbientLight(col(C.colors.ambient), 1.25));
      // Unity light rotation (15°, 15°, 0): light comes from the upper left, in front of the scene.
      const light = new THREE.DirectionalLight(0xffffff, 0.85);
      light.position.set(-0.25, 0.26, 0.93);
      Render.scene.add(light);

      Render.loadTextures();
      Render.buildGeometries();
      Render.buildMaterials();
      Render.buildBackground();
      Render.buildScoreParticles();
      Render.setBoard(SE.LEVELS[0]);
    },

    loadTextures() {
      const loader = new THREE.TextureLoader();
      const t = window.SE_ASSETS.textures;
      for (const key of Object.keys(t)) {
        const tex = loader.load(t[key]);
        tex.anisotropy = 4;
        Render.tex[key] = tex;
      }
      Render.tex.asteroid.wrapS = Render.tex.asteroid.wrapT = THREE.RepeatWrapping;
    },

    buildGeometries() {
      Render.geo.plane = new THREE.PlaneGeometry(1, 1);
      Render.geo.sphere = new THREE.SphereGeometry(1, 32, 20);

      const m = window.SE_ASSETS.asteroidMesh;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normal, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
      g.setIndex(m.index);
      Render.geo.asteroid = g;

      // Torus_001 from the gas planet prefab: major 1.615, tube 0.415, flattened to 16 %.
      Render.geo.torus = new THREE.TorusGeometry(1.615, 0.415, 12, 64).scale(1, 1, 0.161);

      const R = SE.rand;
      // Stardust keeps its particles in place and only twinkles.
      Render.geo.stardustDark = Render.particleGeometry(20, () => {
        const a = R(0, 6.28);
        const r = R(0.1, 0.36);
        return { pos: [Math.cos(a) * r, Math.sin(a) * r, 0], orbit: [0, 0, R(1.2, 2.4), R(0, 6.28)], size: [R(0.24, 0.4), 0.12], color: [0.16, 0.22, 0.5, 0.6] };
      });
      // Magenta / violet / blue glow, as on the app icon.
      const palette = [[0.95, 0.28, 1, 0.6], [0.62, 0.4, 1, 0.6], [0.35, 0.52, 1, 0.6], [1, 1, 1, 0.85]];
      Render.geo.stardustBright = Render.particleGeometry(32, (i) => {
        const c = palette[i % palette.length];
        const white = i % palette.length === 3;
        const a = R(0, 6.28);
        const r = Math.sqrt(Math.random()) * 0.32;
        return { pos: [Math.cos(a) * r, Math.sin(a) * r, 0.01], orbit: [0, 0, R(1.5, 3.5), R(0, 6.28)], size: [white ? R(0.05, 0.1) : R(0.1, 0.26), 0.35], color: c };
      });
      Render.geo.blackHoleDisk = Render.particleGeometry(120, (i) => {
        const r = R(0.27, 0.62);
        return { pos: [0, R(-0.015, 0.015), 0], orbit: [r, R(0, 6.28), 1.7 * Math.pow(0.3 / r, 1.5), R(0, 6.28)], size: [R(0.05, 0.15), 0.3], color: i % 3 === 0 ? [1, 1, 1, 0.7] : [0.5, 0.82, 1, 0.65] };
      });
      Render.geo.blackHoleJet = Render.particleGeometry(36, () => ({
        pos: [R(-0.03, 0.03), 0, R(-0.03, 0.03)],
        orbit: [0.16, R(0.4, 0.6), R(0.7, 1.2), R(0, 1)],
        size: [R(0.08, 0.15), 0],
        color: [0.6, 0.85, 1, 0.8],
      }));
      Render.geo.galaxyStars = Render.particleGeometry(240, (i) => {
        const r = 0.04 + Math.pow(Math.random(), 0.8) * 0.52;
        const k = r / 0.56;
        return { pos: [0, R(-0.01, 0.01), 0], orbit: [r, (i % 2) * Math.PI + r * 5.5 + R(-0.35, 0.35), 0.45, R(0, 6.28)], size: [R(0.05, 0.13) * (1.2 - k * 0.5), 0.3], color: [1 - 0.3 * k, 0.92 - 0.1 * k, 0.7 + 0.3 * k, 0.75] };
      });
      Render.geo.galaxyDust = Render.particleGeometry(50, (i) => {
        const r = R(0.12, 0.5);
        return { orbit: [r, (i % 2) * Math.PI + r * 5.5 + 0.45, 0.45, R(0, 6.28)], size: [R(0.1, 0.18), 0.1], color: [0.05, 0.04, 0.12, 0.45] };
      });
    },

    buildMaterials() {
      const tex = Render.tex;
      const transparent = (map, color) =>
        new THREE.MeshBasicMaterial({ map, color: col(color), transparent: true, depthWrite: false });
      Object.assign(Render.mat, {
        asteroid: new THREE.MeshLambertMaterial({ map: tex.asteroid, color: new THREE.Color(0.828, 0.702, 0.566) }),
        moon: new THREE.MeshLambertMaterial({ map: tex.moon, color: new THREE.Color(0.8, 0.81, 0.86), emissive: new THREE.Color(0.05, 0.05, 0.06) }),
        planet: new THREE.MeshLambertMaterial({ map: tex.planet }),
        gasPlanet: new THREE.MeshLambertMaterial({ map: tex.gasPlanet, color: new THREE.Color(0.831, 0.723, 0.562) }),
        sun: new THREE.MeshBasicMaterial({ map: tex.sun, color: new THREE.Color(1.15, 0.9, 0.3) }),
        black: new THREE.MeshBasicMaterial({ color: 0x000000 }),
        outline: {},
        corona: new THREE.SpriteMaterial({ map: tex.sunParticle, color: new THREE.Color(1.7, 1.2, 0.45), blending: THREE.AdditiveBlending, depthWrite: false }),
        corona2: new THREE.SpriteMaterial({ map: tex.sunParticle, color: new THREE.Color(1.5, 0.75, 0.2), blending: THREE.AdditiveBlending, depthWrite: false }),
        tileBorder: transparent(tex.tileBorder, C.colors.tileBorder),
        circleBorder: transparent(tex.circleBorder, C.colors.placeholderBorder),
        lastInnerBorder: transparent(tex.circleBorder, C.colors.lastPlaceholderInner),
        placeholder: transparent(tex.circleFilling, C.colors.placeholder),
        lastPlaceholder: transparent(tex.circleFilling, C.colors.center),
        particleAdd: Render.particleMaterial(ORBIT, true),
        particleAlpha: Render.particleMaterial(ORBIT, false),
        twinkleAdd: Render.particleMaterial(TWINKLE, true),
        twinkleAlpha: Render.particleMaterial(TWINKLE, false),
        jet: Render.particleMaterial(JET, true),
      });
      Render.sharedMaterials = new Set(Object.values(Render.mat));
    },

    outlineMaterial(rgb) {
      const key = rgb.join(',');
      let m = Render.mat.outline[key];
      if (!m) {
        m = Render.mat.outline[key] = new THREE.MeshBasicMaterial({ color: col(rgb), side: THREE.BackSide });
        Render.sharedMaterials.add(m);
      }
      return m;
    },

    particleMaterial(mode, additive) {
      return new THREE.ShaderMaterial({
        uniforms: {
          uTime: Render.uTime,
          uPx: Render.uPx,
          uBoundsMin: Render.uBoundsMin,
          uBoundsSize: Render.uBoundsSize,
          uTex: { value: Render.tex.particle },
        },
        defines: { MODE: mode },
        vertexShader: PARTICLE_VERTEX,
        fragmentShader: PARTICLE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
    },

    // Builds a particle geometry; fn(i) returns { pos, orbit, size, color }.
    particleGeometry(count, fn) {
      const pos = new Float32Array(count * 3);
      const orbit = new Float32Array(count * 4);
      const size = new Float32Array(count * 2);
      const color = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const p = fn(i);
        if (p.pos) pos.set(p.pos, i * 3);
        if (p.orbit) orbit.set(p.orbit, i * 4);
        size.set(p.size, i * 2);
        color.set(p.color, i * 4);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 2));
      g.setAttribute('aColor', new THREE.BufferAttribute(color, 4));
      return g;
    },

    points(geometry, material, renderOrder) {
      const p = new THREE.Points(geometry, material);
      p.frustumCulled = false;
      p.renderOrder = renderOrder;
      return p;
    },

    buildBackground() {
      const R = SE.rand;
      const g = Render.particleGeometry(160, () => ({
        pos: [R(-20, 20), R(-20, 20), -50],
        orbit: [R(0.4, 1.6), R(0, 6.28), R(-0.06, 0.06), R(0.02, 0.12)],
        size: [R(0.03, 0.1), 0],
        color: Math.random() < 0.4 ? [0.62, 0.75, 1, R(0.15, 0.4)] : [1, 1, 1, R(0.1, 0.35)],
      }));
      const m = Render.particleMaterial(DRIFT, true);
      m.depthTest = false;
      Render.scene.add(Render.points(g, m, -10));
    },

    buildScoreParticles() {
      const capacity = 4000;
      const g = Render.particleGeometry(capacity, () => ({ size: [0, 0], color: [0, 0, 0, 0] }));
      for (const name of ['position', 'aSize', 'aColor']) g.attributes[name].setUsage(THREE.DynamicDrawUsage);
      g.setDrawRange(0, 0);
      const m = Render.particleMaterial(STATIC, true);
      m.depthTest = false;
      const points = Render.points(g, m, 20);
      points.position.z = 10;
      Render.scene.add(points);
      Render.scoreParticles = {
        capacity,
        geometry: g,
        pos: g.attributes.position.array,
        size: g.attributes.aSize.array,
        color: g.attributes.aColor.array,
      };
    },

    // Score particles write straight into the GPU buffers; call after filling `count` entries.
    commitScoreParticles(count) {
      const sp = Render.scoreParticles;
      const a = sp.geometry.attributes;
      a.position.needsUpdate = a.aSize.needsUpdate = a.aColor.needsUpdate = true;
      sp.geometry.setDrawRange(0, count);
    },

    // ------------------------------------------------------------ camera

    setBoard(level) {
      Render.board = level.bounds;
      Render.fitCamera();
    },

    resize(width, height, stageWidth) {
      Render.size = { width, height, stageWidth };
      const renderer = Render.renderer;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      Render.post.setSize(buffer.x, buffer.y);
      Render.fitCamera();
    },

    // CameraPositioning, generalised: fit the board and preview row below the HUD bar.
    fitCamera() {
      const { width, height, stageWidth } = Render.size;
      const b = Render.board;
      if (!b) return;
      const hud = C.camera.hudFraction;
      const radiusX = Math.max(C.camera.minRadius, b.maxX);
      const minHalfHeight = (b.maxY - b.minY) / (2 * (1 - hud));
      const h = Math.max(radiusX / (stageWidth / height), minHalfHeight);
      const w = (h * width) / height;
      const camY = (b.minY + b.maxY) / 2 + hud * h;
      const cam = Render.camera;
      Object.assign(cam, { left: -w, right: w, top: h, bottom: -h });
      cam.position.y = camY;
      cam.updateProjectionMatrix();
      Render.view = { left: -w, right: w, top: camY + h, bottom: camY - h };
      Render.uPx.value = Render.renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * h);
      Render.uBoundsMin.value.set(-w - 0.5, camY - h - 0.5);
      Render.uBoundsSize.value.set(2 * w + 1, 2 * h + 1);
    },

    screenToWorld(clientX, clientY) {
      const rect = Render.renderer.domElement.getBoundingClientRect();
      const v = Render.view;
      return new THREE.Vector2(
        v.left + ((clientX - rect.left) / rect.width) * (v.right - v.left),
        v.top - ((clientY - rect.top) / rect.height) * (v.top - v.bottom)
      );
    },

    update(dt) {
      Render.uTime.value += dt;
      for (const root of Render.visuals) {
        for (const s of root.userData.spinners) {
          if (s.sprite) s.sprite.material.rotation += s.speed * dt;
          else s.obj.rotateOnAxis(s.axis, s.speed * dt);
        }
      }
    },

    render() {
      Render.post.render(Render.scene, Render.camera);
    },

    // ------------------------------------------------------------ tiles

    createTile() {
      const group = new THREE.Group();
      const border = new THREE.Mesh(Render.geo.plane, Render.mat.tileBorder);
      border.scale.set(1.17, 1.0102, 1);
      border.renderOrder = 1;
      const material = new THREE.MeshBasicMaterial({ map: Render.tex.tileFilling, color: col(C.colors.tile), transparent: true, depthWrite: false });
      const fill = new THREE.Mesh(Render.geo.plane, material);
      fill.scale.set(1.0805, 0.937, 1);
      fill.renderOrder = 2;
      group.add(border, fill);
      return { group, material };
    },

    createCenterTile() {
      const group = new THREE.Group();
      const material = new THREE.MeshBasicMaterial({ map: Render.tex.circleFilling, color: col(C.colors.center), transparent: true, depthWrite: false });
      const fill = new THREE.Mesh(Render.geo.plane, material);
      fill.renderOrder = 2;
      group.add(fill);
      return { group, material };
    },

    createPlaceholder(last) {
      const group = new THREE.Group();
      const add = (material, scale, order) => {
        const m = new THREE.Mesh(Render.geo.plane, material);
        m.scale.set(scale, scale, 1);
        m.renderOrder = order;
        group.add(m);
      };
      add(last ? Render.mat.lastPlaceholder : Render.mat.placeholder, 1, 1);
      add(Render.mat.circleBorder, 1.01, 2);
      if (last) add(Render.mat.lastInnerBorder, 0.91, 2);
      return group;
    },

    // ConnectionEffect: glowing link between the center and a neighbour of the same type.
    createBeam(from, to) {
      const material = new THREE.ShaderMaterial({
        uniforms: { uTime: Render.uTime, uOpacity: { value: 0 } },
        vertexShader: QUAD_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(Render.geo.plane, material);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, 1);
      mesh.rotation.z = Math.atan2(dy, dx);
      mesh.scale.set(Math.hypot(dx, dy), 0.34, 1);
      mesh.renderOrder = 3;
      return { mesh, material };
    },

    // ------------------------------------------------------------ space objects

    // Returns a Group whose position/scale the game animates; children spin on their own.
    createSpaceObject(type) {
      const root = new THREE.Group();
      const container = new THREE.Group();
      container.position.z = OBJECT_Z;
      root.add(container);
      const spinners = (root.userData.spinners = []);
      const spin = (obj, axis, degPerSec) => {
        const sign = Math.random() > 0.5 ? -1 : 1;
        spinners.push({ obj, axis: axis.clone().normalize(), speed: sign * degPerSec * DEG });
      };
      const tilted = (x, z) => {
        const g = new THREE.Group();
        g.rotation.set(x * DEG, 0, z * DEG);
        container.add(g);
        return g;
      };

      switch (type) {
        case SE.Type.stardust: {
          // Static cloud; a random orientation per instance avoids identical copies.
          const cloud = new THREE.Group();
          cloud.rotation.z = Math.random() * Math.PI * 2;
          cloud.scale.x = Math.random() > 0.5 ? 1 : -1;
          cloud.add(Render.points(Render.geo.stardustDark, Render.mat.twinkleAlpha, 5));
          cloud.add(Render.points(Render.geo.stardustBright, Render.mat.twinkleAdd, 6));
          container.add(cloud);
          break;
        }
        case SE.Type.astroid: {
          const m = Render.outlined(Render.geo.asteroid, Render.mat.asteroid, [0.827, 0.702, 0.565], 0.2, 0.25);
          m.rotation.set(Math.random() * 6.28, Math.random() * 6.28, 0);
          container.add(m);
          spin(m, new THREE.Vector3(0.2, 1, 0), 30);
          break;
        }
        case SE.Type.moon: {
          const m = Render.outlined(Render.geo.sphere, Render.mat.moon, [0.809, 0.809, 0.809], 0.2, 0.3);
          m.rotation.set(0.4, Math.random() * 6.28, 0.3);
          container.add(m);
          spin(m, Y_AXIS, 10);
          break;
        }
        case SE.Type.planet: {
          const m = Render.outlined(Render.geo.sphere, Render.mat.planet, [0.38, 0.506, 0.875], 0.15, 0.35);
          m.rotation.y = Math.random() * 6.28;
          tilted(0, 15).add(m);
          spin(m, Y_AXIS, 25);
          break;
        }
        case SE.Type.gasplanet: {
          const body = new THREE.Group();
          body.scale.setScalar(0.375);
          body.rotation.y = Math.random() * 6.28;
          const outline = [0.905, 0.926, 0.538];
          const ring = Render.outlined(Render.geo.torus, Render.mat.gasPlanet, outline, 0.15, 1);
          ring.rotation.x = -Math.PI / 2;
          body.add(Render.outlined(Render.geo.sphere, Render.mat.gasPlanet, outline, 0.15, 1), ring);
          tilted(12, 15).add(body);
          spin(body, Y_AXIS, 35);
          break;
        }
        case SE.Type.sun: {
          const glow = new THREE.Sprite(Render.mat.corona.clone());
          glow.scale.set(1.75, 1.75, 1);
          glow.position.z = -0.5;
          const glow2 = new THREE.Sprite(Render.mat.corona2.clone());
          glow2.scale.set(1.2, 1.2, 1);
          glow2.position.z = -0.45;
          const m = new THREE.Mesh(Render.geo.sphere, Render.mat.sun);
          m.scale.setScalar(0.45);
          m.rotation.y = Math.random() * 6.28;
          container.add(glow, glow2, m);
          spin(m, Y_AXIS, 10);
          spinners.push({ sprite: glow, speed: 0.35 }, { sprite: glow2, speed: -0.5 });
          break;
        }
        case SE.Type.blackhole: {
          const g = tilted(15, -25);
          g.add(Render.outlined(Render.geo.sphere, Render.mat.black, [1, 1, 1], 0.2, 0.2));
          g.add(Render.points(Render.geo.blackHoleDisk, Render.mat.particleAdd, 6));
          const bottom = Render.points(Render.geo.blackHoleJet, Render.mat.jet, 6);
          bottom.rotation.x = Math.PI;
          g.add(Render.points(Render.geo.blackHoleJet, Render.mat.jet, 6), bottom);
          break;
        }
        case SE.Type.galaxy: {
          const g = tilted(35, -15);
          g.add(Render.outlined(Render.geo.sphere, Render.mat.black, [1, 0.941, 0.61], 0.5, 0.075));
          g.add(Render.points(Render.geo.galaxyDust, Render.mat.particleAlpha, 5));
          g.add(Render.points(Render.geo.galaxyStars, Render.mat.particleAdd, 6));
          break;
        }
      }
      Render.visuals.add(root);
      return root;
    },

    destroyVisual(root) {
      Render.visuals.delete(root);
      if (root.parent) root.parent.remove(root);
      for (const s of root.userData.spinners) if (s.sprite) s.sprite.material.dispose();
    },

    // Disposes per-instance materials of a removed group (tiles, beams, sun sprites).
    disposeGroup(group) {
      group.traverse((o) => {
        if ((o.isMesh || o.isSprite) && !Render.sharedMaterials.has(o.material)) o.material.dispose();
      });
    },

    outlined(geometry, material, outlineColor, outline, scale) {
      const g = new THREE.Group();
      // Outlined/Custom shader: back faces pushed out along the normals, drawn in the outline colour.
      const shell = new THREE.Mesh(geometry, Render.outlineMaterial(outlineColor));
      shell.scale.setScalar(1 + outline * 0.6);
      g.add(shell, new THREE.Mesh(geometry, material));
      g.scale.setScalar(scale);
      return g;
    },
  };

  SE.Render = Render;
})();
