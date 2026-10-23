// SoundManager: Web Audio for effects (pitch-shifted woosh, click), <audio> elements for music.
(function () {
  'use strict';

  const SE = window.SE;
  const EFX_VOLUME = 0.5;
  const MUSIC_VOLUME = 0.8;

  const Sound = {
    ctx: null,
    buffers: {},
    sfxEnabled: true,
    musicEnabled: true,
    music: {},
    currentMusic: null,
    unlocked: false,
    recent: [],

    init() {
      Sound.music.menu = makeMusic('audio/music_menu.mp3');
      Sound.music.game = makeMusic('audio/music_game.mp3');
      const unlock = () => {
        if (Sound.unlocked) return;
        Sound.unlocked = true;
        Sound.ensureContext();
        Sound.refreshMusic();
      };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    },

    ensureContext() {
      if (Sound.ctx) {
        if (Sound.ctx.state === 'suspended') Sound.ctx.resume();
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      Sound.ctx = new Ctx();
      Sound.gain = Sound.ctx.createGain();
      Sound.gain.gain.value = Sound.sfxEnabled ? EFX_VOLUME : 0;
      Sound.gain.connect(Sound.ctx.destination);
      const sounds = window.SE_ASSETS.sounds;
      Object.keys(sounds).forEach((key) => {
        const bytes = dataUriToArrayBuffer(sounds[key]);
        Sound.ctx.decodeAudioData(bytes, (buf) => (Sound.buffers[key] = buf), () => {});
      });
    },

    play(key, pitch) {
      if (!Sound.ctx || !Sound.sfxEnabled) return;
      const buf = Sound.buffers[key];
      if (!buf) return;
      // Map generation spawns dozens of objects within a fraction of a second;
      // cap overlapping voices so it doesn't clip.
      const now = Sound.ctx.currentTime;
      Sound.recent = Sound.recent.filter((t) => now - t < 0.08);
      if (Sound.recent.length >= 4) return;
      Sound.recent.push(now);
      const src = Sound.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = pitch || 1;
      src.connect(Sound.gain);
      src.start();
    },

    // SoundManager.RandomizeSfx
    woosh(pitch) {
      Sound.play('woosh', pitch + SE.rand(-0.05, 0.05));
    },

    click() {
      Sound.play('click', 1);
    },

    enableSfx(enabled) {
      Sound.sfxEnabled = enabled;
      if (Sound.gain) Sound.gain.gain.value = enabled ? EFX_VOLUME : 0;
    },

    enableMusic(enabled) {
      Sound.musicEnabled = enabled;
      Sound.refreshMusic();
    },

    playMusic(name) {
      const next = Sound.music[name];
      if (Sound.currentMusic && Sound.currentMusic !== next) Sound.currentMusic.pause();
      Sound.currentMusic = next;
      next.currentTime = 0;
      Sound.refreshMusic();
    },

    refreshMusic() {
      const m = Sound.currentMusic;
      if (!m) return;
      if (Sound.musicEnabled && Sound.unlocked) {
        const p = m.play();
        if (p && p.catch) p.catch(() => {});
      } else {
        m.pause();
      }
    },
  };

  function makeMusic(src) {
    const a = new Audio(src);
    a.loop = true;
    a.preload = 'auto';
    a.volume = MUSIC_VOLUME;
    return a;
  }

  function dataUriToArrayBuffer(uri) {
    const b64 = uri.slice(uri.indexOf(',') + 1);
    const bin = window.atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  SE.Sound = Sound;
})();
