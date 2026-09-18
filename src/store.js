// src/store.js
// Sehr einfache, dateibasierte Datenhaltung (JSON) — kein externes Paket nötig.
// Für den produktiven Einsatz mit mehreren Standorten empfiehlt sich der Umstieg
// auf eine echte Datenbank (Postgres o.ä.), siehe README.md, Abschnitt "Nächste Schritte".

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}', 'utf8');
}

// Ein simpler In-Process-"Write-Lock": verhindert, dass zwei fast gleichzeitige
// Requests sich beim Schreiben der JSON-Datei gegenseitig überschreiben.
let writeQueue = Promise.resolve();
function serialize(fn) {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

function readJSON(file) {
  ensureDataFiles();
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw || 'null');
  } catch (e) {
    throw new Error(`Datendatei ${file} ist beschädigt: ${e.message}`);
  }
}

function writeJSON(file, data) {
  return serialize(() => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  });
}

// ---------- users ----------
function getUsers() {
  return readJSON(USERS_FILE) || [];
}

function saveUsers(users) {
  return writeJSON(USERS_FILE, users);
}

function findUserByEmail(email) {
  const users = getUsers();
  const normalized = String(email || '').trim().toLowerCase();
  return users.find((u) => u.email === normalized) || null;
}

function findUserById(id) {
  const users = getUsers();
  return users.find((u) => u.id === id) || null;
}

function findUserByStripeCustomerId(customerId) {
  if (!customerId) return null;
  const users = getUsers();
  return users.find((u) => u.stripeCustomerId === customerId) || null;
}

async function insertUser(user) {
  const users = getUsers();
  if (users.some((u) => u.email === user.email)) {
    const err = new Error('E-Mail bereits registriert');
    err.code = 'EMAIL_TAKEN';
    throw err;
  }
  users.push(user);
  await saveUsers(users);
  return user;
}

async function updateUser(id, patch) {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) {
    const err = new Error('Benutzer nicht gefunden');
    err.code = 'NOT_FOUND';
    throw err;
  }
  users[idx] = { ...users[idx], ...patch, updatedAt: new Date().toISOString() };
  await saveUsers(users);
  return users[idx];
}

// ---------- sessions ----------
function getSessions() {
  return readJSON(SESSIONS_FILE) || {};
}

async function createSession(token, userId) {
  const sessions = getSessions();
  sessions[token] = { userId, createdAt: new Date().toISOString() };
  await writeJSON(SESSIONS_FILE, sessions);
}

function getSessionUserId(token) {
  if (!token) return null;
  const sessions = getSessions();
  const s = sessions[token];
  return s ? s.userId : null;
}

async function destroySession(token) {
  const sessions = getSessions();
  if (sessions[token]) {
    delete sessions[token];
    await writeJSON(SESSIONS_FILE, sessions);
  }
}

module.exports = {
  getUsers,
  findUserByEmail,
  findUserById,
  findUserByStripeCustomerId,
  insertUser,
  updateUser,
  createSession,
  getSessionUserId,
  destroySession,
};
