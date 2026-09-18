// src/auth.js
// Passwort-Hashing (Node-eigenes crypto.scrypt, kein externes Paket) und
// einfache, serverseitige Sessions über ein zufälliges Cookie-Token.

const crypto = require('crypto');
const store = require('./store');

const SCRYPT_KEYLEN = 64;
const SESSION_COOKIE = 'soul_session';
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7; // 7 Tage

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(expectedHash, 'hex');
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, passwordSalt, ...rest } = user;
  return rest;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_S}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(token, userId);
  setSessionCookie(res, token);
  return token;
}

function currentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  const userId = store.getSessionUserId(token);
  if (!userId) return { user: null, token };
  const user = store.findUserById(userId);
  return { user, token };
}

module.exports = {
  hashPassword,
  verifyPassword,
  publicUser,
  parseCookies,
  startSession,
  currentUser,
  clearSessionCookie,
  SESSION_COOKIE,
};
