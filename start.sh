#!/bin/bash
set -e
cd "$(dirname "$0")"
# Load .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "=== Installing Python dependencies ==="
pip install -q -r s2a/src/backend/requirements.txt
pip install -q scikit-learn

echo "=== Installing frontend dependencies ==="
cd s2a/src/frontend
npm install --silent
cd ../../..

echo "=== Starting backend (port 8080) ==="
cd s2a/src/backend
uvicorn main:app --host 0.0.0.0 --port 8080 --reload &
BACK_PID=$!
cd ../../..

echo "=== Starting frontend (port 5173) ==="
cd s2a/src/frontend
npm run dev &
FRONT_PID=$!
cd ../../..

sleep 2
open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173 2>/dev/null || true

echo ""
echo "Backend PID: $BACK_PID  |  Frontend PID: $FRONT_PID"
echo "Press Ctrl+C to stop both."

trap "kill $BACK_PID $FRONT_PID 2>/dev/null" EXIT
wait
