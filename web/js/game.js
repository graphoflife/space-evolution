// Game scene: a port of GameManager, Map, Maptile, CenterMapTile, SelectionManager,
// ScoreManager, SpeedRunManager and StartManager from the original C# code.
// Unity coroutines become async functions awaiting session.wait(seconds).
(function () {
  'use strict';

  const SE = window.SE;
  const C = SE.CONFIG;
  const THREE = window.THREE;
  const Render = SE.Render;
  const Save = SE.Save;
  const DEG = Math.PI / 180;

  // Scratch vectors for the per-frame paths.
  const tmpDest = new THREE.Vector3();
  const tmpWorld = new THREE.Vector3();

  // ------------------------------------------------------------------ SpaceObject

  class SpaceObj {
    constructor(session, type, parent, worldPos) {
      this.session = session;
      this.type = type;
      this.root = Render.createSpaceObject(type);
      this.move = null;
      this.dead = false;
      parent.add(this.root);
      parent.updateMatrixWorld(true);
      this.root.position.copy(parent.worldToLocal(worldPos.clone()));
      session.objects.add(this);
    }

    setParent(parent) {
      parent.attach(this.root);
    }

    goTo(dest, die, scaleDest, popup) {
      if (popup) this.root.scale.setScalar(0);
      const m = this.move || { startWorld: new THREE.Vector3() };
      this.root.getWorldPosition(m.startWorld);
      Object.assign(m, { dest, die, scaleDest, t: 0, startScale: this.root.scale.x });
      this.move = m;
    }

    update(dt) {
      const m = this.move;
      if (!m) return;
      m.t += dt;
      const k = m.t / this.session.combiningTime;
      if (k >= 1) {
        this.root.position.set(0, 0, 0);
        this.root.scale.setScalar(m.scaleDest);
        this.move = null;
        if (m.die) this.destroy();
        return;
      }
      const p = SE.evalCurve(k);
      m.dest.getWorldPosition(tmpDest);
      tmpWorld.copy(m.startWorld).lerp(tmpDest, p);
      this.root.position.copy(this.root.parent.worldToLocal(tmpWorld));
      this.root.scale.setScalar(m.startScale + (m.scaleDest - m.startScale) * p);
    }

    destroy() {
      if (this.dead) return;
      this.dead = true;
      Render.destroyVisual(this.root);
      this.session.objects.delete(this);
    }
  }

  // ------------------------------------------------------------------ Maptile

  class Tile {
    constructor(session, x, y, visual) {
      this.session = session;
      this.x = x;
      this.y = y;
      this.obj = null;
      this.neighbours = [];
      this.connectedToCenter = false;
      this.isCenter = false;
      this.group = visual.group;
      this.material = visual.material;
      this.normalColor = new THREE.Color().fromArray(C.colors.tile);
      this.flashDuration = C.tileFlashTime;
      this.flashT = Infinity;
    }

    contains() {
      return this.obj !== null;
    }

    compareType(other) {
      return this.obj !== null && other.obj !== null && this.obj.type === other.obj.type;
    }

    worldPosition() {
      return this.group.getWorldPosition(new THREE.Vector3());
    }

    findNeighbours() {
      this.neighbours = this.session.tiles.filter(
        (t) => t !== this && !t.isCenter && Math.hypot(t.x - this.x, t.y - this.y) < 1.1
      );
    }

    async removeObject(target, waitTime) {
      const temp = this.obj;
      this.obj = null;
      await this.session.wait(waitTime);
      if (temp && !temp.dead) temp.goTo(target.group, true, 0, false);
    }

    tryToCombine(givesScore) {
      const group = this.collectGroup();
      const info = SE.info(this.obj.type);
      if (group.length >= info.amountToCombine && !this.connectedToCenter) {
        this.session.objectCreated(info.next);
        this.combineObjects(group, info, givesScore);
        return true;
      }
      const center = this.session.center;
      if (center) return center.tryToCombine(givesScore);
      this.session.checkGameover();
      return false;
    }

    // addAllNeighboursToCombine as an iterative flood fill over same-type tiles.
    collectGroup() {
      const group = [this];
      for (let i = 0; i < group.length; i++) {
        for (const n of group[i].neighbours) {
          if (!n.connectedToCenter && n.compareType(group[i]) && !group.includes(n)) group.push(n);
        }
      }
      return group;
    }

    async combineObjects(group, info, givesScore) {
      const s = this.session;
      s.canPlace = false;
      for (const tile of group) tile.removeObject(this, s.combiningTime);
      await s.wait(s.combiningTime);
      if (givesScore) s.score.addForCombining(info.type, group.length, this);
      const chained = s.spawnObject(this, info.next, false, true, this.worldPosition());
      s.canPlace = !chained;
      this.flashT = 0;
    }

    refreshConnectionToCenter() {
      this.connectedToCenter = this.compareType(this.session.center);
    }

    updateColor(dt) {
      const c = this.material.color;
      if (this.flashT < this.flashDuration) {
        this.flashT += dt;
        c.setRGB(1, 1, 1).lerp(this.normalColor, Math.min(1, this.flashT / this.flashDuration));
      } else if (!c.equals(this.normalColor)) {
        c.lerp(this.normalColor, Math.min(1, dt / this.session.combiningTime));
        if (Math.abs(c.r - this.normalColor.r) + Math.abs(c.g - this.normalColor.g) < 0.002) c.copy(this.normalColor);
      }
    }
  }

  class CenterTile extends Tile {
    constructor(session) {
      super(session, 0, 0, Render.createCenterTile());
      this.isCenter = true;
      this.normalColor.fromArray(C.colors.center);
      this.flashDuration = C.centerFlashTime;
      this.connections = [];
    }

    tryToCombine(givesScore) {
      const s = this.session;
      if (this.neighbours.every((n) => this.compareType(n))) {
        const info = SE.info(this.obj.type);
        s.speedrun.levelReached(info.next, true);
        if (info.next === SE.Type.blackhole) SE.UI.showMessage('youWin', 1);
        this.combineObjects([this, ...this.neighbours], info, givesScore);
        return true;
      }
      s.checkGameover();
      return false;
    }

    findNeighbours() {
      const s = this.session;
      this.neighbours = s.level.spokes.map(([x, y]) => s.tileAtLocal(x, y)).filter(Boolean);
      for (const n of this.neighbours) {
        n.normalColor.fromArray(C.colors.centerNeighbour);
        const connection = Render.createConnection(this, n);
        connection.tile = n;
        s.mapGroup.add(connection.node);
        this.connections.push(connection);
      }
      this.refreshCenterNeighbourState();
    }

    // ConnectionEffect.refreshState: sparks run while a neighbour matches the center.
    refreshCenterNeighbourState() {
      for (const n of this.neighbours) n.refreshConnectionToCenter();
      for (const c of this.connections) c.emitter.setActive(c.tile.compareType(this));
    }

    destroy() {
      for (const c of this.connections) SE.Particles.detach(c.emitter);
    }
  }

  // ------------------------------------------------------------------ SelectionManager

  class Selection {
    constructor(session) {
      this.session = session;
      this.group = new THREE.Group();
      this.placeholders = [];
      this.queue = [];
      this.totalWeight = SE.OBJECTS.reduce((sum, o) => sum + o.spawnProbability, 0);
    }

    // Small slots on the left, the big "next" slot on the right, centred as a row.
    layout() {
      const q = C.queue;
      const n = C.previewCount;
      const small = q.smallScale / 2;
      const big = q.bigScale / 2;
      const bigOffset = (n - 2) * q.spacing + small + q.gap + big;
      const x0 = -(bigOffset + big + small) / 2 + small;
      const y = this.session.level.queueY;
      const slots = [];
      for (let i = 0; i < n - 1; i++) slots.push({ x: x0 + i * q.spacing, y, scale: q.smallScale, last: false });
      slots.push({ x: x0 + bigOffset, y, scale: q.bigScale, last: true });
      return slots;
    }

    async setup(savedQueue) {
      const slots = this.layout();
      const n = slots.length;
      for (let i = 0; i < n; i++) {
        const slot = slots[i];
        const ph = Render.createPlaceholder(slot.last);
        ph.scale.setScalar(0);
        this.group.add(ph);
        this.session.addSpawnMover(ph, new THREE.Vector3(slot.x, slot.y, 0), slot.scale, C.queue.spawnTime);
        this.placeholders[n - i - 1] = ph; // index 0 = next object (big slot)
        await this.session.wait(C.queue.spawnTime);
      }
      this.fillUpQueue(savedQueue);
    }

    randomType() {
      const all = SE.OBJECTS;
      const num = Math.random() * this.totalWeight;
      let idx = 0;
      let acc = all[0].spawnProbability;
      while (num > acc && idx < all.length - 1) acc += all[++idx].spawnProbability;
      return all[idx].type;
    }

    getNext() {
      if (!this.queue.length) return null;
      const next = this.queue.shift();
      this.fillUpQueue(null);
      return next;
    }

    fillUpQueue(savedQueue) {
      const missing = this.placeholders.length - this.queue.length;
      const types = (savedQueue || []).slice(0, missing);
      while (types.length < missing) types.push(this.randomType());
      const spawnAt = this.placeholders[this.placeholders.length - 1].getWorldPosition(new THREE.Vector3());
      for (const type of types) this.queue.push(new SpaceObj(this.session, type, this.group, spawnAt));
      this.queue.forEach((obj, i) => {
        obj.setParent(this.placeholders[i]);
        obj.goTo(this.placeholders[i], false, 1, false);
      });
    }

    types() {
      return this.queue.map((o) => o.type);
    }
  }

  // ------------------------------------------------------------------ ScoreManager

  // ScoreObject prefab: a white-to-cyan blob (size 0.4) with a 0.2 s world-space trail.
  const SCORE_TRAIL_TIME = 0.2;
  const SCORE_CYAN = [0, 0.834, 1];

  class Score {
    constructor(session) {
      this.session = session;
      this.record = session.record;
      this.score = 0;
      this.queue = [];
      this.amountToSpawn = 0;
      this.objects = [];
      this.pts = new Float32Array(3 * 64);
      this.drawer = (buckets) => this.draw(buckets.score);
      SE.Particles.drawers.add(this.drawer);
    }

    destroy() {
      SE.Particles.drawers.delete(this.drawer);
    }

    setScore(value) {
      this.score = value;
      this.refresh();
    }

    addScore(amount) {
      if (amount > 0) this.score += amount;
      this.updateHighScore(false);
      this.refresh();
      SE.UI.bumpScore();
    }

    updateHighScore(exact) {
      const total = exact ? this.getTotalScore() : this.score;
      if (total > this.record.highScore) this.record.highScore = total;
    }

    refresh() {
      SE.UI.setScore(this.score, this.record.highScore);
    }

    addForCombining(type, amount, tile) {
      for (let i = 0; i < amount; i++) this.addToQueue(tile, type);
    }

    addForCreating(type, tile) {
      this.addToQueue(tile, type);
    }

    addToQueue(tile, type) {
      this.queue.push({ tile, type, remaining: SE.info(type).scoreSpawns });
    }

    getTotalScore() {
      let total = this.score;
      for (const item of this.queue) total += item.remaining * SE.info(item.type).pointsPerScore * C.score.multiplier;
      for (const o of this.objects) total += o.holds;
      return total;
    }

    update(dt) {
      if (this.queue.length === 0) this.amountToSpawn = 0;
      else this.amountToSpawn += dt * C.score.spawnPerSecond;
      const num = Math.floor(this.amountToSpawn);
      this.amountToSpawn -= num;
      if (num > 0 && this.queue.length) {
        const target = SE.UI.scoreIconWorldPosition();
        for (const item of this.queue) {
          const n = Math.min(num, item.remaining);
          item.remaining -= n;
          const holds = SE.info(item.type).pointsPerScore * C.score.multiplier;
          const start = item.tile.worldPosition();
          for (let i = 0; i < n; i++) this.spawnScoreObject(start, target, holds);
        }
        this.queue = this.queue.filter((item) => item.remaining > 0);
      }
      if (this.objects.length) this.updateScoreObjects(dt);
    }

    spawnScoreObject(start, target, holds) {
      const range = C.score.velocityRange;
      const a = Math.random() * Math.PI * 2;
      // Start colour: random point of the white (0.39) -> cyan (1.0) gradient.
      const k = Math.max(0, (Math.random() - 0.39) / 0.61);
      this.objects.push({
        x: start.x,
        y: start.y,
        dx: Math.cos(a),
        dy: Math.sin(a),
        velocity: SE.rand(range[0], range[1]),
        tx: target.x,
        ty: target.y,
        startDistance: Math.max(0.001, Math.hypot(target.x - start.x, target.y - start.y)),
        scale: 1,
        holds,
        age: 0,
        color: SCORE_CYAN.map((c) => 1 + (c - 1) * k),
        trail: [],
      });
    }

    // ScoreObject.move: steer towards the score icon and shrink on approach.
    updateScoreObjects(dt) {
      const ratio = Math.pow(C.score.veloRatio, dt * 60);
      let kept = 0;
      for (const o of this.objects) {
        o.age += dt;
        const dist = Math.hypot(o.tx - o.x, o.ty - o.y);
        if (dist <= 0.1 || (dist < 0.4 && o.age > 0.8) || o.age > 4) {
          this.addScore(o.holds);
          continue;
        }
        o.dx = o.dx * ratio + ((o.tx - o.x) / dist) * (1 - ratio);
        o.dy = o.dy * ratio + ((o.ty - o.y) / dist) * (1 - ratio);
        o.trail.push(o.x, o.y, o.age);
        while (o.trail.length && o.age - o.trail[2] > SCORE_TRAIL_TIME) o.trail.splice(0, 3);
        o.x += o.velocity * o.dx * dt;
        o.y += o.velocity * o.dy * dt;
        o.scale = Math.min(1, dist / o.startDistance);
        this.objects[kept++] = o;
      }
      this.objects.length = kept;
    }

    draw(bucket) {
      const pts = this.pts;
      for (const o of this.objects) {
        const [r, g, b] = o.color;
        const size = 0.06 + 0.3 * o.scale;
        let n = 0;
        for (let i = Math.max(0, o.trail.length - 60); i < o.trail.length; i += 3) {
          pts[n * 3] = o.trail[i];
          pts[n * 3 + 1] = o.trail[i + 1];
          pts[n * 3 + 2] = 10;
          n++;
        }
        pts[n * 3] = o.x;
        pts[n * 3 + 1] = o.y;
        pts[n * 3 + 2] = 10;
        bucket.ribbon(pts, n + 1, size * 0.8, r, g, b, 0.6);
        bucket.billboard(o.x, o.y, 10, size, 0, r, g, b, 0.95);
      }
    }
  }

  // ------------------------------------------------------------------ SpeedRunManager

  class SpeedRun {
    constructor(session) {
      this.session = session;
      this.record = session.record;
      this.time = 0;
      this.currentFastestTime = Infinity;
      this.shownSecond = -1;
    }

    levelReached(levelType, spawnParticle) {
      const next = SE.info(SE.info(levelType).next);
      SE.UI.setNextLevelIcon(next.icon);
      if (this.time < SE.fastestTime(this.record, levelType)) this.record.fastTimes[levelType] = this.time;
      if (spawnParticle) SE.UI.showTimeDifference(this.diffColor(), SE.formatTime(this.difference(), true, true));
      this.currentFastestTime = SE.fastestTime(this.record, next.type);
      this.refresh();
    }

    difference() {
      return this.time - this.currentFastestTime;
    }

    diffColor() {
      return this.difference() >= 0 ? C.colors.slowTime : C.colors.fastTime;
    }

    setTime(t) {
      this.time = t;
      this.refresh();
    }

    update(dt) {
      if (!this.session.playerCanPlay) return;
      this.time += dt;
      // The labels only show whole seconds; skip DOM writes in between.
      if (Math.floor(this.time) !== this.shownSecond) this.refresh();
    }

    refresh() {
      this.shownSecond = Math.floor(this.time);
      SE.UI.setTime(SE.formatTime(this.time, false, false), SE.formatTime(this.difference(), true, false), this.diffColor());
    }
  }

  // ------------------------------------------------------------------ Session (GameManager + StartManager)

  class GameSession {
    constructor(level) {
      this.level = level;
      this.record = Save.record(level.id);
      this.time = 0;
      this.timers = [];
      this.dead = false;
      this.dirty = false;
      this.playerCanPlay = false;
      this.canPlace = true;
      this.gameover = false;
      this.combiningTime = C.combiningTime;
      this.spawnQueue = [];
      this.objects = new Set();
      this.spawnMovers = [];
      this.tiles = [];
      this.center = null; // stays null on free levels
      this.highestType = SE.Type.stardust; // free levels: best object created so far
      this.started = false;
      this.mapTime = 0;

      this.mapGroup = new THREE.Group();
      this.selection = new Selection(this);
      this.score = new Score(this);
      this.speedrun = new SpeedRun(this);
      Render.scene.add(this.mapGroup, this.selection.group);
      Render.setBoard(level);
    }

    // WaitForSeconds: resolved by update(); never resolves once the session is destroyed.
    wait(seconds) {
      return new Promise((resolve) => this.timers.push({ at: this.time + seconds, resolve }));
    }

    destroy() {
      this.dead = true;
      this.timers = [];
      for (const o of [...this.objects]) o.destroy();
      if (this.center) this.center.destroy();
      this.score.destroy();
      Render.scene.remove(this.mapGroup, this.selection.group);
      Render.disposeGroup(this.mapGroup);
    }

    async start() {
      Save.data.firstTimePlaying = false;
      this.setPlayerCanPlay(false);
      const saved = this.record.currentGame;
      this.combiningTime = C.generatingTime;
      this.setScoreAndTime(saved);
      await this.generateMap();
      if (this.dead) return;
      await this.spawnSpaceObjects(saved || this.newGameData());
      if (this.dead) return;
      this.combiningTime = C.combiningTime;
      await this.selection.setup(saved ? saved.queue : null);
      if (this.dead) return;
      this.started = true;
      this.setPlayerCanPlay(true);
    }

    setScoreAndTime(saved) {
      this.score.setScore(saved ? saved.score : 0);
      this.speedrun.setTime(saved ? saved.time : 0);
      this.highestType = saved ? saved.levelType : SE.Type.stardust;
      this.speedrun.levelReached(this.highestType, false);
    }

    // Free levels: speedrun splits for the first asteroid, moon, ... combined anywhere; a black hole wins.
    objectCreated(type) {
      if (!this.level.free || !this.started || type <= this.highestType) return;
      this.highestType = type;
      this.speedrun.levelReached(type, true);
      if (type === SE.Type.blackhole) SE.UI.showMessage('youWin', 1);
    }

    // Map.generateMap: tiles fly out of the center one after another, sorted clockwise.
    async generateMap() {
      const positions = [...this.level.tiles].sort((a, b) => Math.atan2(a[0], a[1]) - Math.atan2(b[0], b[1]));
      for (const [x, y] of positions) {
        const tile = new Tile(this, x, y, Render.createTile());
        tile.group.scale.setScalar(0);
        this.mapGroup.add(tile.group);
        this.tiles.push(tile);
        this.addSpawnMover(tile.group, new THREE.Vector3(x, y, 0), 1, this.combiningTime);
        await this.wait(this.combiningTime / 4);
        if (this.dead) return;
      }
      if (!this.level.free) {
        const center = (this.center = new CenterTile(this));
        center.group.scale.setScalar(0);
        this.mapGroup.add(center.group);
        this.tiles.push(center);
        this.addSpawnMover(center.group, new THREE.Vector3(0, 0, 0), 1.3, this.combiningTime);
      }
      await this.wait(this.combiningTime * 1.1);
      for (const t of this.tiles) t.findNeighbours();
    }

    // StartManager.getGameData for a new game: stardust everywhere except the center neighbours.
    // Free levels start empty so the speedrun splits only depend on the player.
    newGameData() {
      if (this.level.free) return { levelType: SE.Type.stardust, objects: [] };
      const objects = this.tiles
        .filter((t) => !t.isCenter && !this.center.neighbours.includes(t))
        .map((t) => ({ x: t.x, y: t.y, type: SE.Type.stardust }));
      for (let i = objects.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [objects[i], objects[j]] = [objects[j], objects[i]];
      }
      return { levelType: SE.Type.stardust, objects };
    }

    // Map.spawnSpaceObjects. Combining is live here, so a new board shuffles itself into a random start.
    async spawnSpaceObjects(data) {
      const origin = new THREE.Vector3(0, 0, 0);
      if (this.center) this.spawnObject(this.center, data.levelType, false, false, origin);
      for (const o of data.objects) {
        await this.wait(this.combiningTime / 4);
        if (this.dead) return;
        const tile = this.tileAtLocal(o.x, o.y);
        if (tile) this.spawnObject(tile, o.type, false, false, origin);
      }
      await this.wait(this.combiningTime);
    }

    tileAtLocal(x, y) {
      let best = null;
      let bestDist = Infinity;
      for (const t of this.tiles) {
        const d = Math.hypot(t.x - x, t.y - y);
        if (d < bestDist) {
          best = t;
          bestDist = d;
        }
      }
      if (!best) return null;
      return bestDist <= (best.isCenter ? 0.65 : 0.56) ? best : null;
    }

    addSpawnMover(obj, target, scale, moveTime) {
      this.spawnMovers.push({ obj, target, scale: new THREE.Vector3(scale, scale, 1), moveTime, t: 0 });
    }

    // GameManager.spawnObject
    spawnObject(tile, type, useQueue, givesScore, spawnWorldPos) {
      if (tile.contains()) return false;
      let so;
      if (useQueue) {
        so = this.selection.getNext();
        if (!so) return false;
        so.setParent(tile.group);
      } else {
        so = new SpaceObj(this, type, tile.group, spawnWorldPos);
      }
      SE.Sound.woosh(SE.info(so.type).soundPitch);
      tile.obj = so;
      so.goTo(tile.group, false, 1, !useQueue);
      if (useQueue && givesScore) this.score.addForCreating(so.type, tile);
      if (this.center) this.center.refreshCenterNeighbourState();
      return tile.tryToCombine(givesScore);
    }

    onTap(clientX, clientY) {
      if (!this.playerCanPlay) return;
      const w = Render.screenToWorld(clientX, clientY);
      this.mapGroup.updateMatrixWorld(true);
      const local = this.mapGroup.worldToLocal(new THREE.Vector3(w.x, w.y, 0));
      const tile = this.tileAtLocal(local.x, local.y);
      if (!tile) return;
      if (!tile.isCenter) tile.flashT = 0;
      this.spawnQueue.push(tile);
    }

    checkGameover() {
      if (this.tiles.every((t) => t.contains())) this.gameHasEnded();
    }

    gameHasEnded() {
      this.gameover = true;
      this.saveGame();
      this.setPlayerCanPlay(false);
      SE.UI.showMessage('gameOver', 1);
    }

    setPlayerCanPlay(value) {
      this.playerCanPlay = value && !SE.UI.hasActiveMessages();
    }

    // SaveDataManager.refreshSaveData + Save
    saveGame() {
      if (this.started) {
        this.score.updateHighScore(true);
        if (this.gameover) {
          this.record.currentGame = null;
        } else if (this.playerCanPlay && this.canPlace && this.selection.queue.length) {
          const center = this.center;
          this.record.currentGame = {
            score: this.score.getTotalScore(),
            time: this.speedrun.time,
            queue: this.selection.types(),
            levelType: center ? (center.obj ? center.obj.type : SE.Type.stardust) : this.highestType,
            objects: this.tiles.filter((t) => !t.isCenter && t.contains()).map((t) => ({ x: t.x, y: t.y, type: t.obj.type })),
          };
        }
      }
      Save.persist();
    }

    isSettled() {
      if (!this.playerCanPlay || !this.canPlace || this.spawnQueue.length) return false;
      for (const o of this.objects) if (o.move) return false;
      return true;
    }

    update(dt) {
      if (this.dead) return;

      this.mapTime += dt;
      const r = C.rotateMap;
      this.mapGroup.rotation.z = Math.sin(this.mapTime * r.frequency) * r.amplitude * DEG;
      Render.scene.updateMatrixWorld();

      if (this.canPlace && this.spawnQueue.length) {
        const tile = this.spawnQueue.shift();
        this.spawnObject(tile, null, true, true, null);
        this.dirty = true;
      }

      for (let i = this.spawnMovers.length - 1; i >= 0; i--) {
        const m = this.spawnMovers[i];
        m.t += dt;
        const k = m.t / m.moveTime;
        if (k > 1) {
          m.obj.position.copy(m.target);
          m.obj.scale.copy(m.scale);
          this.spawnMovers.splice(i, 1);
        } else {
          m.obj.position.lerp(m.target, k);
          m.obj.scale.lerp(m.scale, k);
        }
      }

      for (const o of this.objects) o.update(dt);
      for (const t of this.tiles) t.updateColor(dt);
      this.score.update(dt);
      this.speedrun.update(dt);

      // Autosave once the board has settled after a move.
      if (this.dirty && this.isSettled()) {
        this.dirty = false;
        this.saveGame();
      }

      this.time += dt;
      if (this.timers.length) {
        const due = this.timers.filter((t) => t.at <= this.time);
        if (due.length) {
          this.timers = this.timers.filter((t) => t.at > this.time);
          due.sort((a, b) => a.at - b.at).forEach((t) => t.resolve());
        }
      }
    }
  }

  SE.GameSession = GameSession;
})();
