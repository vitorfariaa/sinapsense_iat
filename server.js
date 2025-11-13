// server.js
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const morgan = require('morgan');
const multer = require('multer');
const { db, initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// middlewares
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// static
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ensure folders
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

// file upload (logos)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, '-').toLowerCase();
    const stamp = Date.now();
    cb(null, `${stamp}-${safe}`);
  }
});
const upload = multer({ storage });

// ---------- HTML PAGES ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/create', (req, res) => res.sendFile(path.join(__dirname, 'public/create.html')));
app.get('/test', (req, res) => res.sendFile(path.join(__dirname, 'public/test.html')));
app.get('/run', (req, res) => res.sendFile(path.join(__dirname, 'public/run.html')));
app.get('/panorama', (req, res) => res.sendFile(path.join(__dirname, 'public/panorama.html')));
app.get('/runs', (req, res) => res.sendFile(path.join(__dirname, 'public/runs.html')));
app.get('/run-detail', (req, res) => res.sendFile(path.join(__dirname, 'public/run_detail.html')));

// ---------- API ----------
app.post('/api/upload', upload.single('file'), (req, res) => {
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// criar teste
app.post('/api/tests', (req, res) => {
  const { name, brands, words, responseLabels } = req.body;
  if (!name || !Array.isArray(brands) || !Array.isArray(words)) {
    return res.status(400).json({ error: 'payload inválido' });
  }

  const tx = db.transaction(() => {
    const testStmt = db.prepare('INSERT INTO tests (name, created_at, response_labels) VALUES (?, CURRENT_TIMESTAMP, ?)');
    const result = testStmt.run(name, responseLabels === 'sn' ? 'sn' : 'pn');
    const testId = result.lastInsertRowid;

    const brandStmt = db.prepare('INSERT INTO brands (test_id, name, logo_url) VALUES (?, ?, ?)');
    brands.forEach(b => brandStmt.run(testId, b.name, b.logoUrl || null));

    const wordStmt = db.prepare('INSERT INTO words (test_id, text) VALUES (?, ?)');
    words.forEach(w => wordStmt.run(testId, w));

    return testId;
  });

  const testId = tx();
  res.json({ id: testId });
});

// listar testes
app.get('/api/tests', (req, res) => {
  const rows = db.prepare('SELECT id, name, created_at FROM tests ORDER BY created_at DESC').all();
  res.json(rows);
});

// detalhes do teste
app.get('/api/tests/:id', (req, res) => {
  const id = Number(req.params.id);
  const test = db.prepare(`
  SELECT id, name, created_at,
         COALESCE(response_labels, 'pn') AS response_labels
  FROM tests WHERE id = ?
  `).get(id);
  if (!test) return res.status(404).json({ error: 'teste não encontrado' });

  const brands = db.prepare('SELECT id, name, logo_url AS logoUrl FROM brands WHERE test_id = ?').all(id);
  const words = db.prepare('SELECT id, text FROM words WHERE test_id = ?').all(id);
  res.json({ ...test, brands, words });
});

// criar run (início)
app.post('/api/tests/:id/runs', (req, res) => {
  const id = Number(req.params.id);
  const { age, gender } = req.body;

  const test = db.prepare('SELECT id FROM tests WHERE id = ?').get(id);
  if (!test) return res.status(404).json({ error: 'teste não encontrado' });

  const stmt = db.prepare('INSERT INTO runs (test_id, age, gender, started_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)');
  const result = stmt.run(id, age || null, gender || null);
  res.json({ runId: result.lastInsertRowid });
});

// registrar um trial
app.post('/api/runs/:runId/trials', (req, res) => {
  const runId = Number(req.params.runId);
  const { brandId, wordId, isPositive, rtMs } = req.body;

  const run = db.prepare('SELECT id FROM runs WHERE id = ?').get(runId);
  if (!run) return res.status(404).json({ error: 'run não encontrada' });

  db.prepare(
    'INSERT INTO trials (run_id, brand_id, word_id, is_positive, rt_ms) VALUES (?, ?, ?, ?, ?)'
  ).run(runId, brandId, wordId, isPositive ? 1 : 0, Math.max(0, Math.round(rtMs || 0)));

  res.json({ ok: true });
});

// concluir run
app.post('/api/runs/:runId/complete', (req, res) => {
  const runId = Number(req.params.runId);
  const exists = db.prepare('SELECT id FROM runs WHERE id = ?').get(runId);
  if (!exists) return res.status(404).json({ error: 'run não encontrada' });

  db.prepare('UPDATE runs SET completed_at = CURRENT_TIMESTAMP WHERE id = ?').run(runId);
  res.json({ ok: true });
});

// listar runs de um teste
app.get('/api/tests/:id/runs', (req, res) => {
  const id = Number(req.params.id);
  const rows = db.prepare(`
    SELECT r.id, r.age, r.gender, r.started_at, r.completed_at,
           COUNT(t.id) AS trials
    FROM runs r
    LEFT JOIN trials t ON t.run_id = r.id
    WHERE r.test_id = ?
    GROUP BY r.id
    ORDER BY r.started_at DESC
  `).all(id);

  res.json(rows);
});

// detalhes de uma run
app.get('/api/runs/:runId', (req, res) => {
  const runId = Number(req.params.runId);
  const run = db.prepare('SELECT id, test_id, age, gender, started_at, completed_at FROM runs WHERE id = ?').get(runId);
  if (!run) return res.status(404).json({ error: 'run não encontrada' });

  const trials = db.prepare(`
    SELECT t.id, t.is_positive AS isPositive, t.rt_ms AS rtMs,
           b.id AS brandId, b.name AS brandName, b.logo_url AS brandLogoUrl,
           w.id AS wordId, w.text AS wordText
    FROM trials t
    JOIN brands b ON b.id = t.brand_id
    JOIN words w  ON w.id = t.word_id
    WHERE t.run_id = ?
    ORDER BY t.id
  `).all(runId);

  res.json({ run, trials });
});

// panorama do teste (matriz + média RT por marca)
app.get('/api/tests/:id/panorama', (req, res) => {
  const id = Number(req.params.id);

  const words = db.prepare('SELECT id, text FROM words WHERE test_id = ?').all(id);
  const brands = db.prepare('SELECT id, name FROM brands WHERE test_id = ?').all(id);

  const matrixRows = db.prepare(`
    SELECT w.id AS wordId, b.id AS brandId,
           SUM(t.is_positive) AS pos,
           COUNT(t.id) - SUM(t.is_positive) AS neg,
           COUNT(t.id) AS total
    FROM trials t
    JOIN runs r ON r.id = t.run_id
    JOIN words w ON w.id = t.word_id
    JOIN brands b ON b.id = t.brand_id
    WHERE r.test_id = ?
    GROUP BY w.id, b.id
  `).all(id);

  const avgRtRows = db.prepare(`
    SELECT b.id AS brandId, AVG(t.rt_ms) AS avgRtMs
    FROM trials t
    JOIN runs r ON r.id = t.run_id
    JOIN brands b ON b.id = t.brand_id
    WHERE r.test_id = ?
    GROUP BY b.id
  `).all(id);

  res.json({ words, brands, matrix: matrixRows, brandAvgRt: avgRtRows });
});

// exportar CSV de todas as respostas de um teste
app.get('/api/tests/:id/export.csv', (req, res) => {
  const id = Number(req.params.id);
  const test = db.prepare('SELECT id FROM tests WHERE id = ?').get(id);
  if (!test) return res.status(404).send('teste não encontrado');

  const rows = db.prepare(`
    SELECT
      r.gender  AS genero,
      r.age     AS idade,
      b.name    AS marca,
      w.text    AS palavra,
      CASE t.is_positive WHEN 1 THEN 'positivo' ELSE 'negativo' END AS resultado,
      t.rt_ms   AS tempo
    FROM trials t
    JOIN runs   r ON r.id = t.run_id
    JOIN brands b ON b.id = t.brand_id
    JOIN words  w ON w.id = t.word_id
    WHERE r.test_id = ?
    ORDER BY r.id, t.id
  `).all(id);

  const header = ['Genero', 'Idade', 'Marca', 'Palavra', 'Resultado', 'Tempo de resposta'];
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const csv = [
    header.map(esc).join(','),
    ...rows.map(r => [r.genero || '', r.idade ?? '', r.marca, r.palavra, r.resultado, r.tempo].map(esc).join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="teste-${id}-resultados.csv"`);
  res.send('\uFEFF' + csv); // BOM p/ Excel abrir direitinho em PT-BR
});

initDb();

app.listen(PORT, () => {
  console.log(`IAT app rodando em http://localhost:${PORT}`);
});
