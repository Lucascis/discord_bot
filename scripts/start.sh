#!/bin/bash
# Discord Bot - Production Start Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Check if .env.docker file exists
if [ ! -f .env.docker ]; then
    print_error ".env.docker file not found!"
    echo "Please create .env.docker from .env.example:"
    echo "  cp .env.example .env.docker"
    echo "  # Edit .env.docker with your Discord bot token and other settings"
    exit 1
fi

# Check if Discord token is set
if ! grep -q "DISCORD_TOKEN=.*[a-zA-Z0-9]" .env.docker; then
    print_error "Discord token not configured in .env.docker!"
    echo "Please add your Discord bot token to .env.docker"
    exit 1
fi

print_status "Starting Discord Bot Services..."

# Build images
print_status "Building Docker images..."
docker-compose -f docker-compose.production.yml build

# Start infrastructure services first
print_status "Starting infrastructure services (PostgreSQL, Redis, Lavalink)..."
docker-compose -f docker-compose.production.yml up -d postgres redis lavalink

# Wait for PostgreSQL to be ready
print_status "Waiting for PostgreSQL to be ready..."
sleep 10

# Run database migrations
print_status "Running database migrations..."
docker-compose -f docker-compose.production.yml run --rm migrate

# Start application services
print_status "Starting application services..."
docker-compose -f docker-compose.production.yml up -d gateway audio api worker

# Start monitoring services
print_status "Starting monitoring services (Prometheus, Grafana)..."
docker-compose -f docker-compose.production.yml up -d prometheus grafana

# Wait for services to be healthy
print_status "Waiting for services to become healthy..."
sleep 15

# Check service health
print_status "Checking service health..."
docker-compose -f docker-compose.production.yml ps

# Display access information
echo ""
print_status "Discord Bot is starting up!"
echo ""
echo "Service URLs:"
echo "  • API:        http://localhost:3000/health"
echo "  • Gateway:    http://localhost:3001/health"
echo "  • Audio:      http://localhost:3002/health"
echo "  • Worker:     http://localhost:3003/health"
echo "  • Lavalink:   http://localhost:2333"
echo "  • Prometheus: http://localhost:9090"
echo "  • Grafana:    http://localhost:3300 (admin/admin)"
echo ""
echo "View logs: docker-compose -f docker-compose.production.yml logs -f [service]"
echo "Stop all:  docker-compose -f docker-compose.production.yml down"
echo ""
print_status "Setup complete! The bot should now be online in Discord."