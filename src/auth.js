/**
 * Authentication Module - JWT-Lite for Trump Podcast Generator
 * Session-based auth with localStorage tokens
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

class AuthManager {
  constructor(db, jwtSecret = null) {
    this.db = db;
    this.jwtSecret = jwtSecret || process.env.JWT_SECRET || 'trump-podcast-secret-key-change-in-production';
    this.initTables();
  }

  initTables() {
    // Create users table for basic auth
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT,
        role TEXT DEFAULT 'user',
        api_keys TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        active INTEGER DEFAULT 1
      );
      
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      );
    `);

    // Create default admin user if none exists
    this.createDefaultUser();
  }

  createDefaultUser() {
    const existingUser = this.db.prepare('SELECT id FROM users LIMIT 1').get();
    if (!existingUser) {
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
      const hashedPassword = bcrypt.hashSync(defaultPassword, 10);
      
      this.db.prepare(`
        INSERT INTO users (username, password_hash, email, role) 
        VALUES (?, ?, ?, ?)
      `).run('admin', hashedPassword, 'admin@trumppodgen.local', 'admin');
      
      console.log('Created default admin user: admin / admin123');
      console.log('⚠️  Change default password in production!');
    }
  }

  async login(username, password) {
    try {
      const user = this.db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
      
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return { success: false, error: 'Invalid credentials' };
      }

      // Generate JWT token
      const token = jwt.sign(
        { 
          userId: user.id, 
          username: user.username, 
          role: user.role 
        },
        this.jwtSecret,
        { expiresIn: '24h' }
      );

      // Store session
      const tokenHash = bcrypt.hashSync(token, 10);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      this.db.prepare(`
        INSERT INTO sessions (user_id, token_hash, expires_at) 
        VALUES (?, ?, ?)
      `).run(user.id, tokenHash, expiresAt.toISOString());

      // Update last login
      this.db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

      return {
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      
      // Check if session exists and is valid
      const session = this.db.prepare(`
        SELECT s.*, u.username, u.role, u.active 
        FROM sessions s 
        JOIN users u ON s.user_id = u.id 
        WHERE s.user_id = ? AND s.expires_at > datetime('now') AND u.active = 1
      `).get(decoded.userId);

      if (!session) {
        return { valid: false, error: 'Session expired or invalid' };
      }

      return {
        valid: true,
        user: {
          id: decoded.userId,
          username: session.username,
          role: session.role
        }
      };
    } catch (error) {
      return { valid: false, error: 'Invalid token' };
    }
  }

  logout(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      
      // Remove session
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(decoded.userId);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Middleware for protecting routes
  requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.query.token || 
                  req.body.token;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const verification = this.verifyToken(token);
    if (!verification.valid) {
      return res.status(401).json({ error: verification.error });
    }

    req.user = verification.user;
    next();
  }

  // Middleware for admin-only routes
  requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  }

  // Get user API keys (for OpenRouter, YouTube, etc.)
  getUserApiKeys(userId) {
    try {
      const user = this.db.prepare('SELECT api_keys FROM users WHERE id = ?').get(userId);
      return user?.api_keys ? JSON.parse(user.api_keys) : {};
    } catch (error) {
      return {};
    }
  }

  // Update user API keys
  updateUserApiKeys(userId, apiKeys) {
    try {
      this.db.prepare('UPDATE users SET api_keys = ? WHERE id = ?')
        .run(JSON.stringify(apiKeys), userId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Clean expired sessions
  cleanupSessions() {
    try {
      const result = this.db.prepare('DELETE FROM sessions WHERE expires_at <= datetime("now")').run();
      console.log(`Cleaned up ${result.changes} expired sessions`);
      return result.changes;
    } catch (error) {
      console.error('Session cleanup error:', error);
      return 0;
    }
  }

  // Get user stats
  getUserStats() {
    try {
      const stats = this.db.prepare(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN active = 1 THEN 1 END) as active_users,
          COUNT(CASE WHEN last_login > datetime('now', '-7 days') THEN 1 END) as recent_users
        FROM users
      `).get();

      const sessions = this.db.prepare(`
        SELECT COUNT(*) as active_sessions 
        FROM sessions 
        WHERE expires_at > datetime('now')
      `).get();

      return { ...stats, ...sessions };
    } catch (error) {
      return { error: error.message };
    }
  }
}

module.exports = { AuthManager };
