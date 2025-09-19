.PHONY: help install build dev test lint typecheck clean format check ci health deps docker logs
.PHONY: dev build lint test start prod prod-reset quickstart up down logs ps migrate migrate-deploy build-images clean

# Detect docker compose binary at make-time
DC := $(shell command -v docker-compose >/dev/null 2>&1 && echo docker-compose || echo docker compose)

# Default target
help: ## Show this help message
	@echo "Discord Bot - Enterprise Development Commands"
	@echo "============================================="
	@echo
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo

# Development Setup
install: ## Install all dependencies
	@echo "📦 Installing dependencies..."
	@pnpm install
	@echo "✅ Dependencies installed"

# Build & Development
build: ## Build all packages
	@echo "🏗️  Building all packages..."
	@pnpm build
	@echo "✅ Build complete"

build-clean: ## Clean build artifacts and rebuild
	@echo "🧹 Cleaning build artifacts..."
	@pnpm clean
	@echo "🏗️  Rebuilding all packages..."
	@pnpm build
	@echo "✅ Clean build complete"

dev: ## Start gateway service in development mode
	@echo "🚀 Starting gateway in development mode..."
	@pnpm dev

dev-all: ## Start all services in development mode
	@echo "🚀 Starting all services in development mode..."
	@pnpm dev:all

# Quality Assurance
test: ## Run all tests
	@echo "🧪 Running tests..."
	@pnpm test
	@echo "✅ Tests complete"

lint: ## Run linting
	@echo "🔍 Running linter..."
	@pnpm lint
	@echo "✅ Linting complete"

typecheck: ## Run TypeScript type checking
	@echo "🔍 Running type checking..."
	@pnpm typecheck
	@echo "✅ Type checking complete"

check: ## Run complete quality check (typecheck + lint + test)
	@echo "🔍 Running complete quality check..."
	@make typecheck
	@make lint
	@make test
	@echo "✅ Quality check complete"

ci: ## Run CI pipeline checks
	@echo "🔄 Running CI pipeline..."
	@make install
	@make check
	@make build
	@echo "✅ CI pipeline complete"

# Production & Docker
start: ## Start all services in production mode
	@echo "🚀 Starting services in production mode..."
	@pnpm start

prod: ## Full production deployment
	@echo "🚀 Starting production deployment..."
	@bash scripts/prod.sh

prod-reset: ## Complete production reset
	@echo "🔄 Performing complete production reset..."
	@RESET=1 bash scripts/prod.sh --reset

# Health & Monitoring
health: ## Check service health endpoints
	@echo "🏥 Checking service health..."
	@echo "Gateway Health:"
	@curl -s http://localhost:3001/health | jq . || echo "Gateway not running"
	@echo "API Health:"
	@curl -s http://localhost:3000/health | jq . || echo "API not running"

metrics: ## Show Prometheus metrics
	@echo "📊 Fetching Prometheus metrics..."
	@curl -s http://localhost:3001/metrics | head -20

# Database Operations
migrate: ## Run database migrations
	@echo "🗄️  Running database migrations..."
	@$(DC) run --rm -T api pnpm --filter @discord-bot/database prisma migrate dev --name init

migrate-deploy: ## Deploy database migrations to production
	@echo "🗄️  Deploying database migrations..."
	@$(DC) run --rm -T api pnpm --filter @discord-bot/database exec prisma migrate deploy

db-seed: ## Seed database with initial data
	@echo "🌱 Seeding database..."
	@pnpm db:seed

# Docker Operations
up: ## Start services with Docker
	@echo "🐳 Starting services with Docker..."
	@$(DC) up -d

down: ## Stop Docker services
	@echo "🐳 Stopping Docker services..."
	@$(DC) down

logs: ## Show Docker logs
	@echo "📝 Showing Docker logs..."
	@$(DC) logs -f

ps: ## Show Docker container status
	@echo "📋 Docker container status:"
	@$(DC) ps

build-images: ## Build Docker images
	@echo "🐳 Building Docker images..."
	@$(DC) build

clean: ## Clean Docker containers and volumes
	@echo "🧹 Cleaning Docker containers and volumes..."
	@$(DC) down -v --remove-orphans

# Legacy aliases
quickstart: prod ## Alias for prod
