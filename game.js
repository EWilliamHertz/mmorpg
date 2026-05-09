// RealmScape - Multiplayer Client
// Connects to Socket.io server for real-time multiplayer

const SERVER_URL = window.REALMSCAPE_SERVER || 'https://mmorpg-qnya.onrender.com';

// ─── Auth ─────────────────────────────────────────────────────────────────────
const token = localStorage.getItem('rs_token');
const username = localStorage.getItem('rs_username');
if (!token) { window.location.href = '/'; }

// ─── Canvas Setup ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const TILE_SIZE = 32;

// Dynamically set canvas size to fill container (accounting for sidebar)
function resizeCanvas() {
  const wrapper = document.getElementById('gameWrapper');
  const sidePanel = document.getElementById('sidePanel');
  canvas.width = wrapper.clientWidth - sidePanel.offsetWidth;
  canvas.height = wrapper.clientHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

let VIEW_W = Math.floor(canvas.width / TILE_SIZE);
let VIEW_H = Math.floor(canvas.height / TILE_SIZE);

function updateViewDimensions() {
  VIEW_W = Math.floor(canvas.width / TILE_SIZE);
  VIEW_H = Math.floor(canvas.height / TILE_SIZE);
}

// ─── Game State ───────────────────────────────────────────────────────────────
let map = null;
let myPlayer = null;
let otherPlayers = {};
let npcs = {};
let groundItems = {};
let chatMessages = [];
let floatingTexts = [];
let lastRenderTime = 0;
let cameraX = 0, cameraY = 0;
let targetCamX = 0, targetCamY = 0;
let contextMenu = null;
let activeTab = 'inventory';
let activeTrade = null;
let activeDuel = null;

// ─── Socket.io ────────────────────────────────────────────────────────────────
const socket = io(SERVER_URL, { 
  auth: { token },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});

socket.on('connect', () => {
  console.log('✓ Connected to game server');
  showNotification('Connected!', 'success');
});

socket.on('connect_error', (err) => {
  console.error('Socket error:', err);
  showNotification('Connection error: ' + err.message, 'error');
  if (err.message === 'Invalid token' || err.message === 'No token') {
    localStorage.removeItem('rs_token');
    localStorage.removeItem('rs_username');
    window.location.href = '/';
  }
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  showNotification('Connection lost. Reconnecting...', 'warning');
});

socket.on('init', (data) => {
  myPlayer = data.player;
  map = data.map;
  data.npcs.forEach(n => npcs[n.id] = n);
  data.groundItems.forEach(gi => groundItems[gi.id] = gi);
  data.otherPlayers.forEach(p => otherPlayers[p.socketId] = p);
  cameraX = myPlayer.x - Math.floor(VIEW_W/2);
  cameraY = myPlayer.y - Math.floor(VIEW_H/2);
  targetCamX = cameraX; targetCamY = cameraY;
  updateUI();
  addChat('System', 'Welcome to RealmScape! ' + username, 'system');
});

socket.on('worldState', (state) => {
  if (!myPlayer) return;
  // Update other players
  const newOthers = {};
  state.players.forEach(p => {
    if (p.socketId === socket.id) {
      // Sync our position from server
      myPlayer.x = p.x; myPlayer.y = p.y;
      myPlayer.hp = p.hp; myPlayer.maxHp = p.maxHp;
    } else {
      newOthers[p.socketId] = p;
    }
  });
  otherPlayers = newOthers;

  // Update NPCs
  npcs = {};
  state.npcs.forEach(n => npcs[n.id] = n);

  // Update ground items
  groundItems = {};
  state.groundItems.forEach(gi => groundItems[gi.id] = gi);

  updateHPBar();
});

socket.on('playerJoined', (p) => {
  otherPlayers[p.socketId] = p;
  addChat('System', p.username + ' joined the realm', 'system');
});

socket.on('playerLeft', (sid) => {
  const p = otherPlayers[sid];
  if (p) addChat('System', p.username + ' left the realm', 'system');
  delete otherPlayers[sid];
});

socket.on('damage', ({ amount, hp }) => {
  myPlayer.hp = hp;
  addFloatingText(myPlayer.x, myPlayer.y, '-' + amount, '#ff4444');
  updateHPBar();
});

socket.on('combatHit', ({ targetId, damage, npcHp, npcMaxHp, levelUp }) => {
  if (npcs[targetId]) { npcs[targetId].hp = npcHp; npcs[targetId].maxHp = npcMaxHp; }
  if (damage > 0) addFloatingText(npcs[targetId]?.x || myPlayer.x, npcs[targetId]?.y || myPlayer.y, damage.toString(), '#ffff00');
  else addFloatingText(npcs[targetId]?.x || myPlayer.x, npcs[targetId]?.y || myPlayer.y, '0', '#aaa');
  if (levelUp) showNotification(`Level up! ${levelUp.skill} is now ${levelUp.level}!`, 'levelup');
  updateUI();
});

socket.on('npcDied', ({ id }) => { delete npcs[id]; });

socket.on('gathered', ({ item, skill, xp, inventory, levelUp }) => {
  myPlayer.inventory = inventory;
  addFloatingText(myPlayer.x, myPlayer.y, `+${xp} ${skill}`, '#00ff88');
  if (levelUp) showNotification(`Level up! ${levelUp.skill} is now ${levelUp.level}!`, 'levelup');
  updateInventory();
});

socket.on('healed', ({ hp, inventory }) => {
  myPlayer.hp = hp; myPlayer.inventory = inventory;
  addFloatingText(myPlayer.x, myPlayer.y, '+hp', '#00ff44');
  updateHPBar(); updateInventory();
});

socket.on('equipmentUpdate', ({ equipment, inventory }) => {
  myPlayer.equipment = equipment; myPlayer.inventory = inventory;
  updateInventory(); updateEquipment();
});

socket.on('inventoryUpdate', (inventory) => {
  myPlayer.inventory = inventory; updateInventory();
});

socket.on('died', ({ x, y, inventory }) => {
  myPlayer.x = x; myPlayer.y = y; myPlayer.inventory = inventory;
  showNotification('You died! Respawned in town.', 'error');
  updateInventory();
});

socket.on('objectChanged', ({ x, y, obj }) => {
  if (map) map.objects[y][x] = obj;
});

socket.on('groundItemRemoved', (id) => { delete groundItems[id]; });

socket.on('chat', ({ username: u, message, x, y }) => {
  addChat(u, message, 'player');
  addFloatingText(x, y, message, '#ffffff', true);
});

// ─── Trade Events ─────────────────────────────────────────────────────────────
socket.on('tradeRequest', ({ from, fromName }) => {
  showTradeRequestModal(from, fromName);
});

socket.on('tradeStarted', ({ tradeId, partnerName }) => {
  activeTrade = { tradeId, partnerName, myOffer: [], myCoins: 0, theirOffer: [], theirCoins: 0, myConfirmed: false, theirConfirmed: false };
  openTradeWindow();
});

socket.on('tradeUpdated', ({ tradeId, theirOffer, theirCoins }) => {
  if (!activeTrade || activeTrade.tradeId !== tradeId) return;
  activeTrade.theirOffer = theirOffer; activeTrade.theirCoins = theirCoins;
  activeTrade.myConfirmed = false; activeTrade.theirConfirmed = false;
  renderTradeWindow();
});

socket.on('tradeConfirmed', ({ tradeId, byName }) => {
  if (!activeTrade || activeTrade.tradeId !== tradeId) return;
  activeTrade.theirConfirmed = true;
  addChat('Trade', byName + ' confirmed the trade', 'system');
  renderTradeWindow();
});

socket.on('tradeComplete', ({ inventory, coins }) => {
  myPlayer.inventory = inventory; myPlayer.coins = coins;
  updateInventory();
  closeTradeWindow();
  showNotification('Trade complete!', 'success');
});

socket.on('tradeCancelled', () => {
  closeTradeWindow();
  showNotification('Trade was cancelled.', 'error');
});

// ─── Duel Events ─────────────────────────────────────────────────────────────
socket.on('duelRequest', ({ from, fromName, stakeCoins }) => {
  showDuelRequestModal(from, fromName, stakeCoins);
});

socket.on('duelStarted', ({ duelId, oppName }) => {
  activeDuel = { duelId, oppName, myHp: myPlayer.hp, oppHp: myPlayer.maxHp };
  openDuelWindow();
});

socket.on('duelHit', ({ myHp, oppHp, dmgTaken, dmgDealt }) => {
  if (!activeDuel) return;
  activeDuel.myHp = myHp; activeDuel.oppHp = oppHp;
  if (dmgTaken > 0) addChat('Duel', `You took ${dmgTaken} damage!`, 'system');
  if (dmgDealt > 0) addChat('Duel', `You dealt ${dmgDealt} damage!`, 'system');
  renderDuelWindow();
});

socket.on('duelResult', ({ won, coins }) => {
  if (won) {
    myPlayer.coins = (myPlayer.coins||0) + coins;
    showNotification(`You won the duel! +${coins} coins`, 'levelup');
  } else {
    showNotification('You lost the duel!', 'error');
  }
  closeDuelWindow();
});

socket.on('duelDeclined', ({ byName }) => {
  showNotification(byName + ' declined your duel.', 'error');
});

// ─── Render Loop ──────────────────────────────────────────────────────────────
const TILE_COLORS = {
  0: '#4a8c3f', // grass
  1: '#1a6b9e', // water
  2: '#555',    // wall
  3: '#c8b97a', // sand
  4: '#8B7355', // path
  5: '#8B6914', // dirt
};

const OBJ_EMOJI = { 1: '🌲', 2: '⛏️', 3: '🎣', 4: '📦', 5: '📦' };
const NPC_EMOJI = { chicken:'🐔', cow:'🐄', goblin:'👺', guard:'💂', spider:'🕷️', skeleton:'💀' };

function lerp(a, b, t) { return a + (b - a) * t; }

function render(ts) {
  requestAnimationFrame(render);
  if (!map || !myPlayer) return;
  
  updateViewDimensions();

  const dt = Math.min((ts - lastRenderTime) / 1000, 0.1);
  lastRenderTime = ts;

  // Smooth camera
  targetCamX = myPlayer.x - Math.floor(VIEW_W/2);
  targetCamY = myPlayer.y - Math.floor(VIEW_H/2);
  cameraX = lerp(cameraX, targetCamX, 0.15);
  cameraY = lerp(cameraY, targetCamY, 0.15);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const offX = Math.round(cameraX * TILE_SIZE);
  const offY = Math.round(cameraY * TILE_SIZE);

  // Draw tiles
  for (let y = 0; y < VIEW_H + 2; y++) {
    for (let x = 0; x < VIEW_W + 2; x++) {
      const wx = Math.floor(cameraX) + x;
      const wy = Math.floor(cameraY) + y;
      if (wx < 0 || wy < 0 || wx >= map.w || wy >= map.h) continue;
      const tile = map.tiles[wy][wx];
      ctx.fillStyle = TILE_COLORS[tile] || '#4a8c3f';
      ctx.fillRect(wx*TILE_SIZE - offX, wy*TILE_SIZE - offY, TILE_SIZE, TILE_SIZE);

      // Grid lines
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.strokeRect(wx*TILE_SIZE - offX, wy*TILE_SIZE - offY, TILE_SIZE, TILE_SIZE);

      // Objects
      const obj = map.objects[wy][wx];
      if (obj !== 0) {
        ctx.font = '20px serif';
        ctx.textAlign = 'center';
        ctx.fillText(OBJ_EMOJI[obj]||'?', wx*TILE_SIZE - offX + 16, wy*TILE_SIZE - offY + 22);
      }
    }
  }

  // Ground items
  for (const gi of Object.values(groundItems)) {
    const sx = gi.x * TILE_SIZE - offX;
    const sy = gi.y * TILE_SIZE - offY;
    ctx.font = '14px serif';
    ctx.textAlign = 'center';
    ctx.fillText('💰', sx + 16, sy + 20);
  }

  // Other players
  for (const p of Object.values(otherPlayers)) {
    const sx = p.x * TILE_SIZE - offX;
    const sy = p.y * TILE_SIZE - offY;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx+16, sy+28, 8, 4, 0, 0, Math.PI*2); ctx.fill();
    // Sprite
    ctx.font = '22px serif';
    ctx.textAlign = 'center';
    ctx.fillText('🧙', sx+16, sy+22);
    // Name
    ctx.fillStyle = '#7ec8e3';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(p.username, sx+16, sy-2);
    // HP bar
    const hpPct = p.hp / p.maxHp;
    ctx.fillStyle = '#333'; ctx.fillRect(sx+2, sy-8, 28, 4);
    ctx.fillStyle = hpPct > 0.5 ? '#00cc44' : hpPct > 0.25 ? '#ffaa00' : '#cc0000';
    ctx.fillRect(sx+2, sy-8, 28*hpPct, 4);
  }

  // NPCs
  for (const npc of Object.values(npcs)) {
    const sx = npc.x * TILE_SIZE - offX;
    const sy = npc.y * TILE_SIZE - offY;
    if (sx < -TILE_SIZE || sy < -TILE_SIZE || sx > canvas.width+TILE_SIZE || sy > canvas.height+TILE_SIZE) continue;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx+16, sy+28, 8, 4, 0, 0, Math.PI*2); ctx.fill();
    // Emoji
    ctx.font = '22px serif';
    ctx.textAlign = 'center';
    ctx.fillText(NPC_EMOJI[npc.type]||'👾', sx+16, sy+22);
    // Name
    ctx.fillStyle = '#ff9999';
    ctx.font = 'bold 8px monospace';
    ctx.fillText(npc.name, sx+16, sy-2);
    // HP bar
    const hpPct = npc.hp / npc.maxHp;
    ctx.fillStyle = '#333'; ctx.fillRect(sx+2, sy-8, 28, 4);
    ctx.fillStyle = hpPct > 0.5 ? '#00cc44' : hpPct > 0.25 ? '#ffaa00' : '#cc0000';
    ctx.fillRect(sx+2, sy-8, 28*hpPct, 4);
  }

  // My player
  {
    const sx = myPlayer.x * TILE_SIZE - offX;
    const sy = myPlayer.y * TILE_SIZE - offY;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx+16, sy+28, 8, 4, 0, 0, Math.PI*2); ctx.fill();
    ctx.font = '22px serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚔️', sx+16, sy+22);
    ctx.fillStyle = '#ffe066';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(myPlayer.username || username, sx+16, sy-2);
    // HP bar
    const hpPct = myPlayer.hp / myPlayer.maxHp;
    ctx.fillStyle = '#333'; ctx.fillRect(sx+2, sy-8, 28, 4);
    ctx.fillStyle = hpPct > 0.5 ? '#00cc44' : hpPct > 0.25 ? '#ffaa00' : '#cc0000';
    ctx.fillRect(sx+2, sy-8, 28*hpPct, 4);
  }

  // Floating texts
  floatingTexts.forEach((ft, i) => {
    ft.y -= 0.5;
    ft.life -= dt;
    const alpha = Math.min(1, ft.life * 3);
    ctx.globalAlpha = alpha;
    ctx.font = ft.big ? 'bold 11px monospace' : 'bold 13px monospace';
    ctx.fillStyle = ft.color;
    ctx.textAlign = 'center';
    const sx = ft.x * TILE_SIZE - offX + 16;
    ctx.fillText(ft.text, sx, ft.y * TILE_SIZE - offY);
    ctx.globalAlpha = 1;
  });
  floatingTexts = floatingTexts.filter(ft => ft.life > 0);

  // Minimap
  renderMinimap();

  // Context menu
  if (contextMenu) renderContextMenu();
}

