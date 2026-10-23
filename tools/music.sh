#!/usr/bin/env bash
# The music is licensed via the Unity Asset Store and must not be redistributed as raw files,
# so the repository only contains encrypted copies (assets/music/*.mp3.enc).
#
#   tools/music.sh decrypt   assets/music/*.mp3.enc -> web/audio/*.mp3
#   tools/music.sh encrypt   web/audio/*.mp3       -> assets/music/*.mp3.enc
#
# The passphrase comes from $MUSIC_KEY (GitHub Actions secret) or the git-ignored file .music-key.
# Without a key the game still works, just without music.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${MUSIC_KEY:-}" ] && [ -f .music-key ]; then
  MUSIC_KEY="$(cat .music-key)"
fi
if [ -z "${MUSIC_KEY:-}" ]; then
  echo "music.sh: no MUSIC_KEY and no .music-key file - skipping, the game will run without music." >&2
  exit 0
fi
export MUSIC_KEY

OPTS=(-aes-256-cbc -pbkdf2 -iter 200000 -pass env:MUSIC_KEY)

case "${1:-decrypt}" in
  decrypt)
    mkdir -p web/audio
    for f in assets/music/*.mp3.enc; do
      openssl enc -d "${OPTS[@]}" -in "$f" -out "web/audio/$(basename "$f" .enc)"
    done
    ;;
  encrypt)
    mkdir -p assets/music
    for f in web/audio/*.mp3; do
      openssl enc "${OPTS[@]}" -salt -in "$f" -out "assets/music/$(basename "$f").enc"
    done
    ;;
  *)
    echo "usage: tools/music.sh [decrypt|encrypt]" >&2
    exit 1
    ;;
esac
echo "music.sh: ${1:-decrypt} done"
