require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Database = require('better-sqlite3');
const cheerio = require('cheerio');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const { DataSourceManager } = require('./src/dataSources');
const { Analytics } = require('./src/analytics');
const { AuthManager } = require('./src/auth');
const NgrokTunnel = require('./scripts/ngrok-tunnel');

const app = express();
const port = 3000;
const db = new Database('archive.db');
const dataSourceManager = new DataSourceManager(db);
const analytics = new Analytics(db);
const auth = new AuthManager(db);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public')); // Serve static files from public
app.use(express.static(__dirname)); // Fallback to serve index.html from root

// Analytics middleware
app.use(analytics.middleware());

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} - ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  analytics.trackError(err, req);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Init DB tables with improved schema
db.exec(`
  CREATE TABLE IF NOT EXISTS speeches (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    transcript TEXT,
    video_url TEXT,
    audio_url TEXT,
    source TEXT NOT NULL,
    rally_location TEXT,
    duration INTEGER,
    transcript_url TEXT,
    thumbnail_url TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS models (
    category TEXT PRIMARY KEY,
    list TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    speech_ids TEXT NOT NULL,
    script TEXT,
    audio_url TEXT,
    rss_url TEXT,
    status TEXT DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Pre-populate models (from search; top overall and free)
const topOverallModels = [
  'claude-sonnet-4/anthropic', 'gemini-2.0-flash/google', 'gemini-2.5-flash/google', 'gpt-4o/openai',
  'claude-3.7-sonnet/anthropic', 'deepseek-r1/deepseek', 'openai-o1/openai', 'llama-4/meta',
  'mistral-large-2/mistral', 'qwen-2.5/alibaba'
];
const topFreeModels = [
  'deepseek-v3-0324/deepseek', 'deepseek-r1-0528/deepseek', 'deepseek-r1/deepseek', 'kimi-k2/moonshot',
  'gemini-2.5-flash/google', 'llama-3/meta', 'mistral-7b/mistral', 'gemma-2/google',
  'qwen-2/alibaba', 'phi-3/microsoft'
];

// Store initial models
const insertModels = db.prepare('INSERT OR REPLACE INTO models (category, list) VALUES (?, ?)');
insertModels.run('top_overall', JSON.stringify(topOverallModels));
insertModels.run('top_free', JSON.stringify(topFreeModels));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbCheck = db.prepare('SELECT 1').get();
    const speechCount = db.prepare('SELECT COUNT(*) as count FROM speeches').get().count;
    const workflowCount = db.prepare('SELECT COUNT(*) as count FROM workflows').get().count;

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbCheck ? 'connected' : 'disconnected',
      stats: {
        speeches: speechCount,
        workflows: workflowCount
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: require('./package.json').version
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API status endpoint
app.get('/api/status', async (req, res) => {
  try {
    const sources = await dataSourceManager.verifyAllSources();
    const availableSources = Object.values(sources).filter(s => s.available).length;
    const totalSources = Object.keys(sources).length;

    res.json({
      sources: {
        available: availableSources,
        total: totalSources,
        details: sources
      },
      database: {
        speeches: db.prepare('SELECT COUNT(*) as count FROM speeches').get().count,
        workflows: db.prepare('SELECT COUNT(*) as count FROM workflows').get().count
      },
      ai: {
        provider: 'OpenRouter',
        configured: !!process.env.OPENROUTER_API_KEY
      },
      system: analytics.getHealthMetrics()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analytics dashboard endpoint
app.get('/api/analytics', async (req, res) => {
  try {
    const dashboardData = analytics.getDashboardData();
    res.json(dashboardData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analytics cleanup endpoint (admin only in production)
app.post('/api/analytics/cleanup', auth.requireAuth.bind(auth), auth.requireAdmin.bind(auth), async (req, res) => {
  try {
    const { days = 30 } = req.body;
    const deletedCount = analytics.cleanup(days);
    res.json({
      message: 'Cleanup completed',
      deletedRecords: deletedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Authentication endpoints
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await auth.login(username, password);

    if (result.success) {
      analytics.trackEvent('user_login', { username }, req);
      res.json(result);
    } else {
      res.status(401).json(result);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/logout', auth.requireAuth.bind(auth), async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const result = auth.logout(token);

    analytics.trackEvent('user_logout', { username: req.user.username }, req);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/profile', auth.requireAuth.bind(auth), async (req, res) => {
  try {
    const apiKeys = auth.getUserApiKeys(req.user.id);
    res.json({
      user: req.user,
      apiKeys: Object.keys(apiKeys), // Don't send actual keys, just which ones are configured
      hasOpenRouter: !!apiKeys.openrouter,
      hasYouTube: !!apiKeys.youtube
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profile/api-keys', auth.requireAuth.bind(auth), async (req, res) => {
  try {
    const { openrouter, youtube } = req.body;
    const apiKeys = {};

    if (openrouter) apiKeys.openrouter = openrouter;
    if (youtube) apiKeys.youtube = youtube;

    const result = auth.updateUserApiKeys(req.user.id, apiKeys);

    if (result.success) {
      analytics.trackEvent('api_keys_updated', { userId: req.user.id }, req);
      res.json({ message: 'API keys updated successfully' });
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Donation/Support endpoints with dynamic tiers and A/B testing
app.get('/api/donate', async (req, res) => {
  try {
    const { variant = 'default', userId = 'anonymous' } = req.query;

    // Get user usage statistics for dynamic tier calculation
    const userUsage = await getUserUsageStats(userId);
    const recommendedTier = calculateRecommendedTier(userUsage);

    // A/B test variants for donation messaging (expanded for launch campaign)
    const variants = {
      default: {
        message: "Support Trump Podcast Generator Development",
        description: "Help us maintain and improve this local podcast generation tool",
        audience: "general"
      },
      urgent: {
        message: "Keep Trump Podcast Generator Free & Independent",
        description: "Your support ensures we stay ad-free and maintain local-first privacy",
        audience: "privacy-focused"
      },
      feature: {
        message: "Unlock Premium Features & Support Development",
        description: "Get unlimited batch processing, custom voices, and priority support",
        audience: "power-users"
      },
      usage: {
        message: `You've generated ${userUsage.totalPodcasts} podcasts - Support the tool you love!`,
        description: `Based on your usage, consider the ${recommendedTier.name} tier to help sustain development`,
        audience: "active-users"
      },
      technical: {
        message: "Support Open Source AI Development",
        description: "Help maintain this local-first, privacy-focused podcast generation system",
        audience: "developers"
      },
      creator: {
        message: "Help Keep This Tool Free for Creators",
        description: "Support the tool that saves content creators 10+ hours per podcast episode",
        audience: "content-creators"
      },
      community: {
        message: "Join the Trump Podcast Generator Community",
        description: "Get exclusive access to new features and help shape the future of AI podcasting",
        audience: "enthusiasts"
      }
    };

    const selectedVariant = variants[variant] || variants.default;

    const donationInfo = {
      ...selectedVariant,
      variant: variant,
      userUsage: userUsage,
      recommendedTier: recommendedTier,
      options: [
        {
          platform: "Patreon",
          url: process.env.PATREON_URL || "https://patreon.com/trumppodgen",
          description: "Monthly support for ongoing development",
          suggested_amounts: recommendedTier.patreonAmounts,
          recommended: recommendedTier.platform === 'patreon',
          active: true
        },
        {
          platform: "Ko-fi",
          url: process.env.KOFI_URL || "https://ko-fi.com/trumppodgen",
          description: "One-time support",
          suggested_amounts: recommendedTier.kofiAmounts,
          recommended: recommendedTier.platform === 'kofi',
          active: true
        },
        {
          platform: "GitHub Sponsors",
          url: process.env.GITHUB_SPONSORS_URL || "https://github.com/sponsors/gigamonkeyx",
          description: "Support open source development",
          suggested_amounts: recommendedTier.githubAmounts,
          recommended: recommendedTier.platform === 'github',
          active: true
        }
      ],
      tiers: {
        casual: {
          name: "Casual User",
          description: "Perfect for occasional podcast generation",
          threshold: "1-5 podcasts",
          benefits: ["Basic features", "Community support"]
        },
        regular: {
          name: "Regular User",
          description: "Great for frequent podcast creators",
          threshold: "6-20 podcasts",
          benefits: ["Priority support", "Early feature access"]
        },
        power: {
          name: "Power User",
          description: "For heavy podcast generation workflows",
          threshold: "21+ podcasts",
          benefits: ["Unlimited features", "Direct developer access", "Custom voice training"]
        }
      },
      features: {
        free: [
          "Basic podcast generation",
          "Up to 5 speeches per workflow",
          "Standard TTS voices"
        ],
        supporter: [
          "Unlimited batch processing",
          "Custom voice cloning",
          "Priority support",
          "Early access to new features"
        ]
      }
    };

    res.json(donationInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/donate/track', async (req, res) => {
  try {
    const { platform, amount, userId, variant = 'default', source = 'app' } = req.body;

    // Enhanced donation analytics with A/B testing
    analytics.trackEvent('donation_clicked', {
      platform,
      amount: amount || 'unknown',
      userId: userId || 'anonymous',
      variant,
      source,
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent'] || 'unknown'
    }, req);

    // Track conversion funnel
    analytics.trackEvent('conversion_funnel', {
      step: 'donation_intent',
      platform,
      variant,
      userId: userId || 'anonymous'
    }, req);

    res.json({
      message: 'Thank you for your support!',
      tracked: true,
      variant,
      nextStep: 'Please complete your donation on the platform'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Donation conversion completion (webhook-style)
app.post('/api/donate/complete', async (req, res) => {
  try {
    const { platform, amount, userId, transactionId } = req.body;

    // Track successful conversion (would be called by payment webhook in production)
    analytics.trackEvent('donation_completed', {
      platform,
      amount,
      userId: userId || 'anonymous',
      transactionId,
      timestamp: new Date().toISOString()
    }, req);

    analytics.trackEvent('conversion_funnel', {
      step: 'donation_completed',
      platform,
      amount,
      userId: userId || 'anonymous'
    }, req);

    res.json({
      message: 'Donation completed successfully!',
      tracked: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get donation analytics (admin only)
app.get('/api/donate/analytics', auth.requireAuth.bind(auth), auth.requireAdmin.bind(auth), async (req, res) => {
  try {
    const { days = 30 } = req.query;

    // Get donation analytics from the last N days
    const donationStats = db.prepare(`
      SELECT
        json_extract(data, '$.platform') as platform,
        json_extract(data, '$.variant') as variant,
        COUNT(*) as clicks,
        COUNT(CASE WHEN event_type = 'donation_completed' THEN 1 END) as conversions
      FROM analytics
      WHERE event_type IN ('donation_clicked', 'donation_completed')
        AND created_at > datetime('now', '-${days} days')
      GROUP BY platform, variant
    `).all();

    const totalClicks = db.prepare(`
      SELECT COUNT(*) as total
      FROM analytics
      WHERE event_type = 'donation_clicked'
        AND created_at > datetime('now', '-${days} days')
    `).get();

    const totalConversions = db.prepare(`
      SELECT COUNT(*) as total
      FROM analytics
      WHERE event_type = 'donation_completed'
        AND created_at > datetime('now', '-${days} days')
    `).get();

    res.json({
      period: `${days} days`,
      summary: {
        totalClicks: totalClicks.total,
        totalConversions: totalConversions.total,
        conversionRate: totalClicks.total > 0 ? (totalConversions.total / totalClicks.total * 100).toFixed(2) + '%' : '0%'
      },
      byPlatform: donationStats,
      recommendations: generateDonationRecommendations(donationStats)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Enhanced OpenRouter bridge with dynamic model curation
app.get('/api/models', async (req, res) => {
  try {
    // Check for API key from client or environment
    const clientApiKey = req.headers['x-openrouter-key'];
    const apiKey = clientApiKey || process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      // Return curated fallback models from database
      const fallbackModels = await getCuratedModels('fallback');
      return res.json({
        models: fallbackModels,
        configured: false,
        message: 'Configure OpenRouter API key in the settings to enable AI models',
        source: 'fallback',
        validation: {
          required: true,
          endpoint: '/api/validate-openrouter-key'
        }
      });
    }

    // Validate API key first (uses caching)
    const validation = await validateOpenRouterKey(apiKey);

    if (!validation.valid) {
      // Return fallback models with validation error
      const fallbackModels = await getCuratedModels('fallback');
      return res.json({
        models: fallbackModels,
        configured: false,
        message: `API key validation failed: ${validation.message}`,
        source: 'fallback',
        validation: {
          valid: false,
          error: validation.error,
          message: validation.message,
          fromCache: validation.fromCache
        }
      });
    }

    // Try to fetch available models from OpenRouter with validated key
    try {
      const response = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 15000
      });

      const availableModels = response.data.data
        .filter(model => !model.id.includes('free') && model.pricing) // Filter out free/limited models
        .slice(0, 15) // Increased limit for better selection
        .map(model => ({
          id: model.id,
          name: model.name || model.id,
          description: model.description || 'AI language model',
          provider: model.id.split('/')[0] || 'Unknown',
          available: true,
          pricing: model.pricing,
          context_length: model.context_length,
          performance_score: calculatePerformanceScore(model)
        }));

      // Update model curation with fresh data
      await updateModelCuration(availableModels);

      res.json({
        models: availableModels,
        configured: true,
        message: `${availableModels.length} models available via OpenRouter`,
        source: 'live',
        validation: {
          valid: true,
          modelCount: validation.modelCount,
          fromCache: validation.fromCache
        }
      });

    } catch (apiError) {
      console.error('OpenRouter API error:', apiError.message);

      // Return popular models as fallback
      res.json({
        models: [
          {
            id: 'openai/gpt-3.5-turbo',
            name: 'GPT-3.5 Turbo',
            description: 'Fast and efficient for most tasks',
            provider: 'OpenAI',
            available: true
          },
          {
            id: 'openai/gpt-4',
            name: 'GPT-4',
            description: 'Most capable model for complex tasks',
            provider: 'OpenAI',
            available: true
          },
          {
            id: 'anthropic/claude-3-sonnet',
            name: 'Claude 3 Sonnet',
            description: 'Excellent for creative and analytical tasks',
            provider: 'Anthropic',
            available: true
          },
          {
            id: 'meta-llama/llama-2-70b-chat',
            name: 'Llama 2 70B',
            description: 'Open source model, good for general tasks',
            provider: 'Meta',
            available: true
          }
        ],
        configured: true,
        message: 'Using popular models (API fetch failed)',
        fallback: true
      });
    }

  } catch (error) {
    console.error('Models endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Validate OpenRouter API key with real-key testing support
app.post('/api/validate-openrouter-key', async (req, res) => {
  try {
    const { apiKey, testMode } = req.body;
    const clientApiKey = req.headers['x-openrouter-key'];
    let keyToValidate = apiKey || clientApiKey;

    // Support for real-key testing via environment variable
    if (testMode === 'real' && process.env.OPENROUTER_TEST_KEY) {
      keyToValidate = process.env.OPENROUTER_TEST_KEY;
      console.log('Using real test key for validation simulation');
    }

    if (!keyToValidate) {
      return res.status(400).json({
        valid: false,
        error: 'NO_KEY_PROVIDED',
        message: 'Please provide an OpenRouter API key to validate'
      });
    }

    // Use the comprehensive validation function
    const validationResult = await validateOpenRouterKey(keyToValidate);

    // Add test mode info and timestamp to response
    validationResult.timestamp = new Date().toISOString();
    if (testMode === 'real' && process.env.OPENROUTER_TEST_KEY) {
      validationResult.testMode = 'real';
      validationResult.message += ' (using test key)';
    }

    // Return appropriate HTTP status
    if (validationResult.valid) {
      res.json(validationResult);
    } else {
      // Determine appropriate status code based on error
      let statusCode = 400;
      if (validationResult.error === 'NETWORK_ERROR') {
        statusCode = 503; // Service Unavailable
      } else if (validationResult.error === 'RATE_LIMITED') {
        statusCode = 429; // Too Many Requests
      }

      res.status(statusCode).json(validationResult);
    }

  } catch (error) {
    console.error('API key validation endpoint error:', error);
    res.status(500).json({
      valid: false,
      error: 'VALIDATION_ERROR',
      message: 'Internal error during API key validation',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API: Multi-key validation and pool management
app.post('/api/validate-keys', async (req, res) => {
  try {
    const { apiKeys } = req.body;

    if (!apiKeys || !Array.isArray(apiKeys) || apiKeys.length === 0) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'Please provide an array of API keys to validate'
      });
    }

    if (apiKeys.length > 10) {
      return res.status(400).json({
        error: 'TOO_MANY_KEYS',
        message: 'Maximum 10 keys can be validated at once'
      });
    }

    console.log(`Validating ${apiKeys.length} API keys for pool management`);

    const validationResults = [];
    const validKeys = [];

    // Validate each key
    for (let i = 0; i < apiKeys.length; i++) {
      const apiKey = apiKeys[i];
      const result = await validateOpenRouterKey(apiKey);

      validationResults.push({
        index: i,
        key: apiKey.substring(0, 20) + '...',
        valid: result.valid,
        error: result.error,
        message: result.message,
        modelCount: result.modelCount
      });

      if (result.valid) {
        validKeys.push(apiKey);
        // Add to pool with priority based on model count
        const priority = Math.min(10, Math.max(1, Math.floor((result.modelCount || 50) / 10)));
        apiKeyPool.addKey(apiKey, priority);
      }
    }

    // Update pool statistics
    const poolStats = apiKeyPool.getStats();

    res.json({
      success: true,
      validatedKeys: validationResults.length,
      validKeys: validKeys.length,
      invalidKeys: validationResults.length - validKeys.length,
      results: validationResults,
      poolStats: poolStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Multi-key validation error:', error);
    res.status(500).json({
      error: 'VALIDATION_ERROR',
      message: 'Internal error during multi-key validation',
      details: error.message
    });
  }
});

// API: Get API key pool status
app.get('/api/key-pool-status', async (req, res) => {
  try {
    const stats = apiKeyPool.getStats();

    res.json({
      success: true,
      poolStats: stats,
      hasKeys: stats.totalKeys > 0,
      hasAvailableKeys: stats.availableKeys > 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Key pool status error:', error);
    res.status(500).json({
      error: 'POOL_ERROR',
      message: 'Error getting key pool status',
      details: error.message
    });
  }
});

// API: Direct OpenRouter bridge with multi-key pool support
app.post('/api/openrouter', async (req, res) => {
  try {
    const { model, messages, temperature = 0.7, max_tokens = 2000, usePool = false } = req.body;
    const clientApiKey = req.headers['x-openrouter-key'];

    let apiKey;
    let usingPool = false;

    if (usePool && apiKeyPool.getStats().availableKeys > 0) {
      // Use key from pool
      apiKey = apiKeyPool.getNextKey();
      usingPool = true;
      console.log('Using API key from pool for OpenRouter request');
    } else {
      // Use client or environment key
      apiKey = clientApiKey || process.env.OPENROUTER_API_KEY;
    }

    if (!apiKey) {
      const poolStats = apiKeyPool.getStats();
      return res.status(401).json({
        error: 'OpenRouter API key required',
        message: 'Configure your OpenRouter API key or add keys to the pool',
        poolStats: poolStats
      });
    }

    // Validate API key format before making request
    if (!apiKey.startsWith('sk-or-v1-')) {
      return res.status(400).json({
        error: 'Invalid API key format',
        message: 'OpenRouter API keys should start with "sk-or-v1-"'
      });
    }

    if (!model || !messages) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'Both model and messages are required'
      });
    }

    // Enhanced OpenRouter call with better error handling
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model,
      messages,
      temperature,
      max_tokens,
      stream: false
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.SITE_URL || 'http://localhost:3000',
        'X-Title': 'Trump Podcast Generator'
      },
      timeout: 60000 // 60 second timeout
    });

    // Track model usage for curation
    await trackModelUsage(model, response.data.usage || {});

    // Mark successful API key usage in pool
    if (usingPool) {
      apiKeyPool.markSuccess(apiKey);
    }

    res.json({
      success: true,
      response: response.data.choices[0].message.content,
      model: model,
      usage: response.data.usage,
      usingPool: usingPool,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('OpenRouter bridge error:', error.response?.data || error.message);

    // Handle pool key errors
    if (usingPool) {
      if (error.response?.status === 429) {
        apiKeyPool.markRateLimited(apiKey, 60000); // 1 minute rate limit
      } else if (error.response?.status === 401) {
        apiKeyPool.markError(apiKey, 'INVALID_KEY');
      } else {
        apiKeyPool.markError(apiKey, 'REQUEST_ERROR');
      }
    }

    // Enhanced error responses with pool info
    if (error.response?.status === 401) {
      const poolStats = apiKeyPool.getStats();
      res.status(401).json({
        error: 'Invalid API key',
        message: 'Your OpenRouter API key is invalid or expired',
        poolStats: usingPool ? poolStats : undefined
      });
    } else if (error.response?.status === 429) {
      const poolStats = apiKeyPool.getStats();
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please wait before trying again.',
        poolStats: usingPool ? poolStats : undefined,
        suggestion: poolStats.availableKeys > 0 ? 'Try using pool keys with usePool=true' : undefined
      });
    } else if (error.response?.status === 400) {
      res.status(400).json({
        error: 'Invalid request',
        message: error.response.data?.error?.message || 'Invalid model or parameters'
      });
    } else {
      res.status(500).json({
        error: 'OpenRouter request failed',
        message: error.message
      });
    }
  }
});

// API: Development persona evolution (requires valid API key)
app.post('/api/dev-persona', async (req, res) => {
  try {
    const {
      personaTraits,
      evolutionParams = {},
      testScript = true,
      usePool = false
    } = req.body;
    const clientApiKey = req.headers['x-openrouter-key'];

    // Determine API key source
    let apiKey;
    let keySource = 'none';

    if (usePool && apiKeyPool.getStats().availableKeys > 0) {
      apiKey = apiKeyPool.getNextKey();
      keySource = 'pool';
    } else if (clientApiKey) {
      apiKey = clientApiKey;
      keySource = 'client';
    } else if (process.env.OPENROUTER_API_KEY) {
      apiKey = process.env.OPENROUTER_API_KEY;
      keySource = 'environment';
    }

    if (!apiKey) {
      return res.status(401).json({
        error: 'API_KEY_REQUIRED',
        message: 'Valid OpenRouter API key required for persona evolution',
        suggestion: 'Add keys to pool or provide client key',
        poolStats: apiKeyPool.getStats()
      });
    }

    // Validate API key before proceeding
    console.log(`Validating API key for persona evolution (source: ${keySource})`);
    const validation = await validateOpenRouterKey(apiKey);

    if (!validation.valid) {
      // Handle pool key validation failure
      if (keySource === 'pool') {
        apiKeyPool.markError(apiKey, validation.error);
      }

      return res.status(400).json({
        error: 'INVALID_API_KEY',
        message: `API key validation failed: ${validation.message}`,
        keySource: keySource,
        validationError: validation.error
      });
    }

    // Simulate persona evolution process
    const evolutionResult = {
      personaId: `persona_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      originalTraits: personaTraits || {
        speaking_style: 'authoritative',
        vocabulary_level: 'moderate',
        emotional_tone: 'confident',
        pacing: 'variable'
      },
      evolutionParams: {
        populationSize: evolutionParams.populationSize || 20,
        mutationRate: evolutionParams.mutationRate || 0.1,
        generations: evolutionParams.generations || 5,
        fitnessFunction: evolutionParams.fitnessFunction || 'script_quality'
      },
      keySource: keySource,
      validation: {
        valid: true,
        modelCount: validation.modelCount,
        fromCache: validation.fromCache
      }
    };

    // Simulate evolution generations
    const generations = [];
    for (let i = 0; i < evolutionResult.evolutionParams.generations; i++) {
      generations.push({
        generation: i + 1,
        bestFitness: 0.7 + (i * 0.05) + (Math.random() * 0.1),
        avgFitness: 0.5 + (i * 0.03) + (Math.random() * 0.1),
        mutations: Math.floor(Math.random() * 5) + 1,
        timestamp: new Date(Date.now() + (i * 1000)).toISOString()
      });
    }

    evolutionResult.generations = generations;
    evolutionResult.finalFitness = generations[generations.length - 1].bestFitness;

    // Generate test script if requested
    if (testScript) {
      evolutionResult.testScript = {
        title: 'Evolved Persona Test Script',
        duration: '2 minutes',
        content: `
[00:00] INTRODUCTION
Using evolved persona traits: ${evolutionResult.originalTraits.speaking_style} style,
${evolutionResult.originalTraits.emotional_tone} tone.

[00:30] MAIN CONTENT
This script demonstrates the evolved persona characteristics with
${evolutionResult.originalTraits.pacing} pacing and ${evolutionResult.originalTraits.vocabulary_level} vocabulary.

[01:30] CONCLUSION
Evolution complete with fitness score: ${evolutionResult.finalFitness.toFixed(3)}

[END]
        `.trim(),
        generatedAt: new Date().toISOString()
      };
    }

    // Mark successful API key usage
    if (keySource === 'pool') {
      apiKeyPool.markSuccess(apiKey);
    }

    res.json({
      success: true,
      message: 'Persona evolution completed successfully',
      result: evolutionResult,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Persona evolution error:', error);
    res.status(500).json({
      error: 'EVOLUTION_ERROR',
      message: 'Internal error during persona evolution',
      details: error.message
    });
  }
});

// API: Check supporter status (placeholder for future premium features)
app.get('/api/supporter-status', auth.requireAuth.bind(auth), async (req, res) => {
  try {
    // In future, this would check actual payment status
    // For now, return basic info
    const supporterStatus = {
      isSupporter: false, // Would check actual payment status
      tier: 'free',
      features: {
        maxBatchSize: 10,
        customVoices: false,
        prioritySupport: false
      },
      upgradeUrl: process.env.PATREON_URL || "https://patreon.com/trumppodgen"
    };

    res.json(supporterStatus);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Load testing endpoint for production readiness
app.post('/api/load-test', auth.requireAuth.bind(auth), auth.requireAdmin.bind(auth), async (req, res) => {
  try {
    const { testType = 'basic', duration = 30, concurrency = 10 } = req.body;

    const loadTestResults = {
      testType,
      duration,
      concurrency,
      startTime: new Date().toISOString(),
      results: {}
    };

    // Simulate different load test scenarios
    switch (testType) {
      case 'basic':
        loadTestResults.results = await runBasicLoadTest(duration, concurrency);
        break;
      case 'workflow':
        loadTestResults.results = await runWorkflowLoadTest(duration, concurrency);
        break;
      case 'database':
        loadTestResults.results = await runDatabaseLoadTest(duration, concurrency);
        break;
      default:
        return res.status(400).json({ error: 'Invalid test type' });
    }

    loadTestResults.endTime = new Date().toISOString();
    loadTestResults.totalDuration = Date.now() - new Date(loadTestResults.startTime).getTime();

    // Track load test analytics
    analytics.trackEvent('load_test_completed', {
      testType,
      duration,
      concurrency,
      ...loadTestResults.results
    }, req);

    res.json(loadTestResults);
  } catch (error) {
    console.error('Load test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Ngrok tunnel management
app.get('/api/tunnel/status', auth.requireAuth.bind(auth), async (req, res) => {
  try {
    const tunnelInfo = await NgrokTunnel.getActiveTunnel();

    if (tunnelInfo) {
      res.json({
        active: true,
        url: tunnelInfo.url,
        created: tunnelInfo.created,
        expires: tunnelInfo.expires,
        message: 'Tunnel is active and ready for sharing'
      });
    } else {
      res.json({
        active: false,
        message: 'No active tunnel. Use "npm run tunnel" to create one.',
        instructions: {
          command: 'npm run tunnel',
          description: 'Creates a secure public URL for local sharing'
        }
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tunnel/share', auth.requireAuth.bind(auth), async (req, res) => {
  try {
    const { platform = 'general', message } = req.body;
    const tunnelInfo = await NgrokTunnel.getActiveTunnel();

    if (!tunnelInfo) {
      return res.status(400).json({
        error: 'No active tunnel found',
        suggestion: 'Run "npm run tunnel" first'
      });
    }

    // Track sharing analytics
    analytics.trackEvent('tunnel_shared', {
      platform,
      url: tunnelInfo.url,
      userId: req.user.id,
      customMessage: !!message
    }, req);

    const shareData = {
      url: tunnelInfo.url,
      title: 'Trump Podcast Generator - Live Demo',
      description: message || 'AI-powered podcast generation from Trump speeches with voice cloning and swarm intelligence',
      features: [
        'AI Swarm Script Generation',
        'Custom Voice Cloning',
        'Local RSS Bundles',
        'Batch Processing'
      ],
      instructions: {
        login: 'Use admin / admin123 for full access',
        demo: 'Try /api/search to see available speeches'
      }
    };

    res.json({
      message: 'Tunnel ready for sharing',
      shareData,
      platforms: {
        twitter: `Check out this AI podcast generator: ${tunnelInfo.url}`,
        discord: `🎙️ **Trump Podcast Generator** - Live Demo\n${tunnelInfo.url}\nLogin: admin / admin123`,
        email: `Subject: Trump Podcast Generator Demo\n\nTry the live demo: ${tunnelInfo.url}\n\nFeatures: AI Swarm, Voice Cloning, Local RSS`
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: User feedback collection
app.post('/api/feedback', async (req, res) => {
  try {
    const { ratings, comments, recommend, timestamp, userAgent, sessionId } = req.body;

    // Validate feedback data
    if (!ratings || typeof ratings !== 'object') {
      return res.status(400).json({ error: 'Ratings are required' });
    }

    // Store feedback in database
    const feedbackData = {
      overall_rating: ratings.overall || 0,
      script_rating: ratings.script || 0,
      audio_rating: ratings.audio || 0,
      comments: comments || '',
      recommend: recommend || false,
      user_agent: userAgent || '',
      session_id: sessionId || '',
      created_at: timestamp || new Date().toISOString()
    };

    // Create feedback table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        overall_rating INTEGER,
        script_rating INTEGER,
        audio_rating INTEGER,
        comments TEXT,
        recommend BOOLEAN,
        user_agent TEXT,
        session_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert feedback
    const result = db.prepare(`
      INSERT INTO feedback (overall_rating, script_rating, audio_rating, comments, recommend, user_agent, session_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      feedbackData.overall_rating,
      feedbackData.script_rating,
      feedbackData.audio_rating,
      feedbackData.comments,
      feedbackData.recommend,
      feedbackData.user_agent,
      feedbackData.session_id,
      feedbackData.created_at
    );

    // Track analytics
    analytics.trackEvent('feedback_submitted', {
      feedbackId: result.lastInsertRowid,
      overallRating: feedbackData.overall_rating,
      scriptRating: feedbackData.script_rating,
      audioRating: feedbackData.audio_rating,
      hasComments: !!feedbackData.comments,
      recommend: feedbackData.recommend
    }, req);

    res.json({
      message: 'Feedback submitted successfully',
      feedbackId: result.lastInsertRowid,
      thankYou: true
    });

  } catch (error) {
    console.error('Feedback submission error:', error);
    analytics.trackError(error, req, '/api/feedback');
    res.status(500).json({ error: error.message });
  }
});

// API: Get feedback analytics (admin only)
app.get('/api/feedback/analytics', auth.requireAuth.bind(auth), auth.requireAdmin.bind(auth), async (req, res) => {
  try {
    const { days = 30 } = req.query;

    // Get feedback statistics
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_feedback,
        AVG(overall_rating) as avg_overall,
        AVG(script_rating) as avg_script,
        AVG(audio_rating) as avg_audio,
        COUNT(CASE WHEN recommend = 1 THEN 1 END) as recommend_count,
        COUNT(CASE WHEN comments != '' THEN 1 END) as comments_count
      FROM feedback
      WHERE created_at > datetime('now', '-${days} days')
    `).get();

    // Get rating distribution
    const ratingDistribution = db.prepare(`
      SELECT
        overall_rating,
        COUNT(*) as count
      FROM feedback
      WHERE created_at > datetime('now', '-${days} days')
        AND overall_rating > 0
      GROUP BY overall_rating
      ORDER BY overall_rating
    `).all();

    // Get recent comments
    const recentComments = db.prepare(`
      SELECT comments, overall_rating, created_at
      FROM feedback
      WHERE comments != ''
        AND created_at > datetime('now', '-${days} days')
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    res.json({
      period: `${days} days`,
      summary: {
        totalFeedback: stats.total_feedback,
        averageRatings: {
          overall: parseFloat(stats.avg_overall || 0).toFixed(1),
          script: parseFloat(stats.avg_script || 0).toFixed(1),
          audio: parseFloat(stats.avg_audio || 0).toFixed(1)
        },
        recommendationRate: stats.total_feedback > 0 ?
          (stats.recommend_count / stats.total_feedback * 100).toFixed(1) + '%' : '0%',
        commentsRate: stats.total_feedback > 0 ?
          (stats.comments_count / stats.total_feedback * 100).toFixed(1) + '%' : '0%'
      },
      ratingDistribution,
      recentComments: recentComments.map(comment => ({
        ...comment,
        comments: comment.comments.substring(0, 200) + (comment.comments.length > 200 ? '...' : '')
      }))
    });

  } catch (error) {
    console.error('Feedback analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy middleware for external fetches (with rate limiting)
app.use('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ error: 'URL parameter required' });
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const response = await axios.get(url, { timeout: 10000 });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Search archive with improved error handling
app.get('/api/search', (req, res) => {
  try {
    const { keyword, startDate, endDate, limit = 50, offset = 0 } = req.query;

    // Input validation
    const limitNum = Math.min(parseInt(limit) || 50, 100); // Max 100 results
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    let query = 'SELECT id, title, date, source, rally_location, video_url, audio_url, thumbnail_url, status FROM speeches WHERE status = ?';
    const params = ['active'];

    if (keyword && keyword.trim()) {
      query += ' AND (title LIKE ? OR transcript LIKE ? OR rally_location LIKE ?)';
      const searchTerm = `%${keyword.trim()}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (startDate) {
      query += ' AND date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY date DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offsetNum);

    const stmt = db.prepare(query);
    const results = stmt.all(...params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM speeches WHERE status = ?';
    const countParams = ['active'];

    if (keyword && keyword.trim()) {
      countQuery += ' AND (title LIKE ? OR transcript LIKE ? OR rally_location LIKE ?)';
      const searchTerm = `%${keyword.trim()}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    if (startDate) {
      countQuery += ' AND date >= ?';
      countParams.push(startDate);
    }

    if (endDate) {
      countQuery += ' AND date <= ?';
      countParams.push(endDate);
    }

    const countStmt = db.prepare(countQuery);
    const { total } = countStmt.get(...countParams);

    res.json({
      results,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < total
      }
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: 'Search failed',
      message: error.message
    });
  }
});

// API: Verify data sources
app.get('/api/verify-sources', async (req, res) => {
  try {
    const results = await dataSourceManager.verifyAllSources();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Refresh archive (fetch from sources)
app.post('/api/refresh-archive', async (req, res) => {
  try {
    const result = await populateArchive();
    res.json({
      message: 'Archive refresh completed',
      ...result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Refresh models (scrape OpenRouter rankings)
app.post('/api/refresh-models', async (req, res) => {
  try {
    const { data } = await axios.get('https://openrouter.ai/rankings');
    const $ = cheerio.load(data);
    
    const models = [];
    // Find all links that point to model pages and extract the model ID from the href
    $('a[href^="/models/"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
            const modelId = href.replace('/models/', '');
            // Avoid duplicates and placeholder links
            if (!models.includes(modelId) && modelId) {
                models.push(modelId);
            }
        }
    });

    // For this example, we'll just take the first 10 as "top_overall"
    // and a slice as "top_free". A more robust implementation would
    // parse the specific tables if the structure was guaranteed.
    const topOverall = models.slice(0, 10);
    const topFree = models.filter(m => m.includes('free') || m.includes('small') || m.includes('7b')).slice(0, 10); // Example filter for free models

    insertModels.run('top_overall', JSON.stringify(topOverall));
    insertModels.run('top_free', JSON.stringify(topFree));
    
    res.json({ message: 'Models refreshed successfully from OpenRouter rankings.', top_overall: topOverall, top_free: topFree });

  } catch (error) {
    console.error('Failed to refresh models:', error.message);
    res.status(500).json({ error: 'Failed to scrape OpenRouter rankings.' });
  }
});

// API: Get models
app.get('/api/models', (req, res) => {
  const getModels = db.prepare('SELECT * FROM models');
  const rows = getModels.all();
  const models = {};
  rows.forEach(row => models[row.category] = JSON.parse(row.list));
  res.json(models);
});

// API: Create workflow (save selected items)
app.post('/api/workflow', (req, res) => {
  try {
    const { name, speechIds } = req.body;

    if (!name || !speechIds || !Array.isArray(speechIds) || speechIds.length === 0) {
      return res.status(400).json({ error: 'Name and speechIds array are required' });
    }

    const workflowId = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const insert = db.prepare(`
      INSERT INTO workflows (id, name, speech_ids, status)
      VALUES (?, ?, ?, ?)
    `);

    insert.run(workflowId, name, JSON.stringify(speechIds), 'draft');

    // Track analytics
    analytics.trackEvent('workflow_created', {
      workflowId,
      speechCount: speechIds.length
    }, req);

    res.json({
      workflowId,
      name,
      speechIds,
      status: 'draft',
      message: 'Workflow created successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get workflow details
app.get('/api/workflow/:id', (req, res) => {
  try {
    const { id } = req.params;
    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // Get speech details
    const speechIds = JSON.parse(workflow.speech_ids);
    const placeholders = speechIds.map(() => '?').join(',');
    const speeches = db.prepare(`SELECT * FROM speeches WHERE id IN (${placeholders})`).all(...speechIds);

    res.json({
      ...workflow,
      speech_ids: speechIds,
      speeches
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Upload custom script to workflow
app.post('/api/upload-script', async (req, res) => {
  try {
    const { workflowId, script } = req.body;

    if (!workflowId || !script) {
      return res.status(400).json({ error: 'workflowId and script are required' });
    }

    // Validate script content
    if (typeof script !== 'string' || script.trim().length === 0) {
      return res.status(400).json({ error: 'Script must be a non-empty string' });
    }

    if (script.length > 50000) {
      return res.status(400).json({ error: 'Script too long (max 50,000 characters)' });
    }

    // Update workflow with uploaded script
    const result = db.prepare('UPDATE workflows SET script = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(script.trim(), 'script_uploaded', workflowId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // Track analytics
    analytics.trackEvent('script_uploaded', {
      workflowId,
      scriptLength: script.length,
      method: 'upload'
    }, req);

    res.json({
      workflowId,
      status: 'script_uploaded',
      scriptLength: script.length,
      message: 'Script uploaded successfully'
    });

  } catch (error) {
    console.error('Script upload error:', error);
    analytics.trackError(error, req, '/api/upload-script');
    res.status(500).json({ error: error.message });
  }
});

// API: Generate script with AI swarm and batch processing
app.post('/api/generate-script', async (req, res) => {
  try {
    const { workflowId, model, style = 'professional', duration = 10, batchSize = 10, useSwarm = false } = req.body;

    if (!workflowId || !model) {
      return res.status(400).json({ error: 'workflowId and model are required' });
    }

    // Get workflow and speeches
    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const speechIds = JSON.parse(workflow.speech_ids);
    const placeholders = speechIds.map(() => '?').join(',');
    const speeches = db.prepare(`SELECT title, date, transcript, rally_location FROM speeches WHERE id IN (${placeholders})`).all(...speechIds);

    if (speeches.length === 0) {
      return res.status(400).json({ error: 'No speeches found for this workflow' });
    }

    // Handle script generation with AI swarm or batch processing
    let script;
    if (useSwarm && speeches.length >= 3) {
      console.log(`Using AI swarm for enhanced script generation with ${speeches.length} speeches`);
      script = await generateSwarmScript(speeches, model, style, duration);
    } else if (speeches.length > batchSize) {
      console.log(`Processing large batch: ${speeches.length} speeches, using batch processing`);
      script = await generateBatchScript(speeches, model, style, duration, batchSize);
    } else {
      script = await generateSingleScript(speeches, model, style, duration);
    }

    // Update workflow with script
    db.prepare('UPDATE workflows SET script = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(script, 'script_generated', workflowId);

    // Track analytics
    analytics.trackEvent('script_generated', {
      workflowId,
      model,
      style,
      duration,
      speechCount: speeches.length,
      batchProcessed: speeches.length > batchSize
    }, req);

    res.json({
      workflowId,
      script,
      status: 'script_generated',
      message: `Script generated successfully (${speeches.length} speeches processed)`,
      batchProcessed: speeches.length > batchSize
    });

  } catch (error) {
    console.error('Script generation error:', error);
    analytics.trackError(error, req, '/api/generate-script');
    res.status(500).json({ error: error.message });
  }
});

// Helper function for single script generation
async function generateSingleScript(speeches, model, style, duration) {
  const contentSummary = speeches.map(speech => ({
    title: speech.title,
    date: speech.date,
    location: speech.rally_location,
    excerpt: speech.transcript ? speech.transcript.substring(0, 500) + '...' : 'No transcript available'
  }));

  const prompt = `Create a ${duration}-minute podcast script in a ${style} style based on these Trump speeches:

${contentSummary.map((speech, i) => `
Speech ${i + 1}: ${speech.title}
Date: ${speech.date}
Location: ${speech.location || 'Unknown'}
Excerpt: ${speech.excerpt}
`).join('\n')}

Requirements:
- Create an engaging ${duration}-minute podcast episode
- Include an introduction and conclusion
- Highlight key themes and memorable quotes
- Maintain a ${style} tone throughout
- Structure it for audio presentation with clear transitions
- Include timestamps for major sections

Format the response as a structured script with speaker cues and timing notes.`;

  return await callOpenRouter(prompt, model);
}

// Helper function for batch script generation
async function generateBatchScript(speeches, model, style, duration, batchSize) {
  // Group speeches into batches
  const batches = [];
  for (let i = 0; i < speeches.length; i += batchSize) {
    batches.push(speeches.slice(i, i + batchSize));
  }

  console.log(`Processing ${batches.length} batches of speeches`);

  // Generate summaries for each batch
  const batchSummaries = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchPrompt = `Analyze and summarize the key themes, quotes, and topics from these Trump speeches:

${batch.map((speech, j) => `
Speech ${j + 1}: ${speech.title}
Date: ${speech.date}
Location: ${speech.rally_location || 'Unknown'}
Excerpt: ${speech.transcript ? speech.transcript.substring(0, 300) + '...' : 'No transcript available'}
`).join('\n')}

Provide a concise summary focusing on:
- Main themes and topics discussed
- Most impactful quotes
- Key policy points or announcements
- Audience reactions or notable moments

Keep summary under 200 words.`;

    try {
      const summary = await callOpenRouter(batchPrompt, model);
      batchSummaries.push({
        batchNumber: i + 1,
        speechCount: batch.length,
        dateRange: `${batch[batch.length - 1].date} to ${batch[0].date}`,
        summary: summary
      });
    } catch (error) {
      console.error(`Batch ${i + 1} processing failed:`, error.message);
      batchSummaries.push({
        batchNumber: i + 1,
        speechCount: batch.length,
        dateRange: `${batch[batch.length - 1].date} to ${batch[0].date}`,
        summary: `Batch processing failed: ${batch.map(s => s.title).join(', ')}`
      });
    }
  }

  // Generate final script from batch summaries
  const finalPrompt = `Create a comprehensive ${duration}-minute podcast script in a ${style} style based on these speech batch summaries:

${batchSummaries.map(batch => `
Batch ${batch.batchNumber} (${batch.speechCount} speeches, ${batch.dateRange}):
${batch.summary}
`).join('\n')}

Requirements:
- Create an engaging ${duration}-minute podcast episode covering all batches
- Include an introduction explaining the scope (${speeches.length} speeches total)
- Weave together themes from different time periods
- Highlight evolution of key topics over time
- Include conclusion summarizing overall patterns
- Structure for audio with clear transitions between batch content
- Include timestamps for major sections

Format as a structured script with speaker cues and timing notes.`;

  return await callOpenRouter(finalPrompt, model);
}

// Helper function for AI swarm script generation
async function generateSwarmScript(speeches, primaryModel, style, duration) {
  console.log('Initializing AI swarm with 3 specialized agents...');

  // Define specialized agents
  const agents = [
    {
      name: 'Content Analyst',
      model: primaryModel,
      role: 'Analyze speech content and extract key themes, quotes, and policy points'
    },
    {
      name: 'Narrative Designer',
      model: primaryModel, // Could use different model in production
      role: 'Structure the narrative flow and create engaging transitions'
    },
    {
      name: 'Audio Producer',
      model: primaryModel, // Could use different model in production
      role: 'Optimize content for audio presentation with timing and pacing'
    }
  ];

  try {
    // Phase 1: Parallel analysis by each agent
    const analysisPromises = agents.map(async (agent, index) => {
      const speechSubset = speeches.slice(
        Math.floor(index * speeches.length / 3),
        Math.floor((index + 1) * speeches.length / 3)
      );

      const prompt = `You are the ${agent.name} agent. ${agent.role}.

Analyze these Trump speeches:
${speechSubset.map((speech, i) => `
Speech ${i + 1}: ${speech.title}
Date: ${speech.date}
Location: ${speech.rally_location || 'Unknown'}
Excerpt: ${speech.transcript ? speech.transcript.substring(0, 400) + '...' : 'No transcript available'}
`).join('\n')}

Provide your specialized analysis focusing on your role. Be concise but thorough.`;

      const analysis = await callOpenRouter(prompt, agent.model);
      return {
        agent: agent.name,
        analysis: analysis,
        speechCount: speechSubset.length
      };
    });

    const analyses = await Promise.all(analysisPromises);
    console.log('AI swarm analysis phase completed');

    // Phase 2: Synthesis by primary agent
    const synthesisPrompt = `You are the Lead Producer synthesizing insights from 3 AI agents to create a ${duration}-minute ${style} podcast script.

Agent Reports:
${analyses.map(result => `
${result.agent} (${result.speechCount} speeches analyzed):
${result.analysis}
`).join('\n')}

Create a comprehensive ${duration}-minute podcast script that:
- Incorporates insights from all three agents
- Maintains a ${style} tone throughout
- Includes proper audio timing and transitions
- Features the most compelling content identified by the swarm
- Has clear introduction, body, and conclusion
- Includes timestamps for major sections

Format as a structured script with speaker cues and timing notes.`;

    const finalScript = await callOpenRouter(synthesisPrompt, primaryModel);
    console.log('AI swarm synthesis completed');

    return finalScript;

  } catch (error) {
    console.error('AI swarm generation failed, falling back to single model:', error.message);
    // Fallback to single script generation
    return await generateSingleScript(speeches, primaryModel, style, duration);
  }
}

// API: Upload voice samples for cloning
app.post('/api/voice-clone', auth.requireAuth.bind(auth), async (req, res) => {
  try {
    const { voiceName, description = 'Custom voice clone' } = req.body;

    if (!voiceName) {
      return res.status(400).json({ error: 'Voice name is required' });
    }

    // Handle file uploads (in production, use multer or similar)
    // For now, expect audio file paths in request
    const { audioFiles } = req.body;

    if (!audioFiles || !Array.isArray(audioFiles) || audioFiles.length === 0) {
      return res.status(400).json({ error: 'Audio files are required for voice cloning' });
    }

    const result = await createVoiceClone(voiceName, audioFiles, description);

    if (result.success) {
      analytics.trackEvent('voice_clone_created', {
        voiceName,
        sampleCount: result.sample_count,
        userId: req.user.id
      }, req);

      res.json(result);
    } else {
      res.status(500).json(result);
    }

  } catch (error) {
    console.error('Voice cloning error:', error);
    analytics.trackError(error, req, '/api/voice-clone');
    res.status(500).json({ error: error.message });
  }
});

// API: List available voices
app.get('/api/voices', async (req, res) => {
  try {
    const result = await listAvailableVoices();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Generate audio with Tortoise-TTS
app.post('/api/generate-audio', async (req, res) => {
  try {
    const { workflowId, voice = 'trump', preset = 'fast', useLocal = true, customVoicePath = null } = req.body;

    if (!workflowId) {
      return res.status(400).json({ error: 'workflowId is required' });
    }

    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
    if (!workflow || !workflow.script) {
      return res.status(400).json({ error: 'Workflow not found or no script available' });
    }

    let audioUrl, audioResult;

    if (useLocal) {
      // Use local Tortoise-TTS with optional custom voice
      try {
        audioResult = await generateLocalTTS(workflow.script, voice, preset, workflowId, customVoicePath);
        audioUrl = audioResult.output_file;
      } catch (ttsError) {
        console.error('Local TTS failed, falling back to mock:', ttsError.message);
        audioUrl = `audio/${workflowId}.wav`;
        audioResult = {
          success: false,
          error: ttsError.message,
          fallback: true
        };
      }
    } else {
      // Fallback to mock for now
      audioUrl = `audio/${workflowId}.wav`;
      audioResult = {
        success: true,
        mock: true,
        message: 'Mock audio generation - configure TTS for real audio'
      };
    }

    // Update workflow with audio URL
    db.prepare('UPDATE workflows SET audio_url = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(audioUrl, 'audio_generated', workflowId);

    // Track analytics
    analytics.trackEvent('audio_generated', {
      workflowId,
      voice,
      preset,
      useLocal,
      success: audioResult.success,
      duration: audioResult.duration || null
    }, req);

    res.json({
      workflowId,
      audioUrl,
      status: 'audio_generated',
      message: audioResult.success ? 'Audio generated successfully' : 'Audio generation failed, using fallback',
      ttsResult: audioResult,
      voice,
      preset
    });

  } catch (error) {
    console.error('Audio generation error:', error);
    analytics.trackError(error, req, '/api/generate-audio');
    res.status(500).json({ error: error.message });
  }
});

// Helper function for local TTS generation with voice cloning support
async function generateLocalTTS(script, voice, preset, workflowId, customVoicePath = null) {
  return new Promise((resolve, reject) => {
    const outputFile = `${workflowId}.wav`;
    const pythonScript = path.join(__dirname, 'src', 'tts.py');

    // Prepare script text (remove timestamps and formatting for TTS)
    const cleanScript = cleanScriptForTTS(script);

    const args = [
      pythonScript,
      '--text', cleanScript,
      '--voice', voice,
      '--preset', preset,
      '--output', outputFile,
      '--output-dir', './audio'
    ];

    // Add custom voice path if provided
    if (customVoicePath) {
      args.push('--custom-voice', customVoicePath);
    }

    console.log('Starting TTS generation with Tortoise-TTS...');
    const pythonProcess = spawn('python', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('TTS Progress:', data.toString().trim());
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (parseError) {
          reject(new Error(`TTS completed but failed to parse result: ${parseError.message}`));
        }
      } else {
        reject(new Error(`TTS process failed with code ${code}: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      reject(new Error(`Failed to start TTS process: ${error.message}`));
    });

    // Set timeout for long-running TTS
    setTimeout(() => {
      pythonProcess.kill();
      reject(new Error('TTS generation timeout (5 minutes)'));
    }, 5 * 60 * 1000);
  });
}

// Helper function to clean script for TTS
function cleanScriptForTTS(script) {
  if (!script) return '';

  return script
    // Remove timestamps
    .replace(/\[\d{1,2}:\d{2}\]/g, '')
    // Remove speaker cues
    .replace(/^(HOST|NARRATOR|SPEAKER):/gm, '')
    // Remove stage directions
    .replace(/\[.*?\]/g, '')
    // Clean up extra whitespace
    .replace(/\s+/g, ' ')
    .trim()
    // Limit length for TTS (max 5000 chars for reasonable generation time)
    .substring(0, 5000);
}

// Helper function to create voice clone
async function createVoiceClone(voiceName, audioFiles, description) {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, 'src', 'tts.py');

    const args = [
      pythonScript,
      '--create-voice', voiceName,
      '--description', description,
      '--audio-files', audioFiles.join(',')
    ];

    console.log('Creating voice clone...');
    const pythonProcess = spawn('python', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('Voice Clone Progress:', data.toString().trim());
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (parseError) {
          reject(new Error(`Voice clone completed but failed to parse result: ${parseError.message}`));
        }
      } else {
        reject(new Error(`Voice clone process failed with code ${code}: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      reject(new Error(`Failed to start voice clone process: ${error.message}`));
    });
  });
}

// Helper function to list available voices
async function listAvailableVoices() {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, 'src', 'tts.py');

    const args = [pythonScript, '--list-voices'];

    const pythonProcess = spawn('python', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (parseError) {
          // Fallback to basic voice list
          resolve({
            success: true,
            voices: ['trump', 'default'],
            custom_voices: [],
            message: 'Basic voice list (TTS system may not be fully configured)'
          });
        }
      } else {
        resolve({
          success: false,
          error: `Voice list process failed: ${stderr}`,
          voices: ['trump', 'default'],
          custom_voices: []
        });
      }
    });

    pythonProcess.on('error', (error) => {
      resolve({
        success: false,
        error: `Failed to start voice list process: ${error.message}`,
        voices: ['trump', 'default'],
        custom_voices: []
      });
    });
  });
}

// API: Finalize podcast with local RSS generation
app.post('/api/finalize', async (req, res) => {
  try {
    const { workflowId, title, description, localBundle = true } = req.body;

    if (!workflowId) {
      return res.status(400).json({ error: 'workflowId is required' });
    }

    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
    if (!workflow || !workflow.script || !workflow.audio_url) {
      return res.status(400).json({ error: 'Workflow not ready for finalization' });
    }

    const podcastTitle = title || `Trump Podcast - ${new Date().toLocaleDateString()}`;
    const podcastDescription = description || 'AI-generated podcast from Trump speeches and rallies';

    let rssContent, rssUrl, bundlePath;

    if (localBundle) {
      // Generate self-contained local bundle
      const bundleResult = await generateLocalBundle(workflowId, podcastTitle, podcastDescription, workflow);
      rssContent = bundleResult.rssContent;
      rssUrl = bundleResult.rssUrl;
      bundlePath = bundleResult.bundlePath;
    } else {
      // Generate standard RSS
      rssContent = generateRss(podcastTitle, podcastDescription, workflow.script, workflow.audio_url);
      rssUrl = `rss/${workflowId}.xml`;

      // Save RSS file
      await fs.writeFile(rssUrl, rssContent);
    }

    // Update workflow as finalized
    db.prepare('UPDATE workflows SET rss_url = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(rssUrl, 'finalized', workflowId);

    // Track analytics
    analytics.trackEvent('podcast_finalized', {
      workflowId,
      localBundle,
      title: podcastTitle
    }, req);

    res.json({
      workflowId,
      rssUrl,
      bundlePath,
      podcastTitle,
      podcastDescription,
      status: 'finalized',
      localBundle,
      message: localBundle ? 'Local podcast bundle created successfully' : 'Podcast finalized successfully'
    });

  } catch (error) {
    console.error('Finalization error:', error);
    analytics.trackError(error, req, '/api/finalize');
    res.status(500).json({ error: error.message });
  }
});

// Helper function to generate local self-contained bundle
async function generateLocalBundle(workflowId, title, description, workflow) {
  const bundleDir = `bundles/${workflowId}`;
  const audioDir = `${bundleDir}/audio`;
  const rssPath = `${bundleDir}/podcast.xml`;

  // Create bundle directories
  await fs.mkdir(bundleDir, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });

  // Copy audio file to bundle (if it exists)
  let localAudioPath = null;
  if (workflow.audio_url && await fileExists(workflow.audio_url)) {
    const audioFileName = path.basename(workflow.audio_url);
    localAudioPath = `audio/${audioFileName}`;
    await fs.copyFile(workflow.audio_url, `${bundleDir}/${localAudioPath}`);
  }

  // Generate RSS with relative paths
  const rssContent = generateLocalRss(title, description, workflow.script, localAudioPath);

  // Save RSS file
  await fs.writeFile(rssPath, rssContent);

  // Create bundle info file
  const bundleInfo = {
    workflowId,
    title,
    description,
    createdAt: new Date().toISOString(),
    audioFile: localAudioPath,
    rssFile: 'podcast.xml',
    scriptLength: workflow.script?.length || 0,
    instructions: {
      usage: 'Open podcast.xml in a podcast app or RSS reader',
      audio: localAudioPath ? 'Audio file included in bundle' : 'Audio file not available',
      sharing: 'This bundle is self-contained and can be shared as a folder'
    }
  };

  await fs.writeFile(`${bundleDir}/README.json`, JSON.stringify(bundleInfo, null, 2));

  return {
    rssContent,
    rssUrl: rssPath,
    bundlePath: bundleDir
  };
}

// Helper function to check if file exists
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Generate RSS with local/relative paths
function generateLocalRss(title, description, script, audioPath) {
  const now = new Date();
  const pubDate = now.toUTCString();
  const guid = `trump-podcast-local-${Date.now()}`;

  const audioEnclosure = audioPath ?
    `<enclosure url="${audioPath}" type="audio/wav" length="0"/>` :
    '<!-- Audio file not available -->';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Trump Podcast Generator - Local Bundle</title>
    <description>Self-contained AI-generated podcast from Trump speeches</description>
    <link>file://./</link>
    <language>en-us</language>
    <pubDate>${pubDate}</pubDate>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <itunes:author>Trump Podcast Generator</itunes:author>
    <itunes:category text="News &amp; Politics"/>
    <itunes:explicit>false</itunes:explicit>

    <item>
      <title>${title}</title>
      <description>${description}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${guid}</guid>
      ${audioEnclosure}
      <itunes:duration>10:00</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
    </item>
  </channel>
</rss>`;
}

// Fetch and populate archive using new data source manager
async function populateArchive() {
  console.log('Starting archive population...');

  try {
    // Check existing data
    const existingCount = db.prepare('SELECT COUNT(*) as count FROM speeches').get().count;
    if (existingCount > 10) {
      console.log(`Archive already contains ${existingCount} speeches. Skipping population.`);
      return { existing: existingCount, inserted: 0 };
    }

    // Verify all data sources first
    console.log('Verifying data sources...');
    const sourceStatus = await dataSourceManager.verifyAllSources();
    console.log('Source verification results:', sourceStatus);

    // Fetch from all available sources
    const { results, errors } = await dataSourceManager.fetchFromAllSources();

    if (errors.length > 0) {
      console.warn('Some sources had errors:', errors);
    }

    if (results.length === 0) {
      console.warn('No data found from any source');
      return { existing: existingCount, inserted: 0 };
    }

    // Save to database
    const inserted = await dataSourceManager.saveToDatabase(results);
    console.log(`Archive population completed. Inserted ${inserted} new items from ${results.length} total found.`);

    return { existing: existingCount, inserted, total: results.length, errors };

  } catch (error) {
    console.error('Failed to populate archive:', error.message);
    return { error: error.message };
  }
}

// OpenRouter call
async function callOpenRouter(prompt, model) {
  const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    model: model,
    messages: [{ role: 'user', content: prompt }]
  }, {
    headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` }
  });
  return res.data.choices[0].message.content;
}

// Generate RSS feed for podcast
function generateRss(title, description, script, audioUrl) {
  const now = new Date();
  const pubDate = now.toUTCString();
  const guid = `trump-podcast-${Date.now()}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Trump Podcast Generator</title>
    <description>AI-generated podcasts from Trump speeches and rallies</description>
    <link>http://localhost:3000</link>
    <language>en-us</language>
    <pubDate>${pubDate}</pubDate>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <itunes:author>Trump Podcast Generator</itunes:author>
    <itunes:category text="News &amp; Politics"/>
    <itunes:explicit>false</itunes:explicit>

    <item>
      <title>${title}</title>
      <description>${description}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${guid}</guid>
      <enclosure url="http://localhost:3000/${audioUrl}" type="audio/mpeg"/>
      <itunes:duration>10:00</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
    </item>
  </channel>
</rss>`;
}

// Helper function to generate donation optimization recommendations
function generateDonationRecommendations(stats) {
  const recommendations = [];

  if (stats.length === 0) {
    return ['No donation data available yet. Consider promoting donation options more prominently.'];
  }

  // Find best performing platform
  const bestPlatform = stats.reduce((best, current) => {
    const currentRate = current.conversions / current.clicks;
    const bestRate = best.conversions / best.clicks;
    return currentRate > bestRate ? current : best;
  });

  recommendations.push(`Best performing platform: ${bestPlatform.platform} with ${(bestPlatform.conversions / bestPlatform.clicks * 100).toFixed(1)}% conversion rate`);

  // Find best performing variant
  const variantStats = {};
  stats.forEach(stat => {
    if (!variantStats[stat.variant]) {
      variantStats[stat.variant] = { clicks: 0, conversions: 0 };
    }
    variantStats[stat.variant].clicks += stat.clicks;
    variantStats[stat.variant].conversions += stat.conversions;
  });

  const bestVariant = Object.entries(variantStats).reduce((best, [variant, data]) => {
    const rate = data.conversions / data.clicks;
    return rate > best.rate ? { variant, rate, data } : best;
  }, { rate: 0 });

  if (bestVariant.variant) {
    recommendations.push(`Best performing message variant: ${bestVariant.variant} with ${(bestVariant.rate * 100).toFixed(1)}% conversion rate`);
  }

  // General recommendations
  const totalClicks = stats.reduce((sum, stat) => sum + stat.clicks, 0);
  const totalConversions = stats.reduce((sum, stat) => sum + stat.conversions, 0);
  const overallRate = totalConversions / totalClicks;

  if (overallRate < 0.02) {
    recommendations.push('Consider testing more compelling donation messages or incentives');
  }

  if (overallRate > 0.05) {
    recommendations.push('Excellent conversion rate! Consider increasing donation prompt visibility');
  }

  return recommendations;
}

// Multi-key pool management system
class ApiKeyPool {
  constructor() {
    this.keys = [];
    this.currentIndex = 0;
    this.rateLimitedKeys = new Set();
    this.keyStats = new Map();
  }

  addKey(apiKey, priority = 1) {
    if (!this.keys.find(k => k.key === apiKey)) {
      this.keys.push({
        key: apiKey,
        priority: priority,
        lastUsed: null,
        rateLimitedUntil: null,
        successCount: 0,
        errorCount: 0
      });
      this.keys.sort((a, b) => b.priority - a.priority);
      console.log(`Added API key to pool (${this.keys.length} total)`);
    }
  }

  removeKey(apiKey) {
    const index = this.keys.findIndex(k => k.key === apiKey);
    if (index !== -1) {
      this.keys.splice(index, 1);
      this.rateLimitedKeys.delete(apiKey);
      this.keyStats.delete(apiKey);
      console.log(`Removed API key from pool (${this.keys.length} remaining)`);
    }
  }

  getNextKey() {
    const now = Date.now();

    // Filter out rate-limited keys
    const availableKeys = this.keys.filter(keyInfo => {
      if (keyInfo.rateLimitedUntil && keyInfo.rateLimitedUntil > now) {
        return false;
      }
      // Clear expired rate limits
      if (keyInfo.rateLimitedUntil && keyInfo.rateLimitedUntil <= now) {
        keyInfo.rateLimitedUntil = null;
        this.rateLimitedKeys.delete(keyInfo.key);
      }
      return true;
    });

    if (availableKeys.length === 0) {
      return null;
    }

    // Round-robin with priority weighting
    const keyInfo = availableKeys[this.currentIndex % availableKeys.length];
    this.currentIndex = (this.currentIndex + 1) % availableKeys.length;

    keyInfo.lastUsed = now;
    return keyInfo.key;
  }

  markRateLimited(apiKey, durationMs = 60000) {
    const keyInfo = this.keys.find(k => k.key === apiKey);
    if (keyInfo) {
      keyInfo.rateLimitedUntil = Date.now() + durationMs;
      keyInfo.errorCount++;
      this.rateLimitedKeys.add(apiKey);
      console.log(`API key rate limited for ${durationMs/1000}s`);
    }
  }

  markSuccess(apiKey) {
    const keyInfo = this.keys.find(k => k.key === apiKey);
    if (keyInfo) {
      keyInfo.successCount++;
    }
  }

  markError(apiKey, errorType) {
    const keyInfo = this.keys.find(k => k.key === apiKey);
    if (keyInfo) {
      keyInfo.errorCount++;

      // Handle different error types
      if (errorType === 'RATE_LIMITED') {
        this.markRateLimited(apiKey);
      } else if (errorType === 'INVALID_KEY') {
        // Remove invalid keys from pool
        this.removeKey(apiKey);
      }
    }
  }

  getStats() {
    return {
      totalKeys: this.keys.length,
      availableKeys: this.keys.filter(k => !k.rateLimitedUntil || k.rateLimitedUntil <= Date.now()).length,
      rateLimitedKeys: this.rateLimitedKeys.size,
      keyStats: this.keys.map(k => ({
        key: k.key.substring(0, 20) + '...',
        priority: k.priority,
        successCount: k.successCount,
        errorCount: k.errorCount,
        rateLimited: k.rateLimitedUntil > Date.now()
      }))
    };
  }
}

// Global API key pool instance
const apiKeyPool = new ApiKeyPool();

// Initialize pool with environment keys
if (process.env.OPENROUTER_API_KEY) {
  apiKeyPool.addKey(process.env.OPENROUTER_API_KEY, 10); // High priority for main key
}
if (process.env.OPENROUTER_TEST_KEY) {
  apiKeyPool.addKey(process.env.OPENROUTER_TEST_KEY, 5); // Medium priority for test key
}

// API key validation and tracking functions
async function storeApiKeyValidation(apiKey, isValid, modelCount = 0, errorCode = null) {
  try {
    // Create API key validation table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_key_validations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT NOT NULL,
        is_valid BOOLEAN NOT NULL,
        model_count INTEGER DEFAULT 0,
        error_code TEXT,
        validated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME DEFAULT (datetime('now', '+1 hour'))
      );
    `);

    // Hash the API key for privacy (store only hash, not actual key)
    const crypto = require('crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Store validation result
    const insertValidation = db.prepare(`
      INSERT OR REPLACE INTO api_key_validations
      (key_hash, is_valid, model_count, error_code, validated_at, expires_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+1 hour'))
    `);

    insertValidation.run(keyHash, isValid, modelCount, errorCode);

    console.log(`API key validation stored: ${isValid ? 'VALID' : 'INVALID'} (${modelCount} models)`);

  } catch (error) {
    console.error('Error storing API key validation:', error);
  }
}

async function getCachedApiKeyValidation(apiKey) {
  try {
    const crypto = require('crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Check for recent validation (within 1 hour)
    const cached = db.prepare(`
      SELECT * FROM api_key_validations
      WHERE key_hash = ? AND expires_at > datetime('now')
      ORDER BY validated_at DESC
      LIMIT 1
    `).get(keyHash);

    if (cached) {
      return {
        valid: cached.is_valid === 1,
        modelCount: cached.model_count,
        errorCode: cached.error_code,
        cachedAt: cached.validated_at,
        fromCache: true
      };
    }

    return null;

  } catch (error) {
    console.error('Error getting cached API key validation:', error);
    return null;
  }
}

async function validateOpenRouterKey(apiKey) {
  try {
    // Check cache first
    const cached = await getCachedApiKeyValidation(apiKey);
    if (cached) {
      console.log('Using cached API key validation result');
      return cached;
    }

    // Validate API key format
    if (!apiKey.startsWith('sk-or-v1-')) {
      const result = {
        valid: false,
        error: 'INVALID_FORMAT',
        message: 'OpenRouter API keys should start with "sk-or-v1-"'
      };
      await storeApiKeyValidation(apiKey, false, 0, 'INVALID_FORMAT');
      return result;
    }

    // Test API key with minimal request
    const testResponse = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    const modelCount = testResponse.data?.data?.length || 0;
    await storeApiKeyValidation(apiKey, true, modelCount);

    return {
      valid: true,
      modelCount: modelCount,
      message: 'API key is valid and working'
    };

  } catch (error) {
    let errorCode = 'VALIDATION_FAILED';
    let message = 'API key validation failed';

    if (error.response?.status === 401) {
      errorCode = 'INVALID_KEY';
      message = 'Invalid or expired API key';
    } else if (error.response?.status === 429) {
      errorCode = 'RATE_LIMITED';
      message = 'Rate limit exceeded';
    } else if (error.response?.status === 403) {
      errorCode = 'INSUFFICIENT_PERMISSIONS';
      message = 'API key lacks required permissions';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorCode = 'NETWORK_ERROR';
      message = 'Cannot connect to OpenRouter API';
    }

    await storeApiKeyValidation(apiKey, false, 0, errorCode);

    return {
      valid: false,
      error: errorCode,
      message: message,
      details: error.response?.data || error.message
    };
  }
}

// Model curation and tracking functions
async function getCuratedModels(category = 'all') {
  try {
    // Create models table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS curated_models (
        id TEXT PRIMARY KEY,
        name TEXT,
        provider TEXT,
        description TEXT,
        category TEXT,
        performance_score REAL DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        avg_response_time REAL DEFAULT 0,
        success_rate REAL DEFAULT 1.0,
        last_used DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default curated models if table is empty
    const modelCount = db.prepare('SELECT COUNT(*) as count FROM curated_models').get();
    if (modelCount.count === 0) {
      const defaultModels = [
        {
          id: 'openai/gpt-4',
          name: 'GPT-4',
          provider: 'OpenAI',
          description: 'Most capable model for complex reasoning and creative tasks',
          category: 'top_overall',
          performance_score: 9.5
        },
        {
          id: 'openai/gpt-3.5-turbo',
          name: 'GPT-3.5 Turbo',
          provider: 'OpenAI',
          description: 'Fast and efficient for most tasks',
          category: 'top_overall',
          performance_score: 8.5
        },
        {
          id: 'anthropic/claude-3-sonnet',
          name: 'Claude 3 Sonnet',
          provider: 'Anthropic',
          description: 'Excellent for creative writing and analysis',
          category: 'top_overall',
          performance_score: 9.0
        },
        {
          id: 'meta-llama/llama-2-70b-chat',
          name: 'Llama 2 70B Chat',
          provider: 'Meta',
          description: 'Open source model, good for general conversation',
          category: 'top_free',
          performance_score: 7.5
        },
        {
          id: 'mistralai/mixtral-8x7b-instruct',
          name: 'Mixtral 8x7B Instruct',
          provider: 'Mistral AI',
          description: 'High-performance mixture of experts model',
          category: 'top_overall',
          performance_score: 8.8
        },
        {
          id: 'google/gemma-7b-it',
          name: 'Gemma 7B IT',
          provider: 'Google',
          description: 'Efficient instruction-tuned model',
          category: 'top_free',
          performance_score: 7.0
        }
      ];

      const insertModel = db.prepare(`
        INSERT INTO curated_models (id, name, provider, description, category, performance_score)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      defaultModels.forEach(model => {
        insertModel.run(model.id, model.name, model.provider, model.description, model.category, model.performance_score);
      });
    }

    // Query models based on category
    let query = 'SELECT * FROM curated_models';
    let params = [];

    if (category === 'fallback') {
      // Return basic models with availability status
      const models = db.prepare(`
        SELECT id, name, provider, description, category, performance_score
        FROM curated_models
        ORDER BY performance_score DESC, usage_count DESC
        LIMIT 6
      `).all();

      return models.map(model => ({
        id: model.id,
        name: model.name,
        description: model.description,
        provider: model.provider,
        available: false,
        reason: 'OpenRouter API key not configured',
        performance_score: model.performance_score
      }));
    } else if (category === 'top_overall') {
      query += ' WHERE category = ? ORDER BY performance_score DESC, usage_count DESC LIMIT 10';
      params = ['top_overall'];
    } else if (category === 'top_free') {
      query += ' WHERE category = ? ORDER BY performance_score DESC, usage_count DESC LIMIT 5';
      params = ['top_free'];
    } else {
      query += ' ORDER BY performance_score DESC, usage_count DESC';
    }

    const models = db.prepare(query).all(...params);

    return models.map(model => ({
      id: model.id,
      name: model.name,
      description: model.description,
      provider: model.provider,
      available: true,
      performance_score: model.performance_score,
      usage_count: model.usage_count,
      avg_response_time: model.avg_response_time,
      success_rate: model.success_rate,
      last_used: model.last_used
    }));

  } catch (error) {
    console.error('Error getting curated models:', error);
    return [];
  }
}

async function trackModelUsage(modelId, usage = {}) {
  try {
    const now = new Date().toISOString();

    // Update model usage statistics
    const updateModel = db.prepare(`
      UPDATE curated_models
      SET usage_count = usage_count + 1,
          last_used = ?,
          updated_at = ?
      WHERE id = ?
    `);

    const result = updateModel.run(now, now, modelId);

    // If model doesn't exist, add it
    if (result.changes === 0) {
      const insertModel = db.prepare(`
        INSERT INTO curated_models (id, name, provider, description, category, usage_count, last_used)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `);

      // Extract provider from model ID
      const provider = modelId.split('/')[0] || 'Unknown';
      const name = modelId.split('/')[1] || modelId;

      insertModel.run(modelId, name, provider, 'Auto-discovered model', 'discovered', now);
    }

    // Track usage analytics
    analytics.trackEvent('model_used', {
      modelId,
      usage,
      timestamp: now
    });

  } catch (error) {
    console.error('Error tracking model usage:', error);
  }
}

async function refreshModelCuration() {
  try {
    // Fetch latest models from OpenRouter API
    const response = await axios.get('https://openrouter.ai/api/v1/models');
    const apiModels = response.data.data || [];

    // Update curated models with fresh data
    const updateModel = db.prepare(`
      UPDATE curated_models
      SET name = ?, description = ?, updated_at = ?
      WHERE id = ?
    `);

    const insertModel = db.prepare(`
      INSERT OR IGNORE INTO curated_models (id, name, provider, description, category, performance_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let updatedCount = 0;
    let addedCount = 0;

    apiModels.forEach(model => {
      const provider = model.id.split('/')[0] || 'Unknown';
      const description = model.description || `${model.name} by ${provider}`;
      const category = model.pricing?.prompt ? 'top_overall' : 'top_free';
      const performanceScore = calculatePerformanceScore(model);

      const updateResult = updateModel.run(model.name, description, new Date().toISOString(), model.id);

      if (updateResult.changes === 0) {
        insertModel.run(model.id, model.name, provider, description, category, performanceScore);
        addedCount++;
      } else {
        updatedCount++;
      }
    });

    console.log(`Model curation refreshed: ${updatedCount} updated, ${addedCount} added`);
    return { updated: updatedCount, added: addedCount };

  } catch (error) {
    console.error('Error refreshing model curation:', error);
    return { error: error.message };
  }
}

function calculatePerformanceScore(model) {
  // Simple scoring algorithm based on model characteristics
  let score = 5.0; // Base score

  // Boost for popular providers
  const provider = model.id.split('/')[0];
  if (['openai', 'anthropic', 'google'].includes(provider)) {
    score += 2.0;
  } else if (['meta-llama', 'mistralai'].includes(provider)) {
    score += 1.5;
  }

  // Boost for larger models (rough heuristic)
  if (model.id.includes('70b') || model.id.includes('gpt-4')) {
    score += 1.5;
  } else if (model.id.includes('13b') || model.id.includes('gpt-3.5')) {
    score += 1.0;
  }

  // Boost for instruction-tuned models
  if (model.id.includes('instruct') || model.id.includes('chat') || model.id.includes('it')) {
    score += 0.5;
  }

  return Math.min(score, 10.0); // Cap at 10.0
}

async function updateModelCuration(liveModels) {
  try {
    // Update curated models with live data
    const updateModel = db.prepare(`
      UPDATE curated_models
      SET name = ?, description = ?, performance_score = ?, updated_at = ?
      WHERE id = ?
    `);

    const insertModel = db.prepare(`
      INSERT OR IGNORE INTO curated_models
      (id, name, provider, description, category, performance_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let updatedCount = 0;
    let addedCount = 0;

    liveModels.forEach(model => {
      const provider = model.id.split('/')[0] || 'Unknown';
      const category = model.pricing ? 'top_overall' : 'top_free';

      const updateResult = updateModel.run(
        model.name,
        model.description,
        model.performance_score,
        new Date().toISOString(),
        model.id
      );

      if (updateResult.changes === 0) {
        insertModel.run(
          model.id,
          model.name,
          provider,
          model.description,
          category,
          model.performance_score
        );
        addedCount++;
      } else {
        updatedCount++;
      }
    });

    console.log(`Model curation updated: ${updatedCount} updated, ${addedCount} added`);
    return { updated: updatedCount, added: addedCount };

  } catch (error) {
    console.error('Error updating model curation:', error);
    return { error: error.message };
  }
}

// Helper functions for dynamic donation tiers
async function getUserUsageStats(userId) {
  try {
    // Get user workflow statistics
    const workflowStats = db.prepare(`
      SELECT
        COUNT(*) as totalWorkflows,
        COUNT(CASE WHEN status = 'finalized' THEN 1 END) as completedPodcasts,
        COUNT(CASE WHEN created_at > datetime('now', '-30 days') THEN 1 END) as recentWorkflows,
        MIN(created_at) as firstUsage,
        MAX(created_at) as lastUsage
      FROM workflows
      WHERE user_id = ? OR user_id IS NULL
    `).get(userId === 'anonymous' ? null : userId);

    // Get analytics events for this user
    const analyticsStats = db.prepare(`
      SELECT
        COUNT(*) as totalEvents,
        COUNT(CASE WHEN event_type = 'script_generated' THEN 1 END) as scriptsGenerated,
        COUNT(CASE WHEN event_type = 'audio_generated' THEN 1 END) as audioGenerated,
        COUNT(CASE WHEN event_type = 'donation_clicked' THEN 1 END) as donationClicks
      FROM analytics
      WHERE json_extract(data, '$.userId') = ? OR json_extract(data, '$.userId') IS NULL
    `).get(userId);

    return {
      totalWorkflows: workflowStats.totalWorkflows || 0,
      totalPodcasts: workflowStats.completedPodcasts || 0,
      recentWorkflows: workflowStats.recentWorkflows || 0,
      scriptsGenerated: analyticsStats.scriptsGenerated || 0,
      audioGenerated: analyticsStats.audioGenerated || 0,
      donationClicks: analyticsStats.donationClicks || 0,
      firstUsage: workflowStats.firstUsage,
      lastUsage: workflowStats.lastUsage,
      daysSinceFirstUse: workflowStats.firstUsage ?
        Math.floor((Date.now() - new Date(workflowStats.firstUsage).getTime()) / (1000 * 60 * 60 * 24)) : 0
    };
  } catch (error) {
    console.error('Error getting user usage stats:', error);
    return {
      totalWorkflows: 0,
      totalPodcasts: 0,
      recentWorkflows: 0,
      scriptsGenerated: 0,
      audioGenerated: 0,
      donationClicks: 0,
      firstUsage: null,
      lastUsage: null,
      daysSinceFirstUse: 0
    };
  }
}

function calculateRecommendedTier(usage) {
  const { totalPodcasts, recentWorkflows, daysSinceFirstUse, donationClicks } = usage;

  // Determine user tier based on usage patterns
  let tier = 'casual';
  let platform = 'kofi'; // Default to one-time donations

  if (totalPodcasts >= 21 || recentWorkflows >= 10) {
    tier = 'power';
    platform = 'patreon'; // Heavy users should consider monthly support
  } else if (totalPodcasts >= 6 || (recentWorkflows >= 3 && daysSinceFirstUse >= 7)) {
    tier = 'regular';
    platform = 'patreon'; // Regular users benefit from monthly support
  }

  // Adjust for users who have already shown donation interest
  if (donationClicks > 0 && tier === 'casual') {
    tier = 'regular';
  }

  // Define tier-specific amounts
  const tierAmounts = {
    casual: {
      patreonAmounts: ["$3", "$5", "$10"],
      kofiAmounts: ["$3", "$5", "$10"],
      githubAmounts: ["$5", "$10", "$25"]
    },
    regular: {
      patreonAmounts: ["$5", "$10", "$15"],
      kofiAmounts: ["$5", "$10", "$20"],
      githubAmounts: ["$10", "$25", "$50"]
    },
    power: {
      patreonAmounts: ["$10", "$25", "$50"],
      kofiAmounts: ["$15", "$30", "$50"],
      githubAmounts: ["$25", "$50", "$100"]
    }
  };

  return {
    name: tier.charAt(0).toUpperCase() + tier.slice(1) + ' User',
    tier: tier,
    platform: platform,
    ...tierAmounts[tier],
    reasoning: generateTierReasoning(usage, tier)
  };
}

function generateTierReasoning(usage, tier) {
  const { totalPodcasts, recentWorkflows, daysSinceFirstUse } = usage;

  switch (tier) {
    case 'power':
      return `You've generated ${totalPodcasts} podcasts and are clearly a power user! Consider monthly support to help sustain development.`;
    case 'regular':
      return `With ${totalPodcasts} podcasts generated, you're getting great value from the tool. Monthly support helps ensure continued development.`;
    case 'casual':
    default:
      if (daysSinceFirstUse > 30) {
        return `You've been using the tool for ${daysSinceFirstUse} days. Even small contributions help keep it running!`;
      } else {
        return `New to the tool? Consider supporting development to help us add more features!`;
      }
  }
}

// Load testing helper functions
async function runBasicLoadTest(duration, concurrency) {
  const results = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    maxResponseTime: 0,
    minResponseTime: Infinity,
    responseTimes: []
  };

  const startTime = Date.now();
  const endTime = startTime + (duration * 1000);
  const promises = [];

  // Simulate concurrent requests
  for (let i = 0; i < concurrency; i++) {
    promises.push(simulateBasicRequests(endTime, results));
  }

  await Promise.all(promises);

  // Calculate statistics
  if (results.responseTimes.length > 0) {
    results.averageResponseTime = results.responseTimes.reduce((a, b) => a + b, 0) / results.responseTimes.length;
    results.maxResponseTime = Math.max(...results.responseTimes);
    results.minResponseTime = Math.min(...results.responseTimes);
  }

  results.requestsPerSecond = results.totalRequests / duration;
  results.successRate = (results.successfulRequests / results.totalRequests * 100).toFixed(2) + '%';

  return results;
}

async function simulateBasicRequests(endTime, results) {
  const endpoints = ['/health', '/api/status', '/api/search?limit=5'];

  while (Date.now() < endTime) {
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    const requestStart = Date.now();

    try {
      const response = await fetch(`http://localhost:${port}${endpoint}`);
      const responseTime = Date.now() - requestStart;

      results.totalRequests++;
      results.responseTimes.push(responseTime);

      if (response.ok) {
        results.successfulRequests++;
      } else {
        results.failedRequests++;
      }
    } catch (error) {
      results.totalRequests++;
      results.failedRequests++;
    }

    // Small delay to prevent overwhelming
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function runWorkflowLoadTest(duration, concurrency) {
  const results = {
    workflowsCreated: 0,
    scriptsGenerated: 0,
    audioGenerated: 0,
    failures: 0,
    averageWorkflowTime: 0,
    workflowTimes: []
  };

  const startTime = Date.now();
  const endTime = startTime + (duration * 1000);
  const promises = [];

  for (let i = 0; i < Math.min(concurrency, 5); i++) { // Limit workflow concurrency
    promises.push(simulateWorkflowRequests(endTime, results));
  }

  await Promise.all(promises);

  if (results.workflowTimes.length > 0) {
    results.averageWorkflowTime = results.workflowTimes.reduce((a, b) => a + b, 0) / results.workflowTimes.length;
  }

  return results;
}

async function simulateWorkflowRequests(endTime, results) {
  while (Date.now() < endTime) {
    const workflowStart = Date.now();

    try {
      // Simulate workflow creation
      const workflowResponse = await fetch(`http://localhost:${port}/api/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Load Test Workflow ${Date.now()}`,
          speechIds: ['1', '2'] // Use existing speech IDs
        })
      });

      if (workflowResponse.ok) {
        results.workflowsCreated++;
        const workflowTime = Date.now() - workflowStart;
        results.workflowTimes.push(workflowTime);
      } else {
        results.failures++;
      }
    } catch (error) {
      results.failures++;
    }

    await new Promise(resolve => setTimeout(resolve, 1000)); // Longer delay for workflows
  }
}

async function runDatabaseLoadTest(duration, concurrency) {
  const results = {
    totalQueries: 0,
    successfulQueries: 0,
    failedQueries: 0,
    averageQueryTime: 0,
    queryTimes: []
  };

  const startTime = Date.now();
  const endTime = startTime + (duration * 1000);
  const promises = [];

  for (let i = 0; i < concurrency; i++) {
    promises.push(simulateDatabaseQueries(endTime, results));
  }

  await Promise.all(promises);

  if (results.queryTimes.length > 0) {
    results.averageQueryTime = results.queryTimes.reduce((a, b) => a + b, 0) / results.queryTimes.length;
  }

  results.queriesPerSecond = results.totalQueries / duration;

  return results;
}

async function simulateDatabaseQueries(endTime, results) {
  const queries = [
    () => db.prepare('SELECT COUNT(*) as count FROM speeches').get(),
    () => db.prepare('SELECT * FROM speeches LIMIT 10').all(),
    () => db.prepare('SELECT * FROM workflows ORDER BY created_at DESC LIMIT 5').all(),
    () => db.prepare('SELECT COUNT(*) as count FROM analytics').get()
  ];

  while (Date.now() < endTime) {
    const queryStart = Date.now();
    const query = queries[Math.floor(Math.random() * queries.length)];

    try {
      query();
      const queryTime = Date.now() - queryStart;

      results.totalQueries++;
      results.successfulQueries++;
      results.queryTimes.push(queryTime);
    } catch (error) {
      results.totalQueries++;
      results.failedQueries++;
    }

    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

// Start server immediately, populate archive in background
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Visit: http://localhost:${port}`);

  // Populate archive in background with error handling
  populateArchive()
    .then(() => console.log('Archive populated successfully'))
    .catch(err => console.error('Failed to populate archive:', err.message));
});
