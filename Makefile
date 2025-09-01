.PHONY: dev build lint test start prod prod-reset quickstart up down logs ps migrate migrate-deploy build-images clean

# Detect docker compose binary at make-time
DC := $(shell command -v docker-compose >/dev/null 2>&1 && echo docker-compose || echo docker compose)

dev:
	pnpm dev

build:
	pnpm build

lint:
	pnpm lint

test:
	pnpm test

start:
	pnpm start

prod:
	bash scripts/prod.sh

prod-reset:
	RESET=1 bash scripts/prod.sh --reset

quickstart: prod

up:
	$(DC) up -d

down:
	$(DC) down

logs:
	$(DC) logs -f

ps:
	$(DC) ps

migrate:
	$(DC) run --rm -T api pnpm --filter @discord-bot/database prisma migrate dev --name init

migrate-deploy:
	$(DC) run --rm -T api pnpm --filter @discord-bot/database exec prisma migrate deploy

build-images:
	$(DC) build

clean:
	$(DC) down -v --remove-orphans
