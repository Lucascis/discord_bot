.PHONY: dev build lint test start prod

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
