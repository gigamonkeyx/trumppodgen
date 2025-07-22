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

// Run tests if this file is executed directly
if (require.main === module) {
  runner.run().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = { TestRunner, assert, get, post };
