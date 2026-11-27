# Build from the repo root, since the bot imports the server's route types and
# shares the workspace lockfile:
#   docker build -f apps/discord/esport/Dockerfile -t it3k-esport-bot .
#   docker run -d --env-file apps/discord/esport/.env -v esport-bot:/data it3k-esport-bot
FROM oven/bun:1.4.4-slim

WORKDIR /repo
COPY . .

# Only this workspace's dependencies. Scripts are skipped because the root
# postinstall runs codegen for every app; run just the bot's.
RUN bun install --frozen-lockfile --ignore-scripts --filter @it3k/discord-esport \
  && cd apps/discord/esport && bunx varlock codegen

WORKDIR /repo/apps/discord/esport
ENV NODE_ENV=production \
  SQLITE_PATH=/data/bot.sqlite
# Owned by the unprivileged user before VOLUME, so a fresh volume inherits it.
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
USER bun

# Runs the source as is: importx finds modules by glob at runtime, which a
# bundle would break.
CMD ["bun", "src/main.ts"]
