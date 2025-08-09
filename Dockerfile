FROM node:20 AS builder
WORKDIR /app
COPY . .
RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile \
  && pnpm -r build

FROM node:20
WORKDIR /app
COPY --from=builder /app .
CMD ["pnpm", "start"]
