#!/usr/bin/env node
/**
 * Ngrok Tunnel Script for Trump Podcast Generator
 * Creates secure tunnels for local sharing and hybrid deployment
 */

const ngrok = require('ngrok');
const fs = require('fs').promises;
const path = require('path');

class NgrokTunnel {
  constructor() {
    this.port = process.env.PORT || 3000;
    this.authToken = process.env.NGROK_AUTH_TOKEN;
    this.tunnelUrl = null;
    this.tunnelInfo = null;
  }

  async start() {
    try {
      console.log('🚀 Starting Trump Podcast Generator with Ngrok tunnel...');
      
      // Configure ngrok options
      const options = {
        addr: this.port,
        region: 'us', // Use US region for better performance
        inspect: false, // Disable ngrok web interface for cleaner output
      };

      // Add auth token if available
      if (this.authToken) {
        options.authtoken = this.authToken;
        console.log('✅ Using authenticated ngrok tunnel');
      } else {
        console.log('⚠️  Using free ngrok tunnel (limited sessions)');
        console.log('   Set NGROK_AUTH_TOKEN for unlimited tunnels');
      }

      // Start the tunnel
      this.tunnelUrl = await ngrok.connect(options);
      this.tunnelInfo = await ngrok.getApi().get('api/tunnels');

      console.log('\n🌐 Tunnel created successfully!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📡 Public URL: ${this.tunnelUrl}`);
      console.log(`🏠 Local URL:  http://localhost:${this.port}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Save tunnel info for other processes
      await this.saveTunnelInfo();

      // Display sharing instructions
      this.displaySharingInstructions();

      // Set up graceful shutdown
      this.setupShutdownHandlers();

      // Keep the process alive
      console.log('\n⏳ Tunnel is active. Press Ctrl+C to stop...\n');
      
      // Monitor tunnel status
      this.monitorTunnel();

    } catch (error) {
      console.error('❌ Failed to create ngrok tunnel:', error.message);
      
      if (error.message.includes('authtoken')) {
        console.log('\n💡 To fix this:');
        console.log('   1. Sign up at https://ngrok.com');
        console.log('   2. Get your auth token from the dashboard');
        console.log('   3. Set NGROK_AUTH_TOKEN environment variable');
      }
      
      process.exit(1);
    }
  }

  async saveTunnelInfo() {
    const tunnelData = {
      url: this.tunnelUrl,
      port: this.port,
      created: new Date().toISOString(),
      expires: this.authToken ? 'Never (authenticated)' : '8 hours (free tier)'
    };

    try {
      await fs.writeFile(
        path.join(__dirname, '..', 'tunnel-info.json'),
        JSON.stringify(tunnelData, null, 2)
      );
    } catch (error) {
      console.warn('⚠️  Could not save tunnel info:', error.message);
    }
  }

  displaySharingInstructions() {
    console.log('\n📋 Sharing Instructions:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔗 Share this URL: ${this.tunnelUrl}`);
    console.log('\n📱 Available endpoints:');
    console.log(`   • Health Check: ${this.tunnelUrl}/health`);
    console.log(`   • API Status:   ${this.tunnelUrl}/api/status`);
    console.log(`   • Search:       ${this.tunnelUrl}/api/search`);
    console.log(`   • Generate:     ${this.tunnelUrl}/api/workflow`);
    console.log('\n🔐 Authentication:');
    console.log('   • Login:        POST /api/login');
    console.log('   • Default:      admin / admin123');
    console.log('\n💰 Donation System:');
    console.log(`   • Support:      ${this.tunnelUrl}/api/donate`);
    console.log(`   • Analytics:    ${this.tunnelUrl}/api/donate/analytics`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  monitorTunnel() {
    // Check tunnel status every 30 seconds
    const monitor = setInterval(async () => {
      try {
        const tunnels = await ngrok.getApi().get('api/tunnels');
        if (!tunnels.tunnels || tunnels.tunnels.length === 0) {
          console.log('⚠️  Tunnel disconnected, attempting to reconnect...');
          clearInterval(monitor);
          await this.start();
        }
      } catch (error) {
        console.warn('⚠️  Tunnel monitoring error:', error.message);
      }
    }, 30000);

    // Store monitor reference for cleanup
    this.monitor = monitor;
  }

  setupShutdownHandlers() {
    const shutdown = async (signal) => {
      console.log(`\n🛑 Received ${signal}, shutting down tunnel...`);
      
      if (this.monitor) {
        clearInterval(this.monitor);
      }

      try {
        await ngrok.disconnect();
        await ngrok.kill();
        console.log('✅ Tunnel closed successfully');
      } catch (error) {
        console.warn('⚠️  Error closing tunnel:', error.message);
      }

      // Clean up tunnel info file
      try {
        await fs.unlink(path.join(__dirname, '..', 'tunnel-info.json'));
      } catch (error) {
        // File might not exist, ignore
      }

      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGQUIT', () => shutdown('SIGQUIT'));
  }

  static async getActiveTunnel() {
    try {
      const tunnelInfoPath = path.join(__dirname, '..', 'tunnel-info.json');
      const data = await fs.readFile(tunnelInfoPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }
}

// CLI usage
if (require.main === module) {
  const tunnel = new NgrokTunnel();
  tunnel.start().catch(console.error);
}

module.exports = NgrokTunnel;
