.RECIPEPREFIX := >
.PHONY: dev build lint test start

dev:
> pnpm dev

build:
> pnpm build

lint:
> pnpm lint

test:
> pnpm test

start:
> pnpm start
