const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Data Sources Module - Handles fetching content from multiple verified sources
 * Implements link-first strategy with fallback mechanisms
 */

class DataSourceManager {
  constructor(db) {
    this.db = db;
    this.sources = {
      cspan: new CSpanSource(),
      youtube: new YouTubeSource(),
      archive: new ArchiveOrgSource(),
      whitehouse: new WhiteHouseSource()
    };
  }

  async verifyAllSources() {
    const results = {};
    for (const [name, source] of Object.entries(this.sources)) {
      try {
        results[name] = await source.verify();
      } catch (error) {
        results[name] = { available: false, error: error.message };
      }
    }
    return results;
  }

  async fetchFromAllSources(options = {}) {
    const results = [];
    const errors = [];

    for (const [name, source] of Object.entries(this.sources)) {
      try {
        console.log(`Fetching from ${name}...`);
        const data = await source.fetch(options);
        if (data && data.length > 0) {
          results.push(...data.map(item => ({ ...item, source: name })));
          console.log(`${name}: Found ${data.length} items`);
        }
      } catch (error) {
        console.error(`${name} error:`, error.message);
        errors.push({ source: name, error: error.message });
      }
    }

    return { results, errors };
  }

  async saveToDatabase(items) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO speeches 
      (id, title, date, transcript, video_url, audio_url, source, rally_location, duration, transcript_url, thumbnail_url, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    for (const item of items) {
      try {
        insert.run(
          item.id,
          item.title,
          item.date,
          item.transcript || null,
          item.video_url || null,
          item.audio_url || null,
          item.source,
          item.rally_location || null,
          item.duration || null,
          item.transcript_url || null,
          item.thumbnail_url || null,
          'active'
        );
        inserted++;
      } catch (error) {
        console.error(`Failed to insert item ${item.id}:`, error.message);
      }
    }

    return inserted;
  }
}

class CSpanSource {
  constructor() {
    this.baseUrl = 'https://www.c-span.org';
    this.apiUrl = 'https://www.c-span.org/api';
  }

