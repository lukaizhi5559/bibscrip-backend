import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import bibleRouter from './bible';
import vectorRouter from './vector';
import cacheRouter from './cache';
import generateRouter from './generate';
import askRouter from './ask';
import youtubeRouter from './youtube';
import authRouter from './auth';
import bibliographyRouter from './bibliography';
import visualAgentRouter from './visualAgent';
import integrationRouter from './integration';
// Import other route modules directly instead of using dynamic imports

const router = Router();

// Get the absolute path to the current directory
const apiDir = __dirname;

// Mount routers
router.use('/bible', bibleRouter);
router.use('/vector', vectorRouter);
router.use('/cache', cacheRouter);
router.use('/generate', generateRouter);
router.use('/ask', askRouter);
router.use('/youtube', youtubeRouter);
router.use('/auth', authRouter);
router.use('/bibliography', bibliographyRouter);
router.use('/visual-agent', visualAgentRouter);
router.use('/integration', integrationRouter);

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
