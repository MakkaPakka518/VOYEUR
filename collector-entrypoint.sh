#!/bin/sh
set -eu

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb :99 -screen 0 1440x1000x24 -nolisten tcp -ac &
export DISPLAY=:99
for _ in 1 2 3 4 5; do
  [ -S /tmp/.X11-unix/X99 ] && break
  sleep 0.2
done
exec python -u app.py
