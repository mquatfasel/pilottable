// src/server.js
// PilotTable – Login, Benutzerverwaltung, Abo-Modelle.
// Reines Node.js (http, crypto, fs) – keine externen Pakete, kein npm install nötig.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const auth = require('./auth');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB Schutz gegen zu große Requests

const ROLLEN = [
  'Geschäftsleitung',
  'Küchenchef / Souschef',
  'Serviceleitung',
  'Einkauf',
  'HACCP-Verantwortlicher',
  'Administrator',
  'Mitarbeiter Küche / Service',
];
const PLAENE = ['basic', 'professional', 'enterprise'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Anfrage zu groß'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('Ungültiges JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- API-Handler ----------

async function handleRegister(req, res) {
  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const name = String(body.name || '').trim();
  const betrieb = String(body.betrieb || '').trim();
  const rolle = String(body.rolle || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!name || !betrieb || !rolle || !email || !password) {
    return sendJSON(res, 400, { error: 'Bitte alle Felder ausfüllen.' });
  }
  if (!isValidEmail(email)) {
    return sendJSON(res, 400, { error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
  }
  if (password.length < 8) {
    return sendJSON(res, 400, { error: 'Das Passwort muss mindestens 8 Zeichen haben.' });
  }
  if (!ROLLEN.includes(rolle)) {
    return sendJSON(res, 400, { error: 'Ungültige Rolle.' });
  }

  const { salt, hash } = auth.hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    name,
    betrieb,
    rolle,
    email,
    passwordSalt: salt,
    passwordHash: hash,
    plan: null,
    planRequested: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await store.insertUser(user);
  } catch (e) {
    if (e.code === 'EMAIL_TAKEN') {
      return sendJSON(res, 409, { error: 'Für diese E-Mail existiert bereits ein Konto.' });
    }
    return sendJSON(res, 500, { error: 'Konto konnte nicht angelegt werden.' });
  }

  await auth.startSession(res, user.id);
  return sendJSON(res, 201, { user: auth.publicUser(user) });
}

async function handleLogin(req, res) {
  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) {
    return sendJSON(res, 400, { error: 'Bitte E-Mail und Passwort angeben.' });
  }

  const user = store.findUserByEmail(email);
  if (!user || !auth.verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    // Bewusst dieselbe Fehlermeldung für "unbekannt" und "falsches Passwort",
    // damit sich nicht erraten lässt, welche E-Mails registriert sind.
    return sendJSON(res, 401, { error: 'E-Mail oder Passwort ist falsch.' });
  }

  await auth.startSession(res, user.id);
  return sendJSON(res, 200, { user: auth.publicUser(user) });
}

async function handleLogout(req, res) {
  const { token } = auth.currentUser(req);
  if (token) await store.destroySession(token);
  auth.clearSessionCookie(res);
  return sendJSON(res, 200, { ok: true });
}

function handleMe(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });
  return sendJSON(res, 200, { user: auth.publicUser(user) });
}

async function handlePlan(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });

  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const plan = String(body.plan || '');
  if (!PLAENE.includes(plan)) {
    return sendJSON(res, 400, { error: 'Ungültiger Plan.' });
  }
  const planRequested = plan === 'enterprise' && body.requestSales !== false;

  const updated = await store.updateUser(user.id, { plan, planRequested });
  return sendJSON(res, 200, { user: auth.publicUser(updated) });
}

// ---------- statische Dateien ----------

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // Pfad-Traversal verhindern (z.B. "/../../etc/passwd")
  const safePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(400);
    return res.end('Ungültiger Pfad');
  }

  fs.readFile(safePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Nicht gefunden');
      }
      res.writeHead(500);
      return res.end('Serverfehler');
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- Router ----------

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  try {
    if (urlPath === '/api/auth/register' && req.method === 'POST') return void handleRegister(req, res);
    if (urlPath === '/api/auth/login' && req.method === 'POST') return void handleLogin(req, res);
    if (urlPath === '/api/auth/logout' && req.method === 'POST') return void handleLogout(req, res);
    if (urlPath === '/api/auth/me' && req.method === 'GET') return void handleMe(req, res);
    if (urlPath === '/api/plan' && req.method === 'POST') return void handlePlan(req, res);

    if (urlPath.startsWith('/api/')) {
      return sendJSON(res, 404, { error: 'Unbekannter Endpunkt.' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);

    res.writeHead(405);
    res.end('Methode nicht erlaubt');
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: 'Unerwarteter Serverfehler.' });
  }
});

server.listen(PORT, () => {
  console.log(`PilotTable läuft auf http://localhost:${PORT}`);
});
