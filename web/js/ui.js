// DOM user interface: HUD, menu with level picker (MenuManager / ScoreDisplayer) and messages (MessageManager).
(function () {
  'use strict';

  const SE = window.SE;
  const Save = SE.Save;
  const $ = (id) => document.getElementById(id);

  const MESSAGE_FADE = 300;

  const MESSAGES = {
    tutorial: () => `
      <div class="msg msg-tutorial">
        <div class="tut-head"><span>Combine!</span><span>Level Up!</span></div>
        <img class="tut-image" src="img/tutorial.webp" alt="How to play">
        <p class="msg-text">Create a <b class="hl">BLACK HOLE</b> in the center to <b class="hl">WIN!</b></p>
        <button class="tick-btn" data-action="closeTutorial" aria-label="OK"><img src="img/tick.webp" alt=""></button>
      </div>`,
    gameOver: () => `
      <div class="msg">
        <h2>Game Over</h2>
        <p class="msg-text">Score <b class="score-blue">${UI.finalScore()}</b></p>
        <button class="pill-btn" data-action="tryAgain">Try Again!</button>
        <button class="link-btn" data-action="menu">Menu</button>
      </div>`,
    youWin: () => `
      <div class="msg">
        <h2 class="hl">YOU WIN!</h2>
        <p class="msg-text">You created a <b class="hl">BLACK HOLE!</b><br>Now continue and improve your highscore.</p>
        <button class="tick-btn" data-action="continue" aria-label="Continue"><img src="img/tick.webp" alt=""></button>
      </div>`,
  };

  const UI = {
    active: [],
    lastScore: 0,
    scoreTarget: null,
    el: {},

    init(app) {
      UI.app = app;
      for (const id of ['hud', 'menu', 'score', 'highscore', 'time', 'fastest', 'nextIcon', 'scoreIcon', 'popups', 'messages', 'stage', 'levelPreview', 'levelName', 'levelTag', 'menuHighscore', 'menuTimes', 'restartBtn', 'musicBtn', 'sfxBtn']) {
        UI.el[id] = $(id);
      }
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        SE.Sound.click();
        UI.onAction(btn.dataset.action || btn.id);
      });
      window.addEventListener('keydown', (e) => {
        if (UI.app.session || UI.active.length) return;
        if (e.key === 'ArrowLeft') UI.onAction('prevLevel');
        if (e.key === 'ArrowRight') UI.onAction('nextLevel');
      });
      UI.refreshSoundButtons();
    },

    onAction(action) {
      const app = UI.app;
      const settings = Save.data;
      switch (action) {
        case 'playBtn':
          return app.playGame();
        case 'restartBtn':
          return app.restartGame();
        case 'pauseBtn':
        case 'menu':
          return app.goToMenu();
        case 'tryAgain':
          return app.tryAgain();
        case 'musicBtn':
          settings.musicEnabled = !settings.musicEnabled;
          UI.refreshSoundButtons();
          return Save.persist();
        case 'sfxBtn':
          settings.sfxEnabled = !settings.sfxEnabled;
          UI.refreshSoundButtons();
          return Save.persist();
        case 'prevLevel':
        case 'nextLevel':
          return UI.changeLevel(action === 'nextLevel' ? 1 : -1);
        case 'tutorialBtn':
          return UI.showMessage('tutorial', 0);
        case 'closeTutorial':
          return UI.closeMessage('tutorial');
        case 'continue':
          return UI.closeMessage('youWin');
      }
    },

    refreshSoundButtons() {
      const s = Save.data;
      UI.el.musicBtn.querySelector('img').src = s.musicEnabled ? 'img/music-on.webp' : 'img/music-off.webp';
      UI.el.sfxBtn.querySelector('img').src = s.sfxEnabled ? 'img/sfx-on.webp' : 'img/sfx-off.webp';
      SE.Sound.enableSfx(s.sfxEnabled);
      SE.Sound.enableMusic(s.musicEnabled);
    },

    // ------------------------------------------------------------ menu

    showMenu() {
      UI.renderLevel();
      const menu = UI.el.menu;
      menu.classList.remove('hidden');
      // Next frame, so the scale-in transition runs (FadeWobbleUIScript).
      requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('shown')));
    },

    hideMenu() {
      const menu = UI.el.menu;
      menu.classList.remove('shown');
      return new Promise((resolve) =>
        setTimeout(() => {
          menu.classList.add('hidden');
          resolve();
        }, 380)
      );
    },

    changeLevel(step) {
      const levels = SE.LEVELS;
      const i = levels.indexOf(SE.levelById(Save.data.level));
      Save.data.level = levels[(i + step + levels.length) % levels.length].id;
      Save.persist();
      UI.renderLevel();
    },

    renderLevel() {
      const level = SE.levelById(Save.data.level);
      const record = Save.record(level.id);
      UI.el.levelName.textContent = level.name;
      UI.el.levelTag.textContent = level.tag;
      UI.el.levelTag.dataset.tag = level.tag.toLowerCase();
      UI.el.menuHighscore.textContent = record.highScore;
      UI.el.restartBtn.classList.toggle('gone', !record.currentGame);
      UI.renderPreview(level);
      UI.renderTimes(record);
    },

    // Small SVG map of the selected level: tiles, center neighbours and the center.
    renderPreview(level) {
      const svg = UI.el.levelPreview;
      const b = level.bounds;
      const ys = level.tiles.map((p) => p[1]);
      const top = Math.max(...ys) + 0.55;
      const bottom = Math.min(...ys) - 0.55;
      svg.setAttribute('viewBox', `${-b.maxX} ${-top} ${2 * b.maxX} ${top - bottom}`);
      const hex = (x, y) =>
        [0, 1, 2, 3, 4, 5].map((k) => `${(x + 0.5 * Math.cos((k * Math.PI) / 3)).toFixed(3)},${(-y + 0.5 * Math.sin((k * Math.PI) / 3)).toFixed(3)}`).join(' ');
      const isSpoke = (x, y) => level.spokes.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < 0.1);
      let html = '';
      for (const [x, y] of level.tiles) html += `<polygon points="${hex(x, y)}" class="${isSpoke(x, y) ? 'spoke' : 'tile'}"/>`;
      if (!level.free) html += '<circle cx="0" cy="0" r="0.65" class="center"/>';
      svg.innerHTML = html;
    },

    renderTimes(record) {
      const box = UI.el.menuTimes;
      box.innerHTML = '';
      for (const info of SE.OBJECTS) {
        const t = SE.fastestTime(record, info.type);
        if (info.type === SE.Type.stardust || t === Infinity) continue;
        const el = document.createElement('div');
        el.className = 'time-entry';
        el.innerHTML = `<img src="${info.icon}" alt="${info.name}" title="${info.name}"><span>${SE.formatTime(t, false, true)}</span>`;
        box.appendChild(el);
      }
    },

    // ------------------------------------------------------------ HUD

    showHud() {
      UI.el.hud.classList.remove('hidden');
      UI.invalidateLayout();
    },

    hideHud() {
      UI.el.hud.classList.add('hidden');
      UI.el.popups.innerHTML = '';
    },

    invalidateLayout() {
      UI.scoreTarget = null;
    },

    setScore(score, high) {
      UI.lastScore = score;
      UI.el.score.textContent = score;
      UI.el.highscore.textContent = high;
    },

    finalScore() {
      const s = UI.app.session;
      return s ? s.score.getTotalScore() : UI.lastScore;
    },

    bumpScore() {
      const el = UI.el.score;
      if (el.classList.contains('bump')) return;
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 90);
    },

    setTime(time, diff, color) {
      UI.el.time.textContent = time;
      UI.el.fastest.textContent = diff;
      UI.el.fastest.style.color = color;
    },

    setNextLevelIcon(src) {
      UI.el.nextIcon.src = src;
    },

    // TimeDifference: the split time floats down from the best-time label and fades out.
    showTimeDifference(color, text) {
      const anchor = UI.el.fastest.getBoundingClientRect();
      const stage = UI.el.stage.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = 'time-diff';
      el.textContent = text;
      el.style.color = color;
      el.style.left = anchor.left - stage.left + 'px';
      el.style.top = anchor.top - stage.top + 'px';
      el.style.animationDuration = SE.CONFIG.timeDifferenceFadeTime + 's';
      el.addEventListener('animationend', () => el.remove());
      UI.el.popups.appendChild(el);
    },

    // World position of the trophy icon, where score particles fly to. Cached until the layout changes.
    scoreIconWorldPosition() {
      if (!UI.scoreTarget) {
        const r = UI.el.scoreIcon.getBoundingClientRect();
        UI.scoreTarget = SE.Render.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
      }
      return UI.scoreTarget;
    },

    // ------------------------------------------------------------ messages

    hasActiveMessages() {
      return UI.active.length > 0;
    },

    showMessage(type, delay) {
      if (UI.active.some((m) => m.type === type)) return;
      const wrap = document.createElement('div');
      wrap.className = 'msg-wrap';
      wrap.innerHTML = MESSAGES[type]();
      const entry = { type, el: wrap };
      UI.active.push(entry);
      if (UI.app.session) UI.app.session.setPlayerCanPlay(false);
      setTimeout(() => {
        if (!UI.active.includes(entry)) return;
        UI.el.messages.appendChild(wrap);
        requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('shown')));
      }, delay * 1000);
    },

    closeMessage(type) {
      const entry = UI.active.find((m) => m.type === type);
      if (!entry) return;
      UI.active = UI.active.filter((m) => m !== entry);
      UI.fadeOut(entry);
      if (UI.app.session) UI.app.session.setPlayerCanPlay(true);
    },

    closeAllMessages() {
      UI.active.forEach(UI.fadeOut);
      UI.active = [];
    },

    fadeOut(entry) {
      entry.el.classList.remove('shown');
      setTimeout(() => entry.el.remove(), MESSAGE_FADE);
    },
  };

  SE.UI = UI;
})();
