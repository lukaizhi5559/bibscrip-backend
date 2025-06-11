import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import bibleRoutes from './bible';
import askRoutes from './ask';
import vectorRoutes from './vector';
import cacheRoutes from './cache';
// Import other route modules directly instead of using dynamic imports

const router = Router();

// Get the absolute path to the current directory
const apiDir = __dirname;

// Mount routes explicitly to ensure they're available immediately
router.use('/bible', bibleRoutes);
router.use('/ask', askRoutes);
router.use('/vector', vectorRoutes);
router.use('/cache', cacheRoutes);

// Function to mount additional route modules that may not be critical
async function mountAdditionalRoutes() {
  try {
    // Get all .ts files in the current directory (excluding already imported ones and index.ts)
    const files = fs.readdirSync(apiDir)
      .filter(file => {
        return file.endsWith('.ts') && 
               file !== 'index.ts' && 
               !['bible.ts', 'ask.ts', 'vector.ts', 'cache.ts'].includes(file);
      });
    
    // Dynamically import and mount each additional route module
    for (const file of files) {
      const moduleName = path.basename(file, '.ts');
      const modulePath = `./${moduleName}`;
      
      try {
        // Dynamic import
        const module = await import(modulePath);
        router.use(`/${moduleName}`, module.default);
        console.log(`Mounted additional route module: ${moduleName}`);
      } catch (error) {
        console.error(`Error loading route module ${moduleName}:`, error);
      }
    }
  } catch (error) {
    console.error('Error mounting additional route modules:', error);
  }
}

// Mount additional routes in the background
mountAdditionalRoutes().catch(err => console.error('Failed to mount additional routes:', err));

export default router;
