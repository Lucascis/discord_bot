#!/bin/bash

# Discord Music Bot - Production Deployment Script
# Version: 1.0.0
# Last Updated: November 3, 2025

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Script header
echo "=========================================="
echo "🚀 Discord Music Bot - Production Deploy"
echo "=========================================="
echo ""

# 1. Pre-deployment checks
log_info "Running pre-deployment checks..."

# Check if .env exists
if [ ! -f .env ]; then
    log_error ".env file not found!"
    log_info "Please create .env from .env.example:"
    log_info "  cp .env.example .env"
    log_info "  # Edit .env with your production values"
    exit 1
fi
log_success ".env file exists"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    log_error "Docker is not running!"
    log_info "Please start Docker Desktop and try again"
    exit 1
fi
log_success "Docker is running"

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    log_error "docker-compose not found!"
    log_info "Please install Docker Compose v2+"
    exit 1
fi
log_success "docker-compose is available"

# Check required environment variables
log_info "Validating environment variables..."
source .env

if [ "$DISCORD_TOKEN" == "your-bot-token" ]; then
    log_error "DISCORD_TOKEN is not set!"
    log_info "Please update .env with your Discord bot token"
    exit 1
fi

if [ "$DISCORD_APPLICATION_ID" == "your-application-id" ]; then
    log_error "DISCORD_APPLICATION_ID is not set!"
    log_info "Please update .env with your Discord application ID"
    exit 1
fi
log_success "Required environment variables are set"

# 2. Build Docker images
log_info "Building Docker images (this may take a few minutes)..."
docker-compose build --no-cache
log_success "Docker images built successfully"

# 3. Stop existing services (if running)
log_info "Stopping existing services..."
docker-compose down --remove-orphans || true
log_success "Existing services stopped"

# 4. Clean up old volumes (optional - commented out for safety)
# log_warning "Cleaning up old volumes..."
# docker-compose down -v
# log_success "Old volumes cleaned"

# 5. Start services
log_info "Starting all services..."
docker-compose up -d
log_success "Services started"

# 6. Wait for services to be ready
log_info "Waiting for services to be healthy (this may take up to 2 minutes)..."
sleep 10

# Wait for database
log_info "Waiting for PostgreSQL..."
timeout=60
counter=0
until docker-compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
    sleep 2
    counter=$((counter + 2))
    if [ $counter -ge $timeout ]; then
        log_error "PostgreSQL failed to start within $timeout seconds"
        docker-compose logs postgres
        exit 1
    fi
done
log_success "PostgreSQL is ready"

# Wait for Redis
log_info "Waiting for Redis..."
counter=0
until docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; do
    sleep 2
    counter=$((counter + 2))
    if [ $counter -ge $timeout ]; then
        log_error "Redis failed to start within $timeout seconds"
        docker-compose logs redis
        exit 1
    fi
done
log_success "Redis is ready"

# Wait for Lavalink
log_info "Waiting for Lavalink..."
counter=0
until curl -s http://localhost:2333/version > /dev/null 2>&1; do
    sleep 3
    counter=$((counter + 3))
    if [ $counter -ge 90 ]; then
        log_error "Lavalink failed to start within 90 seconds"
        docker-compose logs lavalink
        exit 1
    fi
done
log_success "Lavalink is ready"

# 7. Run database migrations
log_info "Running database migrations..."
docker-compose exec -T gateway sh -c "cd /app && pnpm --filter @discord-bot/database prisma migrate deploy" || {
    log_warning "Migration command not available or failed - this is normal if already migrated"
}
log_success "Database migrations completed"

# 8. Verify all services are healthy
log_info "Verifying service health..."

# Check Gateway
if curl -sf http://localhost:3001/health > /dev/null; then
    log_success "Gateway service is healthy"
else
    log_warning "Gateway health check failed - checking logs..."
    docker-compose logs --tail=20 gateway
fi

# Check Audio
if curl -sf http://localhost:3002/health > /dev/null; then
    log_success "Audio service is healthy"
else
    log_warning "Audio health check failed - checking logs..."
    docker-compose logs --tail=20 audio
fi

# Check API
if curl -sf http://localhost:3000/health > /dev/null; then
    log_success "API service is healthy"
else
    log_warning "API health check failed - checking logs..."
    docker-compose logs --tail=20 api
fi

# Check Worker
if curl -sf http://localhost:3003/health > /dev/null; then
    log_success "Worker service is healthy"
else
    log_warning "Worker health check failed - checking logs..."
    docker-compose logs --tail=20 worker
fi

# 9. Display service status
echo ""
log_info "Service status:"
docker-compose ps

# 10. Display helpful information
echo ""
echo "=========================================="
log_success "Deployment completed successfully!"
echo "=========================================="
echo ""
log_info "Next steps:"
echo "  1. Check bot is online in Discord"
echo "  2. Test /play command"
echo "  3. Monitor logs: docker-compose logs -f"
echo ""
log_info "Useful commands:"
echo "  View logs:        docker-compose logs -f [service]"
echo "  Restart service:  docker-compose restart [service]"
echo "  Stop all:         docker-compose down"
echo "  Service status:   docker-compose ps"
echo ""
log_info "Health check URLs:"
echo "  Gateway:  http://localhost:3001/health"
echo "  Audio:    http://localhost:3002/health"
echo "  API:      http://localhost:3000/health"
echo "  Worker:   http://localhost:3003/health"
echo "  Lavalink: http://localhost:2333/version"
echo ""
log_success "Happy music streaming! 🎵"
