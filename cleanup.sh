#!/bin/bash

echo "Cleaning up all Discord bot processes..."

# Kill all Discord bot related processes
pkill -f "tsx.*gateway" 2>/dev/null || true
pkill -f "tsx.*audio" 2>/dev/null || true
pkill -f "pnpm.*dev" 2>/dev/null || true
pkill -f "node.*discord" 2>/dev/null || true
pkill -f "node.*simple" 2>/dev/null || true
pkill -f "node.*start" 2>/dev/null || true

echo "Waiting for processes to terminate..."
sleep 2

# Double check with ps and kill any remaining
ps aux | grep -E "(tsx.*gateway|tsx.*audio|pnpm.*dev|node.*discord|node.*simple)" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true

echo "Cleanup complete!"
echo "Now starting clean services..."