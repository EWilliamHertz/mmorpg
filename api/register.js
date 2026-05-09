const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_cOps6JPUzS0g@ep-empty-cell-aq1rjlpj-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const JWT_SECRET = process.env.JWT_SECRET || 'realmscape_jwt_secret_key_2024_secure';

async function initTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(20) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS characters (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      xp JSONB DEFAULT '{}',
      inventory JSONB DEFAULT '[]',
      equipment JSONB DEFAULT '{}',
      pos_x INTEGER DEFAULT 32,
      pos_y INTEGER DEFAULT 32,
      hp INTEGER DEFAULT 10,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3–20 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Only letters, numbers, and underscores allowed' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await initTables(client);

    const existing = await client.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 10);
    const result = await client.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
      [username, hash]
    );
    const userId = result.rows[0].id;

    // Default starting character
    const defaultXp = { attack:0, strength:0, defence:0, hitpoints:1154, woodcutting:0, mining:0, fishing:0, cooking:0, prayer:0 };
    const defaultInv = [
      { id: 'bronze_sword', c: 1 },
      { id: 'bronze_shield', c: 1 },
      { id: 'bread', c: 5 },
      null, null, null, null, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null, null, null, null, null,
      null, null, null
    ];
    const defaultEq = { weapon: null, shield: null, head: null, body: null, legs: null };

    await client.query(
      'INSERT INTO characters (user_id, xp, inventory, equipment, pos_x, pos_y, hp) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [userId, JSON.stringify(defaultXp), JSON.stringify(defaultInv), JSON.stringify(defaultEq), 32, 32, 10]
    );

    const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '30d' });
    return res.status(200).json({ token, username });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  } finally {
    await client.end();
  }
};
