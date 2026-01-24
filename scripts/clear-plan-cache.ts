/**
 * Script to clear specific cached plan
 * Usage: ts-node scripts/clear-plan-cache.ts <planId>
 */

import { planCachingService } from '../src/services/planCachingService';
import { logger } from '../src/utils/logger';

async function clearPlanCache() {
  const planId = process.argv[2];

  if (!planId) {
    console.error('Usage: ts-node scripts/clear-plan-cache.ts <planId>');
    console.error('Example: ts-node scripts/clear-plan-cache.ts c23a30d0-7d65-4050-9982-63bf9fef13ed');
    process.exit(1);
  }

  try {
    console.log(`Deleting cached plan: ${planId}`);
    await planCachingService.deletePlan(planId);
    console.log('✅ Plan deleted successfully');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Failed to delete plan:', error.message);
    process.exit(1);
  }
}

clearPlanCache();
