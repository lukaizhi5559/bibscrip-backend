import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import vectorRoutes from './vector'; // Import vector routes explicitly

const router = Router();

// Get the absolute path to the current directory
const apiDir = __dirname;

// Function to mount all route modules
async function mountRoutes() {
  try {
    // Get all .ts files in the current directory (except index.ts)
    const files = fs.readdirSync(apiDir)
      .filter(file => file.endsWith('.ts') && file !== 'index.ts');
    
    // Dynamically import and mount each route module
    for (const file of files) {
      const moduleName = path.basename(file, '.ts');
      const modulePath = `./${moduleName}`;
      
      try {
        // Dynamic import
        const module = await import(modulePath);
        router.use(`/${moduleName}`, module.default);
        console.log(`Mounted route module: ${moduleName}`);
      } catch (error) {
        console.error(`Error loading route module ${moduleName}:`, error);
      }
    }
  } catch (error) {
    console.error('Error mounting route modules:', error);
  }
}

// Mount all routes
mountRoutes();

// Explicitly mount vector routes
router.use('/vector', vectorRoutes);
console.log('Explicitly mounted vector route module');

export default router;
