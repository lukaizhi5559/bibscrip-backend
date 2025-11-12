/**
 * Test script for Nut.js Code Generation API
 * 
 * Usage:
 * 1. Make sure your .env has GROK_API_KEY or ANTHROPIC_API_KEY
 * 2. Start the server: yarn dev
 * 3. Run this test: node test-nutjs-api.js
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:4000/api';
const API_KEY = process.env.THINKDROP_API_KEY || 'your-api-key-here';

// Test commands
const testCommands = [
  {
    name: 'Open Terminal',
    command: 'open my terminal',
    description: 'Opens terminal using Spotlight search'
  },
  {
    name: 'Find Winter Clothes on Amazon',
    command: 'I need to find new winter clothes on Amazon for upcoming winter',
    description: 'Opens browser, navigates to Amazon, searches for winter clothes'
  },
  {
    name: 'Check Memory',
    command: 'how much memory left on my computer',
    description: 'Opens Activity Monitor to check system memory'
  },
  {
    name: 'Type Hello World',
    command: 'type hello world',
    description: 'Types text at current cursor position'
  }
];

async function testHealthCheck() {
  console.log('\n🔍 Testing Health Check...');
  try {
    const response = await axios.get(`${API_BASE_URL}/nutjs/health`);
    console.log('✅ Health Check Response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('❌ Health check failed:', error.response?.data || error.message);
    return null;
  }
}

async function testExamples() {
  console.log('\n📚 Testing Examples Endpoint...');
  try {
    const response = await axios.get(`${API_BASE_URL}/nutjs/examples`);
    console.log('✅ Examples Response:');
    response.data.examples.forEach((example, index) => {
      console.log(`\n${index + 1}. ${example.command}`);
      console.log(`   Description: ${example.description}`);
      console.log(`   Pattern: ${example.pattern}`);
    });
    return response.data;
  } catch (error) {
    console.error('❌ Examples request failed:', error.response?.data || error.message);
    return null;
  }
}

async function testCodeGeneration(testCase) {
  console.log(`\n🤖 Testing: ${testCase.name}`);
  console.log(`Command: "${testCase.command}"`);
  console.log(`Expected: ${testCase.description}`);
  
  try {
    const startTime = Date.now();
    const response = await axios.post(
      `${API_BASE_URL}/nutjs`,
      { command: testCase.command },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        }
      }
    );
    const duration = Date.now() - startTime;

    console.log(`✅ Success! (${duration}ms)`);
    console.log(`Provider: ${response.data.provider}`);
    console.log(`Latency: ${response.data.latencyMs}ms`);
    console.log(`Code Length: ${response.data.code.length} characters`);
    console.log(`Validation: ${response.data.validation.valid ? '✅ Valid' : '❌ Invalid'}`);
    
    // Show first 500 characters of generated code
    console.log('\n📝 Generated Code (preview):');
    console.log('─'.repeat(80));
    console.log(response.data.code.substring(0, 500));
    if (response.data.code.length > 500) {
      console.log(`\n... (${response.data.code.length - 500} more characters)`);
    }
    console.log('─'.repeat(80));

    return response.data;
  } catch (error) {
    console.error(`❌ Code generation failed:`, error.response?.data || error.message);
    return null;
  }
}

async function runTests() {
  console.log('🚀 Starting Nut.js Code Generation API Tests');
  console.log('='.repeat(80));

  // Test 1: Health Check
  const health = await testHealthCheck();
  if (!health) {
    console.error('\n⚠️  Health check failed. Make sure the server is running and providers are configured.');
    return;
  }

  if (health.status !== 'healthy') {
    console.warn('\n⚠️  Service is degraded. Check that GROK_API_KEY or ANTHROPIC_API_KEY is set in .env');
    console.log('Available providers:', JSON.stringify(health.providers, null, 2));
  }

  // Test 2: Examples
  await testExamples();

  // Test 3: Code Generation (run one test by default, uncomment to run all)
  console.log('\n' + '='.repeat(80));
  console.log('🧪 Running Code Generation Tests');
  console.log('='.repeat(80));

  // Run first test only (faster)
  await testCodeGeneration(testCommands[0]);

  // Uncomment to run all tests (slower)
  /*
  for (const testCase of testCommands) {
    await testCodeGeneration(testCase);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between tests
  }
  */

  console.log('\n' + '='.repeat(80));
  console.log('✅ Tests Complete!');
  console.log('='.repeat(80));
  console.log('\n💡 Tips:');
  console.log('- Set GROK_API_KEY in .env for primary provider (Grok)');
  console.log('- Set ANTHROPIC_API_KEY in .env for fallback provider (Claude)');
  console.log('- The API returns pure Nut.js code ready to execute');
  console.log('- Use POST /api/nutjs with {"command": "your command"} from your MCP');
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
