#!/usr/bin/env bash
# Pulls the bot's :latest image and restarts the bot only if it changed.
# CI publishes the image (.github/workflows/discord-bot.yml); this VM has no
# public IP, so it fetches instead of being pushed to. Safe to run any time.
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "no .env in $PWD yet; nothing to run"
  exit 0
fi

before=$(docker compose images --quiet bot 2>/dev/null || true)
docker compose pull --quiet bot
docker compose up --detach --remove-orphans --quiet-pull bot
after=$(docker compose images --quiet bot)

if [[ "$before" != "$after" ]]; then
  echo "bot now runs image ${after:-?} (was ${before:-none})"
  # Old bot images only; nothing else on this machine.
  docker image prune --force --filter "label=org.opencontainers.image.title=it3k esport bot" >/dev/null
fi