function renderMinimap() {
  if (!map || !myPlayer) return;
  const mm = document.getElementById('minimap');
  if (!mm) return;
  const mctx = mm.getContext('2d');
  const mw = mm.width, mh = mm.height;
  const sx = mw / map.w, sy = mh / map.h;
  mctx.clearRect(0, 0, mw, mh);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const t = map.tiles[y][x];
    mctx.fillStyle = t===1?'#1a6b9e':t===5?'#8B6914':t===3?'#c8b97a':t===4?'#8B7355':'#4a8c3f';
    mctx.fillRect(x*sx, y*sy, sx+1, sy+1);
  }
  // Other players
  for (const p of Object.values(otherPlayers)) {
    mctx.fillStyle = '#7ec8e3';
    mctx.fillRect(p.x*sx-1, p.y*sy-1, 3, 3);
  }
  // My player
  mctx.fillStyle = '#ffe066';
  mctx.fillRect(myPlayer.x*sx-2, myPlayer.y*sy-2, 4, 4);
  // View rect
  mctx.strokeStyle = 'rgba(255,255,255,0.4)';
  mctx.strokeRect(cameraX*sx, cameraY*sy, VIEW_W*sx, VIEW_H*sy);
}

function renderContextMenu() {
  if (!contextMenu) return;
  const { x, y, items } = contextMenu;
  const itemH = 22, menuW = 140, pad = 4;
  const menuH = items.length * itemH + pad*2;
  ctx.fillStyle = 'rgba(30,20,10,0.97)';
  ctx.strokeStyle = '#c8a200';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, menuW, menuH);
  ctx.strokeRect(x, y, menuW, menuH);
  items.forEach((item, i) => {
    ctx.fillStyle = item.hovered ? '#3a2800' : 'transparent';
    ctx.fillRect(x+1, y+pad+i*itemH, menuW-2, itemH);
    ctx.fillStyle = item.color || '#ffe066';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, x+8, y+pad+i*itemH+15);
  });
}

