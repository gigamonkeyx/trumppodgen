#!/bin/bash

# Trump Podcast Generator Deployment Script
# Usage: ./scripts/deploy.sh [environment]

set -e

ENVIRONMENT=${1:-development}
PROJECT_NAME="trump-podcast-generator"

echo "🚀 Deploying Trump Podcast Generator to $ENVIRONMENT environment"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "📝 Please edit .env file with your API keys before continuing."
        echo "   Required: OPENROUTER_API_KEY"
        echo "   Optional: YOUTUBE_API_KEY"
        read -p "Press Enter when ready to continue..."
    else
        echo "❌ .env.example file not found. Please create .env file manually."
        exit 1
    fi
fi

# Create necessary directories
echo "📁 Creating data directories..."
mkdir -p data audio rss logs

# Set permissions
chmod 755 data audio rss logs

# Build and start services
echo "🔨 Building Docker image..."
docker-compose build

echo "🏃 Starting services..."
if [ "$ENVIRONMENT" = "production" ]; then
    docker-compose --profile production up -d
else
    docker-compose up -d
fi

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Health check
echo "🏥 Performing health check..."
for i in {1..30}; do
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        echo "✅ Service is healthy!"
        break
    fi
    
    if [ $i -eq 30 ]; then
        echo "❌ Health check failed after 30 attempts"
        echo "📋 Service logs:"
        docker-compose logs trump-podcast-generator
        exit 1
    fi
    
    echo "   Attempt $i/30 - waiting..."
    sleep 2
done

# Show status
echo "📊 Deployment Status:"
docker-compose ps

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📱 Application URLs:"
echo "   Main App: http://localhost:3000"
echo "   Health Check: http://localhost:3000/health"
echo "   API Status: http://localhost:3000/api/status"
echo ""
echo "🔧 Management Commands:"
echo "   View logs: docker-compose logs -f"
echo "   Stop services: docker-compose down"
echo "   Restart: docker-compose restart"
echo "   Update: git pull && docker-compose build && docker-compose up -d"
echo ""

# Run basic tests if available
if [ -f "test/basic.test.js" ]; then
    echo "🧪 Running basic tests..."
    sleep 5  # Give the service a moment to fully start
    
    if node test/basic.test.js; then
        echo "✅ All tests passed!"
    else
        echo "⚠️  Some tests failed, but deployment is complete."
        echo "   Check the application manually at http://localhost:3000"
    fi
fi

echo ""
echo "🎯 Next Steps:"
echo "1. Visit http://localhost:3000 to use the application"
echo "2. Configure additional API keys in .env if needed"
echo "3. Test the workflow by selecting speeches and generating a podcast"
echo "4. Monitor logs with: docker-compose logs -f"
