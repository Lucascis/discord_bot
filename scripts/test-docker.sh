#!/bin/bash
# Docker configuration validation and testing script

set -e

echo "🐳 Discord Bot - Docker Configuration Test"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Docker is running
echo "1️⃣ Checking Docker installation..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Docker daemon is not running. Please start Docker Desktop.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"
docker --version
docker compose version
echo ""

# Validate docker-compose.yml
echo "2️⃣ Validating docker-compose.yml..."
if docker compose config --quiet; then
    echo -e "${GREEN}✅ docker-compose.yml syntax is valid${NC}"
else
    echo -e "${RED}❌ docker-compose.yml has syntax errors${NC}"
    exit 1
fi
echo ""

# Check .env file
echo "3️⃣ Checking environment configuration..."
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Copying from .env.example...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}⚠️  Please edit .env with your Discord credentials${NC}"
else
    echo -e "${GREEN}✅ .env file exists${NC}"
fi

# Check required env vars
if grep -q "your-bot-token" .env; then
    echo -e "${YELLOW}⚠️  DISCORD_TOKEN needs to be configured in .env${NC}"
fi

if grep -q "your-application-id" .env; then
    echo -e "${YELLOW}⚠️  DISCORD_APPLICATION_ID needs to be configured in .env${NC}"
fi
echo ""

# Check required directories
echo "4️⃣ Checking required directories..."
mkdir -p logs
mkdir -p lavalink/plugins
echo -e "${GREEN}✅ All directories ready${NC}"
echo ""

# Check lavalink plugins
echo "5️⃣ Checking Lavalink plugins..."
if [ -d "lavalink/plugins" ] && [ "$(ls -A lavalink/plugins)" ]; then
    echo -e "${GREEN}✅ Lavalink plugins found:${NC}"
    ls -1 lavalink/plugins/*.jar 2>/dev/null | wc -l | xargs echo "   Total plugins:"
else
    echo -e "${YELLOW}⚠️  No Lavalink plugins found. They will be downloaded on first run.${NC}"
fi
echo ""

# Test build (dry run)
echo "6️⃣ Testing Docker build configuration..."
if docker compose config > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Docker Compose configuration is valid${NC}"
    echo ""
    echo "Services configured:"
    docker compose config --services | while read service; do
        echo "   - $service"
    done
else
    echo -e "${RED}❌ Docker Compose configuration has errors${NC}"
    exit 1
fi
echo ""

# Clean up any existing containers
echo "7️⃣ Cleaning up existing containers..."
if docker compose ps -q | grep -q .; then
    echo -e "${YELLOW}⚠️  Stopping existing containers...${NC}"
    docker compose down
fi
echo -e "${GREEN}✅ Clean state${NC}"
echo ""

# Build images
echo "8️⃣ Building Docker images..."
echo -e "${YELLOW}This may take 5-10 minutes on first run...${NC}"
if docker compose build; then
    echo -e "${GREEN}✅ Docker images built successfully${NC}"
else
    echo -e "${RED}❌ Failed to build Docker images${NC}"
    exit 1
fi
echo ""

# Start infrastructure services only
echo "9️⃣ Starting infrastructure services (postgres, redis, lavalink)..."
docker compose up -d postgres redis lavalink

echo "Waiting for services to be healthy (max 2 minutes)..."
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    HEALTHY=$(docker compose ps --format json | jq -r 'select(.Health == "healthy") | .Service' | wc -l)
    TOTAL=3

    if [ "$HEALTHY" -eq "$TOTAL" ]; then
        echo -e "${GREEN}✅ All infrastructure services are healthy${NC}"
        break
    fi

    echo "   Healthy: $HEALTHY/$TOTAL (${ELAPSED}s elapsed)"
    sleep 5
    ELAPSED=$((ELAPSED + 5))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
    echo -e "${RED}❌ Timeout waiting for services to be healthy${NC}"
    docker compose logs
    exit 1
fi
echo ""

# Start application services
echo "🔟 Starting application services (gateway, audio, api, worker)..."
docker compose up -d

echo "Waiting for all services to start..."
sleep 10
echo ""

# Check service status
echo "1️⃣1️⃣ Checking service health..."
echo ""
echo "Container Status:"
docker compose ps
echo ""

# Test health endpoints
echo "1️⃣2️⃣ Testing health endpoints..."

test_endpoint() {
    local name=$1
    local url=$2

    if curl -sf "$url" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ $name is responding${NC}"
    else
        echo -e "${YELLOW}⚠️  $name is not responding yet (may still be starting)${NC}"
    fi
}

test_endpoint "Lavalink" "http://localhost:2333/version"
test_endpoint "API" "http://localhost:3000/health"
test_endpoint "Gateway" "http://localhost:3001/health"
test_endpoint "Audio" "http://localhost:3002/health"
test_endpoint "Worker" "http://localhost:3003/health"
echo ""

# Show logs
echo "1️⃣3️⃣ Recent logs from services:"
echo ""
docker compose logs --tail=20
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}✅ Docker configuration test complete!${NC}"
echo ""
echo "Next steps:"
echo "  - View logs: docker compose logs -f"
echo "  - Stop services: docker compose down"
echo "  - Restart services: docker compose restart"
echo ""
echo "Services running at:"
echo "  - Gateway Health: http://localhost:3001/health"
echo "  - Audio Health: http://localhost:3002/health"
echo "  - API Health: http://localhost:3000/health"
echo "  - Worker Health: http://localhost:3003/health"
echo "  - Lavalink: http://localhost:2333/version"
echo ""
echo "Your bot should now be online in Discord!"
echo "=========================================="
