#!/bin/bash

# Cartesia Integration Quick Start Script
# This script helps you get started quickly

set -e

echo "🚀 Cartesia Integration Quick Start"
echo "===================================="
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from template..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✅ Created .env file from template"
        echo ""
        echo "📝 IMPORTANT: Edit .env file and add your CARTESIA_API_KEY"
        echo "   Then run this script again."
        exit 0
    else
        echo "❌ .env.example not found. Please create a .env file manually."
        exit 1
    fi
fi

# Check if CARTESIA_API_KEY is set
if ! grep -q "^CARTESIA_API_KEY=your_api_key_here" .env && ! grep -q "^CARTESIA_API_KEY=$" .env; then
    echo "✅ CARTESIA_API_KEY is configured"
else
    echo "❌ CARTESIA_API_KEY is not set in .env file"
    echo "   Please edit .env and add your API key, then run this script again."
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi

echo ""

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Install/upgrade pip
echo "📦 Upgrading pip..."
pip install --upgrade pip > /dev/null 2>&1

# Install dependencies
echo "📦 Installing dependencies..."
if [ -f requirements.txt ]; then
    pip install -r requirements.txt
    echo "✅ Dependencies installed"
else
    echo "⚠️  requirements.txt not found, installing manually..."
    pip install fastapi uvicorn httpx websockets pydantic python-dotenv
    echo "✅ Core dependencies installed"
fi

echo ""
echo "===================================="
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Choose which server to run:"
echo ""
echo "   For REST API (TTS only):"
echo "   $ source venv/bin/activate"
echo "   $ python server-fixed.py"
echo ""
echo "   For WebSocket (STT + TTS):"
echo "   $ source venv/bin/activate"
echo "   $ uvicorn server_ws-fixed:app --reload --port 8000"
echo ""
echo "2. In another terminal, start a simple HTTP server:"
echo "   $ python -m http.server 3000"
echo ""
echo "3. Open your browser to:"
echo "   http://localhost:3000/index-fixed.html"
echo ""
echo "===================================="