// ─── Input ────────────────────────────────────────────────────────────────────
canvas.addEventListener('click', (e) => {
  if (contextMenu) { contextMenu = null; return; }
  if (!myPlayer || !map) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const offX = Math.round(cameraX * TILE_SIZE);
  const offY = Math.round(cameraY * TILE_SIZE);
  const wx = Math.floor((mx + offX) / TILE_SIZE);
  const wy = Math.floor((my + offY) / TILE_SIZE);

  // Check NPC click
  for (const npc of Object.values(npcs)) {
    if (npc.x === wx && npc.y === wy) {
      socket.emit('attackNPC', { npcId: npc.id });
      return;
    }
  }

  // Check object click (gather)
  if (map.objects[wy]?.[wx] !== 0) {
    socket.emit('gather', { x: wx, y: wy });
    return;
  }

  // Check ground item click
  for (const gi of Object.values(groundItems)) {
    if (gi.x === wx && gi.y === wy) {
      socket.emit('pickupItem', { groundItemId: gi.id });
      return;
    }
  }

  // Check other player click
  for (const p of Object.values(otherPlayers)) {
    if (p.x === wx && p.y === wy) {
      showPlayerContextMenu(mx, my, p);
      return;
    }
  }

  // Walk
  socket.emit('move', { x: wx, y: wy });
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!myPlayer || !map) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const offX = Math.round(cameraX * TILE_SIZE);
  const offY = Math.round(cameraY * TILE_SIZE);
  const wx = Math.floor((mx + offX) / TILE_SIZE);
  const wy = Math.floor((my + offY) / TILE_SIZE);

  const items = [{ label: 'Walk here', color:'#ffffff', action: () => socket.emit('move', { x: wx, y: wy }) }];

  // NPC options
  for (const npc of Object.values(npcs)) {
    if (npc.x === wx && npc.y === wy) {
      items.unshift({ label: `Attack ${npc.name}`, color:'#ff6666', action: () => socket.emit('attackNPC', { npcId: npc.id }) });
    }
  }

  // Object options
  const obj = map.objects[wy]?.[wx];
  if (obj === 1) items.unshift({ label: 'Chop tree', color:'#88ff88', action: () => socket.emit('gather',{x:wx,y:wy}) });
  if (obj === 2) items.unshift({ label: 'Mine rock', color:'#aaaaaa', action: () => socket.emit('gather',{x:wx,y:wy}) });
  if (obj === 3) items.unshift({ label: 'Fish here', color:'#88ccff', action: () => socket.emit('gather',{x:wx,y:wy}) });

  // Ground item options
  for (const gi of Object.values(groundItems)) {
    if (gi.x === wx && gi.y === wy) {
      items.unshift({ label: `Take ${gi.item}`, color:'#ffe066', action: () => socket.emit('pickupItem',{groundItemId:gi.id}) });
    }
  }

  // Other player
  for (const p of Object.values(otherPlayers)) {
    if (p.x === wx && p.y === wy) {
      items.unshift({ label: `Trade with ${p.username}`, color:'#88ffcc', action: () => socket.emit('tradeRequest',{targetSocketId:p.socketId}) });
      items.unshift({ label: `Duel ${p.username}`, color:'#ff8844', action: () => socket.emit('duelRequest',{targetSocketId:p.socketId,stakeCoins:0}) });
    }
  }

  items.push({ label: 'Cancel', color:'#ff6666', action: () => {} });
  contextMenu = { x: mx, y: my, items };
  items.forEach(item => { item.onClick = item.action; });
});

