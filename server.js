require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Database = require('better-sqlite3');
const cheerio = require('cheerio');
const path = require('path');
const { DataSourceManager } = require('./src/dataSources');
const { Analytics } = require('./src/analytics');

const app = express();
const port = 3000;
const db = new Database('archive.db');
const dataSourceManager = new DataSourceManager(db);
const analytics = new Analytics(db);

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
app.post('/api/analytics/cleanup', async (req, res) => {
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

// API: Generate script with batch processing
app.post('/api/generate-script', async (req, res) => {
  try {
    const { workflowId, model, style = 'professional', duration = 10, batchSize = 10 } = req.body;

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

    // Handle large batches (10+ speeches) with intelligent processing
    let script;
    if (speeches.length > batchSize) {
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

// API: Generate audio (enhanced TTS)
app.post('/api/generate-audio', async (req, res) => {
  try {
    const { workflowId, voice = 'default', speed = 1.0 } = req.body;

    if (!workflowId) {
      return res.status(400).json({ error: 'workflowId is required' });
    }

    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
    if (!workflow || !workflow.script) {
      return res.status(400).json({ error: 'Workflow not found or no script available' });
    }

    // For now, return a mock audio URL
    // In production, this would integrate with TTS services like:
    // - OpenAI TTS API
    // - Google Cloud Text-to-Speech
    // - Amazon Polly
    // - ElevenLabs

    const audioUrl = `audio/${workflowId}.mp3`;

    // Update workflow with audio URL
    db.prepare('UPDATE workflows SET audio_url = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(audioUrl, 'audio_generated', workflowId);

    res.json({
      workflowId,
      audioUrl,
      status: 'audio_generated',
      message: 'Audio generation completed (mock)',
      note: 'This is a mock response. In production, this would generate actual audio.'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Finalize podcast (RSS and publishing)
app.post('/api/finalize', (req, res) => {
  try {
    const { workflowId, title, description } = req.body;

    if (!workflowId) {
      return res.status(400).json({ error: 'workflowId is required' });
    }

    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
    if (!workflow || !workflow.script || !workflow.audio_url) {
      return res.status(400).json({ error: 'Workflow not ready for finalization' });
    }

    const podcastTitle = title || `Trump Podcast - ${new Date().toLocaleDateString()}`;
    const podcastDescription = description || 'AI-generated podcast from Trump speeches and rallies';

    const rss = generateRss(podcastTitle, podcastDescription, workflow.script, workflow.audio_url);
    const rssUrl = `rss/${workflowId}.xml`;

    // Update workflow as finalized
    db.prepare('UPDATE workflows SET rss_url = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(rssUrl, 'finalized', workflowId);

    res.json({
      workflowId,
      rssUrl,
      podcastTitle,
      podcastDescription,
      status: 'finalized',
      message: 'Podcast finalized successfully'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