  async verify() {
    try {
      const response = await axios.get(`${this.baseUrl}/person/donald-trump`, { timeout: 5000 });
      return { available: true, status: response.status };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  async fetch(options = {}) {
    // C-SPAN doesn't have a public API, so we'll scrape their Trump page
    try {
      const response = await axios.get(`${this.baseUrl}/person/donald-trump`, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      const items = [];

      // Look for video links and titles
      $('.program-item, .video-item').each((i, element) => {
        const $el = $(element);
        const title = $el.find('.program-title, .video-title').text().trim();
        const link = $el.find('a').attr('href');
        const date = $el.find('.date, .program-date').text().trim();

        if (title && link && title.toLowerCase().includes('trump')) {
          items.push({
            id: `cspan_${link.split('/').pop()}`,
            title: title,
            date: this.parseDate(date),
            video_url: link.startsWith('http') ? link : `${this.baseUrl}${link}`,
            transcript_url: null,
            rally_location: this.extractLocation(title),
            duration: null,
            thumbnail_url: $el.find('img').attr('src')
          });
        }
      });

      return items.slice(0, 20); // Limit to 20 most recent
    } catch (error) {
      throw new Error(`C-SPAN fetch failed: ${error.message}`);
    }
  }

  parseDate(dateStr) {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  extractLocation(title) {
    // Simple location extraction from title
    const locationPatterns = [
      /in ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
      /at ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
      /([A-Z][a-z]+,\s*[A-Z]{2})/
    ];

    for (const pattern of locationPatterns) {
      const match = title.match(pattern);
      if (match) return match[1];
    }
    return null;
  }
}

class YouTubeSource {
  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY;
    this.baseUrl = 'https://www.googleapis.com/youtube/v3';
  }

  async verify() {
    if (!this.apiKey) {
      return { available: false, error: 'YouTube API key not configured' };
    }

    try {
      const response = await axios.get(`${this.baseUrl}/search`, {
        params: { part: 'snippet', q: 'test', key: this.apiKey, maxResults: 1 },
        timeout: 5000
      });
      return { available: true, status: response.status };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  async fetch(options = {}) {
    if (!this.apiKey) {
      throw new Error('YouTube API key not configured');
    }

    try {
      const queries = [
        'Trump rally 2024',
        'Trump speech 2024',
        'Donald Trump rally',
        'Trump campaign speech'
      ];

      const items = [];
      for (const query of queries) {
        const response = await axios.get(`${this.baseUrl}/search`, {
          params: {
            part: 'snippet',
            q: query,
            key: this.apiKey,
            maxResults: 10,
            type: 'video',
            order: 'date'
          },
          timeout: 10000
        });

        for (const video of response.data.items) {
          items.push({
            id: `youtube_${video.id.videoId}`,
            title: video.snippet.title,
            date: video.snippet.publishedAt.split('T')[0],
            video_url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
            transcript_url: null,
            rally_location: this.extractLocation(video.snippet.title),
            duration: null,
            thumbnail_url: video.snippet.thumbnails.medium?.url
          });
        }
      }

      return items;
    } catch (error) {
      throw new Error(`YouTube fetch failed: ${error.message}`);
    }
  }

  extractLocation(title) {
    // Extract location from YouTube video titles
    const locationPatterns = [
      /Rally in ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
      /([A-Z][a-z]+,\s*[A-Z]{2})/,
      /in ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
    ];

    for (const pattern of locationPatterns) {
      const match = title.match(pattern);
      if (match) return match[1];
    }
    return null;
  }
}

class ArchiveOrgSource {
  constructor() {
    this.baseUrl = 'https://archive.org';
    this.apiUrl = 'https://archive.org/advancedsearch.php';
  }

  async verify() {
    try {
      const response = await axios.get(this.baseUrl, { timeout: 5000 });
      return { available: true, status: response.status };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  async fetch(options = {}) {
    try {
      const response = await axios.get(this.apiUrl, {
        params: {
          q: 'title:(Trump speech OR Trump rally) AND mediatype:movies',
          fl: 'identifier,title,date,description',
          rows: 20,
          output: 'json'
        },
        timeout: 10000
      });

      const items = [];
      if (response.data.response && response.data.response.docs) {
        for (const doc of response.data.response.docs) {
          items.push({
            id: `archive_${doc.identifier}`,
            title: doc.title,
            date: doc.date,
            video_url: `${this.baseUrl}/details/${doc.identifier}`,
            transcript_url: null,
            rally_location: this.extractLocation(doc.title),
            duration: null,
            thumbnail_url: `${this.baseUrl}/services/img/${doc.identifier}`
          });
        }
      }

      return items;
    } catch (error) {
      throw new Error(`Archive.org fetch failed: ${error.message}`);
    }
  }

  extractLocation(title) {
    const locationPatterns = [
      /Rally in ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
      /([A-Z][a-z]+,\s*[A-Z]{2})/,
      /at ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
    ];

    for (const pattern of locationPatterns) {
      const match = title.match(pattern);
      if (match) return match[1];
    }
    return null;
  }
}

class WhiteHouseSource {
  constructor() {
    this.baseUrl = 'https://www.whitehouse.gov';
  }

  async verify() {
    try {
      const response = await axios.get(`${this.baseUrl}/briefing-room/speeches-remarks/`, { timeout: 5000 });
      return { available: true, status: response.status };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  async fetch(options = {}) {
    // Note: This would fetch current administration speeches
    // For Trump speeches, we'd need to access archived content
    try {
      const response = await axios.get(`${this.baseUrl}/briefing-room/speeches-remarks/`, { timeout: 10000 });
      const $ = cheerio.load(response.data);
      const items = [];

      $('.news-item').each((i, element) => {
        const $el = $(element);
        const title = $el.find('.news-item__title').text().trim();
        const link = $el.find('a').attr('href');
        const date = $el.find('.news-item__date').text().trim();

        if (title && link) {
          items.push({
            id: `whitehouse_${link.split('/').pop()}`,
            title: title,
            date: this.parseDate(date),
            video_url: link.startsWith('http') ? link : `${this.baseUrl}${link}`,
            transcript_url: link.startsWith('http') ? link : `${this.baseUrl}${link}`,
            rally_location: null,
            duration: null,
            thumbnail_url: null
          });
        }
      });

      return items.slice(0, 10);
    } catch (error) {
      throw new Error(`WhiteHouse fetch failed: ${error.message}`);
    }
  }

  parseDate(dateStr) {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toISOString().split('T')[0];
    } catch {
      return null;
    }
  }
}

module.exports = { DataSourceManager };