canvas.addEventListener('mousemove', (e) => {
  if (!contextMenu) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const { x, y, items } = contextMenu;
  const itemH = 22, pad = 4, menuW = 140;
  items.forEach((item, i) => {
    item.hovered = mx >= x && mx <= x+menuW && my >= y+pad+i*itemH && my <= y+pad+(i+1)*itemH;
  });
});

canvas.addEventListener('click', (e) => {
  if (!contextMenu) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const { x, y, items } = contextMenu;
  const itemH = 22, pad = 4, menuW = 140;
  items.forEach((item, i) => {
    if (mx >= x && mx <= x+menuW && my >= y+pad+i*itemH && my <= y+pad+(i+1)*itemH) {
      item.action?.();
    }
  });
  contextMenu = null;
}, true);

// Chat input
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
function sendChat() {
  const msg = chatInput?.value?.trim();
  if (!msg) return;
  socket.emit('chat', { message: msg });
  chatInput.value = '';
}
chatSend?.addEventListener('click', sendChat);
chatInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function updateUI() {
  updateHPBar();
  updateInventory();
  updateSkills();
  updateEquipment();
}

function updateHPBar() {
  if (!myPlayer) return;
  const hpEl = document.getElementById('hpVal');
  if (hpEl) hpEl.textContent = `${myPlayer.hp}/${myPlayer.maxHp}`;
  const bar = document.getElementById('hpBar');
  if (bar) bar.style.width = Math.round(100 * myPlayer.hp / myPlayer.maxHp) + '%';
}

