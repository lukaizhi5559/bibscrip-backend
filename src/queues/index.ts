import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');

export const llmQueue = new Queue('llmQueue', { connection });

export const worker = new Worker('llmQueue', async job => {
  console.log('Processing job:', job.name);
}, { connection });
