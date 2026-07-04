const express = require('express');

const { GROUPS, CAT_TO_GROUP } = require('../lib/taxonomy');

const router = express.Router();

// GET /api/categories — the full taxonomy, so the frontend stays in sync.
router.get('/', (req, res) => {
  res.json({ groups: GROUPS, cat_to_group: CAT_TO_GROUP });
});

module.exports = router;
