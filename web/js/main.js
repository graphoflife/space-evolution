// App: scene switching (Menu <-> Game), resize handling and the frame loop.
(function () {
  'use strict';

  const SE = window.SE;
  const Save = SE.Save;
  const UI = SE.UI;
  const Render = SE.Render;
  const Sound = SE.Sound;

  // The original is a portrait phone game; on wide screens the UI keeps this aspect ratio.
  const MAX_STAGE_ASPECT = 0.62;

  const App = {
    session: null,
    starting: false,
    last: 0,

    init() {
      Save.load();
      Sound.init();
      Render.init(document.getElementById('gl'));
      UI.init(App);

      window.addEventListener('resize', App.resize);
      App.resize();

      Render.renderer.domElement.addEventListener('pointerup', (e) => {
        if (e.button === 0 && App.session) App.session.onTap(e.clientX, e.clientY);
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && App.session) App.goToMenu();
      });

      const persist = () => (App.session ? App.session.saveGame() : Save.persist());
      window.addEventListener('pagehide', persist);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') persist();
      });

      App.showMenu();
      App.last = performance.now();
      requestAnimationFrame(App.frame);
    },

    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const stageW = Math.min(w, h * MAX_STAGE_ASPECT);
      document.getElementById('stage').style.width = stageW + 'px';
      const root = document.documentElement.style;
      root.setProperty('--u', stageW / 100 + 'px');
      root.setProperty('--h', h / 100 + 'px');
      Render.resize(w, h, stageW);
      UI.invalidateLayout();
    },

    showMenu() {
      Sound.playMusic('menu');
      UI.showMenu();
      if (Save.data.firstTimePlaying) UI.showMessage('tutorial', 0.4);
    },

    async playGame() {
      if (App.starting || App.session) return;
      App.starting = true;
      UI.closeAllMessages();
      await UI.hideMenu();
      App.startGame();
      App.starting = false;
    },

    restartGame() {
      Save.record().currentGame = null;
      App.playGame();
    },

    startGame() {
      UI.showHud();
      Sound.playMusic('game');
      App.session = new SE.GameSession(SE.levelById(Save.data.level));
      App.session.start();
    },

    tryAgain() {
      UI.closeAllMessages();
      App.endSession();
      Save.record().currentGame = null;
      App.startGame();
    },

    goToMenu() {
      if (!App.session) return;
      UI.closeAllMessages();
      App.endSession();
      UI.hideHud();
      App.showMenu();
    },

    endSession() {
      App.session.saveGame();
      App.session.destroy();
      App.session = null;
    },

    frame(now) {
      const dt = Math.min(0.1, Math.max(0, (now - App.last) / 1000));
      App.last = now;
      Render.update(dt);
      if (App.session) App.session.update(dt);
      Render.render();
      requestAnimationFrame(App.frame);
    },
  };

  SE.App = App;
  window.addEventListener('DOMContentLoaded', App.init);
})();
