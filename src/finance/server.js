const express = require('express');
const path = require('path');

const app = express();

// Shared DB handle. Routes read `req.app.locals.db` so tests can inject an
// in-memory Postgres without touching the modules.
app.locals.db = require('./db/knex');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/upload', require('./routes/upload'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/summary', require('./routes/summary'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/years', require('./routes/years'));
app.use('/api/months', require('./routes/months'));

// Health check for Railway.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Fallback — serve the dashboard for any non-API route.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Central error handler so route handlers can just `throw` / `next(err)`.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err); // don't log expected 4xx validation errors
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Running on port ${PORT}`));
}

module.exports = app;
