// Three.js scene: camera, tiles, space object models and the bloom post pass.
// World units match the Unity scene (1 unit = distance between neighbouring hex tiles).
// Object hierarchies, rotation axes and speeds follow the Unity prefabs (see docs/SPEC.md).
(function () {
  'use strict';

  const SE = window.SE;
  const C = SE.CONFIG;
  const THREE = window.THREE;
  const Particles = SE.Particles;
  const DEG = Math.PI / 180;
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  const col = (a) => new THREE.Color(a[0], a[1], a[2]);

  // Space objects float in front of the tiles, like the Unity "Container" at z = -10.
  const OBJECT_Z = 3;
  // Outlined/Custom shader: back faces pushed out along the normals. Factor tuned for a comic look.
  const OUTLINE_SCALE = 1.0;

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
    visuals: new Set(),
    tex: {},
    geo: {},
    mat: {},
    view: { left: -1, right: 1, top: 1, bottom: -1 },
    size: { width: 1, height: 1, stageWidth: 1 },
    board: null,
    dt: 0,

    init(canvas) {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
      renderer.setClearColor(col(C.colors.background), 1);
      Render.renderer = renderer;
      Render.post = createPost(renderer);

      Render.scene = new THREE.Scene();
      Render.scene.autoUpdate = false; // world matrices are updated once per frame in render()
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
      Particles.init(Render.scene, Render.tex);

      // Background (level0): twinkling dust behind everything, sized to the view in fitCamera().
      Render.backgroundNode = new THREE.Object3D();
      Render.backgroundNode.position.z = -50;
      Render.scene.add(Render.backgroundNode);
      Render.background = Particles.attach('background', Render.backgroundNode);

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
        tileBorder: transparent(tex.tileBorder, C.colors.tileBorder),
        circleBorder: transparent(tex.circleBorder, C.colors.placeholderBorder),
        lastInnerBorder: transparent(tex.circleBorder, C.colors.lastPlaceholderInner),
        placeholder: transparent(tex.circleFilling, C.colors.placeholder),
        lastPlaceholder: transparent(tex.circleFilling, C.colors.center),
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
      // BackgroundScript: the emission box covers the whole view.
      Render.backgroundNode.position.y = camY;
      Render.background.def = Object.assign({}, Particles.systems.background, { shape: { type: 'box', size: [2 * w, 2 * h, 0] } });
    },

    screenToWorld(clientX, clientY) {
      const rect = Render.renderer.domElement.getBoundingClientRect();
      const v = Render.view;
      return new THREE.Vector2(
        v.left + ((clientX - rect.left) / rect.width) * (v.right - v.left),
        v.top - ((clientY - rect.top) / rect.height) * (v.top - v.bottom)
      );
    },

    // Rotate scripts: Space.World spins premultiply (around the parent's axis), Space.Self spins locally.
    update(dt) {
      Render.dt = dt;
      for (const root of Render.visuals) {
        for (const s of root.userData.spinners) {
          s.q.setFromAxisAngle(s.axis, s.speed * dt);
          if (s.world) s.obj.quaternion.premultiply(s.q);
          else s.obj.quaternion.multiply(s.q);
        }
      }
    },

    render() {
      Render.scene.updateMatrixWorld();
      Particles.update(Render.dt);
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

    // ConnectionEffect: sparks along the line between the center and a neighbour of the same type.
    createConnection(from, to) {
      const node = new THREE.Object3D();
      node.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, 1);
      node.rotation.z = Math.atan2(to.y - from.y, to.x - from.x);
      const emitter = Particles.attach('connection', node);
      emitter.setActive(false);
      return { node, emitter };
    },

    // ------------------------------------------------------------ space objects

    // Returns a Group whose position/scale the game animates; children spin like the Unity prefabs.
    createSpaceObject(type) {
      const root = new THREE.Group();
      const container = new THREE.Group();
      container.position.z = OBJECT_Z;
      root.add(container);
      const spinners = (root.userData.spinners = []);
      const emitters = (root.userData.emitters = []);
      const sign = Math.random() > 0.5 ? -1 : 1;
      const spin = (obj, axis, degPerSec, world) =>
        spinners.push({ obj, axis: axis.clone().normalize(), speed: sign * degPerSec * DEG, world, q: new THREE.Quaternion() });
      const group = (parent, opts = {}) => {
        const g = new THREE.Group();
        if (opts.rot) g.rotation.set(opts.rot[0] * DEG, opts.rot[1] * DEG, opts.rot[2] * DEG);
        if (opts.pos) g.position.set(opts.pos[0], opts.pos[1], opts.pos[2]);
        if (opts.scale) g.scale.setScalar(opts.scale);
        parent.add(g);
        return g;
      };
      const emit = (name, node) => emitters.push(Particles.attach(name, node));

      switch (type) {
        case SE.Type.stardust: {
          const node = group(container);
          emit('darkDust', node);
          emit('brightDust', node);
          break;
        }
        case SE.Type.astroid: {
          spin(container, new THREE.Vector3(0, 1, -0.5), 80, true);
          const m = Render.outlined(Render.geo.asteroid, Render.mat.asteroid, [0.827, 0.702, 0.565], 0.2, 0.25);
          m.rotation.set(-Math.PI / 2, Math.random() * 6.28, 0);
          container.add(m);
          break;
        }
        case SE.Type.moon: {
          spin(container, new THREE.Vector3(0.2, 1, 0), 30, true);
          const m = Render.outlined(Render.geo.sphere, Render.mat.moon, [0.809, 0.809, 0.809], 0.2, 0.3);
          m.quaternion.set(0.742, -0.242, 0.346, 0.52).normalize();
          container.add(m);
          break;
        }
        case SE.Type.planet: {
          spin(container, Y_AXIS, 30, true);
          const tilt = group(container, { rot: [0, 0, 15] });
          spin(tilt, Y_AXIS, 60, false);
          tilt.add(Render.outlined(Render.geo.sphere, Render.mat.planet, [0.38, 0.506, 0.875], 0.15, 0.35));
          break;
        }
        case SE.Type.gasplanet: {
          spin(container, Y_AXIS, 35, true);
          const tilt = group(container, { rot: [0, 0, 15], scale: 0.375 });
          spin(tilt, Y_AXIS, 65, false);
          const outline = [0.905, 0.926, 0.538];
          const ring = Render.outlined(Render.geo.torus, Render.mat.gasPlanet, outline, 0.15, 1);
          ring.rotation.x = -Math.PI / 2;
          tilt.add(Render.outlined(Render.geo.sphere, Render.mat.gasPlanet, outline, 0.15, 1), ring);
          break;
        }
        case SE.Type.sun: {
          emit('sunRim', group(root, { pos: [0, 0, OBJECT_Z], scale: 0.45 }));
          spin(container, Y_AXIS, 10, true);
          const model = group(container, { scale: 0.45 });
          model.add(new THREE.Mesh(Render.geo.sphere, Render.mat.sun));
          emit('sunSurface', model);
          break;
        }
        case SE.Type.blackhole: {
          const turn = group(container);
          spin(turn, Y_AXIS, 25, true);
          const model = group(turn, { rot: [15, 0, 0], scale: 0.2 });
          model.add(Render.outlined(Render.geo.sphere, Render.mat.black, [1, 1, 1], 0.2, 1));
          const ring = group(model, { scale: 6 });
          spin(ring, Y_AXIS, 50, false);
          emit('blackHoleDisk', ring);
          emit('blackHoleJet', group(model, { pos: [0, 1.5, 0] }));
          emit('blackHoleJet', group(model, { pos: [0, -1.5, 0], rot: [180, 0, 0] }));
          break;
        }
        case SE.Type.galaxy: {
          spin(container, Y_AXIS, 10, true);
          const model = group(container, { rot: [25, 0, 0], scale: 0.075 });
          model.add(Render.outlined(Render.geo.sphere, Render.mat.black, [1, 0.941, 0.61], 0.5, 1));
          const ring = group(model, { scale: 15 });
          spin(ring, Y_AXIS, 10, false);
          emit('galaxyDisk', ring);
          break;
        }
      }
      Render.visuals.add(root);
      return root;
    },

    destroyVisual(root) {
      Render.visuals.delete(root);
      for (const e of root.userData.emitters) Particles.detach(e);
      if (root.parent) root.parent.remove(root);
    },

    // Disposes per-instance materials of a removed group (tiles, center).
    disposeGroup(group) {
      group.traverse((o) => {
        if (o.isMesh && !Render.sharedMaterials.has(o.material)) o.material.dispose();
      });
    },

    outlined(geometry, material, outlineColor, outline, scale) {
      const g = new THREE.Group();
      const shell = new THREE.Mesh(geometry, Render.outlineMaterial(outlineColor));
      shell.scale.setScalar(1 + outline * OUTLINE_SCALE);
      g.add(shell, new THREE.Mesh(geometry, material));
      g.scale.setScalar(scale);
      return g;
    },
  };

  SE.Render = Render;
})();
