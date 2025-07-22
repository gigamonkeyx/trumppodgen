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
    this.apiUrl = 'https://api.c-span.org/v1';
    this.trumpPersonId = '20967'; // C-SPAN person ID for Donald Trump
  }

  async verify() {
    try {
      // Try API first, fallback to scraping
      const response = await axios.get(`${this.apiUrl}/videos`, {
        params: { personId: this.trumpPersonId, limit: 1 },
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      return { available: true, status: response.status, method: 'api' };
    } catch (apiError) {
      // Fallback to scraping verification
      try {
        const response = await axios.get(`${this.baseUrl}/person/donald-trump`, {
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        return { available: true, status: response.status, method: 'scraping' };
      } catch (scrapeError) {
        return { available: false, error: scrapeError.message };
      }
    }
  }

  async fetch(options = {}) {
    const limit = options.limit || 50;

    // Try API first
    try {
      return await this.fetchFromAPI(limit);
    } catch (apiError) {
      console.log('C-SPAN API failed, falling back to scraping:', apiError.message);
      return await this.fetchFromScraping(limit);
    }
  }

  async fetchFromAPI(limit = 50) {
    try {
      const response = await axios.get(`${this.apiUrl}/videos`, {
        params: {
          personId: this.trumpPersonId,
          limit: limit,
          sort: 'date_desc'
        },
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      const items = [];
      if (response.data && response.data.videos) {
        for (const video of response.data.videos) {
          items.push({
            id: `cspan_${video.id}`,
            title: video.title || 'Untitled',
            date: video.date ? new Date(video.date).toISOString().split('T')[0] : null,
            video_url: `${this.baseUrl}/video/?${video.id}`,
            transcript_url: video.transcript ? `${this.baseUrl}/video/?${video.id}#transcript` : null,
            rally_location: this.extractLocation(video.title || ''),
            duration: video.duration || null,
            thumbnail_url: video.thumbnail || null
          });
        }
      }

      return items;
    } catch (error) {
      throw new Error(`C-SPAN API fetch failed: ${error.message}`);
    }
  }

  async fetchFromScraping(limit = 20) {
    try {
      const response = await axios.get(`${this.baseUrl}/person/donald-trump`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      const items = [];

      // Look for video links and titles
      $('.program-item, .video-item, .result-item').each((i, element) => {
        if (items.length >= limit) return false;

        const $el = $(element);
        const title = $el.find('.program-title, .video-title, .result-title').text().trim();
        const link = $el.find('a').attr('href');
        const date = $el.find('.date, .program-date, .result-date').text().trim();

        if (title && link && title.toLowerCase().includes('trump')) {
          items.push({
            id: `cspan_${link.split('/').pop() || Math.random().toString(36)}`,
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

      return items;
    } catch (error) {
      throw new Error(`C-SPAN scraping failed: ${error.message}`);
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
        'Trump campaign speech',
        'RSBN Trump rally',
        'Right Side Broadcasting Trump',
        'Trump rally live',
        'Trump Pennsylvania rally',
        'Trump Michigan rally',
        'Trump Florida rally'
      ];

      const items = [];
      const seenVideoIds = new Set();

      for (const query of queries) {
        try {
          const response = await axios.get(`${this.baseUrl}/search`, {
            params: {
              part: 'snippet',
              q: query,
              key: this.apiKey,
              maxResults: 15,
              type: 'video',
              order: 'date',
              publishedAfter: '2020-01-01T00:00:00Z' // Focus on recent content
            },
            timeout: 10000
          });

          for (const video of response.data.items) {
            // Avoid duplicates
            if (seenVideoIds.has(video.id.videoId)) continue;
            seenVideoIds.add(video.id.videoId);

            // Filter for Trump-related content
            const title = video.snippet.title.toLowerCase();
            if (title.includes('trump') &&
                (title.includes('rally') || title.includes('speech') ||
                 title.includes('campaign') || title.includes('remarks'))) {

              // Get additional video details
              const videoDetails = await this.getVideoDetails(video.id.videoId);

              items.push({
                id: `youtube_${video.id.videoId}`,
                title: video.snippet.title,
                date: video.snippet.publishedAt.split('T')[0],
                video_url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
                transcript_url: null, // Could be enhanced with YouTube transcript API
                rally_location: this.extractLocation(video.snippet.title),
                duration: videoDetails.duration,
                thumbnail_url: video.snippet.thumbnails.medium?.url,
                channel: video.snippet.channelTitle,
                description: video.snippet.description?.substring(0, 500)
              });
            }
          }
        } catch (queryError) {
          console.warn(`YouTube query failed for "${query}":`, queryError.message);
          continue; // Continue with other queries
        }
      }

      // Sort by date (newest first) and limit results
      return items
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, options.limit || 50);

    } catch (error) {
      throw new Error(`YouTube fetch failed: ${error.message}`);
    }
  }

  async getVideoDetails(videoId) {
    try {
      const response = await axios.get(`${this.baseUrl}/videos`, {
        params: {
          part: 'contentDetails,statistics',
          id: videoId,
          key: this.apiKey
        },
        timeout: 5000
      });

      if (response.data.items && response.data.items.length > 0) {
        const video = response.data.items[0];
        return {
          duration: this.parseDuration(video.contentDetails.duration),
          viewCount: video.statistics.viewCount,
          likeCount: video.statistics.likeCount
        };
      }
    } catch (error) {
      console.warn(`Failed to get video details for ${videoId}:`, error.message);
    }

    return { duration: null, viewCount: null, likeCount: null };
  }

  parseDuration(isoDuration) {
    // Parse ISO 8601 duration (PT4M13S -> 4:13)
    if (!isoDuration) return null;

    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return null;

    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
