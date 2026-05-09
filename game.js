(function () {
"use strict";

// ===================== CONSTANTS =====================
var TS = 32; // tile size in px
var WS = 64; // world size in tiles
var TICK = 600; // ms per game tick

// ===================== SEEDED RNG =====================
function makeRng(s) {
  return function () { s = (s * 1664525 + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}

// ===================== TILES =====================
var T = { GRASS: 0, WATER: 1, DIRT: 2, SAND: 3, DWATER: 4, WALL: 5, FLOOR: 6 };
var TC = {
  0: ["#4a7c59","#527a52","#458055"], 1: ["#2f6b9a","#2a608b","#3470a0"],
  2: ["#8b7355","#7e6848","#9a8060"], 3: ["#c2a86e","#b89a60","#cbb580"],
  4: ["#1a4a6b","#153d5a","#1f5070"], 5: ["#6b6155","#5e574d","#78706a"],
  6: ["#7a6e5a","#706448","#8a7e6e"]
};
var WALK = { 0:1, 2:1, 3:1, 6:1 };

// ===================== OBJECT TYPES =====================
var OT = { TREE:"tree", OAK:"oak", WILLOW:"willow", RCOPPER:"rcopper", RIRON:"riron", RCOAL:"rcoal", FISH:"fish" };

// ===================== ITEMS =====================
var ITEMS = {
  logs:       { n:"Logs",          ic:"🪵" },
  oak_logs:   { n:"Oak logs",      ic:"🪵" },
  willow_logs:{ n:"Willow logs",   ic:"🪵" },
  copper_ore: { n:"Copper ore",    ic:"🟤" },
  iron_ore:   { n:"Iron ore",      ic:"⬜" },
  coal:       { n:"Coal",          ic:"⬛" },
  raw_shrimp: { n:"Raw shrimps",   ic:"🦐" },
  shrimp:     { n:"Shrimps",       ic:"🍤", heal:3 },
  raw_trout:  { n:"Raw trout",     ic:"🐟" },
  trout:      { n:"Trout",         ic:"🍣", heal:7 },
  raw_chicken:{ n:"Raw chicken",   ic:"🍗" },
  chicken_m:  { n:"Cooked chicken", ic:"🍖", heal:4 },
  bones:      { n:"Bones",         ic:"🦴" },
  big_bones:  { n:"Big bones",     ic:"🦴" },
  coins:      { n:"Coins",         ic:"🪙", stack:1 },
  feather:    { n:"Feather",       ic:"🪶", stack:1 },
  goblin_mail:{ n:"Goblin mail",   ic:"👕" },
  bronze_sword:  { n:"Bronze sword",      ic:"🗡️", eq:"weapon", ab:4,  sb:3 },
  iron_sword:    { n:"Iron sword",        ic:"🗡️", eq:"weapon", ab:10, sb:8 },
  steel_sword:   { n:"Steel sword",       ic:"🗡️", eq:"weapon", ab:19, sb:15 },
  bronze_shield: { n:"Bronze shield",     ic:"🛡️", eq:"shield", db:4 },
  iron_shield:   { n:"Iron shield",       ic:"🛡️", eq:"shield", db:10 },
  bronze_helm:   { n:"Bronze helm",       ic:"⛑️", eq:"head",   db:3 },
  iron_helm:     { n:"Iron helm",         ic:"⛑️", eq:"head",   db:7 },
  leather_body:  { n:"Leather body",      ic:"🥋", eq:"body",   db:6 },
  iron_platebody:{ n:"Iron platebody",    ic:"🥋", eq:"body",   db:21 },
  bread:         { n:"Bread",             ic:"🍞", heal:5 },
};

// ===================== MONSTERS =====================
var MONS = {
  chicken: { n:"Chicken",     lv:1,  hp:3,  a:1,  s:1,  d:1,  ag:0, rt:25,
    drops:[{id:"bones",c:1},{id:"raw_chicken",c:1},{id:"feather",c:1,mn:5,mx:15}] },
  goblin:  { n:"Goblin",      lv:2,  hp:5,  a:1,  s:1,  d:1,  ag:0, rt:25,
    drops:[{id:"bones",c:1},{id:"coins",c:.6,mn:1,mx:5},{id:"goblin_mail",c:.08},{id:"bronze_shield",c:.02}] },
  cow:     { n:"Cow",         lv:2,  hp:8,  a:1,  s:1,  d:1,  ag:0, rt:25,
    drops:[{id:"bones",c:1},{id:"coins",c:.3,mn:1,mx:3}] },
  rat:     { n:"Giant rat",   lv:3,  hp:5,  a:2,  s:2,  d:2,  ag:3, rt:30,
    drops:[{id:"bones",c:1},{id:"coins",c:.4,mn:1,mx:4}] },
  guard:   { n:"Guard",       lv:21, hp:22, a:19, s:18, d:14, ag:0, rt:50,
    drops:[{id:"bones",c:1},{id:"coins",c:.8,mn:15,mx:60},{id:"iron_sword",c:.04},{id:"bread",c:.15}] },
  spider:  { n:"Giant spider", lv:27, hp:50, a:26, s:24, d:25, ag:4, rt:60,
    drops:[{id:"big_bones",c:1},{id:"coins",c:.5,mn:20,mx:100},{id:"steel_sword",c:.02},{id:"iron_platebody",c:.01}] },
};
var MCOL = { chicken:"#f0e6c8", goblin:"#4a8c3a", cow:"#c8b896", rat:"#8b7355", guard:"#a0a0b0", spider:"#2a1a0a" };

// ===================== SKILLS =====================
var SIDS  = ["attack","strength","defence","hitpoints","woodcutting","mining","fishing","cooking","prayer"];
var SNAME = ["Attack","Strength","Defence","Hitpoints","Woodcutting","Mining","Fishing","Cooking","Prayer"];
var SICON = ["⚔️","💪","🛡️","❤️","🪓","⛏️","🎣","🍳","✨"];

function xpFor(lv) { var t=0; for(var l=1;l<lv;l++) t+=Math.floor(l+300*Math.pow(2,l/7)); return Math.floor(t/4); }
function lvFor(xp) { for(var l=1;l<99;l++) if(xp<xpFor(l+1)) return l; return 99; }

// ===================== STATE =====================
var canvas, ctx, mcanvas, mctx;
var cw, ch, tx, ty; // canvas dims and tile counts
var world = [], objs = [], mons = [], gitems = [];
var cam = { x:0, y:0 };
var tick = 0;
var curTab = "inventory";
var ctxMenu = null; // context menu state

var P = {
  x:32, y:32, path:[], xp:{},
  inv: new Array(28).fill(null),
  eq: { weapon:null, shield:null, head:null, body:null, legs:null },
  ct: null,   // combat target (monster ref)
  ctTmr: 0,   // combat timer
  gt: null,   // gather target (obj ref)
  gtTmr: 0,   // gather timer
  style: "attack",
  dead: false, dTmr: 0,
  hp: 10,
  pickup: null,
};
SIDS.forEach(function(s){ P.xp[s]=0; });
P.xp.hitpoints = xpFor(10);
P.inv[0] = { id:"bronze_sword", c:1 };
P.inv[1] = { id:"bronze_shield", c:1 };
P.inv[2] = { id:"bread", c:5 };

function maxHp() { return lvFor(P.xp.hitpoints); }
function lv(s) { return lvFor(P.xp[s]); }
function combatLv() { var b = lv("defence") + lv("hitpoints") + Math.floor(lv("prayer")/2); return Math.floor((13/10) * Math.max(lv("attack")+lv("strength"), 0) + b) >> 2 || 3; }

function addXp(sk, amt) {
  var old = lv(sk); P.xp[sk] += amt; var nw = lv(sk);
  if (nw > old) msg("Congratulations! " + SNAME[SIDS.indexOf(sk)] + " level " + nw + "!", "skill");
  if (sk === "hitpoints" && nw > old) P.hp = Math.min(P.hp + (nw - old), maxHp());
}

// ===================== MESSAGES =====================
function msg(text, type) {
  var el = document.getElementById("chat-messages");
  var d = document.createElement("div");
  d.className = "msg-" + (type||"info");
  d.textContent = text;
  el.appendChild(d);
  el.scrollTop = 99999;
  while (el.childNodes.length > 80) el.removeChild(el.firstChild);
}

// ===================== INVENTORY =====================
function invCount() { var c=0; P.inv.forEach(function(s){if(s)c++;}); return c; }

function addItem(id, count) {
  count = count || 1;
  var def = ITEMS[id]; if (!def) return false;
  if (def.stack) {
    for (var i=0;i<28;i++) if (P.inv[i] && P.inv[i].id===id) { P.inv[i].c+=count; return true; }
  }
  if (def.stack) {
    for (var i=0;i<28;i++) if (!P.inv[i]) { P.inv[i]={id:id,c:count}; return true; }
  } else {
    var added=0;
    for (var j=0;j<count;j++) {
      for (var i=0;i<28;i++) { if (!P.inv[i]) { P.inv[i]={id:id,c:1}; added++; break; } }
    }
    return added>0;
  }
  return false;
}

// ===================== WORLD GEN =====================
function objAt(x,y) { for(var i=0;i<objs.length;i++) if(objs[i].x===x&&objs[i].y===y) return objs[i]; return null; }
function monAt(x,y) { for(var i=0;i<mons.length;i++) if(mons[i].x===x&&mons[i].y===y&&!mons[i].dead) return mons[i]; return null; }
function walkTile(x,y) { return x>=0&&x<WS&&y>=0&&y<WS&&WALK[world[y][x]]; }
function walkable(x,y) {
  if(!walkTile(x,y)) return false;
  var o=objAt(x,y);
  if(o&&!o.dep&&o.t!==OT.FISH) return false;
  return true;
}

function genWorld() {
  var r = makeRng(42);
  var y,x;
  for(y=0;y<WS;y++) { world[y]=[]; for(x=0;x<WS;x++) world[y][x]=T.GRASS; }

  // Southern water
  for(y=52;y<WS;y++) for(x=18;x<56;x++) world[y][x] = y>55?T.DWATER:T.WATER;
  // Lake
  for(y=46;y<55;y++) for(x=36;x<53;x++) {
    var dx=x-44.5, dy=y-51; if(dx*dx/64+dy*dy/20<1) world[y][x]=T.WATER;
  }
  // Sand borders
  for(y=1;y<WS-1;y++) for(x=1;x<WS-1;x++) {
    if(world[y][x]!==T.WATER&&world[y][x]!==T.DWATER) {
      for(var dy=-1;dy<=1;dy++) for(var dx=-1;dx<=1;dx++) {
        var ny=y+dy,nx=x+dx;
        if(ny>=0&&ny<WS&&nx>=0&&nx<WS&&(world[ny][nx]===T.WATER||world[ny][nx]===T.DWATER)&&r()<0.55)
          world[y][x]=T.SAND;
      }
    }
  }
  // Main paths
  for(x=4;x<58;x++) { world[32][x]=T.DIRT; world[31][x]=T.DIRT; }
  for(y=8;y<50;y++) { world[y][32]=T.DIRT; world[y][31]=T.DIRT; }
  for(x=32;x<55;x++) world[18][x]=T.DIRT;
  for(y=32;y<47;y++) world[y][15]=T.DIRT;
  // Town buildings
  for(y=28;y<31;y++) for(x=28;x<31;x++) world[y][x]=T.FLOOR;
  for(x=27;x<32;x++) { world[27][x]=T.WALL; world[31][x]=T.WALL; }
  for(y=27;y<32;y++) { world[y][27]=T.WALL; world[y][32]=T.WALL; }
  world[31][29]=T.FLOOR;
  for(y=34;y<37;y++) for(x=35;x<39;x++) world[y][x]=T.FLOOR;
  for(x=34;x<40;x++) { world[33][x]=T.WALL; world[37][x]=T.WALL; }
  for(y=33;y<38;y++) { world[y][34]=T.WALL; world[y][40]=T.WALL; }
  world[37][37]=T.FLOOR;
  // Scatter dirt
  for(var i=0;i<50;i++) { var px=1+Math.floor(r()*(WS-2)),py=1+Math.floor(r()*(WS-2)); if(world[py][px]===T.GRASS)world[py][px]=T.DIRT; }
  // Border
  for(i=0;i<WS;i++) { world[0][i]=T.DWATER; world[WS-1][i]=T.DWATER; world[i][0]=T.DWATER; world[i][WS-1]=T.DWATER; }

  // === OBJECTS ===
  function placeObj(type,sx,sy,w,h,count) {
    for(var i=0;i<count;i++){
      var ox=sx+Math.floor(r()*w), oy=sy+Math.floor(r()*h);
      if(walkTile(ox,oy)&&!objAt(ox,oy)) objs.push({t:type,x:ox,y:oy,dep:false,rt:0});
    }
  }
  placeObj(OT.TREE,4,38,18,14,22);
  placeObj(OT.OAK,10,20,12,15,6);
  placeObj(OT.WILLOW,24,44,10,4,4);
  placeObj(OT.RCOPPER,48,5,11,12,10);
  placeObj(OT.RIRON,52,8,8,8,5);
  placeObj(OT.RCOAL,54,10,6,6,3);
  // Town deco trees
  [[25,30],[36,30],[30,25],[35,25],[25,35],[38,40],[26,40],[20,28],[40,28]].forEach(function(p){
    if(walkTile(p[0],p[1])&&!objAt(p[0],p[1])) objs.push({t:OT.TREE,x:p[0],y:p[1],dep:false,rt:0});
  });
  // Fishing spots (in water tiles)
  [[36,49],[40,50],[44,49],[42,51],[38,52],[46,50]].forEach(function(p){
    if(world[p[1]]&&(world[p[1]][p[0]]===T.WATER))
      objs.push({t:OT.FISH,x:p[0],y:p[1],dep:false,rt:0});
  });

  // === MONSTERS ===
  function spawnMons(type,sx,sy,area,count) {
    var def=MONS[type];
    for(var i=0;i<count;i++){
      var mx=sx+Math.floor(r()*area), my=sy+Math.floor(r()*area);
      if(mx>0&&mx<WS-1&&my>0&&my<WS-1&&walkTile(mx,my))
        mons.push({t:type,x:mx,y:my,hp:def.hp,dead:false,rt:0,sx:mx,sy:my,wr:area,mt:Math.floor(r()*10),ct:null,ctm:0});
    }
  }
  spawnMons("chicken",38,20,6,6);
  spawnMons("cow",24,17,8,4);
  spawnMons("goblin",8,8,12,7);
  spawnMons("rat",16,36,10,5);
  spawnMons("guard",29,30,6,2);
  spawnMons("spider",4,2,10,4);
}

// ===================== PATHFINDING (BFS) =====================
function findPath(sx,sy,tx,ty) {
  if(sx===tx&&sy===ty) return [];
  var vis={}; vis[sx+","+sy]=1;
  var q=[{x:sx,y:sy,p:[]}];
  var dirs=[{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0},{x:-1,y:-1},{x:1,y:-1},{x:-1,y:1},{x:1,y:1}];
  for(var step=0;q.length&&step<800;step++){
    var c=q.shift();
    for(var d=0;d<dirs.length;d++){
      var nx=c.x+dirs[d].x, ny=c.y+dirs[d].y, k=nx+","+ny;
      if(vis[k]) continue; vis[k]=1;
      // diagonal check
      if(dirs[d].x&&dirs[d].y){ if(!walkable(c.x+dirs[d].x,c.y)||!walkable(c.x,c.y+dirs[d].y)) continue; }
      var np=c.p.concat([{x:nx,y:ny}]);
      if(nx===tx&&ny===ty) return np;
      if(walkable(nx,ny)) q.push({x:nx,y:ny,p:np});
    }
  }
  return null;
}

function pathAdj(sx,sy,tx,ty) {
  var dirs=[{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];
  var best=null;
  for(var d=0;d<dirs.length;d++){
    var ax=tx+dirs[d].x, ay=ty+dirs[d].y;
    if(ax===sx&&ay===sy) return [];
    if(walkable(ax,ay)||walkTile(ax,ay)){
      var p=findPath(sx,sy,ax,ay);
      if(p&&(!best||p.length<best.length)) best=p;
    }
  }
  return best;
}

// ===================== COMBAT =====================
function pMaxHit() {
  var sl=lv("strength"), sb=P.eq.weapon?(ITEMS[P.eq.weapon].sb||0):0;
  return Math.max(1, Math.floor(0.5+sl*(sb+64)/640));
}
function pAtkRoll() { var al=lv("attack"),ab=P.eq.weapon?(ITEMS[P.eq.weapon].ab||0):0; return Math.floor(Math.random()*(al*(ab+64))); }
function pDefRoll() {
  var dl=lv("defence"), db=0;
  ["shield","head","body","legs"].forEach(function(s){ if(P.eq[s]) db+=(ITEMS[P.eq[s]].db||0); });
  return Math.floor(Math.random()*(dl*(db+64)));
}

function pAttack(m) {
  var def=MONS[m.t];
  var ar=pAtkRoll(), dr=Math.floor(Math.random()*(def.d*64));
  if(ar>dr){
    var dmg=Math.floor(Math.random()*(pMaxHit()+1));
    m.hp=Math.max(0,m.hp-dmg);
    msg(dmg>0?"You hit the "+def.n+" for "+dmg+".":"You hit a 0 on the "+def.n+".","combat");
    if(dmg>0){ addXp(P.style,dmg*4); addXp("hitpoints",Math.floor(dmg*1.33)); }
    if(m.hp<=0) mKill(m);
  } else { msg("You miss the "+def.n+".","combat"); }
  m.ct="player"; // retaliate
}

function mAttack(m) {
  var def=MONS[m.t];
  var ar=Math.floor(Math.random()*(def.a*64)), dr=pDefRoll();
  if(ar>dr){
    var mh=Math.max(1,Math.floor(0.5+def.s*64/640));
    var dmg=Math.floor(Math.random()*(mh+1));
    P.hp=Math.max(0,P.hp-dmg);
    msg(dmg>0?"The "+def.n+" hits you for "+dmg+".":"The "+def.n+" hits a 0 on you.","combat");
    if(P.hp<=0) pDeath();
  } else { msg("The "+def.n+" misses you.","combat"); }
}

function mKill(m) {
  var def=MONS[m.t]; m.dead=true; m.rt=def.rt; P.ct=null;
  msg("You killed the "+def.n+"!","combat");
  def.drops.forEach(function(dr){
    if(Math.random()<dr.c){
      var cnt=dr.mn?dr.mn+Math.floor(Math.random()*(dr.mx-dr.mn+1)):1;
      gitems.push({id:dr.id,x:m.x,y:m.y,c:cnt,tmr:200});
      msg("Drop: "+ITEMS[dr.id].n+(cnt>1?" x"+cnt:""),"drop");
    }
  });
}

function pDeath() {
  P.dead=true; P.dTmr=5; P.ct=null; P.gt=null; P.path=[];
  msg("Oh dear, you are dead!","system");
}

function pRespawn() {
  P.dead=false; P.x=32; P.y=32; P.hp=maxHp(); P.ct=null; P.gt=null; P.path=[]; P.pickup=null;
  msg("You respawn in town.","system");
}

// ===================== GATHERING =====================
function gatherTick() {
  var o=P.gt; if(!o||o.dep){P.gt=null;return;}
  var dist=Math.abs(P.x-o.x)+Math.abs(P.y-o.y);
  if(dist>2){P.gt=null;return;}
  var sk,it,xp,req,ch;
  switch(o.t){
    case OT.TREE:    sk="woodcutting";it="logs";xp=25;req=1;ch=.5+lv("woodcutting")*.02;break;
    case OT.OAK:     sk="woodcutting";it="oak_logs";xp=37;req=15;ch=.3+(lv("woodcutting")-15)*.02;break;
    case OT.WILLOW:  sk="woodcutting";it="willow_logs";xp=68;req=30;ch=.2+(lv("woodcutting")-30)*.02;break;
    case OT.RCOPPER: sk="mining";it="copper_ore";xp=18;req=1;ch=.5+lv("mining")*.02;break;
    case OT.RIRON:   sk="mining";it="iron_ore";xp=35;req=15;ch=.3+(lv("mining")-15)*.02;break;
    case OT.RCOAL:   sk="mining";it="coal";xp=50;req=30;ch=.2+(lv("mining")-30)*.02;break;
    case OT.FISH:    sk="fishing";it="raw_shrimp";xp=10;req=1;ch=.5+lv("fishing")*.02;break;
    default: P.gt=null;return;
  }
  if(lv(sk)<req){msg("You need "+SNAME[SIDS.indexOf(sk)]+" level "+req+".","system");P.gt=null;return;}
  if(invCount()>=28){msg("Your inventory is full.","system");P.gt=null;return;}
  ch=Math.min(.95,Math.max(.1,ch));
  if(Math.random()<ch){
    addItem(it); addXp(sk,xp);
    msg("You get some "+ITEMS[it].n+".","skill");
    if(o.t!==OT.FISH&&Math.random()<.15){ o.dep=true; o.rt=20+Math.floor(Math.random()*15); }
  }
}

// ===================== GAME TICK =====================
function gameTick() {
  tick++;
  if(P.dead){P.dTmr--;if(P.dTmr<=0)pRespawn();return;}

  // Movement
  if(P.path.length){
    var nx=P.path[0];
    if(walkable(nx.x,nx.y)){P.x=nx.x;P.y=nx.y;P.path.shift();}
    else P.path=[];
  }

  // Pickup check
  if(P.pickup&&P.path.length===0){
    var g=P.pickup; P.pickup=null;
    var dist=Math.abs(P.x-g.x)+Math.abs(P.y-g.y);
    if(dist<=2){
      var idx=gitems.indexOf(g);
      if(idx>=0){
        if(addItem(g.id,g.c)){gitems.splice(idx,1);msg("You pick up: "+ITEMS[g.id].n+(g.c>1?" x"+g.c:""),"info");}
        else msg("Your inventory is full.","system");
      }
    }
  }

  // Combat
  if(P.ct){
    var m=P.ct;
    if(m.dead){P.ct=null;}
    else{
      var d=Math.abs(P.x-m.x)+Math.abs(P.y-m.y);
      if(d<=1.5){P.path=[];P.ctTmr++;if(P.ctTmr>=4){pAttack(m);P.ctTmr=0;}}
    }
  }

  // Gathering
  if(P.gt&&P.path.length===0){
    var o=P.gt, d2=Math.abs(P.x-o.x)+Math.abs(P.y-o.y);
    if(d2<=2){P.gtTmr++;if(P.gtTmr>=4){gatherTick();P.gtTmr=0;}}
    else P.gt=null;
  }

  // Monster AI
  mons.forEach(function(m){
    if(m.dead){m.rt--;if(m.rt<=0){m.dead=false;m.hp=MONS[m.t].hp;m.x=m.sx;m.y=m.sy;m.ct=null;}return;}
    var def=MONS[m.t];
    // Aggro
    if(!m.ct&&def.ag>0){var dp=Math.abs(P.x-m.x)+Math.abs(P.y-m.y);if(dp<=def.ag&&!P.dead)m.ct="player";}
    if(m.ct==="player"){
      var dp2=Math.abs(P.x-m.x)+Math.abs(P.y-m.y);
      if(dp2<=1.5){m.ctm++;if(m.ctm>=4){mAttack(m);m.ctm=0;}}
      else{m.mt++;if(m.mt>=2){
        var dx=Math.sign(P.x-m.x),dy=Math.sign(P.y-m.y);
        if(walkable(m.x+dx,m.y+dy)){m.x+=dx;m.y+=dy;}
        else if(walkable(m.x+dx,m.y))m.x+=dx;
        else if(walkable(m.x,m.y+dy))m.y+=dy;
        m.mt=0;
      }}
      if(Math.abs(P.x-m.x)+Math.abs(P.y-m.y)>15||P.dead){m.ct=null;m.ctm=0;}
    } else {
      m.mt++;
      if(m.mt>=6+Math.floor(Math.random()*6)){
        var dirs=[{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];
        var dd=dirs[Math.floor(Math.random()*4)];
        var nx2=m.x+dd.x,ny2=m.y+dd.y;
        if(walkable(nx2,ny2)&&Math.abs(nx2-m.sx)+Math.abs(ny2-m.sy)<=m.wr){m.x=nx2;m.y=ny2;}
        m.mt=0;
      }
    }
  });

  // Object respawn
  objs.forEach(function(o){if(o.dep){o.rt--;if(o.rt<=0)o.dep=false;}});

  // Ground item decay
  for(var i=gitems.length-1;i>=0;i--){gitems[i].tmr--;if(gitems[i].tmr<=0)gitems.splice(i,1);}

  // HP regen
  if(tick%100===0&&P.hp<maxHp()) P.hp++;
}

// ===================== RENDERING =====================
function drawTile(x,y) {
  var sx=(x-cam.x)*TS, sy=(y-cam.y)*TS;
  var tt=world[y][x], c=TC[tt];
  if(!c) return;
  ctx.fillStyle=c[((x*7+y*13)%3+3)%3];
  ctx.fillRect(sx,sy,TS,TS);
  // Detail
  if(tt===T.WATER||tt===T.DWATER){
    ctx.fillStyle="rgba(255,255,255,0.08)";
    var wo=Math.sin(tick*.3+x*.5+y*.7)*3;
    ctx.fillRect(sx+4+wo,sy+12,8,1);ctx.fillRect(sx+16+wo,sy+22,10,1);
  }
}

function drawObj(o) {
  var sx=(o.x-cam.x)*TS, sy=(o.y-cam.y)*TS;
  if(o.dep){
    ctx.fillStyle="#5a5040";
    if(o.t===OT.RCOPPER||o.t===OT.RIRON||o.t===OT.RCOAL)
      ctx.fillRect(sx+8,sy+20,16,8);
    else ctx.fillRect(sx+12,sy+22,8,8);
    return;
  }
  switch(o.t){
    case OT.TREE:
      ctx.fillStyle="#5c3a1a";ctx.fillRect(sx+13,sy+16,6,14);
      ctx.fillStyle="#2d6b2e";ctx.beginPath();ctx.arc(sx+16,sy+12,11,0,6.28);ctx.fill();
      ctx.fillStyle="#3a8c3b";ctx.beginPath();ctx.arc(sx+14,sy+10,7,0,6.28);ctx.fill();
      break;
    case OT.OAK:
      ctx.fillStyle="#4a2a0a";ctx.fillRect(sx+11,sy+14,10,16);
      ctx.fillStyle="#1a5c1a";ctx.beginPath();ctx.arc(sx+16,sy+10,14,0,6.28);ctx.fill();
      ctx.fillStyle="#2a7a2a";ctx.beginPath();ctx.arc(sx+12,sy+8,9,0,6.28);ctx.fill();
      ctx.beginPath();ctx.arc(sx+20,sy+7,8,0,6.28);ctx.fill();
      break;
    case OT.WILLOW:
      ctx.fillStyle="#5c4a1a";ctx.fillRect(sx+13,sy+12,6,18);
      ctx.fillStyle="#4a8a3a";ctx.beginPath();ctx.arc(sx+16,sy+8,12,0,6.28);ctx.fill();
      ctx.strokeStyle="#3a7a2a";ctx.lineWidth=1;
      for(var i=0;i<5;i++){ctx.beginPath();ctx.moveTo(sx+8+i*4,sy+8);ctx.quadraticCurveTo(sx+6+i*4,sy+20,sx+4+i*5,sy+28);ctx.stroke();}
      break;
    case OT.RCOPPER:
      ctx.fillStyle="#8a6a4a";drawRock(sx,sy);
      ctx.fillStyle="#c87941";ctx.fillRect(sx+12,sy+14,4,4);ctx.fillRect(sx+18,sy+18,3,3);
      break;
    case OT.RIRON:
      ctx.fillStyle="#7a7a7a";drawRock(sx,sy);
      ctx.fillStyle="#b0a090";ctx.fillRect(sx+12,sy+14,4,4);
      break;
    case OT.RCOAL:
      ctx.fillStyle="#5a5a5a";drawRock(sx,sy);
      ctx.fillStyle="#1a1a1a";ctx.fillRect(sx+12,sy+14,4,4);ctx.fillRect(sx+18,sy+16,3,3);
      break;
    case OT.FISH:
      ctx.fillStyle="rgba(255,255,255,0.5)";
      var t2=tick*.5;
      ctx.beginPath();ctx.arc(sx+14+Math.sin(t2)*3,sy+16+Math.cos(t2)*2,3,0,6.28);ctx.fill();
      ctx.beginPath();ctx.arc(sx+20+Math.cos(t2)*2,sy+14+Math.sin(t2+1)*3,2,0,6.28);ctx.fill();
      break;
  }
}

function drawRock(sx,sy) {
  ctx.beginPath();ctx.moveTo(sx+8,sy+26);ctx.lineTo(sx+6,sy+16);ctx.lineTo(sx+12,sy+10);
  ctx.lineTo(sx+20,sy+10);ctx.lineTo(sx+26,sy+16);ctx.lineTo(sx+24,sy+26);ctx.closePath();ctx.fill();
  ctx.strokeStyle="rgba(0,0,0,0.3)";ctx.lineWidth=1;ctx.stroke();
}

function drawEntity(ex,ey,col,isP,hp,mhp,name) {
  var sx=(ex-cam.x)*TS+TS/2, sy=(ey-cam.y)*TS+TS/2;
  // Shadow
  ctx.fillStyle="rgba(0,0,0,0.25)";ctx.beginPath();ctx.ellipse(sx,sy+10,8,4,0,0,6.28);ctx.fill();
  if(isP){
    // Legs
    ctx.fillStyle="#2c4a8c";ctx.fillRect(sx-5,sy+2,4,8);ctx.fillRect(sx+1,sy+2,4,8);
    // Body
    ctx.fillStyle=P.eq.body?"#6a5a3a":"#4a90e2";ctx.fillRect(sx-6,sy-8,12,12);
    // Arms
    ctx.fillStyle=P.eq.body?"#6a5a3a":"#4a90e2";ctx.fillRect(sx-9,sy-6,4,10);ctx.fillRect(sx+5,sy-6,4,10);
    // Head
    ctx.fillStyle="#f5c07c";ctx.beginPath();ctx.arc(sx,sy-13,6,0,6.28);ctx.fill();
    if(P.eq.head){ctx.fillStyle="#8a7a5a";ctx.beginPath();ctx.arc(sx,sy-14,7,Math.PI,0);ctx.fill();}
    // Eyes
    ctx.fillStyle="#000";ctx.fillRect(sx-3,sy-14,2,2);ctx.fillRect(sx+1,sy-14,2,2);
    // Weapon
    if(P.eq.weapon){ctx.fillStyle="#b0b0b0";ctx.fillRect(sx+7,sy-12,2,18);ctx.fillStyle="#8b6914";ctx.fillRect(sx+5,sy-2,6,3);}
    // Shield
    if(P.eq.shield){ctx.fillStyle="#8a7a5a";ctx.fillRect(sx-11,sy-6,5,9);ctx.fillStyle="#6a5a3a";ctx.fillRect(sx-10,sy-4,3,5);}
  } else {
    ctx.fillStyle=col;ctx.beginPath();ctx.arc(sx,sy-2,10,0,6.28);ctx.fill();
    ctx.fillStyle="rgba(0,0,0,0.2)";ctx.beginPath();ctx.arc(sx,sy+2,8,0,6.28);ctx.fill();
    // Eyes
    ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(sx-3,sy-4,2.5,0,6.28);ctx.fill();ctx.beginPath();ctx.arc(sx+3,sy-4,2.5,0,6.28);ctx.fill();
    ctx.fillStyle="#000";ctx.fillRect(sx-2,sy-5,2,2);ctx.fillRect(sx+2,sy-5,2,2);
  }
  // HP bar
  if(hp<mhp){
    var bw=24,bx=sx-bw/2,by=sy-22;
    ctx.fillStyle="#600";ctx.fillRect(bx,by,bw,4);
    ctx.fillStyle="#0f0";ctx.fillRect(bx,by,bw*(hp/mhp),4);
    ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(bx,by,bw,4);
  }
  if(name){ctx.fillStyle="#ffff00";ctx.font="bold 10px Courier New";ctx.textAlign="center";ctx.fillText(name,sx,sy-26);ctx.textAlign="left";}
}

function drawGItem(gi) {
  var sx=(gi.x-cam.x)*TS, sy=(gi.y-cam.y)*TS;
  ctx.fillStyle="rgba(255,0,255,0.15)";ctx.beginPath();ctx.arc(sx+TS/2,sy+TS/2+4,8,0,6.28);ctx.fill();
  ctx.fillStyle="#ff44ff";ctx.fillRect(sx+12,sy+22,8,6);
  ctx.fillStyle="#fff";ctx.font="8px Courier";ctx.textAlign="center";
  ctx.fillText(ITEMS[gi.id].ic,sx+TS/2,sy+TS-2);ctx.textAlign="left";
}

function drawMinimap() {
  mctx.fillStyle="#000";mctx.fillRect(0,0,152,152);
  var sc=152/WS;
  for(var y=0;y<WS;y++) for(var x=0;x<WS;x++){
    var c=TC[world[y][x]]; mctx.fillStyle=c?c[0]:"#000";
    mctx.fillRect(Math.floor(x*sc),Math.floor(y*sc),Math.ceil(sc),Math.ceil(sc));
  }
  objs.forEach(function(o){
    if(o.dep)return;
    if(o.t===OT.TREE||o.t===OT.OAK||o.t===OT.WILLOW)mctx.fillStyle="#1a5c1a";
    else if(o.t===OT.RCOPPER||o.t===OT.RIRON||o.t===OT.RCOAL)mctx.fillStyle="#8a8a8a";
    else return;
    mctx.fillRect(Math.floor(o.x*sc),Math.floor(o.y*sc),Math.ceil(sc),Math.ceil(sc));
  });
  mons.forEach(function(m){if(m.dead)return;mctx.fillStyle="#ff4444";mctx.fillRect(Math.floor(m.x*sc),Math.floor(m.y*sc),Math.ceil(sc)+1,Math.ceil(sc)+1);});
  mctx.fillStyle="#fff";mctx.fillRect(Math.floor(P.x*sc)-1,Math.floor(P.y*sc)-1,3,3);
  mctx.strokeStyle="rgba(255,255,255,0.5)";mctx.lineWidth=1;
  mctx.strokeRect(Math.floor(cam.x*sc),Math.floor(cam.y*sc),Math.ceil(tx*sc),Math.ceil(ty*sc));
}

// ===================== MAIN RENDER LOOP =====================
var mouseWX=-1,mouseWY=-1;

function render() {
  if(!canvas) return;
  cam.x=P.x-Math.floor(tx/2); cam.y=P.y-Math.floor(ty/2);
  cam.x=Math.max(0,Math.min(WS-tx,cam.x)); cam.y=Math.max(0,Math.min(WS-ty,cam.y));
  ctx.fillStyle="#000";ctx.fillRect(0,0,cw,ch);

  // Tiles
  for(var y=Math.floor(cam.y);y<Math.min(WS,cam.y+ty+1);y++)
    for(var x=Math.floor(cam.x);x<Math.min(WS,cam.x+tx+1);x++) drawTile(x,y);

  // Grid lines (subtle)
  ctx.strokeStyle="rgba(0,0,0,0.08)";ctx.lineWidth=1;
  for(var y=Math.floor(cam.y);y<Math.min(WS,cam.y+ty+1);y++){var sy2=(y-cam.y)*TS;ctx.beginPath();ctx.moveTo(0,sy2);ctx.lineTo(cw,sy2);ctx.stroke();}
  for(var x=Math.floor(cam.x);x<Math.min(WS,cam.x+tx+1);x++){var sx2=(x-cam.x)*TS;ctx.beginPath();ctx.moveTo(sx2,0);ctx.lineTo(sx2,ch);ctx.stroke();}

  // Objects
  objs.forEach(function(o){ if(o.x>=cam.x-1&&o.x<=cam.x+tx+1&&o.y>=cam.y-1&&o.y<=cam.y+ty+1) drawObj(o); });

  // Ground items
  gitems.forEach(function(gi){ if(gi.x>=cam.x&&gi.x<=cam.x+tx&&gi.y>=cam.y&&gi.y<=cam.y+ty) drawGItem(gi); });

  // Destination marker
  if(P.path.length>0){
    var last=P.path[P.path.length-1];
    var dsx=(last.x-cam.x)*TS, dsy=(last.y-cam.y)*TS;
    ctx.strokeStyle="rgba(255,255,0,0.5)";ctx.lineWidth=1;ctx.setLineDash([3,3]);
    ctx.strokeRect(dsx+2,dsy+2,TS-4,TS-4);ctx.setLineDash([]);
  }

  // Monsters
  mons.forEach(function(m){
    if(m.dead||m.x<cam.x-1||m.x>cam.x+tx+1||m.y<cam.y-1||m.y>cam.y+ty+1) return;
    var def=MONS[m.t];
    var show=m===P.ct||(mouseWX===m.x&&mouseWY===m.y);
    drawEntity(m.x,m.y,MCOL[m.t]||"#888",false,m.hp,def.hp,show?def.n+" (lvl "+def.lv+")":null);
  });

  // Player
  if(!P.dead) drawEntity(P.x,P.y,"#4a90e2",true,P.hp,maxHp(),null);

  // Hover tile highlight
  if(mouseWX>=0&&mouseWY>=0&&mouseWX<WS&&mouseWY<WS){
    var hsx=(mouseWX-cam.x)*TS, hsy=(mouseWY-cam.y)*TS;
    ctx.strokeStyle="rgba(255,255,255,0.2)";ctx.lineWidth=1;ctx.strokeRect(hsx,hsy,TS,TS);
  }

  // Gathering indicator
  if(P.gt&&P.path.length===0){
    var gsx=(P.gt.x-cam.x)*TS, gsy=(P.gt.y-cam.y)*TS;
    var prog=P.gtTmr/4;
    ctx.strokeStyle="#ffff00";ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(gsx+TS/2,gsy+TS/2,14,-Math.PI/2,-Math.PI/2+prog*6.28);ctx.stroke();
  }

  // Combat indicator
  if(P.ct&&!P.ct.dead){
    var csx=(P.ct.x-cam.x)*TS, csy=(P.ct.y-cam.y)*TS;
    ctx.strokeStyle="rgba(255,0,0,0.6)";ctx.lineWidth=2;
    ctx.strokeRect(csx+1,csy+1,TS-2,TS-2);
  }

  drawMinimap();
  updateUI();
  requestAnimationFrame(render);
}

// ===================== UI =====================
function updateUI() {
  document.getElementById("hp-text").textContent=P.hp+"/"+maxHp();
  document.getElementById("prayer-text").textContent=lv("prayer");
  document.getElementById("combat-text").textContent=combatLv();
  var tot=0; SIDS.forEach(function(s){tot+=P.xp[s];}); document.getElementById("xp-total").textContent="Total XP: "+tot.toLocaleString();
  if(curTab==="inventory") renderInv();
  else if(curTab==="stats") renderStats();
  else if(curTab==="equipment") renderEquip();
}

function renderInv() {
  var el=document.getElementById("inventory-tab");
  var html='<div class="inv-grid">';
  for(var i=0;i<28;i++){
    var it=P.inv[i];
    html+='<div class="inv-slot" data-s="'+i+'">';
    if(it){var d=ITEMS[it.id];html+=d.ic;if(it.c>1)html+='<span class="icount">'+it.c+'</span>';}
    html+='</div>';
  }
  html+='</div>';
  el.innerHTML=html;
  el.querySelectorAll(".inv-slot").forEach(function(slot){
    slot.addEventListener("click",function(){invClick(parseInt(slot.dataset.s));});
  });
}

function renderStats() {
  var el=document.getElementById("stats-tab");
  var html='';
  SIDS.forEach(function(s,i){
    var l=lv(s),xp=P.xp[s],cx=xpFor(l),nx=xpFor(l+1);
    var pr=l>=99?100:Math.floor((xp-cx)/(nx-cx)*100);
    html+='<div class="stat-row"><span class="stat-icon">'+SICON[i]+'</span><span class="stat-name">'+SNAME[i]+'</span><span class="stat-lvl">'+l+'</span><span class="stat-xp">'+xp.toLocaleString()+'</span><div class="stat-bar"><div class="stat-bar-fill" style="width:'+pr+'%"></div></div></div>';
  });
  html+='<div class="style-area"><label>Combat Style:</label>';
  ["attack","strength","defence"].forEach(function(s){
    html+='<button class="style-btn'+(P.style===s?" active":"")+'" data-st="'+s+'">'+SICON[SIDS.indexOf(s)]+' '+s.charAt(0).toUpperCase()+s.slice(1)+'</button>';
  });
  html+='</div>';
  el.innerHTML=html;
  el.querySelectorAll(".style-btn").forEach(function(b){b.addEventListener("click",function(){P.style=b.dataset.st;});});
}

function renderEquip() {
  var el=document.getElementById("equipment-tab");
  var html='<div class="equip-area">';
  html+='<div class="equip-row">'+eqSlot("head","Head")+'</div>';
  html+='<div class="equip-row">'+eqSlot("weapon","Weapon")+eqSlot("body","Body")+eqSlot("shield","Shield")+'</div>';
  html+='<div class="equip-row">'+eqSlot("legs","Legs")+'</div>';
  var ab=0,sb=0,db=0;
  Object.keys(P.eq).forEach(function(k){if(P.eq[k]){var d=ITEMS[P.eq[k]];ab+=(d.ab||0);sb+=(d.sb||0);db+=(d.db||0);}});
  html+='<div class="equip-summary">Atk: <span>+'+ab+'</span> | Str: <span>+'+sb+'</span> | Def: <span>+'+db+'</span></div>';
  html+='</div>';
  el.innerHTML=html;
  el.querySelectorAll(".equip-slot[data-eq]").forEach(function(s){
    s.addEventListener("click",function(){unequip(s.dataset.eq);});
  });
}

function eqSlot(id,label) {
  var it=P.eq[id];
  return '<div class="equip-slot" data-eq="'+id+'"><span class="equip-label">'+label+'</span>'+(it?ITEMS[it].ic:"")+'</div>';
}

function unequip(slot) {
  if(!P.eq[slot])return;
  if(invCount()>=28){msg("Inventory full.","system");return;}
  addItem(P.eq[slot]); msg("You unequip the "+ITEMS[P.eq[slot]].n+".","info"); P.eq[slot]=null;
}

function invClick(slot) {
  var it=P.inv[slot]; if(!it) return;
  var d=ITEMS[it.id];
  if(d.heal){
    if(P.hp<maxHp()){P.hp=Math.min(maxHp(),P.hp+d.heal);
      if(it.c>1)it.c--;else P.inv[slot]=null;
      msg("You eat the "+d.n+". It heals "+d.heal+" HP.","info");
    }else msg("You don't need to eat right now.","system");
    return;
  }
  if(d.eq){
    var cur=P.eq[d.eq];
    if(cur) P.inv[slot]={id:cur,c:1}; else P.inv[slot]=null;
    P.eq[d.eq]=it.id; msg("You equip the "+d.n+".","info"); return;
  }
  if(it.id==="bones"||it.id==="big_bones"){
    var xpg=it.id==="big_bones"?15:5;
    if(it.c>1)it.c--;else P.inv[slot]=null;
    addXp("prayer",xpg); msg("You bury the "+d.n+". (+"+xpg+" Prayer XP)","skill"); return;
  }
  // Cooking
  var cookMap={raw_shrimp:["shrimp",30],raw_trout:["trout",70],raw_chicken:["chicken_m",30]};
  if(cookMap[it.id]){
    var r2=cookMap[it.id];
    if(it.c>1)it.c--;else P.inv[slot]=null;
    addItem(r2[0]); addXp("cooking",r2[1]); msg("You cook the "+d.n+".","skill"); return;
  }
  msg(d.n+" — no action available.","system");
}

// ===================== INPUT =====================
function onCanvasClick(e) {
  hideCtx();
  if(P.dead) return;
  var r=canvas.getBoundingClientRect();
  var sx=cw/r.width, sy=ch/r.height;
  var cx2=(e.clientX-r.left)*sx, cy2=(e.clientY-r.top)*sy;
  var tileX=Math.floor(cx2/TS+cam.x), tileY=Math.floor(cy2/TS+cam.y);
  if(tileX<0||tileX>=WS||tileY<0||tileY>=WS) return;

  // Ground item?
  var gi=null; for(var i=0;i<gitems.length;i++) if(gitems[i].x===tileX&&gitems[i].y===tileY){gi=gitems[i];break;}
  if(gi){
    var p=pathAdj(P.x,P.y,tileX,tileY);
    if(p!==null){P.path=p;P.ct=null;P.gt=null;P.pickup=gi;}
    return;
  }

  // Monster?
  var mo=monAt(tileX,tileY);
  if(mo){
    var p2=pathAdj(P.x,P.y,tileX,tileY);
    if(p2!==null){P.path=p2;P.ct=mo;P.ctTmr=3;P.gt=null;P.pickup=null;msg("Attacking "+MONS[mo.t].n+"...","combat");}
    return;
  }

  // Object?
  var ob=objAt(tileX,tileY);
  if(ob&&!ob.dep){
    var p3=pathAdj(P.x,P.y,tileX,tileY);
    if(p3!==null){P.path=p3;P.gt=ob;P.gtTmr=3;P.ct=null;P.pickup=null;
      var act={tree:"Chopping",oak:"Chopping",willow:"Chopping",rcopper:"Mining",riron:"Mining",rcoal:"Mining",fish:"Fishing"};
      msg((act[ob.t]||"Interacting")+"...","info");
    }
    return;
  }

  // Walk
  if(walkable(tileX,tileY)){
    var p4=findPath(P.x,P.y,tileX,tileY);
    if(p4){P.path=p4;P.ct=null;P.gt=null;P.pickup=null;}
  }
}

function onCtx(e) {
  e.preventDefault();
  var r=canvas.getBoundingClientRect();
  var sx=cw/r.width, sy=ch/r.height;
  var cx2=(e.clientX-r.left)*sx, cy2=(e.clientY-r.top)*sy;
  var tileX=Math.floor(cx2/TS+cam.x), tileY=Math.floor(cy2/TS+cam.y);
  if(tileX<0||tileX>=WS||tileY<0||tileY>=WS){hideCtx();return;}

  var opts=[];
  var mo=monAt(tileX,tileY);
  var ob=objAt(tileX,tileY);
  var gi=null; for(var i=0;i<gitems.length;i++) if(gitems[i].x===tileX&&gitems[i].y===tileY){gi=gitems[i];break;}

  if(mo){
    var def=MONS[mo.t];
    opts.push({label:"Attack "+def.n+" (lvl "+def.lv+")",fn:function(){
      var p=pathAdj(P.x,P.y,mo.x,mo.y);
      if(p!==null){P.path=p;P.ct=mo;P.ctTmr=3;P.gt=null;P.pickup=null;}
    }});
    opts.push({label:"Examine "+def.n,fn:function(){msg(def.n+" - Level "+def.lv+", HP "+def.hp+".","info");}});
  }
  if(gi){
    opts.push({label:"Take "+ITEMS[gi.id].n,fn:function(){
      var p=pathAdj(P.x,P.y,gi.x,gi.y);
      if(p!==null){P.path=p;P.ct=null;P.gt=null;P.pickup=gi;}
    }});
  }
  if(ob&&!ob.dep){
    var names={tree:"Chop Tree",oak:"Chop Oak",willow:"Chop Willow",rcopper:"Mine Copper",riron:"Mine Iron",rcoal:"Mine Coal",fish:"Fish"};
    opts.push({label:names[ob.t]||"Use",fn:function(){
      var p=pathAdj(P.x,P.y,ob.x,ob.y);
      if(p!==null){P.path=p;P.gt=ob;P.gtTmr=3;P.ct=null;P.pickup=null;}
    }});
  }
  opts.push({label:"Walk here",fn:function(){
    if(walkable(tileX,tileY)){var p=findPath(P.x,P.y,tileX,tileY);if(p){P.path=p;P.ct=null;P.gt=null;P.pickup=null;}}
  }});

  showCtx(e.clientX,e.clientY,tileX+", "+tileY,opts);
}

function showCtx(mx,my,title,opts) {
  var el=document.getElementById("context-menu");
  el.innerHTML='<div class="ctx-title">'+title+'</div>';
  opts.forEach(function(o){
    var d=document.createElement("div");d.className="ctx-option";d.textContent=o.label;
    d.addEventListener("click",function(){o.fn();hideCtx();});
    el.appendChild(d);
  });
  el.style.display="block";el.style.left=mx+"px";el.style.top=my+"px";
  // Keep on screen
  setTimeout(function(){
    if(mx+el.offsetWidth>window.innerWidth) el.style.left=(mx-el.offsetWidth)+"px";
    if(my+el.offsetHeight>window.innerHeight) el.style.top=(my-el.offsetHeight)+"px";
  },0);
}

function hideCtx(){document.getElementById("context-menu").style.display="none";}

function onMouseMove(e) {
  var r=canvas.getBoundingClientRect();
  var sx=cw/r.width, sy=ch/r.height;
  var cx2=(e.clientX-r.left)*sx, cy2=(e.clientY-r.top)*sy;
  mouseWX=Math.floor(cx2/TS+cam.x); mouseWY=Math.floor(cy2/TS+cam.y);

  var tip=document.getElementById("tooltip");
  var mo=monAt(mouseWX,mouseWY);
  var ob=objAt(mouseWX,mouseWY);
  var gi=null; for(var i=0;i<gitems.length;i++) if(gitems[i].x===mouseWX&&gitems[i].y===mouseWY){gi=gitems[i];break;}

  if(mo){
    tip.textContent=MONS[mo.t].n+" (level "+MONS[mo.t].lv+")";
    canvas.style.cursor="pointer";
  }else if(gi){
    tip.textContent="Take: "+ITEMS[gi.id].n;canvas.style.cursor="pointer";
  }else if(ob&&!ob.dep){
    var nm={tree:"Tree",oak:"Oak tree",willow:"Willow tree",rcopper:"Copper rock",riron:"Iron rock",rcoal:"Coal rock",fish:"Fishing spot"};
    tip.textContent=nm[ob.t]||"Object";canvas.style.cursor="pointer";
  }else{tip.textContent="";canvas.style.cursor="crosshair";}

  if(tip.textContent){tip.style.display="block";tip.style.left=(e.clientX+12)+"px";tip.style.top=(e.clientY-8)+"px";}
  else tip.style.display="none";
}

// ===================== TAB SWITCHING =====================
document.querySelectorAll(".tab-btn").forEach(function(btn){
  btn.addEventListener("click",function(){
    document.querySelectorAll(".tab-btn").forEach(function(b){b.classList.remove("active");});
    document.querySelectorAll(".tab-panel").forEach(function(p){p.classList.remove("active");});
    btn.classList.add("active");
    var tid=btn.dataset.tab;
    document.getElementById(tid+"-tab").classList.add("active");
    curTab=tid;
  });
});

// ===================== RESIZE =====================
function resize() {
  var r=canvas.parentElement.getBoundingClientRect();
  cw=Math.floor(r.width);ch=Math.floor(r.height);
  canvas.width=cw;canvas.height=ch;
  tx=Math.ceil(cw/TS);ty=Math.ceil(ch/TS);
}

// ===================== INIT =====================
function init() {
  canvas=document.getElementById("game-canvas");
  ctx=canvas.getContext("2d");
  mcanvas=document.getElementById("minimap-canvas");
  mctx=mcanvas.getContext("2d");
  resize(); window.addEventListener("resize",resize);
  canvas.addEventListener("click",onCanvasClick);
  canvas.addEventListener("contextmenu",onCtx);
  canvas.addEventListener("mousemove",onMouseMove);
  document.addEventListener("click",function(e){
    if(!document.getElementById("context-menu").contains(e.target))hideCtx();
  });

  genWorld();
  P.hp=maxHp();

  msg("⚔️ Welcome to RealmScape! ⚔️","system");
  msg("Click to move. Click monsters to attack.","info");
  msg("Click trees/rocks/fishing spots to gather.","info");
  msg("Right-click for more options.","info");
  msg("Click items in inventory to use them.","info");

  setInterval(gameTick,TICK);
  requestAnimationFrame(render);
}

init();
})();
