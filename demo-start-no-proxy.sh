#!/usr/bin/env bash
# Demo startup script with proxy disabled for local network access

set -e

echo "🚀 Starting Genius X Demo (no proxy mode)..."

# Check dependencies
if ! command -v pnpm &> /dev/null; then
  echo "❌ pnpm not found. Install it first: npm install -g pnpm"
  exit 1
fi

# Install if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  pnpm install
fi

echo "✅ Dependencies ready"
echo ""
echo "Starting services..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get WSL2 IP for mobile testing
WSL_IP=$(hostname -I | awk '{print $1}')

echo "📍 Server will run on: http://localhost:3000"
echo "📍 Web app will run on: http://localhost:5173"
echo ""
echo "🎯 Demo URLs:"
echo "   • Assistant: http://localhost:5173/?role=assistant"
echo "   • Student:   http://localhost:5173/"
echo "   • Teacher:   http://localhost:5173/?role=teacher"
echo ""
echo "📱 For mobile/iPad testing:"
echo "   • Assistant: http://$WSL_IP:5173/?role=assistant"
echo "   • Student:   http://$WSL_IP:5173/"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔄 Starting both server and web app..."
echo "   Press Ctrl+C to stop all services"
echo ""

# Disable proxy for local network access
unset http_proxy
unset https_proxy
unset HTTP_PROXY
unset HTTPS_PROXY
unset all_proxy
unset ALL_PROXY

# Trap Ctrl+C to clean up both processes
trap 'echo ""; echo "🛑 Stopping all services..."; kill 0' SIGINT

# Start both in parallel
pnpm --filter @genius-x/server dev &
pnpm --filter @genius-x/web dev &

# Wait for all background jobs
wait
