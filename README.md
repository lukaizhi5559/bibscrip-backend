# BibScrip Backend Scaffold

Includes:
- Express API
- OpenAI → Mistral → Claude → Gemini fallback
- Redis cache
- PostgreSQL session logging
- BullMQ Redis-based queue

## Usage
1. Copy `.env.example` to `.env` and configure.
2. Run Redis/PostgreSQL.
3. Install with `yarn install` or `npm install`.
4. Dev: `yarn dev`
5. Queue worker: `node dist/queues/index.js`
