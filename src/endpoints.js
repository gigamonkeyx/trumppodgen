/**
 * API Endpoints Module - Modularized server endpoints for Grok 4 Heavy ingestion
 * Extracted from server.js for better organization and analysis
 */

const express = require('express');
const router = express.Router();

// Search endpoint
router.get('/search', async (req, res) => {
  try {
    const { query = '', limit = 20, offset = 0, source = '', date_from = '', date_to = '' } = req.query;
    
    let sql = `
      SELECT id, title, date, video_url, transcript_url, rally_location, 
             duration, thumbnail_url, source, description
      FROM speeches 
      WHERE 1=1
    `;
    const params = [];

    if (query) {
      sql += ` AND (title LIKE ? OR description LIKE ?)`;
      params.push(`%${query}%`, `%${query}%`);
    }

    if (source) {
      sql += ` AND source = ?`;
      params.push(source);
    }

    if (date_from) {
      sql += ` AND date >= ?`;
      params.push(date_from);
    }

    if (date_to) {
      sql += ` AND date <= ?`;
      params.push(date_to);
    }

    sql += ` ORDER BY date DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const results = db.prepare(sql).all(...params);
    const total = db.prepare('SELECT COUNT(*) as count FROM speeches').get().count;

    res.json({
      results,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      query
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Status endpoint
router.get('/status', (req, res) => {
  try {
    const speechCount = db.prepare('SELECT COUNT(*) as count FROM speeches').get().count;
    const sources = ['archive', 'whitehouse', 'cspan', 'youtube'];
    const sourceStats = {};
    
    sources.forEach(source => {
      const count = db.prepare('SELECT COUNT(*) as count FROM speeches WHERE source = ?').get(source).count;
      sourceStats[source] = count;
    });

    res.json({
      database: {
        connected: true,
        speeches: speechCount,
        sources: sourceStats
      },
      sources: {
        archive: { available: true },
        whitehouse: { available: true },
        cspan: { available: false, reason: 'Blocked (403)' },
        youtube: { available: !!process.env.YOUTUBE_API_KEY }
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '1.0.0'
      }
    });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Status check failed' });
  }
});

// Workflow endpoint
router.post('/workflow', async (req, res) => {
  try {
    const { 
      speechIds, 
      voice = 'trump', 
      preset = 'fast',
      customVoicePath,
      useLocal = process.env.USE_LOCAL_TTS === 'true'
    } = req.body;

    if (!speechIds || !Array.isArray(speechIds) || speechIds.length === 0) {
      return res.status(400).json({ error: 'speechIds array is required' });
    }

    const workflowId = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Get speeches
    const placeholders = speechIds.map(() => '?').join(',');
    const speeches = db.prepare(`SELECT * FROM speeches WHERE id IN (${placeholders})`).all(...speechIds);
    
    if (speeches.length === 0) {
      return res.status(404).json({ error: 'No speeches found for provided IDs' });
    }

    // Generate script
    const script = await generateScript(speeches);
    
    // Generate audio (no mock fallback)
    let audioResult;
    if (useLocal) {
      audioResult = await generateLocalTTS(script, voice, preset, workflowId, customVoicePath);
    } else {
      throw new Error('TTS not configured - set USE_LOCAL_TTS=true and configure Tortoise-TTS');
    }

    // Generate RSS
    const rssResult = await generateRSS(workflowId, script, audioResult.output_file, speeches);

    res.json({
      workflowId,
      script,
      audio: audioResult,
      rss: rssResult,
      speeches: speeches.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Workflow error:', error);
    res.status(500).json({ 
      error: 'Workflow generation failed',
      details: error.message 
    });
  }
});

module.exports = router;
