#!/bin/bash

# Discord Bot Startup Script - Integrated Lavalink + Services
# Starts Lavalink first, waits for it to be ready, then starts all services

set -e

# Redirect all output to log file
exec > >(tee -a /Users/lucascisterna/Documents/repos/discord_bot/startup_debug_internal.log) 2>&1

echo "🚀 Starting Discord Bot with integrated Lavalink..."

# Function to check if Lavalink is ready
check_lavalink() {
    curl -s http://localhost:2333/v4/info > /dev/null 2>&1
}

# Start Lavalink in background
echo "🔵 Starting Lavalink..."
cd lavalink
java -jar Lavalink.jar &
LAVALINK_PID=$!
cd ..

# Wait for Lavalink to be ready (max 30 seconds)
echo "⏳ Waiting for Lavalink to be ready..."
for i in {1..30}; do
    if check_lavalink; then
        echo "✅ Lavalink is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Lavalink failed to start within 30 seconds"
        kill $LAVALINK_PID 2>/dev/null || true
        exit 1
    fi
    echo "⏳ Attempt $i/30 - waiting for Lavalink..."
    sleep 1
done

# Now start all services
echo "🟢 Starting Discord Bot services..."
pnpm -r --parallel dev &
SERVICES_PID=$!

# Function to cleanup on exit
cleanup() {
    echo "🛑 Shutting down..."
    kill $SERVICES_PID 2>/dev/null || true
    kill $LAVALINK_PID 2>/dev/null || true
    wait $SERVICES_PID 2>/dev/null || true
    wait $LAVALINK_PID 2>/dev/null || true
    echo "✅ All processes stopped"
}

# Handle interruption signals
trap cleanup SIGINT SIGTERM

echo "✅ All services started successfully!"
echo "🎵 Discord Bot is ready for multi-server usage"
echo "Press Ctrl+C to stop all services"

# Wait for both processes
wait $SERVICES_PID
wait $LAVALINK_PID