function updateInventory() {
  if (!myPlayer) return;
  const grid = document.getElementById('inventoryGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < 28; i++) {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    const item = myPlayer.inventory[i];
    if (item) {
      slot.title = item.name + (item.qty > 1 ? ` (${item.qty})` : '');
      slot.innerHTML = itemEmoji(item) + (item.qty > 1 ? `<span class="qty">${item.qty}</span>` : '');
      slot.addEventListener('click', () => {
        socket.emit('useItem', { itemIndex: i });
      });
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showItemContextMenu(e, i, item);
      });
    }
    grid.appendChild(slot);
  }
  const coinsEl = document.getElementById('coinsVal');
  if (coinsEl) coinsEl.textContent = (myPlayer.coins||0).toLocaleString();
}

function itemEmoji(item) {
  const map = { bronze_sword:'⚔️', iron_sword:'🗡️', bronze_shield:'🛡️', bread:'🍞', logs:'🪵', ore:'🪨', raw_fish:'🐟', raw_chicken:'🍗', raw_beef:'🥩', bones:'🦴', coins:'💰', feather:'🪶', cowhide:'🟫', spider_silk:'🕸️', food:'🍎' };
  return `<span>${map[item.id] || map[item.type] || '📦'}</span>`;
}

function updateSkills() {
  if (!myPlayer?.skills) return;
  const grid = document.getElementById('skillsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const skillEmoji = { attack:'⚔️', strength:'💪', defence:'🛡️', hitpoints:'❤️', prayer:'🙏', magic:'🔮', ranged:'🏹', woodcutting:'🪓', mining:'⛏️', fishing:'🎣', cooking:'🍳', firemaking:'🔥' };
  Object.entries(myPlayer.skills).forEach(([name, s]) => {
    const el = document.createElement('div');
    el.className = 'skill-item';
    el.innerHTML = `<span>${skillEmoji[name]||'📊'}</span><span class="skill-name">${name.slice(0,4)}</span><span class="skill-level">${s.level}</span>`;
    grid.appendChild(el);
  });
}

function updateEquipment() {
  if (!myPlayer) return;
  const slots = ['weapon','offhand','head','body','legs','feet','hands','neck','ring'];
  slots.forEach(slot => {
    const el = document.getElementById(`eq-${slot}`);
    if (!el) return;
    const item = myPlayer.equipment?.[slot];
    el.innerHTML = item ? itemEmoji(item) : '';
    el.title = item ? item.name : slot;
  });
}

function addChat(user, message, type='player') {
  const box = document.getElementById('chatBox');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `chat-msg chat-${type}`;
  el.textContent = type === 'system' ? message : `${user}: ${message}`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  chatMessages.push({ user, message, type });
  if (box.children.length > 100) box.removeChild(box.firstChild);
}

function addFloatingText(x, y, text, color='#ffffff', big=false) {
  floatingTexts.push({ x, y, text, color, big, life: 1.5 });
}

function showNotification(msg, type='info') {
  const el = document.getElementById('notification');
  if (!el) return;
  el.textContent = msg;
  el.className = `notification visible ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('visible'), 3500);
}

function showPlayerContextMenu(mx, my, p) {
  contextMenu = {
    x: mx, y: my,
    items: [
      { label: `Trade with ${p.username}`, color:'#88ffcc', action: () => socket.emit('tradeRequest',{targetSocketId:p.socketId}) },
      { label: `Duel ${p.username}`, color:'#ff8844', action: () => socket.emit('duelRequest',{targetSocketId:p.socketId,stakeCoins:0}) },
      { label: 'Cancel', color:'#ff6666', action: () => {} }
    ]
  };
}

// ─── Trade Window ─────────────────────────────────────────────────────────────
function showTradeRequestModal(from, fromName) {
  const modal = document.getElementById('modal');
  if (!modal) return;
  modal.innerHTML = `
    <div class="modal-box">
      <h3>Trade Request</h3>
      <p><b>${fromName}</b> wishes to trade with you.</p>
      <div class="modal-btns">
        <button onclick="acceptTrade('${from}')">Accept</button>
        <button onclick="declineModal()">Decline</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

window.acceptTrade = (from) => {
  socket.emit('tradeAccept', { fromSocketId: from });
  document.getElementById('modal').style.display = 'none';
};

function openTradeWindow() {
  const tw = document.getElementById('tradeWindow');
  if (!tw) return;
  tw.style.display = 'block';
  renderTradeWindow();
}

function closeTradeWindow() {
  const tw = document.getElementById('tradeWindow');
  if (tw) tw.style.display = 'none';
  activeTrade = null;
}

function renderTradeWindow() {
  if (!activeTrade) return;
  const tw = document.getElementById('tradeWindow');
  if (!tw) return;
  tw.innerHTML = `
    <div class="trade-header">⚖️ Trade with ${activeTrade.partnerName}</div>
    <div class="trade-body">
      <div class="trade-side">
        <div class="trade-label">Your Offer</div>
        <div class="trade-items">
          ${(activeTrade.myOffer||[]).map(i => `<div class="trade-item">${itemEmoji(i)} ${i.name}</div>`).join('')}
          <div class="trade-coins">💰 ${activeTrade.myCoins||0} coins</div>
        </div>
        <div class="trade-confirmed ${activeTrade.myConfirmed?'yes':''}">
          ${activeTrade.myConfirmed ? '✅ Confirmed' : ''}
        </div>
      </div>
      <div class="trade-side">
        <div class="trade-label">Their Offer</div>
        <div class="trade-items">
          ${(activeTrade.theirOffer||[]).map(i => `<div class="trade-item">${itemEmoji(i)} ${i.name}</div>`).join('')}
          <div class="trade-coins">💰 ${activeTrade.theirCoins||0} coins</div>
        </div>
        <div class="trade-confirmed ${activeTrade.theirConfirmed?'yes':''}">
          ${activeTrade.theirConfirmed ? '✅ Confirmed' : ''}
        </div>
      </div>
    </div>
    <div class="trade-actions">
      <button onclick="offerItem()">Add Item</button>
      <button onclick="confirmTrade()">✅ Confirm</button>
      <button onclick="cancelTrade()" class="btn-danger">✖ Cancel</button>
    </div>`;
}

window.confirmTrade = () => {
  if (!activeTrade) return;
  activeTrade.myConfirmed = true;
  socket.emit('tradeConfirm', { tradeId: activeTrade.tradeId });
  renderTradeWindow();
};

window.cancelTrade = () => {
  if (!activeTrade) return;
  socket.emit('tradeCancel', { tradeId: activeTrade.tradeId });
  closeTradeWindow();
};

window.offerItem = () => {
  if (!activeTrade || !myPlayer) return;
  const name = prompt('Enter item name to offer (from inventory):');
  if (!name) return;
  const item = myPlayer.inventory.find(i => i.name.toLowerCase().includes(name.toLowerCase()));
  if (!item) { showNotification('Item not found in inventory', 'error'); return; }
  activeTrade.myOffer = [...(activeTrade.myOffer||[]), item];
  activeTrade.myConfirmed = false;
  socket.emit('tradeOffer', { tradeId: activeTrade.tradeId, items: activeTrade.myOffer, coins: activeTrade.myCoins });
  renderTradeWindow();
};

// ─── Duel Window ─────────────────────────────────────────────────────────────
function showDuelRequestModal(from, fromName, stakeCoins) {
  const modal = document.getElementById('modal');
  if (!modal) return;
  modal.innerHTML = `
    <div class="modal-box">
      <h3>⚔️ Duel Challenge!</h3>
      <p><b>${fromName}</b> challenges you to a duel!</p>
      ${stakeCoins ? `<p>Stakes: 💰 ${stakeCoins} coins</p>` : ''}
      <div class="modal-btns">
        <button onclick="acceptDuel('${from}')">Accept</button>
        <button onclick="declineDuel('${from}')">Decline</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

window.acceptDuel = (from) => {
  socket.emit('duelAccept', { fromSocketId: from, myStake: 0 });
  document.getElementById('modal').style.display = 'none';
};

window.declineDuel = (from) => {
  socket.emit('duelDecline', { fromSocketId: from });
  document.getElementById('modal').style.display = 'none';
};

function openDuelWindow() {
  const dw = document.getElementById('duelWindow');
  if (!dw) return;
  dw.style.display = 'block';
  renderDuelWindow();
}

function closeDuelWindow() {
  const dw = document.getElementById('duelWindow');
  if (dw) dw.style.display = 'none';
  activeDuel = null;
}

function renderDuelWindow() {
  if (!activeDuel) return;
  const dw = document.getElementById('duelWindow');
  if (!dw) return;
  const myPct = Math.max(0, (activeDuel.myHp / (myPlayer?.maxHp||10)) * 100);
  const oppPct = Math.max(0, (activeDuel.oppHp / (myPlayer?.maxHp||10)) * 100);
  dw.innerHTML = `
    <div class="duel-header">⚔️ DUEL vs ${activeDuel.oppName}</div>
    <div class="duel-hp">
      <div>You ❤️ ${activeDuel.myHp}
        <div class="hp-track"><div class="hp-fill" style="width:${myPct}%;background:#00cc44"></div></div>
      </div>
      <div>${activeDuel.oppName} ❤️ ${activeDuel.oppHp}
        <div class="hp-track"><div class="hp-fill" style="width:${oppPct}%;background:#cc0000"></div></div>
      </div>
    </div>
    <div class="duel-note">Combat is automatic each server tick!</div>`;
}

window.declineModal = () => { document.getElementById('modal').style.display = 'none'; };

// ─── Tab switching ────────────────────────────────────────────────────────────
window.switchTab = (tab) => {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = c.id === `tab-${tab}` ? 'block' : 'none');
};

// ─── Logout ───────────────────────────────────────────────────────────────────
window.logout = () => {
  socket.emit('save');
  setTimeout(() => {
    localStorage.removeItem('rs_token');
    localStorage.removeItem('rs_username');
    window.location.href = '/';
  }, 500);
};

// ─── Start ────────────────────────────────────────────────────────────────────
requestAnimationFrame(render);

// Auto-save every 30s
setInterval(() => { if (myPlayer) socket.emit('save'); }, 30000);
