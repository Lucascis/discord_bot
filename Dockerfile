FROM node:20 AS builder
WORKDIR /app
COPY . .
RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile \
  && pnpm -r build \
  && pnpm --filter @discord-bot/database prisma:generate

FROM node:20
WORKDIR /app
COPY --from=builder /app .
RUN corepack enable pnpm && corepack prepare pnpm@8.7.0 --activate
# Default cmd is overridden by docker-compose; keep a harmless default
CMD ["node", "-e", "console.log('Set service command in docker-compose.yml')"]
