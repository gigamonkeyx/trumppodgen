/**
 * Analytics and Monitoring Module
 * Tracks usage, performance, and system health
 */

class Analytics {
  constructor(db) {
    this.db = db;
    this.initTables();
    this.metrics = {
      requests: 0,
      errors: 0,
      workflows: 0,
      scriptsGenerated: 0,
      audioGenerated: 0,
      podcastsFinalized: 0
    };
    this.startTime = Date.now();
  }

  initTables() {
    // Create analytics tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        event_data TEXT,
        user_agent TEXT,
        ip_address TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS analytics_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        response_time INTEGER NOT NULL,
        status_code INTEGER NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS analytics_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        error_type TEXT NOT NULL,
        error_message TEXT,
        stack_trace TEXT,
        endpoint TEXT,
        user_agent TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // Track API requests and performance
  trackRequest(req, res, responseTime) {
    try {
      this.metrics.requests++;
      
      const insert = this.db.prepare(`
        INSERT INTO analytics_performance (endpoint, method, response_time, status_code)
        VALUES (?, ?, ?, ?)
      `);
      
      insert.run(req.path, req.method, responseTime, res.statusCode);
      
      if (res.statusCode >= 400) {
        this.metrics.errors++;
      }
    } catch (error) {
      console.error('Analytics tracking error:', error);
    }
  }

  // Track specific events
  trackEvent(eventType, eventData = {}, req = null) {
    try {
      const insert = this.db.prepare(`
        INSERT INTO analytics_events (event_type, event_data, user_agent, ip_address)
        VALUES (?, ?, ?, ?)
      `);
      
      insert.run(
        eventType,
        JSON.stringify(eventData),
        req?.get('User-Agent') || null,
        req?.ip || null
      );

      // Update metrics
      switch (eventType) {
        case 'workflow_created':
          this.metrics.workflows++;
          break;
        case 'script_generated':
          this.metrics.scriptsGenerated++;
          break;
        case 'audio_generated':
          this.metrics.audioGenerated++;
          break;
        case 'podcast_finalized':
          this.metrics.podcastsFinalized++;
          break;
      }
    } catch (error) {
      console.error('Event tracking error:', error);
    }
  }

  // Track errors
  trackError(error, req = null, endpoint = null) {
    try {
      const insert = this.db.prepare(`
        INSERT INTO analytics_errors (error_type, error_message, stack_trace, endpoint, user_agent)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      insert.run(
        error.name || 'Unknown',
        error.message || 'No message',
        error.stack || null,
        endpoint || req?.path || null,
        req?.get('User-Agent') || null
      );
    } catch (trackingError) {
      console.error('Error tracking error:', trackingError);
    }
  }

  // Get analytics dashboard data
  getDashboardData() {
    try {
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Request stats
      const requestStats = this.db.prepare(`
        SELECT 
          COUNT(*) as total_requests,
          AVG(response_time) as avg_response_time,
          COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_count
        FROM analytics_performance 
        WHERE timestamp >= ?
      `).get(last24h.toISOString());

      // Popular endpoints
      const popularEndpoints = this.db.prepare(`
        SELECT endpoint, COUNT(*) as count
        FROM analytics_performance 
        WHERE timestamp >= ?
        GROUP BY endpoint 
        ORDER BY count DESC 
        LIMIT 10
      `).all(last7d.toISOString());

      // Event stats
      const eventStats = this.db.prepare(`
        SELECT event_type, COUNT(*) as count
        FROM analytics_events 
        WHERE timestamp >= ?
        GROUP BY event_type
      `).all(last7d.toISOString());

      // Error stats
      const errorStats = this.db.prepare(`
        SELECT error_type, COUNT(*) as count
        FROM analytics_errors 
        WHERE timestamp >= ?
        GROUP BY error_type 
        ORDER BY count DESC
      `).all(last7d.toISOString());

      // Performance trends (hourly for last 24h)
      const performanceTrends = this.db.prepare(`
        SELECT 
          strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
          COUNT(*) as requests,
          AVG(response_time) as avg_response_time
        FROM analytics_performance 
        WHERE timestamp >= ?
        GROUP BY hour 
        ORDER BY hour
      `).all(last24h.toISOString());

      return {
        overview: {
          uptime: Date.now() - this.startTime,
          totalRequests: this.metrics.requests,
          totalErrors: this.metrics.errors,
          totalWorkflows: this.metrics.workflows,
          scriptsGenerated: this.metrics.scriptsGenerated,
          audioGenerated: this.metrics.audioGenerated,
          podcastsFinalized: this.metrics.podcastsFinalized
        },
        last24h: {
          requests: requestStats.total_requests || 0,
          avgResponseTime: Math.round(requestStats.avg_response_time || 0),
          errors: requestStats.error_count || 0,
          errorRate: requestStats.total_requests ? 
            ((requestStats.error_count || 0) / requestStats.total_requests * 100).toFixed(2) : 0
        },
        popularEndpoints,
        eventStats,
        errorStats,
        performanceTrends
      };
    } catch (error) {
      console.error('Dashboard data error:', error);
      return { error: 'Failed to generate dashboard data' };
    }
  }

  // Get system health metrics
  getHealthMetrics() {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      return {
        memory: {
          used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
          total: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
          external: Math.round(memUsage.external / 1024 / 1024), // MB
          rss: Math.round(memUsage.rss / 1024 / 1024) // MB
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        },
        uptime: Math.round(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      };
    } catch (error) {
      console.error('Health metrics error:', error);
      return { error: 'Failed to get health metrics' };
    }
  }

  // Cleanup old analytics data
  cleanup(daysToKeep = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      const cutoffISO = cutoffDate.toISOString();

      const tables = ['analytics_events', 'analytics_performance', 'analytics_errors'];
      let totalDeleted = 0;

      for (const table of tables) {
        const result = this.db.prepare(`DELETE FROM ${table} WHERE timestamp < ?`).run(cutoffISO);
        totalDeleted += result.changes;
      }

      console.log(`Analytics cleanup: Removed ${totalDeleted} old records`);
      return totalDeleted;
    } catch (error) {
      console.error('Analytics cleanup error:', error);
      return 0;
    }
  }

  // Express middleware for automatic tracking
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      
      // Track when response finishes
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        this.trackRequest(req, res, responseTime);
      });
      
      next();
    };
  }
}

module.exports = { Analytics };
