const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_cOps6JPUzS0g@ep-empty-cell-aq1rjlpj-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const JWT_SECRET = process.env.JWT_SECRET || 'realmscape_jwt_secret_key_2024_secure';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const result = await client.query(
      'SELECT xp, inventory, equipment, pos_x, pos_y, hp FROM characters WHERE user_id=$1',
      [decoded.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Character not found' });
    const row = result.rows[0];
    return res.status(200).json({
      xp: row.xp,
      inventory: row.inventory,
      equipment: row.equipment,
      pos_x: row.pos_x,
      pos_y: row.pos_y,
      hp: row.hp,
      username: decoded.username
    });
  } catch (err) {
    console.error('Load error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  } finally {
    await client.end();
  }
};
