// SaveDataManager: settings plus highscore, best times and the running game per level, in localStorage.
(function () {
  'use strict';

  const SE = window.SE;
  const KEY = 'spaceEvolution.save.v2';
  const LEGACY_KEY = 'spaceEvolution.save.v1';

  const defaults = () => ({
    level: 'classic',
    levels: {},
    musicEnabled: true,
    sfxEnabled: true,
    firstTimePlaying: true,
  });

  const emptyRecord = () => ({ highScore: 0, fastTimes: {}, currentGame: null });

  function read(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  const Save = {
    data: defaults(),

    load() {
      const stored = read(KEY);
      if (stored) {
        Save.data = Object.assign(defaults(), stored);
        return;
      }
      // Version 1 only knew the classic map.
      const legacy = read(LEGACY_KEY);
      if (legacy) {
        Object.assign(Save.data, {
          musicEnabled: legacy.musicEnabled !== false,
          sfxEnabled: legacy.sfxEnabled !== false,
          firstTimePlaying: !!legacy.firstTimePlaying,
        });
        Save.data.levels.classic = {
          highScore: legacy.highScore || 0,
          fastTimes: legacy.fastTimes || {},
          currentGame: legacy.currentGame || null,
        };
      }
    },

    persist() {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(Save.data));
      } catch (e) {
        // Private mode or storage disabled: the game still works, it just forgets.
      }
    },

    // Records (highscore, best times, running game) of a level, created on demand.
    record(levelId) {
      const id = levelId || Save.data.level;
      return Save.data.levels[id] || (Save.data.levels[id] = emptyRecord());
    },
  };

  SE.fastestTime = (record, type) => {
    const t = record.fastTimes[type];
    return typeof t === 'number' ? t : Infinity;
  };

  SE.Save = Save;
})();
