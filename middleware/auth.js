'use strict';

/**
 * middleware/auth.js
 *
 * Decodes the mock base64 token issued by /auth/*-login and attaches
 * req.user = { id, role } to the request.
 *
 * Token format:  "mock.<base64-json>.token"
 * Payload shape: { role, id, iat }
 *
 * When real Firebase Auth is wired in, swap decodeToken() for
 * admin.auth().verifyIdToken(token) — the middleware interface stays the same.
 */

function decodeToken(header) {
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'mock' || parts[2] !== 'token') return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * requireAuth(roles?)
 *
 * Returns an Express middleware that:
 *   1. Decodes the Bearer token from Authorization header.
 *   2. Rejects with 401 if missing/invalid.
 *   3. Rejects with 403 if the caller's role is not in the allowed list.
 *   4. Attaches req.user = { id, role } for downstream handlers.
 *
 * @param {string[]} [roles] — if omitted, any valid token is accepted
 */
function requireAuth(roles) {
  return (req, res, next) => {
    const payload = decodeToken(req.headers['authorization']);

    if (!payload || !payload.id || !payload.role) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required — provide a valid Bearer token',
      });
    }

    if (roles && roles.length > 0 && !roles.includes(payload.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied — required role: ${roles.join(' or ')}`,
      });
    }

    req.user = { id: payload.id, role: payload.role };
    next();
  };
}

module.exports = { requireAuth };
