/**
 * Basic functionality tests for Trump Podcast Generator
 * Run with: node test/basic.test.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

// Simple test framework
class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    console.log('🧪 Running Trump Podcast Generator Tests\n');
    
    for (const test of this.tests) {
      try {
        await test.fn();
        console.log(`✅ ${test.name}`);
        this.passed++;
      } catch (error) {
        console.log(`❌ ${test.name}: ${error.message}`);
        this.failed++;
      }
    }

    console.log(`\n📊 Test Results: ${this.passed} passed, ${this.failed} failed`);
    
    if (this.failed > 0) {
      process.exit(1);
    }
  }
}

// Helper functions
async function get(path) {
  const response = await axios.get(`${BASE_URL}${path}`);
  return response.data;
}

async function post(path, data) {
  const response = await axios.post(`${BASE_URL}${path}`, data);
  return response.data;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Tests
const runner = new TestRunner();

runner.test('Server health check', async () => {
  const health = await get('/health');
  assert(health.status === 'healthy', 'Server should be healthy');
  assert(typeof health.stats === 'object', 'Health should include stats');
});

runner.test('API status endpoint', async () => {
  const status = await get('/api/status');
  assert(typeof status.sources === 'object', 'Status should include sources');
  assert(typeof status.database === 'object', 'Status should include database info');
  assert(typeof status.ai === 'object', 'Status should include AI info');
});

runner.test('Search API with no parameters', async () => {
  const result = await get('/api/search');
  assert(Array.isArray(result.results), 'Search should return results array');
  assert(typeof result.pagination === 'object', 'Search should include pagination');
});

runner.test('Search API with keyword filter', async () => {
  const result = await get('/api/search?keyword=trump');
  assert(Array.isArray(result.results), 'Filtered search should return results array');
});

runner.test('Verify data sources', async () => {
  const sources = await get('/api/verify-sources');
  assert(typeof sources === 'object', 'Should return sources object');
  
  // Check that we have expected sources
  const expectedSources = ['cspan', 'youtube', 'archive', 'whitehouse'];
  for (const source of expectedSources) {
    assert(sources.hasOwnProperty(source), `Should include ${source} source`);
    assert(typeof sources[source].available === 'boolean', `${source} should have available status`);
  }
});

runner.test('Get AI models', async () => {
  const models = await get('/api/models');
  assert(typeof models === 'object', 'Should return models object');
  // Models might be empty if not populated yet, so just check structure
});

runner.test('Create workflow', async () => {
  // First get some speeches to use
  const searchResult = await get('/api/search?limit=2');
  
  if (searchResult.results.length > 0) {
    const speechIds = searchResult.results.slice(0, 2).map(s => s.id);
    
    const workflow = await post('/api/workflow', {
      name: 'Test Workflow',
      speechIds: speechIds
    });
    
    assert(workflow.workflowId, 'Should return workflow ID');
    assert(workflow.status === 'draft', 'New workflow should be in draft status');
    
    // Test getting workflow details
    const details = await get(`/api/workflow/${workflow.workflowId}`);
    assert(details.id === workflow.workflowId, 'Should return correct workflow details');
    assert(Array.isArray(details.speeches), 'Should include speeches array');
  } else {
    console.log('⚠️  Skipping workflow test - no speeches available');
  }
});

runner.test('Error handling for invalid requests', async () => {
  try {
    await get('/api/nonexistent');
    assert(false, 'Should have thrown error for nonexistent endpoint');
  } catch (error) {
    assert(error.response.status === 404, 'Should return 404 for nonexistent endpoint');
  }

  try {
    await post('/api/workflow', { invalid: 'data' });
    assert(false, 'Should have thrown error for invalid workflow data');
  } catch (error) {
    assert(error.response.status === 400, 'Should return 400 for invalid data');
  }
});

runner.test('Data source verification details', async () => {
  const sources = await get('/api/verify-sources');

  // Check Archive.org is working
  assert(sources.archive, 'Archive.org source should be present');
  assert(sources.archive.available === true, 'Archive.org should be available');

  // Check WhiteHouse.gov is working
  assert(sources.whitehouse, 'WhiteHouse.gov source should be present');
  assert(sources.whitehouse.available === true, 'WhiteHouse.gov should be available');

  // Check expected unavailable sources
  assert(sources.cspan, 'C-SPAN source should be present');
  assert(sources.youtube, 'YouTube source should be present');
});

runner.test('Database content validation', async () => {
  const result = await get('/api/search?limit=100');

  // Should have speeches from Archive.org
  assert(result.results.length >= 19, 'Should have at least 19 speeches from initial population');

  // Check data quality
  const archiveSpeeches = result.results.filter(s => s.source === 'archive');
  assert(archiveSpeeches.length > 0, 'Should have speeches from Archive.org');

  // Validate speech structure
  if (archiveSpeeches.length > 0) {
    const speech = archiveSpeeches[0];
    assert(speech.id, 'Speech should have ID');
    assert(speech.title, 'Speech should have title');
    assert(speech.source === 'archive', 'Speech should have correct source');
  }
});

runner.test('Analytics endpoint functionality', async () => {
  const analytics = await get('/api/analytics');

  assert(typeof analytics.overview === 'object', 'Should include overview data');
  assert(typeof analytics.last24h === 'object', 'Should include 24h metrics');
  assert(Array.isArray(analytics.popularEndpoints), 'Should include popular endpoints');
});

runner.test('Performance and load handling', async () => {
  // Test concurrent requests
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(get('/api/search?limit=10'));
  }

  const results = await Promise.all(promises);
  assert(results.length === 5, 'Should handle concurrent requests');

  // All should return valid data
  results.forEach(result => {
    assert(Array.isArray(result.results), 'Each request should return valid results');
  });
});

runner.test('C-SPAN source integration', async () => {
  const sources = await get('/api/verify-sources');

  // C-SPAN should be present in sources
  assert(sources.cspan, 'C-SPAN source should be configured');

  if (sources.cspan.available) {
    console.log('✅ C-SPAN source is available - testing fetch capability');

    // Test refresh archive to see if C-SPAN data comes through
    const refreshResult = await post('/api/refresh-archive', {});
    assert(refreshResult.message, 'Archive refresh should complete');

    // Check if we got C-SPAN data
    const searchResult = await get('/api/search?limit=100');
    const cspanSpeeches = searchResult.results.filter(s => s.source === 'cspan');

    if (cspanSpeeches.length > 0) {
      console.log(`✅ C-SPAN integration successful: ${cspanSpeeches.length} speeches found`);

      // Validate C-SPAN speech structure
      const speech = cspanSpeeches[0];
      assert(speech.id.startsWith('cspan_'), 'C-SPAN speech should have correct ID prefix');
      assert(speech.video_url.includes('c-span.org'), 'Should have C-SPAN video URL');
    } else {
      console.log('⚠️ C-SPAN available but no Trump content found (expected for current period)');
    }
  } else {
    console.log('⚠️ C-SPAN source blocked (403) - expected, testing error handling');
    assert(sources.cspan.error, 'Should report error details when blocked');
  }
});

runner.test('YouTube source integration', async () => {
  const sources = await get('/api/verify-sources');

  // YouTube should be present in sources
  assert(sources.youtube, 'YouTube source should be configured');

  if (sources.youtube.available) {
    console.log('✅ YouTube API configured - testing fetch capability');

    // Test refresh archive to see if YouTube data comes through
    const refreshResult = await post('/api/refresh-archive', {});
    assert(refreshResult.message, 'Archive refresh should complete');

    // Check if we got YouTube data
    const searchResult = await get('/api/search?limit=100');
    const youtubeSpeeches = searchResult.results.filter(s => s.source === 'youtube');

    if (youtubeSpeeches.length > 0) {
      console.log(`✅ YouTube integration successful: ${youtubeSpeeches.length} videos found`);

      // Validate YouTube speech structure
      const speech = youtubeSpeeches[0];
      assert(speech.id.startsWith('youtube_'), 'YouTube speech should have correct ID prefix');
      assert(speech.video_url.includes('youtube.com'), 'Should have YouTube video URL');
      assert(speech.channel, 'Should include channel information');
    } else {
      console.log('⚠️ YouTube API available but no content found - may need API key configuration');
    }
  } else {
    console.log('⚠️ YouTube API key not configured - expected, testing error handling');
    assert(sources.youtube.error.includes('API key'), 'Should report API key configuration issue');
  }
});

runner.test('Multi-source data quality validation', async () => {
  const searchResult = await get('/api/search?limit=200');

  // Should have data from multiple sources
  const sourceTypes = [...new Set(searchResult.results.map(s => s.source))];
  console.log(`📊 Active sources: ${sourceTypes.join(', ')}`);

  // Validate data quality across sources
  for (const speech of searchResult.results.slice(0, 10)) {
    assert(speech.id, 'Each speech should have an ID');
    assert(speech.title, 'Each speech should have a title');
    assert(speech.source, 'Each speech should have a source');
    assert(speech.date, 'Each speech should have a date');

    // Source-specific validations
    if (speech.source === 'archive') {
      assert(speech.video_url.includes('archive.org'), 'Archive speeches should have archive.org URLs');
    } else if (speech.source === 'youtube') {
      assert(speech.video_url.includes('youtube.com'), 'YouTube speeches should have YouTube URLs');
      assert(speech.channel, 'YouTube speeches should have channel info');
    } else if (speech.source === 'cspan') {
      assert(speech.video_url.includes('c-span.org'), 'C-SPAN speeches should have C-SPAN URLs');
    }
  }

  // Performance check - should have reasonable amount of data
  if (searchResult.results.length >= 50) {
    console.log(`✅ Good data coverage: ${searchResult.results.length} total speeches`);
  } else {
    console.log(`⚠️ Limited data coverage: ${searchResult.results.length} speeches (may need source configuration)`);
  }
});

// Run tests if this file is executed directly
if (require.main === module) {
  runner.run().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = { TestRunner, assert, get, post };
