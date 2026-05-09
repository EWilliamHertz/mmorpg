const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => res.json({ status: 'RealmScape server running' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'realmscape-secret-2024';
const PORT = process.env.PORT || 3001;
const TICK_RATE = 600; // ms per game tick

// ─── World Data ──────────────────────────────────────────────────────────────
const MAP_W = 60, MAP_H = 60;

const TILE = { GRASS: 0, WATER: 1, WALL: 2, SAND: 3, PATH: 4, DIRT: 5 };
const OBJ  = { NONE: 0, TREE: 1, ROCK: 2, FISH: 3, DEPOSIT: 4, CHEST: 5 };

function generateMap() {
  const tiles = [];
  const objects = [];
  for (let y = 0; y < MAP_H; y++) {
    tiles[y] = [];
    objects[y] = [];
    for (let x = 0; x < MAP_W; x++) {
      tiles[y][x] = TILE.GRASS;
      objects[y][x] = OBJ.NONE;
    }
  }
  // Water border
  for (let x = 0; x < MAP_W; x++) { tiles[0][x] = TILE.WATER; tiles[MAP_H-1][x] = TILE.WATER; }
  for (let y = 0; y < MAP_H; y++) { tiles[y][0] = TILE.WATER; tiles[y][MAP_W-1] = TILE.WATER; }

  // Lake SE
  for (let y = 38; y < 48; y++) for (let x = 38; x < 50; x++) tiles[y][x] = TILE.WATER;

  // Town paths
  for (let x = 20; x < 40; x++) { tiles[28][x] = TILE.PATH; tiles[32][x] = TILE.PATH; }
  for (let y = 24; y < 36; y++) { tiles[y][28] = TILE.PATH; tiles[y][32] = TILE.PATH; }

  // Sand zone
  for (let y = 44; y < 55; y++) for (let x = 2; x < 15; x++) tiles[y][x] = TILE.SAND;

  // Forest SW
  for (let y = 35; y < 55; y++) for (let x = 2; x < 20; x++)
    if (tiles[y][x] === TILE.GRASS && Math.random() < 0.35) objects[y][x] = OBJ.TREE;

  // Mine NE
  for (let y = 2; y < 18; y++) for (let x = 42; x < 58; x++) {
    tiles[y][x] = TILE.DIRT;
    if (Math.random() < 0.25) objects[y][x] = OBJ.ROCK;
  }

  // Fishing spots along lake edge
  const fishSpots = [[37,42],[37,44],[37,46],[48,42],[48,44]];
  fishSpots.forEach(([y,x]) => { if (tiles[y][x] === TILE.GRASS) objects[y][x] = OBJ.FISH; });

  return { tiles, objects };
}

const worldMap = generateMap();

// Respawn timers for resources (key = "y,x", value = tick count)
const resourceRespawn = {};

// ─── NPC Data ────────────────────────────────────────────────────────────────
const NPC_DEFS = {
  chicken:  { name: 'Chicken',     hp: 3,  maxHp: 3,  atk: 1,  def: 0,  xp: 12,  drops: [{id:'raw_chicken',chance:0.9},{id:'feather',chance:0.8,qty:5}]},
  cow:      { name: 'Cow',         hp: 8,  maxHp: 8,  atk: 1,  def: 1,  xp: 18,  drops: [{id:'raw_beef',chance:0.9},{id:'cowhide',chance:0.9}]},
  goblin:   { name: 'Goblin',      hp: 5,  maxHp: 5,  atk: 2,  def: 1,  xp: 25,  drops: [{id:'coins',chance:0.7,qty:3},{id:'bronze_sword',chance:0.1}]},
  guard:    { name: 'Guard',       hp: 25, maxHp: 25, atk: 6,  def: 5,  xp: 58,  drops: [{id:'coins',chance:0.8,qty:10}]},
  spider:   { name: 'Giant Spider',hp: 12, maxHp: 12, atk: 4,  def: 2,  xp: 40,  drops: [{id:'spider_silk',chance:0.7}]},
  skeleton: { name: 'Skeleton',    hp: 20, maxHp: 20, atk: 7,  def: 4,  xp: 55,  drops: [{id:'bones',chance:1},{id:'iron_sword',chance:0.1}]},
};

let npcIdCounter = 1;
const npcs = {};

function spawnNPC(type, x, y) {
  const def = NPC_DEFS[type];
  const id = `npc_${npcIdCounter++}`;
  npcs[id] = { id, type, ...JSON.parse(JSON.stringify(def)), x, y, spawnX: x, spawnY: y, target: null, lastMove: 0 };
  return id;
}

// Spawn NPCs
const npcSpawnList = [
  // Chickens & cows (farm area)
  ...Array.from({length:8}, (_,i) => ({type:'chicken', x:22+i%4, y:22+Math.floor(i/4)})),
  ...Array.from({length:4}, (_,i) => ({type:'cow',     x:26+i%2, y:22+Math.floor(i/2)})),
  // Goblins (NW)
  ...Array.from({length:6}, (_,i) => ({type:'goblin',  x:5+i%3,  y:5+Math.floor(i/3)})),
  // Guards (town)
  {type:'guard', x:30, y:26}, {type:'guard', x:30, y:34},
  // Spiders
  ...Array.from({length:4}, (_,i) => ({type:'spider',  x:8+i%2,  y:12+Math.floor(i/2)})),
  // Skeletons
  ...Array.from({length:4}, (_,i) => ({type:'skeleton',x:50+i%2, y:30+Math.floor(i/2)})),
];
npcSpawnList.forEach(({type,x,y}) => spawnNPC(type,x,y));

// ─── Ground Items ─────────────────────────────────────────────────────────────
let groundItemId = 1;
const groundItems = {}; // id -> {id,x,y,item,qty,despawnTick}

function dropItem(x, y, itemId, qty=1) {
  const id = `gi_${groundItemId++}`;
  groundItems[id] = { id, x, y, item: itemId, qty, despawnTick: gameTick + 300 };
}

// ─── Duel Arena ──────────────────────────────────────────────────────────────
const duels = {};       // duelId -> { p1, p2, state:'pending'|'active'|'done', hp1, hp2, stake1, stake2 }
let duelIdCounter = 1;

// ─── Trade System ─────────────────────────────────────────────────────────────
const trades = {};      // tradeId -> { p1, p2, offer1, offer2, confirmed1, confirmed2 }
let tradeIdCounter = 1;

// ─── Player State ─────────────────────────────────────────────────────────────
const players = {};     // socketId -> player object

// ─── DB Helpers ───────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(20) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS characters (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) UNIQUE,
      username VARCHAR(20),
      x INTEGER DEFAULT 30, y INTEGER DEFAULT 30,
      hp INTEGER DEFAULT 10, max_hp INTEGER DEFAULT 10,
      skills JSONB DEFAULT '{}',
      inventory JSONB DEFAULT '[]',
      equipment JSONB DEFAULT '{}',
      combat_style VARCHAR(10) DEFAULT 'balanced',
      coins INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('DB ready');
}

async function loadCharacter(userId, username) {
  const r = await pool.query('SELECT * FROM characters WHERE user_id=$1', [userId]);
  if (r.rows.length === 0) {
    const def = defaultCharacter(username);
    await pool.query(
      `INSERT INTO characters (user_id,username,x,y,hp,max_hp,skills,inventory,equipment,combat_style,coins)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [userId, username, def.x, def.y, def.hp, def.maxHp,
       JSON.stringify(def.skills), JSON.stringify(def.inventory),
       JSON.stringify(def.equipment), def.combatStyle, def.coins]
    );
    return def;
  }
  const c = r.rows[0];
  return {
    username: c.username, x: c.x, y: c.y, hp: c.hp, maxHp: c.max_hp,
    skills: c.skills, inventory: c.inventory, equipment: c.equipment,
    combatStyle: c.combat_style, coins: c.coins
  };
}

async function saveCharacter(userId, char) {
  await pool.query(
    `UPDATE characters SET x=$1,y=$2,hp=$3,max_hp=$4,skills=$5,inventory=$6,equipment=$7,combat_style=$8,coins=$9,updated_at=NOW()
     WHERE user_id=$10`,
    [char.x, char.y, char.hp, char.maxHp,
     JSON.stringify(char.skills), JSON.stringify(char.inventory),
     JSON.stringify(char.equipment), char.combatStyle, char.coins, userId]
  );
}

function defaultCharacter(username) {
  return {
    username,
    x: 30, y: 30,
    hp: 10, maxHp: 10,
    skills: {
      attack:      {level:1, xp:0},
      strength:    {level:1, xp:0},
      defence:     {level:1, xp:0},
      hitpoints:   {level:10,xp:1154},
      prayer:      {level:1, xp:0},
      magic:       {level:1, xp:0},
      ranged:      {level:1, xp:0},
      woodcutting: {level:1, xp:0},
      mining:      {level:1, xp:0},
      fishing:     {level:1, xp:0},
      cooking:     {level:1, xp:0},
      firemaking:  {level:1, xp:0},
    },
    inventory: [
      {id:'bronze_sword',name:'Bronze Sword',type:'weapon',atk:5,stackable:false},
      {id:'bronze_shield',name:'Bronze Shield',type:'offhand',def:3,stackable:false},
      {id:'bread',name:'Bread',type:'food',heal:5,stackable:true,qty:3},
    ],
    equipment: {},
    combatStyle: 'balanced',
    coins: 0
  };
}

// ─── XP Table ─────────────────────────────────────────────────────────────────
const XP_TABLE = [0,0,83,174,276,388,512,650,801,969,1154,1358,1584,1833,2107,2411,2746,3115,3523,3973,4470,5018,5624,6291,7028,7842,8740,9730,10824,12031,13363,14833,16456,18247,20224,22406,24815,27473,30408,33648,37224,41171,45529,50339,55649,61512,67983,75127,83014,91721,101333,112022,123826,136594,150872,166636,184040,203254,224466,247886,273742,302288,333804,368599,407015,449428,496254,547953,605032,667457,736931,812912,896961,988677,1089106,1200533,1323761,1459952,1610762,1777159,1961563,2167453,2395918,2649503,2930199,3240485,3581502,3954502,4362471,4808317,5294991,5826150,6404567,7035550,7723641,8474474,9296014,10192540,11168665];

function xpForLevel(lvl) { return XP_TABLE[Math.min(lvl, 98)] || 0; }
function levelForXp(xp) {
  for (let l = 98; l >= 1; l--) if (xp >= XP_TABLE[l]) return l;
  return 1;
}
function addXp(char, skill, amount) {
  if (!char.skills[skill]) return;
  char.skills[skill].xp += amount;
  const newLevel = levelForXp(char.skills[skill].xp);
  if (newLevel > char.skills[skill].level) {
    char.skills[skill].level = newLevel;
    if (skill === 'hitpoints') { char.maxHp = 10 + (newLevel - 10) * 2; }
    return { levelUp: true, skill, level: newLevel };
  }
  return null;
}

// ─── Combat Helpers ───────────────────────────────────────────────────────────
function rollDamage(atk, def) {
  const hit = Math.random() < (atk / (atk + def + 1));
  return hit ? Math.ceil(Math.random() * atk) : 0;
}

// ─── Pathfinding (BFS) ───────────────────────────────────────────────────────
function isWalkable(x, y, ignoreObjects=false) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  if (worldMap.tiles[y][x] === TILE.WATER || worldMap.tiles[y][x] === TILE.WALL) return false;
  if (!ignoreObjects && worldMap.objects[y][x] !== OBJ.NONE) return false;
  return true;
}

function bfs(sx, sy, tx, ty, maxSteps=20) {
  if (sx===tx && sy===ty) return [];
  const q = [[sx,sy,[]]];
  const visited = new Set([`${sx},${sy}`]);
  while (q.length) {
    const [cx,cy,path] = q.shift();
    if (path.length >= maxSteps) continue;
    for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx=cx+dx, ny=cy+dy;
      const key=`${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const newPath=[...path,{x:nx,y:ny}];
      if (nx===tx && ny===ty) return newPath;
      if (isWalkable(nx,ny)) q.push([nx,ny,newPath]);
    }
  }
  return null;
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
let gameTick = 0;

setInterval(() => {
  gameTick++;
  const updates = {};

  // Move players along their paths
  for (const [sid, p] of Object.entries(players)) {
    if (!p.path || p.path.length === 0) continue;
    if (p.inCombat || p.gathering) continue;
    const next = p.path[0];
    if (isWalkable(next.x, next.y, true)) {
      p.x = next.x; p.y = next.y;
      p.path.shift();
    } else {
      p.path = [];
    }
    updates[sid] = { x: p.x, y: p.y };
  }

  // NPC AI
  for (const [nid, npc] of Object.entries(npcs)) {
    if (npc.hp <= 0) continue;

    // Find nearby player to aggro (within 5 tiles)
    if (!npc.target) {
      for (const p of Object.values(players)) {
        const dist = Math.abs(p.x-npc.x)+Math.abs(p.y-npc.y);
        if (dist <= 5) { npc.target = p.socketId; break; }
      }
    }

    if (npc.target) {
      const tp = players[npc.target];
      if (!tp) { npc.target = null; continue; }
      const dist = Math.abs(tp.x-npc.x)+Math.abs(tp.y-npc.y);
      if (dist > 10) { npc.target = null; continue; }

      if (dist === 1) {
        // Attack player
        const dmg = rollDamage(NPC_DEFS[npc.type].atk, (tp.skills?.defence?.level||1));
        tp.hp = Math.max(0, tp.hp - dmg);
        if (dmg > 0) io.to(tp.socketId).emit('damage', { source: nid, amount: dmg, hp: tp.hp });
        if (tp.hp <= 0) handlePlayerDeath(tp);
      } else {
        // Move toward player
        const path = bfs(npc.x, npc.y, tp.x, tp.y, 1);
        if (path && path.length > 0) { npc.x = path[0].x; npc.y = path[0].y; }
      }
    } else {
      // Wander
      if (gameTick % 3 === 0) {
        const dx = Math.floor(Math.random()*3)-1;
        const dy = Math.floor(Math.random()*3)-1;
        const nx = npc.x+dx, ny = npc.y+dy;
        const spawnDist = Math.abs(nx-npc.spawnX)+Math.abs(ny-npc.spawnY);
        if (spawnDist <= 5 && isWalkable(nx,ny)) { npc.x=nx; npc.y=ny; }
      }
    }
  }

  // Process player combat (player attacking NPC)
  for (const p of Object.values(players)) {
    if (!p.inCombat || !p.combatTarget) continue;
    const npc = npcs[p.combatTarget];
    if (!npc || npc.hp <= 0) { p.inCombat = false; p.combatTarget = null; continue; }

    const dist = Math.abs(p.x-npc.x)+Math.abs(p.y-npc.y);
    if (dist > 1) {
      // Move toward NPC
      const path = bfs(p.x, p.y, npc.x, npc.y, 1);
      if (path && path.length > 0) { p.x=path[0].x; p.y=path[0].y; }
      continue;
    }

    // Hit
    const atkLevel = p.skills?.attack?.level||1;
    const strLevel = p.skills?.strength?.level||1;
    const wpn = p.equipment?.weapon;
    const atkBonus = wpn ? (wpn.atk||0) : 0;
    const dmg = rollDamage(atkLevel+atkBonus, npc.def||0);
    npc.hp -= dmg;

    // XP
    const lu = addXp(p, 'attack', Math.floor(dmg*4));
    addXp(p, 'strength', Math.floor(dmg*4));
    addXp(p, 'hitpoints', Math.floor(dmg*1.33));

    io.to(p.socketId).emit('combatHit', { targetId: p.combatTarget, damage: dmg, npcHp: npc.hp, npcMaxHp: npc.maxHp, levelUp: lu });

    if (npc.hp <= 0) {
      handleNPCDeath(npc, p);
      p.inCombat = false;
      p.combatTarget = null;
    }
  }

  // Duel combat
  for (const [did, duel] of Object.entries(duels)) {
    if (duel.state !== 'active') continue;
    const p1 = players[duel.p1], p2 = players[duel.p2];
    if (!p1 || !p2) { duel.state = 'done'; continue; }

    const dmg1 = rollDamage(p1.skills?.attack?.level||1, p2.skills?.defence?.level||1);
    const dmg2 = rollDamage(p2.skills?.attack?.level||1, p1.skills?.defence?.level||1);
    duel.hp1 = Math.max(0, duel.hp1 - dmg2);
    duel.hp2 = Math.max(0, duel.hp2 - dmg1);

    io.to(duel.p1).emit('duelHit', { myHp: duel.hp1, oppHp: duel.hp2, dmgTaken: dmg2, dmgDealt: dmg1 });
    io.to(duel.p2).emit('duelHit', { myHp: duel.hp2, oppHp: duel.hp1, dmgTaken: dmg1, dmgDealt: dmg2 });

    if (duel.hp1 <= 0 || duel.hp2 <= 0) {
      const winner = duel.hp1 > 0 ? duel.p1 : duel.p2;
      const loser  = duel.hp1 > 0 ? duel.p2 : duel.p1;
      duel.state = 'done';
      // Transfer stakes
      if (duel.stake1 && players[winner]) { players[winner].coins = (players[winner].coins||0) + (duel.stake1||0) + (duel.stake2||0); }
      io.to(winner).emit('duelResult', { won: true,  coins: (duel.stake1||0)+(duel.stake2||0) });
      io.to(loser).emit('duelResult',  { won: false, coins: 0 });
      delete duels[did];
    }
  }

  // Respawn resources
  for (const [key, tick] of Object.entries(resourceRespawn)) {
    if (gameTick >= tick) {
      const [y,x] = key.split(',').map(Number);
      const orig = worldMap._originalObjects?.[y]?.[x];
      if (orig) worldMap.objects[y][x] = orig;
      delete resourceRespawn[key];
    }
  }
  // Save original objects map
  if (!worldMap._originalObjects) {
    worldMap._originalObjects = worldMap.objects.map(r => [...r]);
  }

  // Despawn ground items
  for (const [id, gi] of Object.entries(groundItems)) {
    if (gameTick >= gi.despawnTick) {
      delete groundItems[id];
      io.emit('groundItemRemoved', id);
    }
  }

  // Broadcast world state every tick
  const worldState = {
    tick: gameTick,
    players: Object.values(players).map(p => ({
      socketId: p.socketId, username: p.username, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp,
      combatLevel: calcCombatLevel(p.skills)
    })),
    npcs: Object.values(npcs).filter(n => n.hp > 0).map(n => ({
      id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, hp: n.hp, maxHp: n.maxHp
    })),
    groundItems: Object.values(groundItems)
  };
  io.emit('worldState', worldState);

}, TICK_RATE);

function calcCombatLevel(skills) {
  if (!skills) return 3;
  const atk = skills.attack?.level||1, str = skills.strength?.level||1;
  const def = skills.defence?.level||1, hp = skills.hitpoints?.level||10;
  return Math.floor((def+hp)/4 + (atk+str)*0.325);
}

function handleNPCDeath(npc, killer) {
  // Drop items
  const def = NPC_DEFS[npc.type];
  def.drops.forEach(drop => {
    if (Math.random() < drop.chance) {
      dropItem(npc.x, npc.y, drop.id, drop.qty||1);
    }
  });
  // Always drop bones
  dropItem(npc.x, npc.y, 'bones', 1);

  io.emit('npcDied', { id: npc.id });

  // Respawn after 30 ticks
  setTimeout(() => {
    npc.hp = npc.maxHp;
    npc.x = npc.spawnX; npc.y = npc.spawnY;
    npc.target = null;
  }, 30 * TICK_RATE);
}

function handlePlayerDeath(p) {
  p.hp = p.maxHp;
  p.x = 30; p.y = 30;
  p.inCombat = false; p.combatTarget = null; p.path = [];
  // Drop half inventory
  const keep = p.inventory.slice(0, Math.ceil(p.inventory.length/2));
  const drop = p.inventory.slice(Math.ceil(p.inventory.length/2));
  drop.forEach(item => dropItem(p.x, p.y, item.id, item.qty||1));
  p.inventory = keep;
  io.to(p.socketId).emit('died', { x: p.x, y: p.y, inventory: p.inventory });
}

// ─── REST: Auth ───────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query('INSERT INTO users (username,password_hash) VALUES ($1,$2) RETURNING id', [username, hash]);
    const token = jwt.sign({ userId: r.rows[0].id, username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username taken' });
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: r.rows[0].id, username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    socket.username = decoded.username;
    next();
  } catch { next(new Error('Invalid token')); }
});

io.on('connection', async (socket) => {
  console.log(`${socket.username} connected`);

  // Load character
  const char = await loadCharacter(socket.userId, socket.username);
  const player = {
    socketId: socket.id,
    userId: socket.userId,
    username: socket.username,
    ...char,
    path: [],
    inCombat: false,
    combatTarget: null,
    gathering: false,
    gatherTick: 0,
    gatherTarget: null,
  };
  players[socket.id] = player;

  // Send initial state to this player
  socket.emit('init', {
    player,
    map: { tiles: worldMap.tiles, objects: worldMap.objects, w: MAP_W, h: MAP_H },
    npcs: Object.values(npcs),
    groundItems: Object.values(groundItems),
    otherPlayers: Object.values(players).filter(p => p.socketId !== socket.id).map(p => ({
      socketId: p.socketId, username: p.username, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp
    }))
  });

  // Notify others
  socket.broadcast.emit('playerJoined', { socketId: socket.id, username: socket.username, x: player.x, y: player.y, hp: player.hp, maxHp: player.maxHp });

  // ── Actions ──
  socket.on('move', ({ x, y }) => {
    const p = players[socket.id];
    if (!p || p.inCombat || p.gathering) return;
    const path = bfs(p.x, p.y, x, y, 30);
    if (path) p.path = path;
  });

  socket.on('attackNPC', ({ npcId }) => {
    const p = players[socket.id];
    const npc = npcs[npcId];
    if (!p || !npc || npc.hp <= 0) return;
    p.path = [];
    p.inCombat = true;
    p.combatTarget = npcId;
    npc.target = socket.id;
  });

  socket.on('gather', ({ x, y }) => {
    const p = players[socket.id];
    if (!p) return;
    const obj = worldMap.objects[y]?.[x];
    if (obj === OBJ.NONE) return;

    // Walk adjacent then gather
    const adjPath = bfs(p.x, p.y, x-1, y, 5) || bfs(p.x, p.y, x+1, y, 5) || bfs(p.x, p.y, x, y-1, 5) || bfs(p.x, p.y, x, y+1, 5);
    if (!adjPath) return;

    p.path = adjPath;
    p.gathering = true;
    p.gatherTarget = { x, y, obj };

    // After path completes (estimate)
    const delay = (adjPath.length + 2) * TICK_RATE;
    setTimeout(() => {
      if (!players[socket.id] || worldMap.objects[y]?.[x] === OBJ.NONE) {
        p.gathering = false; return;
      }
      let item, skill, xpAmt;
      if (obj === OBJ.TREE) { item='logs'; skill='woodcutting'; xpAmt=25; }
      else if (obj === OBJ.ROCK) { item='ore'; skill='mining'; xpAmt=17; }
      else if (obj === OBJ.FISH) { item='raw_fish'; skill='fishing'; xpAmt=20; }
      else { p.gathering = false; return; }

      // Add to inventory
      const existing = p.inventory.find(i => i.id === item);
      if (existing) existing.qty = (existing.qty||1)+1;
      else p.inventory.push({ id: item, name: item.replace('_',' '), type:'resource', stackable:true, qty:1 });

      const lu = addXp(p, skill, xpAmt);
      socket.emit('gathered', { item, skill, xp: xpAmt, inventory: p.inventory, levelUp: lu });

      // Deplete resource
      worldMap.objects[y][x] = OBJ.NONE;
      resourceRespawn[`${y},${x}`] = gameTick + 30;
      io.emit('objectChanged', { x, y, obj: OBJ.NONE });
      p.gathering = false;
    }, delay);
  });

  socket.on('pickupItem', ({ groundItemId: gid }) => {
    const p = players[socket.id];
    const gi = groundItems[gid];
    if (!p || !gi) return;
    const dist = Math.abs(p.x-gi.x)+Math.abs(p.y-gi.y);
    if (dist > 1) return;
    const existing = p.inventory.find(i => i.id === gi.item);
    if (existing) existing.qty = (existing.qty||1)+gi.qty;
    else p.inventory.push({ id: gi.item, name: gi.item.replace('_',' '), stackable: true, qty: gi.qty });
    delete groundItems[gid];
    io.emit('groundItemRemoved', gid);
    socket.emit('inventoryUpdate', p.inventory);
  });

  socket.on('useItem', ({ itemIndex }) => {
    const p = players[socket.id];
    if (!p) return;
    const item = p.inventory[itemIndex];
    if (!item) return;
    if (item.type === 'food') {
      p.hp = Math.min(p.maxHp, p.hp + (item.heal||5));
      item.qty = (item.qty||1) - 1;
      if (item.qty <= 0) p.inventory.splice(itemIndex, 1);
      socket.emit('healed', { hp: p.hp, inventory: p.inventory });
    } else if (item.type === 'weapon' || item.type === 'offhand' || item.type === 'armour') {
      const old = p.equipment[item.type];
      if (old) p.inventory.push(old);
      p.equipment[item.type] = item;
      p.inventory.splice(itemIndex, 1);
      socket.emit('equipmentUpdate', { equipment: p.equipment, inventory: p.inventory });
    }
  });

  socket.on('chat', ({ message }) => {
    if (!message || message.length > 100) return;
    const p = players[socket.id];
    io.emit('chat', { username: p.username, message, x: p.x, y: p.y });
  });

  // ── Trading ──
  socket.on('tradeRequest', ({ targetSocketId }) => {
    const tp = players[targetSocketId];
    if (!tp) return;
    io.to(targetSocketId).emit('tradeRequest', { from: socket.id, fromName: players[socket.id].username });
  });

  socket.on('tradeAccept', ({ fromSocketId }) => {
    const id = `trade_${tradeIdCounter++}`;
    trades[id] = { p1: fromSocketId, p2: socket.id, offer1: [], offer2: [], coins1: 0, coins2: 0, confirmed1: false, confirmed2: false };
    io.to(fromSocketId).emit('tradeStarted', { tradeId: id, partnerName: players[socket.id].username });
    io.to(socket.id).emit('tradeStarted',   { tradeId: id, partnerName: players[fromSocketId].username });
  });

  socket.on('tradeOffer', ({ tradeId, items, coins }) => {
    const t = trades[tradeId];
    if (!t) return;
    t.confirmed1 = false; t.confirmed2 = false;
    if (t.p1 === socket.id) { t.offer1 = items; t.coins1 = coins||0; }
    else                    { t.offer2 = items; t.coins2 = coins||0; }
    const other = t.p1 === socket.id ? t.p2 : t.p1;
    io.to(other).emit('tradeUpdated', { tradeId, theirOffer: items, theirCoins: coins||0 });
  });

  socket.on('tradeConfirm', ({ tradeId }) => {
    const t = trades[tradeId];
    if (!t) return;
    if (t.p1 === socket.id) t.confirmed1 = true;
    else                    t.confirmed2 = true;
    if (t.confirmed1 && t.confirmed2) {
      // Execute trade
      const p1 = players[t.p1], p2 = players[t.p2];
      if (p1 && p2) {
        // Remove offered items from each
        t.offer1.forEach(item => { const idx=p1.inventory.findIndex(i=>i.id===item.id); if(idx>=0) p1.inventory.splice(idx,1); });
        t.offer2.forEach(item => { const idx=p2.inventory.findIndex(i=>i.id===item.id); if(idx>=0) p2.inventory.splice(idx,1); });
        p1.coins = (p1.coins||0) - t.coins1 + t.coins2;
        p2.coins = (p2.coins||0) - t.coins2 + t.coins1;
        t.offer2.forEach(item => p1.inventory.push(item));
        t.offer1.forEach(item => p2.inventory.push(item));
        io.to(t.p1).emit('tradeComplete', { inventory: p1.inventory, coins: p1.coins });
        io.to(t.p2).emit('tradeComplete', { inventory: p2.inventory, coins: p2.coins });
      }
      delete trades[tradeId];
    } else {
      const other = t.p1 === socket.id ? t.p2 : t.p1;
      io.to(other).emit('tradeConfirmed', { tradeId, byName: players[socket.id].username });
    }
  });

  socket.on('tradeCancel', ({ tradeId }) => {
    const t = trades[tradeId];
    if (!t) return;
    const other = t.p1 === socket.id ? t.p2 : t.p1;
    io.to(other).emit('tradeCancelled', { tradeId });
    delete trades[tradeId];
  });

  // ── Duel Arena ──
  socket.on('duelRequest', ({ targetSocketId, stakeCoins }) => {
    const tp = players[targetSocketId];
    if (!tp) return;
    io.to(targetSocketId).emit('duelRequest', { from: socket.id, fromName: players[socket.id].username, stakeCoins: stakeCoins||0 });
  });

  socket.on('duelAccept', ({ fromSocketId, myStake }) => {
    const p1 = players[fromSocketId], p2 = players[socket.id];
    if (!p1 || !p2) return;
    const id = `duel_${duelIdCounter++}`;
    duels[id] = {
      p1: fromSocketId, p2: socket.id, state: 'active',
      hp1: p1.hp, hp2: p2.hp,
      stake1: p1._duelStake||0, stake2: myStake||0
    };
    io.to(fromSocketId).emit('duelStarted', { duelId: id, oppName: p2.username });
    io.to(socket.id).emit('duelStarted',   { duelId: id, oppName: p1.username });
  });

  socket.on('duelDecline', ({ fromSocketId }) => {
    io.to(fromSocketId).emit('duelDeclined', { byName: players[socket.id]?.username });
  });

  // ── Save & Disconnect ──
  socket.on('save', async () => {
    const p = players[socket.id];
    if (p) await saveCharacter(p.userId, p);
  });

  socket.on('disconnect', async () => {
    const p = players[socket.id];
    if (p) {
      await saveCharacter(p.userId, p);
      socket.broadcast.emit('playerLeft', socket.id);
      delete players[socket.id];
    }
    console.log(`${socket.username} disconnected`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
initDB().then(() => {
  server.listen(PORT, () => console.log(`RealmScape server on :${PORT}`));
});
