import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';

const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || 'replace_me';
const MYSQL_DSN = process.env.MYSQL_DSN;

if (!MYSQL_DSN) {
  console.error('MYSQL_DSN is required');
}

const pool = mysql.createPool(MYSQL_DSN);

async function migrate() {
  // Minimal schema for test environment (idempotent)
  await pool.query(`CREATE TABLE IF NOT EXISTS user_progress (
    uid VARCHAR(64) PRIMARY KEY,
    max_level INT NOT NULL DEFAULT 1,
    coins INT NOT NULL DEFAULT 0,
    hint_count INT NOT NULL DEFAULT 0,
    shuffle_count INT NOT NULL DEFAULT 0,
    freeze_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS level_record (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    uid VARCHAR(64) NOT NULL,
    level_id INT NOT NULL,
    result ENUM('success','fail') NOT NULL,
    score INT NOT NULL DEFAULT 0,
    duration_sec INT NOT NULL DEFAULT 0,
    stars TINYINT NOT NULL DEFAULT 0,
    props_used_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_uid_level(uid, level_id),
    INDEX idx_created_at(created_at)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS iap_order (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    uid VARCHAR(64) NOT NULL,
    sku VARCHAR(64) NOT NULL,
    platform_order_id VARCHAR(128) NOT NULL,
    amount_cent INT NOT NULL,
    status ENUM('created','paid','failed','refunded') NOT NULL DEFAULT 'created',
    verify_msg VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_platform_order(platform_order_id),
    INDEX idx_uid(uid)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS ad_reward_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    uid VARCHAR(64) NOT NULL,
    scene ENUM('revive','double','prop') NOT NULL,
    ad_ticket VARCHAR(128) NOT NULL,
    grant_status ENUM('success','failed','duplicate') NOT NULL,
    reward_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ticket(ad_ticket),
    INDEX idx_uid_scene(uid, scene)
  )`);
}

migrate().then(() => {
  console.log('schema ok');
}).catch((e) => {
  console.error('schema migrate failed', e);
});


async function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload, requestId) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': requestId });
  res.end(JSON.stringify(payload));
}

function auth(req) {
  if (req.url === '/healthz') return { ok: true, uid: 'system' };
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return { ok: false };
  try {
    const data = jwt.verify(h.slice(7), JWT_SECRET);
    return { ok: true, uid: data.uid || 'unknown' };
  } catch {
    return { ok: false };
  }
}

async function getOrInit(uid) {
  const [rows] = await pool.query('SELECT * FROM user_progress WHERE uid=?', [uid]);
  if (rows.length) return rows[0];
  await pool.query('INSERT INTO user_progress(uid) VALUES(?)', [uid]);
  const [rows2] = await pool.query('SELECT * FROM user_progress WHERE uid=?', [uid]);
  return rows2[0];
}


const CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LLK Web Console</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:980px;margin:24px auto;padding:0 16px;}
    input,select,button,textarea{font-size:14px;padding:8px;}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;}
    .card{border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin:12px 0;}
    code{background:#f3f4f6;padding:2px 6px;border-radius:6px;}
    pre{background:#0b1020;color:#d1e7ff;padding:12px;border-radius:10px;overflow:auto;}
    .btn{cursor:pointer;border:1px solid #111827;background:#111827;color:white;border-radius:8px;}
    .btn.secondary{background:white;color:#111827;}
    .small{font-size:12px;color:#6b7280;}
  </style>
</head>
<body>
  <h2>LLK Web Console</h2>
  <div class="small">This is a test console for backend APIs. Do not paste production secrets. JWT is kept in-memory only.</div>

  <div class="card">
    <div class="row">
      <label>JWT:</label>
      <input id="jwt" style="flex:1;min-width:320px" placeholder="Bearer token (paste JWT)" />
      <label>uid:</label>
      <input id="uid" value="u_demo" style="width:180px" />
      <label>levelId:</label>
      <input id="levelId" value="1" style="width:90px" />
    </div>
    <div class="row">
      <button class="btn" onclick="apiStart()">Start</button>
      <button class="btn" onclick="apiFinish()">Finish</button>
      <button class="btn secondary" onclick="apiProgress()">Progress</button>
      <button class="btn secondary" onclick="apiReward()">Reward (revive)</button>
      <button class="btn secondary" onclick="apiPay()">Pay (starter_pack_6)</button>
      <span class="small">sessionToken: <code id="st">(none)</code></span>
    </div>
    <div class="row">
      <label>adTicket:</label>
      <input id="adTicket" value="ticket_demo_001" style="width:220px" />
      <label>orderId:</label>
      <input id="orderId" value="order_demo_001" style="width:220px" />
    </div>
  </div>

  <div class="card">
    <div class="row"><strong>Response</strong></div>
    <pre id="out">(no calls yet)</pre>
  </div>

<script>
const out = (x) => {
  const el = document.getElementById('out');
  el.textContent = typeof x === 'string' ? x : JSON.stringify(x, null, 2);
};

function h() {
  const jwt = document.getElementById('jwt').value.trim();
  if (!jwt) throw new Error('JWT required');
  return { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' };
}

function v(id){ return document.getElementById(id).value.trim(); }

async function post(url, body) {
  const r = await fetch(url, { method:'POST', headers: h(), body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t, status: r.status }; }
}

async function get(url) {
  const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + v('jwt') } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t, status: r.status }; }
}

async function apiStart(){
  try{
    const uid=v('uid');
    const levelId=Number(v('levelId'));
    const j=await post('/v1/game/start', { uid, levelId });
    if (j?.data?.sessionToken) document.getElementById('st').textContent=j.data.sessionToken;
    out(j);
  }catch(e){ out(String(e)); }
}

async function apiFinish(){
  try{
    const uid=v('uid');
    const levelId=Number(v('levelId'));
    const sessionToken=document.getElementById('st').textContent;
    const j=await post('/v1/game/finish', { uid, levelId, result:'success', score:999, durationSec:60, stars:3, sessionToken });
    out(j);
  }catch(e){ out(String(e)); }
}

async function apiProgress(){
  try{
    const uid=v('uid');
    const j=await get('/v1/user/progress?uid='+encodeURIComponent(uid));
    out(j);
  }catch(e){ out(String(e)); }
}

async function apiReward(){
  try{
    const uid=v('uid');
    const adTicket=v('adTicket');
    const j=await post('/v1/ad/reward/claim', { uid, scene:'revive', adTicket });
    out(j);
  }catch(e){ out(String(e)); }
}

async function apiPay(){
  try{
    const uid=v('uid');
    const platformOrderId=v('orderId');
    const j=await post('/v1/payment/verify', { uid, sku:'starter_pack_6', platformOrderId });
    out(j);
  }catch(e){ out(String(e)); }
}
</script>
</body>
</html>`;

const MATCH3_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MATCH3 Web Demo</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:1100px;margin:24px auto;padding:0 16px;}
    .top{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    input,button{font-size:14px;padding:8px;border-radius:8px;border:1px solid #e5e7eb;}
    button{cursor:pointer;background:#111827;color:white;border:1px solid #111827;}
    button.secondary{background:white;color:#111827;}
    .bar{margin-top:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .pill{padding:6px 10px;border-radius:999px;background:#f3f4f6;}
    .small{font-size:12px;color:#6b7280}
    .panel{margin-top:16px;border:1px solid #e5e7eb;border-radius:12px;padding:12px;}
    pre{background:#0b1020;color:#d1e7ff;padding:12px;border-radius:10px;overflow:auto;max-height:220px}
    a{color:#2563eb;text-decoration:none}

    /* Board */
    #boardWrap{margin-top:16px;}
    #board{position:relative; width: calc(8 * 54px + 7 * 6px); height: calc(8 * 54px + 7 * 6px); touch-action: none;}
    .tile{position:absolute; width:54px; height:54px; display:flex; align-items:center; justify-content:center;
      border-radius:12px; border:1px solid #d1d5db; background:white; user-select:none;
      font-size:28px; line-height:1;
      transition: transform 360ms cubic-bezier(.20,1.08,.32,1);
      box-shadow: 0 14px 28px rgba(0,0,0,.14), 0 3px 0 rgba(0,0,0,.10);
      border: 1px solid rgba(255,255,255,.55);
      background: linear-gradient(180deg, rgba(255,255,255,.92), rgba(255,255,255,.72));
      will-change: transform;
    }
    .tile::before{content:'';position:absolute;inset:6px 8px auto 8px;height:18px;border-radius:999px;
      background: linear-gradient(180deg, rgba(255,255,255,.88), rgba(255,255,255,0));pointer-events:none;filter: blur(.2px);}

    .tile::after{content:'';position:absolute;inset:0;border-radius:12px;pointer-events:none;
      background: radial-gradient(120px 80px at 20% 10%, rgba(255,255,255,.35), rgba(255,255,255,0) 60%),
                  radial-gradient(120px 80px at 80% 90%, rgba(0,0,0,.10), rgba(0,0,0,0) 55%),
                  repeating-linear-gradient(45deg, rgba(255,255,255,.06) 0 2px, rgba(255,255,255,0) 2px 6px);
      mix-blend-mode: overlay; opacity: .55;}

    .tile.sel{outline:3px solid rgba(37,99,235,.65); box-shadow: 0 14px 28px rgba(37,99,235,.18), 0 10px 20px rgba(0,0,0,.12), 0 2px 0 rgba(0,0,0,.08);}

    .t1{background: linear-gradient(180deg,#ff9db1,#ff4d6d);}
    .t2{background: linear-gradient(180deg,#ffe08a,#ffb703);}
    .t3{background: linear-gradient(180deg,#d6c1ff,#8b5cf6);}
    .t4{background: linear-gradient(180deg,#ffc0e8,#ff6ec7);}
    .t5{background: linear-gradient(180deg,#ffd0a8,#ff7a3d);}
    .t6{background: linear-gradient(180deg,#c9ffd6,#22c55e);} 
    .tile.pop{animation: pop 360ms ease forwards;}
    @keyframes pop{ 0%{transform: translate(var(--x), var(--y)) scale(1);} 100%{transform: translate(var(--x), var(--y)) scale(0.1); opacity:0;} }
  </style>
</head>
<body>
  <h2>MATCH3 Web Demo (8×8, swipe)</h2>
  <div class="small">Swipe a tile to swap with adjacent. 3+ matches clear, drop & refill with cascades.</div>

  <div class="top">
    <span class="pill">Moves: <b id="moves">--</b></span>
    <span class="pill">Score: <b id="score">0</b></span>
    <span class="pill">Goal 🍎: <b id="goal">0</b> / <b id="goalNeed">20</b></span>
    <button onclick="newGame()">New Game</button>
    <button class="secondary" onclick="propBomb()">Bomb (1)</button>
    <span class="small">|</span>
    <a href="/console" class="small">API console</a>
  </div>

  <div id="boardWrap">
    <div id="board"></div>
  </div>

  <div class="panel">
    <div><b>Debug</b></div>
    <pre id="out">(none)</pre>
  </div>

<script>
const OUT = (x) => {
  const el = document.getElementById('out');
  el.textContent = typeof x === 'string' ? x : JSON.stringify(x, null, 2);
};

const N = 8;
const TYPES = 6;
const EMOJI = ['','🍎','🍋','🍇','🍓','🍒','🥝'];
const SIZE = 54;
const GAP = 6;
const THRESH = 14; // swipe threshold

let grid = []; // grid[r][c] = {id, t}
let nextId = 1;
let selected = null;
let moves = 25;
let score = 0;
let goalType = 1; // 🍎
let goal = 0;
let goalNeed = 20;
let bomb = 1;
let busy = false;

const boardEl = document.getElementById('board');
const tileEls = new Map(); // id -> el

function randType(){ return 1 + Math.floor(Math.random()*TYPES); }
function inBounds(r,c){ return r>=0 && r<N && c>=0 && c<N; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function posToXY(r,c){
  const x = c*(SIZE+GAP);
  const y = r*(SIZE+GAP);
  return {x,y};
}

function setStatus(){
  document.getElementById('moves').textContent = String(moves);
  document.getElementById('score').textContent = String(score);
  document.getElementById('goal').textContent = String(goal);
  document.getElementById('goalNeed').textContent = String(goalNeed);
}

function mountTile(cell, r, c){
  let el = tileEls.get(cell.id);
  const {x,y} = posToXY(r,c);

  if(!el){
    el = document.createElement('div');
    el.className = 'tile';
    el.dataset.id = String(cell.id);
    boardEl.appendChild(el);
    tileEls.set(cell.id, el);

    // Spawn above the board then drop into place (simple fall animation)
    const spawnY = y - (SIZE + GAP) * (3 + Math.floor(Math.random()*3));
    el.style.setProperty('--x', x+'px');
    el.style.setProperty('--y', spawnY+'px');
    const scale = (selected && selected.r===r && selected.c===c) ? 1.06 : 1;
    el.style.transform = 'translate(' + x + 'px,' + spawnY + 'px) scale(' + scale + ')';

    // Next frame -> move to target, CSS transition will animate
    requestAnimationFrame(() => {
      el.style.setProperty('--x', x+'px');
      el.style.setProperty('--y', y+'px');
      const scale = (selected && selected.r===r && selected.c===c) ? 1.06 : 1;
    el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
    });
  } else {
    // Existing tiles: just move to target
    el.style.setProperty('--x', x+'px');
    el.style.setProperty('--y', y+'px');
    const scale = (selected && selected.r===r && selected.c===c) ? 1.06 : 1;
    el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
  }

  el.textContent = EMOJI[cell.t] || String(cell.t);
  // type-based candy color
  for(let i=1;i<=TYPES;i++) el.classList.remove('t'+i);
  el.classList.add('t'+cell.t);
  if(selected && selected.r===r && selected.c===c) el.classList.add('sel');
  else el.classList.remove('sel');
}

function renderAll(){
  for(let r=0;r<N;r++) for(let c=0;c<N;c++) mountTile(grid[r][c], r, c);
  setStatus();
}

function initGrid(){
  grid = Array.from({length:N}, ()=> Array.from({length:N}, ()=>null));
  for(let r=0;r<N;r++){
    for(let c=0;c<N;c++){
      let t=randType();
      // avoid immediate matches on spawn
      while((c>=2 && t===grid[r][c-1]?.t && t===grid[r][c-2]?.t) || (r>=2 && t===grid[r-1][c]?.t && t===grid[r-2][c]?.t)){
        t=randType();
      }
      grid[r][c] = { id: nextId++, t };
    }
  }
}

function findMatches(){
  const marks = Array.from({length:N}, ()=> Array.from({length:N}, ()=>false));
  // rows
  for(let r=0;r<N;r++){
    let c=0;
    while(c<N){
      const t=grid[r][c].t;
      let k=c+1;
      while(k<N && grid[r][k].t===t) k++;
      if(t && k-c>=3){ for(let x=c;x<k;x++) marks[r][x]=true; }
      c=k;
    }
  }
  // cols
  for(let c=0;c<N;c++){
    let r=0;
    while(r<N){
      const t=grid[r][c].t;
      let k=r+1;
      while(k<N && grid[k][c].t===t) k++;
      if(t && k-r>=3){ for(let x=r;x<k;x++) marks[x][c]=true; }
      r=k;
    }
  }
  return marks;
}

function anyMarked(marks){
  for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(marks[r][c]) return true;
  return false;
}

async function clearMarkedAnimated(marks){
  let cleared=0;
  const toPop=[];
  for(let r=0;r<N;r++) for(let c=0;c<N;c++){
    if(marks[r][c]){
      const cell=grid[r][c];
      if(cell.t===goalType) goal++;
      const el=tileEls.get(cell.id);
      if(el){ el.classList.add('pop'); }
      toPop.push(cell.id);
      grid[r][c] = { id: nextId++, t: 0 }; // placeholder empty with new id
      cleared++;
    }
  }
  score += cleared * 10;
  setStatus();
  await sleep(400);
  // remove popped dom nodes
  for(const id of toPop){
    const el=tileEls.get(id);
    if(el){ el.remove(); tileEls.delete(id); }
  }
}

function dropAndRefill(){
  for(let c=0;c<N;c++){
    const col=[];
    for(let r=N-1;r>=0;r--){
      if(grid[r][c].t!==0) col.push(grid[r][c]);
    }
    let write=N-1;
    for(const cell of col){
      grid[write][c]=cell;
      write--;
    }
    for(let r=write;r>=0;r--){
      grid[r][c] = { id: nextId++, t: randType() };
    }
  }
}

async function resolveCascades(){
  let loops=0;
  while(true){
    const m=findMatches();
    if(!anyMarked(m)) break;
    await clearMarkedAnimated(m);
    dropAndRefill();
    renderAll();
    await sleep(400);
    loops++;
    if(loops>25) break;
  }
}

function isAdjacent(a,b){
  const dr=Math.abs(a.r-b.r), dc=Math.abs(a.c-b.c);
  return (dr+dc)===1;
}

async function trySwap(a,b){
  if(busy) return;
  if(moves<=0) return;
  if(!isAdjacent(a,b)) return;

  busy=true;
  // swap in model
  const tmp=grid[a.r][a.c];
  grid[a.r][a.c]=grid[b.r][b.c];
  grid[b.r][b.c]=tmp;
  renderAll();
  await sleep(400);

  const m=findMatches();
  if(!anyMarked(m)){
    // swap back
    const tmp2=grid[a.r][a.c];
    grid[a.r][a.c]=grid[b.r][b.c];
    grid[b.r][b.c]=tmp2;
    renderAll();
    await sleep(400);
    busy=false;
    return;
  }

  moves -= 1;
  setStatus();
  await resolveCascades();
  busy=false;
  checkEnd();
}

async function onClick(r,c){
  // keep click selection for bomb usage (optional)
  selected = {r,c};
  renderAll();
}

function checkEnd(){
  if(goal>=goalNeed){ setTimeout(()=>alert('Win!'), 50); return; }
  if(moves<=0){ setTimeout(()=>alert('Out of moves!'), 50); }
}

async function propBomb(){
  if(busy) return;
  if(bomb<=0) return;
  if(!selected){ OUT('Select a tile then click Bomb.'); return; }
  busy=true;
  bomb -= 1;
  const r0=selected.r, c0=selected.c;
  selected=null;

  const marks = Array.from({length:N}, ()=> Array.from({length:N}, ()=>false));
  for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
    const r=r0+dr, c=c0+dc;
    if(inBounds(r,c)) marks[r][c]=true;
  }
  await clearMarkedAnimated(marks);
  dropAndRefill();
  renderAll();
  await sleep(400);
  await resolveCascades();
  renderAll();
  busy=false;
  checkEnd();
}

function newGame(){
  busy=false;
  selected=null;
  moves=25;
  score=0;
  goal=0;
  goalNeed=20;
  goalType=1;
  bomb=1;
  // clear dom
  boardEl.innerHTML='';
  tileEls.clear();

  initGrid();
  renderAll();
  // resolve any accidental matches (should be none, but safe)
  resolveCascades().then(()=>renderAll());
}

// Swipe handling
let pDown = null; // {r,c,x,y,done}
function xyToCell(clientX, clientY){
  const rect=boardEl.getBoundingClientRect();
  const x=clientX-rect.left;
  const y=clientY-rect.top;
  const c=Math.floor(x/(SIZE+GAP));
  const r=Math.floor(y/(SIZE+GAP));
  if(!inBounds(r,c)) return null;
  return {r,c};
}

boardEl.addEventListener('pointerdown', (e)=>{
  if(busy) return;
  const cell = xyToCell(e.clientX, e.clientY);
  if(!cell) return;
  pDown = {r:cell.r, c:cell.c, x:e.clientX, y:e.clientY, done:false};
  boardEl.setPointerCapture(e.pointerId);
});

boardEl.addEventListener('pointermove', (e)=>{
  if(!pDown || pDown.done || busy) return;
  const dx=e.clientX-pDown.x;
  const dy=e.clientY-pDown.y;
  if(Math.abs(dx)<THRESH && Math.abs(dy)<THRESH) return;
  pDown.done=true;
  let dr=0, dc=0;
  if(Math.abs(dx) > Math.abs(dy)) dc = dx>0 ? 1 : -1;
  else dr = dy>0 ? 1 : -1;
  const a={r:pDown.r, c:pDown.c};
  const b={r:pDown.r+dr, c:pDown.c+dc};
  if(!inBounds(b.r,b.c)) return;
  trySwap(a,b);
});

boardEl.addEventListener('pointerup', (e)=>{
  if(!pDown) return;
  // tap fallback: select for bomb
  if(!pDown.done){
    onClick(pDown.r,pDown.c);
  }
  pDown=null;
});

newGame();
</script>
</body>
</html>`;



const DEMO_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LLK Web Demo</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:1100px;margin:24px auto;padding:0 16px;}
    .top{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    input,button{font-size:14px;padding:8px;border-radius:8px;border:1px solid #e5e7eb;}
    button{cursor:pointer;background:#111827;color:white;border:1px solid #111827;}
    button.secondary{background:white;color:#111827;}
    .grid{display:grid;gap:6px;margin-top:16px;}
    .cell{width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;user-select:none;font-size:24px;line-height:1;}
    .cell.tile{background:white;border-color:#d1d5db;}
    .cell.sel{outline:3px solid #2563eb;}
    .cell.hint{outline:3px solid #f59e0b;}
    .bar{margin-top:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .pill{padding:6px 10px;border-radius:999px;background:#f3f4f6;}
    .small{font-size:12px;color:#6b7280}
    .panel{margin-top:16px;border:1px solid #e5e7eb;border-radius:12px;padding:12px;}
    pre{background:#0b1020;color:#d1e7ff;padding:12px;border-radius:10px;overflow:auto;max-height:220px}
    a{color:#2563eb;text-decoration:none}
  </style>
</head>
<body>
  <h2>LLK Web Demo (8×10, 8 types)</h2>
  <div class="small">A web playable demo for quick UX testing. Final WeChat mini-game will be built in Cocos.</div>

  <div class="top">
    <span class="pill">Time: <b id="time">--</b>s</span>
    <span class="pill">Remaining: <b id="remain">--</b></span>
    <span class="pill">Coins (demo): <b id="coins">0</b></span>

    <button onclick="newGame()">New Game</button>
    <button class="secondary" onclick="propHint()">Hint</button>
    <button class="secondary" onclick="propShuffle()">Shuffle</button>
    <button class="secondary" onclick="propFreeze()">Freeze +8s</button>

    <span class="small">|</span>
    <span class="small">Optional backend:</span>
    <input id="jwt" style="min-width:360px" placeholder="paste JWT to sync with backend (optional)" />
    <a href="/" class="small">API console</a>
  </div>

  <div id="grid" class="grid"></div>

  <div class="panel">
    <div><b>Last response / debug</b></div>
    <pre id="out">(none)</pre>
  </div>

<script>
const OUT = (x) => {
  const el = document.getElementById('out');
  el.textContent = typeof x === 'string' ? x : JSON.stringify(x, null, 2);
};

// Board uses 1-cell empty border: total (rows+2) x (cols+2)
const INNER_R = 8, INNER_C = 10;
const R = INNER_R + 2, C = INNER_C + 2;
const TILE_TYPES = 8;
const EMOJI = ['','🍎','🍋','🍇','🍓','🍒','🥝','🍑','🍍'];

let board = []; // [r][c] = tileType (0 empty)
let selected = null;
let hintCells = [];
let timer = null;
let timeLeft = 120;
let coins = 0;
let sessionToken = null;

function inBounds(r,c){ return r>=0 && r<R && c>=0 && c<C; }
function isEmpty(r,c){ return board[r][c]===0; }

function initEmpty(){
  board = Array.from({length:R}, ()=> Array.from({length:C}, ()=>0));
}

function playablePositions(){
  const ps=[];
  for(let r=1;r<=INNER_R;r++) for(let c=1;c<=INNER_C;c++) ps.push([r,c]);
  return ps;
}

function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function generate(){
  initEmpty();
  const ps=shuffle(playablePositions());
  const n=ps.length;
  if(n%2!==0) throw new Error('odd cells');
  const ts=[];
  for(let i=0;i<n/2;i++){
    const t=(i%TILE_TYPES)+1;
    ts.push(t,t);
  }
  shuffle(ts);
  for(let i=0;i<n;i++){
    const [r,c]=ps[i];
    board[r][c]=ts[i];
  }
  ensureHasMove();
}

const DIRS=[[-1,0],[0,1],[1,0],[0,-1]];

// BFS line-walk with <=2 turns
function findPath(a,b,maxTurns=2){
  const [ar,ac]=a,[br,bc]=b;
  const ta=board[ar][ac], tb=board[br][bc];
  if(!ta||!tb||ta!==tb) return null;
  if(ar===br && ac===bc) return null;

  const q=[];
  const seen=new Set();
  const pool=[];
  function push(st){
    const k=st.r+','+st.c+','+st.d+','+st.t;
    if(seen.has(k)) return;
    seen.add(k);
    pool.push(st);
    q.push(pool.length-1);
  }
  push({r:ar,c:ac,d:-1,t:0,prev:-1});

  while(q.length){
    const idx=q.shift();
    const cur=pool[idx];
    for(let nd=0; nd<4; nd++){
      const nt = (cur.d===-1 || cur.d===nd) ? cur.t : cur.t+1;
      if(nt>maxTurns) continue;
      let r=cur.r, c=cur.c;
      while(true){
        r+=DIRS[nd][0]; c+=DIRS[nd][1];
        if(!inBounds(r,c)) break;
        const isTarget = (r===br && c===bc);
        if(!isTarget && !isEmpty(r,c)) break;
        const nxt={r,c,d:nd,t:nt,prev:idx};
        if(isTarget) return reconstruct(nxt,pool);
        push(nxt);
      }
    }
  }
  return null;
}

function reconstruct(end,pool){
  const path=[[end.r,end.c]];
  let prev=end.prev;
  while(prev!==-1){
    const p=pool[prev];
    path.push([p.r,p.c]);
    prev=p.prev;
  }
  path.reverse();
  // compact duplicates
  const out=[];
  for(const p of path){
    const last=out[out.length-1];
    if(!last || last[0]!==p[0] || last[1]!==p[1]) out.push(p);
  }
  return out;
}

function remainingTiles(){
  let cnt=0;
  for(let r=1;r<=INNER_R;r++) for(let c=1;c<=INNER_C;c++) if(board[r][c]!==0) cnt++;
  return cnt;
}

function findAnyPair(){
  const tiles=[];
  for(let r=1;r<=INNER_R;r++) for(let c=1;c<=INNER_C;c++){
    const t=board[r][c];
    if(t) tiles.push([r,c,t]);
  }
  for(let i=0;i<tiles.length;i++){
    for(let j=i+1;j<tiles.length;j++){
      if(tiles[i][2]!==tiles[j][2]) continue;
      const p=findPath([tiles[i][0],tiles[i][1]],[tiles[j][0],tiles[j][1]],2);
      if(p) return {a:[tiles[i][0],tiles[i][1]], b:[tiles[j][0],tiles[j][1]], path:p};
    }
  }
  return null;
}

function shuffleBoard(){
  const ps=[]; const ts=[];
  for(let r=1;r<=INNER_R;r++) for(let c=1;c<=INNER_C;c++){
    const t=board[r][c];
    if(t){ ps.push([r,c]); ts.push(t); }
  }
  shuffle(ts);
  for(let i=0;i<ps.length;i++){
    const [r,c]=ps[i];
    board[r][c]=ts[i];
  }
}

function ensureHasMove(){
  for(let i=0;i<20;i++){
    if(findAnyPair()) return true;
    shuffleBoard();
  }
  return !!findAnyPair();
}

function render(){
  const g=document.getElementById('grid');
  g.style.gridTemplateColumns = "repeat(" + INNER_C + ", 48px)";
  g.innerHTML='';
  for(let r=1;r<=INNER_R;r++){
    for(let c=1;c<=INNER_C;c++){
      const t=board[r][c];
      const d=document.createElement('div');
      d.className='cell'+(t? ' tile':'');
      d.textContent = t? (EMOJI[t] || String(t)) : '';
      d.dataset.r=r; d.dataset.c=c;
      if(selected && selected[0]===r && selected[1]===c) d.classList.add('sel');
      for(const hc of hintCells){ if(hc[0]===r && hc[1]===c) d.classList.add('hint'); }
      d.onclick=()=>onClick(r,c);
      g.appendChild(d);
    }
  }
  document.getElementById('remain').textContent = String(remainingTiles()/2);
  document.getElementById('time').textContent = String(timeLeft);
  document.getElementById('coins').textContent = String(coins);
}

function onClick(r,c){
  if(timeLeft<=0) return;
  if(board[r][c]===0) return;
  hintCells=[];
  if(!selected){ selected=[r,c]; render(); return; }
  const a=selected; const b=[r,c];
  selected=null;
  const path=findPath(a,b,2);
  if(!path){ render(); return; }
  // remove
  board[a[0]][a[1]]=0;
  board[b[0]][b[1]]=0;
  coins += 10;
  if(remainingTiles()===0){
    win();
  } else {
    ensureHasMove();
    render();
  }
}

function tick(){
  timeLeft -= 1;
  if(timeLeft<=0){ timeLeft=0; render(); lose(); return; }
  render();
}

async function backendStart(){
  const jwt=document.getElementById('jwt').value.trim();
  if(!jwt) return;
  const r = await fetch('/v1/game/start',{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify({uid:'u_demo',levelId:1})});
  const j=await r.json().catch(()=>null);
  sessionToken = j?.data?.sessionToken || null;
  OUT({backendStart:j});
}

async function backendFinish(result){
  const jwt=document.getElementById('jwt').value.trim();
  if(!jwt || !sessionToken) return;
  const r = await fetch('/v1/game/finish',{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify({uid:'u_demo',levelId:1,result,score:999,durationSec:120-timeLeft,stars:3,sessionToken})});
  const j=await r.json().catch(()=>null);
  OUT({backendFinish:j});
}

function win(){
  clearInterval(timer);
  backendFinish('success');
  setTimeout(()=>alert('Win!'), 50);
}
function lose(){
  clearInterval(timer);
  backendFinish('fail');
  setTimeout(()=>alert('Time up!'), 50);
}

function newGame(){
  clearInterval(timer);
  timeLeft=120;
  coins=0;
  selected=null;
  hintCells=[];
  sessionToken=null;
  generate();
  render();
  backendStart();
  timer=setInterval(tick, 1000);
}

function propHint(){
  const p=findAnyPair();
  hintCells = p ? [p.a, p.b] : [];
  render();
  OUT({hint:p});
}

function propShuffle(){
  shuffleBoard();
  ensureHasMove();
  render();
}

function propFreeze(){
  timeLeft += 8;
  render();
}

// auto start
newGame();
</script>
</body>
</html>`;


const sessions = new Map();

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.url === '/healthz') return send(res, 200, { ok: true, service: 'llk-backend' }, requestId);
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(302, { Location: '/match3' });
      res.end();
      return;
    }

    if (req.method === 'GET' && (req.url.startsWith('/llk'))) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(DEMO_HTML);
      return;
    }

    if (req.method === 'GET' && (req.url.startsWith('/console'))) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(CONSOLE_HTML);
      return;
    }


    
    if (req.method === 'GET' && (req.url === '/llk' || req.url.startsWith('/llk?'))) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(DEMO_HTML);
      return;
    }

    if (req.method === 'GET' && (req.url === '/match3' || req.url.startsWith('/match3?'))) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(MATCH3_HTML);
      return;
    }
const a = auth(req);
    if (!a.ok) return send(res, 401, { code: 1002, message: 'UNAUTHORIZED' }, requestId);

    // Routes
    if (req.method === 'GET' && req.url.startsWith('/v1/user/progress')) {
      const u = new URL(req.url, 'http://x');
      const uid = u.searchParams.get('uid') || a.uid;
      const row = await getOrInit(uid);
      return send(res, 200, { code: 0, message: 'OK', data: row }, requestId);
    }

    if (req.method === 'POST' && req.url === '/v1/game/start') {
      const b = await readJson(req);
      const uid = b.uid || a.uid;
      const { levelId } = b;
      if (!uid || !levelId) return send(res, 400, { code: 1001, message: 'INVALID_PARAM' }, requestId);
      const token = crypto.randomUUID();
      sessions.set(token, { uid, levelId, startedAt: Date.now() });
      return send(res, 200, { code: 0, message: 'OK', data: { sessionToken: token } }, requestId);
    }

    if (req.method === 'POST' && req.url === '/v1/game/finish') {
      const b = await readJson(req);
      const uid = b.uid || a.uid;
      const { levelId, result, score = 0, durationSec = 0, stars = 0, propsUsed = {}, sessionToken } = b;
      if (!uid || !levelId || !result || !sessionToken) return send(res, 400, { code: 1001, message: 'INVALID_PARAM' }, requestId);
      const s = sessions.get(sessionToken);
      if (!s || s.uid !== uid || s.levelId !== levelId) return send(res, 400, { code: 2002, message: 'INVALID_SESSION' }, requestId);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          `INSERT INTO level_record(uid, level_id, result, score, duration_sec, stars, props_used_json)
           VALUES(?,?,?,?,?,?,?)`,
          [uid, levelId, result, score, durationSec, stars, JSON.stringify(propsUsed)]
        );
        let coins = 0;
        if (result === 'success') {
          coins = Math.min(80, 30 + stars * 10);
          await conn.query(
            `INSERT INTO user_progress(uid, max_level, coins)
             VALUES(?, ?, ?)
             ON DUPLICATE KEY UPDATE max_level=GREATEST(max_level, VALUES(max_level)), coins=coins+VALUES(coins)`,
            [uid, levelId, coins]
          );
        }
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }

      sessions.delete(sessionToken);
      return send(res, 200, { code: 0, message: 'OK' }, requestId);
    }

    if (req.method === 'POST' && req.url === '/v1/ad/reward/claim') {
      const b = await readJson(req);
      const uid = b.uid || a.uid;
      const { scene, adTicket } = b;
      if (!uid || !scene || !adTicket) return send(res, 400, { code: 1001, message: 'INVALID_PARAM' }, requestId);
      const rewardByScene = { revive: { deltaFreeze: 1 }, double: { deltaCoins: 50 }, prop: { deltaHint: 1 } };
      const r = rewardByScene[scene];
      if (!r) return send(res, 400, { code: 3001, message: 'AD_VERIFY_FAIL' }, requestId);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        try {
          await conn.query(
            `INSERT INTO ad_reward_log(uid, scene, ad_ticket, grant_status, reward_json) VALUES(?,?,?,?,?)`,
            [uid, scene, adTicket, 'success', JSON.stringify(r)]
          );
        } catch {
          await conn.rollback();
          return send(res, 200, { code: 3002, message: 'AD_TICKET_DUPLICATE' }, requestId);
        }
        await conn.query('INSERT INTO user_progress(uid) VALUES(?) ON DUPLICATE KEY UPDATE uid=uid', [uid]);
        await conn.query(
          `UPDATE user_progress SET coins=coins+?, hint_count=hint_count+?, shuffle_count=shuffle_count+?, freeze_count=freeze_count+? WHERE uid=?`,
          [r.deltaCoins || 0, r.deltaHint || 0, r.deltaShuffle || 0, r.deltaFreeze || 0, uid]
        );
        await conn.commit();
        return send(res, 200, { code: 0, message: 'OK', data: r }, requestId);
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    }

    if (req.method === 'POST' && req.url === '/v1/payment/verify') {
      const b = await readJson(req);
      const uid = b.uid || a.uid;
      const { sku, platformOrderId } = b;
      if (!uid || !sku || !platformOrderId) return send(res, 400, { code: 1001, message: 'INVALID_PARAM' }, requestId);
      const skuMap = { starter_pack_6: { amountCent: 600, deltaCoins: 300, deltaHint: 3, deltaShuffle: 3, deltaFreeze: 1 } };
      const g = skuMap[sku];
      if (!g) return send(res, 400, { code: 4004, message: 'SKU_INVALID' }, requestId);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [exists] = await conn.query('SELECT * FROM iap_order WHERE platform_order_id=? FOR UPDATE', [platformOrderId]);
        if (exists.length && exists[0].status === 'paid') {
          await conn.commit();
          return send(res, 200, { code: 0, message: 'OK', data: { idempotent: true } }, requestId);
        }
        if (!exists.length) {
          await conn.query(
            `INSERT INTO iap_order(uid, sku, platform_order_id, amount_cent, status) VALUES(?,?,?,?,?)`,
            [uid, sku, platformOrderId, g.amountCent, 'created']
          );
        }
        await conn.query('UPDATE iap_order SET status=? WHERE platform_order_id=?', ['paid', platformOrderId]);
        await conn.query('INSERT INTO user_progress(uid) VALUES(?) ON DUPLICATE KEY UPDATE uid=uid', [uid]);
        await conn.query(
          `UPDATE user_progress SET coins=coins+?, hint_count=hint_count+?, shuffle_count=shuffle_count+?, freeze_count=freeze_count+? WHERE uid=?`,
          [g.deltaCoins, g.deltaHint, g.deltaShuffle, g.deltaFreeze, uid]
        );
        await conn.commit();
        return send(res, 200, { code: 0, message: 'OK', data: { paid: true } }, requestId);
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    }

    return send(res, 404, { code: 1001, message: 'NOT_FOUND' }, requestId);
  } catch (e) {
    return send(res, 500, { code: 1005, message: 'INTERNAL_ERROR', detail: String(e.message || e) }, requestId);
  }
});

server.listen(PORT, () => console.log('llk-backend listening on', PORT));
