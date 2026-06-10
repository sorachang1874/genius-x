#!/bin/bash
# Quick start script for Genius X Demo
# Usage: ./demo-start.sh

set -e

echo "🚀 Starting Genius X Demo..."
echo ""

# Check if in project root
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must run from project root"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    pnpm install
fi

echo "✅ Dependencies ready"
echo ""

# Phase 1: student joins need the Identity Service (PostgreSQL). Default to the compose DB.
export DATABASE_URL="${DATABASE_URL:-postgres://geniusx:geniusx@localhost:5432/geniusx}"
if ! docker compose exec -T postgres pg_isready -U geniusx >/dev/null 2>&1; then
    echo "⚠️  PostgreSQL is not running — student joins will fail (503 IDENTITY_UNAVAILABLE)."
    echo "   Start it first:"
    echo "     docker compose up -d postgres"
    echo "     DATABASE_URL=$DATABASE_URL pnpm --filter @genius-x/server migrate:seed"
    echo ""
fi

# Seeded demo students (apps/server/migrations/001_phase1_identity_seed.sql)
XIAOMING="33333333-3333-4333-8333-000000000001"
DUODUO="33333333-3333-4333-8333-000000000002"

echo "Starting services..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📍 Server will run on: http://localhost:3000 (identity: $DATABASE_URL)"
echo "📍 Web app will run on: http://localhost:5173"
echo ""
echo "🎯 Demo URLs (students need their enrollment link with studentId):"
echo "   • Assistant:    http://localhost:5173/?role=assistant"
echo "   • Student 小明: http://localhost:5173/?studentId=$XIAOMING"
echo "   • Student 朵朵: http://localhost:5173/?studentId=$DUODUO"
echo "   • Teacher:      http://localhost:5173/?role=teacher"
echo ""
echo "📱 For mobile/iPad testing:"
LOCAL_IP=$(hostname -I | awk '{print $1}' 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || echo "")
if [ -n "$LOCAL_IP" ]; then
    echo "   • Assistant:    http://$LOCAL_IP:5173/?role=assistant"
    echo "   • Student 小明: http://$LOCAL_IP:5173/?studentId=$XIAOMING"
else
    echo "   (Get your local IP with: ifconfig | grep 'inet ' | grep -v 127.0.0.1)"
fi
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔄 Starting both server and web app..."
echo "   Press Ctrl+C to stop all services"
echo ""

# Use pnpm to run both in parallel
# Server logs will have [server] prefix, web logs will have [web] prefix
pnpm --filter @genius-x/server dev 2>&1 | sed 's/^/[server] /' &
SERVER_PID=$!

pnpm --filter @genius-x/web dev 2>&1 | sed 's/^/[web] /' &
WEB_PID=$!

# Trap Ctrl+C and kill both processes
trap "echo ''; echo '🛑 Stopping services...'; kill $SERVER_PID $WEB_PID 2>/dev/null; exit 0" INT TERM

# Wait for both processes
wait
