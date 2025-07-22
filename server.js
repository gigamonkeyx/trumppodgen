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

// API: Donation/Support endpoints
app.get('/api/donate', async (req, res) => {
  try {
    const donationInfo = {
      message: "Support Trump Podcast Generator Development",
      description: "Help us maintain and improve this local podcast generation tool",
      options: [
        {
          platform: "Patreon",
          url: process.env.PATREON_URL || "https://patreon.com/trumppodgen",
          description: "Monthly support for ongoing development",
          suggested_amounts: ["$5", "$10", "$25"]
        },
        {
          platform: "Ko-fi",
          url: process.env.KOFI_URL || "https://ko-fi.com/trumppodgen",
          description: "One-time support",
          suggested_amounts: ["$3", "$5", "$10"]
        },
        {
          platform: "GitHub Sponsors",
          url: process.env.GITHUB_SPONSORS_URL || "https://github.com/sponsors/gigamonkeyx",
          description: "Support open source development",
          suggested_amounts: ["$5", "$15", "$50"]
        }
      ],
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
    const { platform, amount, userId } = req.body;

    // Track donation analytics (don't store sensitive payment info)
    analytics.trackEvent('donation_clicked', {
      platform,
      amount: amount || 'unknown',
      userId: userId || 'anonymous'
    }, req);

    res.json({
      message: 'Thank you for your support!',
      tracked: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

// Start server immediately, populate archive in background
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Visit: http://localhost:${port}`);

  // Populate archive in background with error handling
  populateArchive()
    .then(() => console.log('Archive populated successfully'))
    .catch(err => console.error('Failed to populate archive:', err.message));
});
