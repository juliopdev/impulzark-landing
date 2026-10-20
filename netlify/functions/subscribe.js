const { MongoClient } = require('mongodb');

const MAX_EMAIL  = 254;
const MAX_NOMBRE = 100;

// Simple sanitizer: strip control chars and HTML-like content
function sanitize(str, maxLen) {
  return str
    .replace(/[\x00-\x1F\x7F]/g, '') // control characters
    .replace(/[<>]/g, '')              // angle brackets
    .trim()
    .slice(0, maxLen);
}

let client = null;

async function getCollection() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set');
  }
  try {
    if (!client) {
      client = new MongoClient(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS:         10000,
        socketTimeoutMS:          10000,
      });
      await client.connect();
    }
    return client.db().collection('waitlist');
  } catch (err) {
    client = null; // reset so next invocation retries
    throw err;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid_json' }),
    };
  }

  // Sanitize and validate inputs
  const rawEmail  = sanitize(String(body.email  || ''), MAX_EMAIL).toLowerCase();
  const rawNombre = sanitize(String(body.nombre || ''), MAX_NOMBRE) || null;

  if (!rawEmail || rawEmail.length > MAX_EMAIL) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid_email' }),
    };
  }

  // RFC 5322-compatible basic check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid_email' }),
    };
  }

  try {
    const col = await getCollection();

    const existing = await col.findOne({ email: rawEmail });
    if (existing) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'already_exists' }),
      };
    }

    await col.insertOne({
      email:       rawEmail,
      nombre:      rawNombre,
      precio_visto: 'S/19.90/mes',
      ts:          new Date(),
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('subscribe error', err.message);
    const isTimeout = err.message?.includes('timed out') || err.message?.includes('MONGODB_URI');
    return {
      statusCode: isTimeout ? 503 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: isTimeout ? 'service_unavailable' : 'server_error' }),
    };
  }
};
