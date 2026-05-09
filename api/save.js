const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_cOps6JPUzS0g@ep-empty-cell-aq1rjlpj-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const JWT_SECRET = process.env.JWT_SECRET || 'realmscape_jwt_secret_key_2024_secure';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { xp, inventory, equipment, pos_x, pos_y, hp } = req.body || {};
  if (!xp || !inventory || !equipment) return res.status(400).json({ error: 'Missing character data' });

  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(
      `UPDATE characters SET xp=$1, inventory=$2, equipment=$3, pos_x=$4, pos_y=$5, hp=$6, updated_at=NOW()
       WHERE user_id=$7`,
      [JSON.stringify(xp), JSON.stringify(inventory), JSON.stringify(equipment),
       pos_x || 32, pos_y || 32, hp || 10, decoded.userId]
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Save error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  } finally {
    await client.end();
  }
};
