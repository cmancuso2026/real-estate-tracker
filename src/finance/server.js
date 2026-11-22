import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { createFinanceKnex } from './db/connection.js';
import uploadRouter from './routes/upload.js';
import transactionsRouter from './routes/transactions.js';
import summaryRouter from './routes/summary.js';
import categoriesRouter from './routes/categories.js';
import yearsRouter from './routes/years.js';
import monthsRouter from './routes/months.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The legacy dashboard stays in finance/public until the Phase 4 React rebuild.
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'finance', 'public');

const app = express();

// Shared DB handle. Routes read `req.app.locals.db` so tests can inject an
// in-memory Postgres without touching the modules.
app.locals.db = process.env.DATABASE_URL ? createFinanceKnex() : null;

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.use('/api/upload', uploadRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/summary', summaryRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/years', yearsRouter);
app.use('/api/months', monthsRouter);

// Health check for Railway.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Fallback — serve the dashboard for any non-API route.
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Central error handler so route handlers can just `throw` / `next(err)`.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err); // don't log expected 4xx validation errors
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => console.log(`Running on port ${PORT}`));
}

export default app;
