// Quick script to delete cached plan
require('dotenv').config();
const { createClient } = require('redis');
const { Pinecone } = require('@pinecone-database/pinecone');

async function deletePlan() {
  const planIds = [
    // Add the latest plan IDs from the test that selected Suggestions section
    // Will be updated after the next test run
  ];
  
  try {
    // Delete from Redis
    const redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    await redis.connect();
    
    let totalDeleted = 0;
    for (const planId of planIds) {
      const result = await redis.del(`plan:${planId}`);
      totalDeleted += result;
      console.log(`✅ Deleted plan ${planId} from Redis (${result} keys deleted)`);
    }
    
    await redis.quit();
    console.log(`✅ Total deleted from Redis: ${totalDeleted} keys`);

    // Delete from Pinecone
    if (!process.env.PINECONE_API_KEY) {
      console.error('❌ PINECONE_API_KEY not found in environment');
      process.exit(1);
    }
    
    const pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY
    });
    const index = pc.index('bibscrip-index');
    
    for (const planId of planIds) {
      try {
        await index.namespace('automation_plans').deleteOne(planId);
        console.log(`✅ Deleted plan ${planId} from Pinecone`);
      } catch (err) {
        console.log(`⚠️  Plan ${planId} not found in Pinecone (already deleted or doesn't exist)`);
      }
    }
    
    console.log(`✅ All plans deleted successfully`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

deletePlan();
