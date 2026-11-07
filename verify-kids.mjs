/**
 * Cube Shape Lab 兒童版驗證腳本
 * 1. console error = 0、pageerror = 0
 * 2. 分層放置測試：隨機 10 格 → 計數精確 10；再點一格 → 9；復原 → 10
 * 3. 關卡流程測試：完成第 1 關 → 星星 +1 → localStorage 有紀錄 → 進入第 2 關
 * 4. 家長區防誤觸：1 次點擊不開啟；連按 5 次開啟
 * 5. 截圖輸出到 projects/cube-shape-lab/.shots/
 */
import fs from 'node:fs';

/* playwright 由 /tmp/cube-verify/node_modules 提供（此專案不帶 npm 依賴） */
async function loadPlaywright() {
  const candidates = ['playwright', '/tmp/cube-verify/node_modules/playwright/index.js'];
  for (const c of candidates) {
    try { return await import(c); } catch (e) { /* 試下一個 */ }
  }
  throw new Error('找不到 playwright 模組');
}
const pw = await loadPlaywright();
const chromium = pw.chromium || (pw.default && pw.default.chromium);

const URL = 'http://127.0.0.1:8124/index.html';
const SHOTS = '/root/.openclaw/workspace/projects/cube-shape-lab/.shots';
fs.mkdirSync(SHOTS, { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const results = [];

function ok(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });

page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e && e.stack ? e.stack : e)));
page.on('requestfailed', (r) => {
  const f = r.failure();
  consoleErrors.push('REQUEST FAILED ' + r.url() + ' :: ' + (f ? f.errorText : 'unknown'));
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__cubeLab && window.__cubeLab.ready, null, { timeout: 20000 });
await page.waitForTimeout(1500);

/* ---------------- 1. 基本狀態 ---------------- */
const boot = await page.evaluate(() => {
  const gl = document.getElementById('scene').getContext('webgl2') || document.getElementById('scene').getContext('webgl');
  return {
    state: window.__cubeLab.getState(),
    webgl: !!gl,
    levels: window.__cubeLab.levels().length
  };
});
ok('WebGL 正常', boot.webgl === true);
ok('關卡數量 = 20', boot.levels === 20, 'levels=' + boot.levels);

/* ---------------- 2. 分層放置測試 ---------------- */
async function clickCell(cell) {
  const p = await page.evaluate(([x, y, z]) => window.__cubeLab.cellScreen(x, y, z), [cell.x, cell.y, cell.z]);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(45);
  return p;
}

await page.evaluate(() => { window.__cubeLab.clearAll(); window.__cubeLab.setLayer(2); });
await page.waitForTimeout(200);

// 隨機抽 10 個「當前層可見且未被遮擋」的格點
const picks = await page.evaluate(() => {
  const cells = window.__cubeLab.visibleCells();
  const out = [];
  const used = new Set();
  let guard = 0;
  while (out.length < 10 && guard < 500) {
    guard++;
    const c = cells[Math.floor(Math.random() * cells.length)];
    const k = c.x + ',' + c.y + ',' + c.z;
    if (used.has(k)) continue;
    used.add(k);
    out.push(c);
  }
  return out;
});
ok('可抽到 10 個可見格點', picks.length === 10, 'got=' + picks.length);

for (const c of picks) await clickCell(c);
const afterTen = await page.evaluate(() => window.__cubeLab.getState());
ok('分層放置：10 次點擊 → 計數精確為 10', afterTen.count === 10, 'count=' + afterTen.count);

// 再點其中一格 → 應該變成 9
await clickCell(picks[3]);
const afterNine = await page.evaluate(() => window.__cubeLab.getState());
ok('分層放置：再點一格 → 計數 9', afterNine.count === 9, 'count=' + afterNine.count);

// 復原（再點一次）→ 應該變回 10
await clickCell(picks[3]);
const afterRestore = await page.evaluate(() => window.__cubeLab.getState());
ok('分層放置：復原 → 計數 10', afterRestore.count === 10, 'count=' + afterRestore.count);

// 位置正確性：每一格都應在第 2 層（y = 2）
const layerOk = await page.evaluate((want) => {
  const cells = window.__cubeLab.getState().cells;
  return cells.length === 10 && cells.every((c) => c.y === want);
}, 2);
ok('分層放置：全部落在目前層（y=2）', layerOk === true);

// 換層：第 1 層不應有方塊，且可繼續放置
await page.evaluate(() => window.__cubeLab.setLayer(0));
await page.waitForTimeout(150);
const layerSwitch = await page.evaluate(() => window.__cubeLab.getState());
ok('切換層：方塊保留、層號更新', layerSwitch.count === 10 && layerSwitch.layer === 0,
  'count=' + layerSwitch.count + ' layer=' + layerSwitch.layer);
await page.evaluate(() => window.__cubeLab.clearAll());

/* ---------------- 3. 關卡流程測試 ---------------- */
await page.evaluate(() => { localStorage.removeItem('cube-shape-lab-kids-progress'); });
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__cubeLab && window.__cubeLab.ready);
await page.waitForTimeout(1200);

await page.evaluate(() => window.__cubeLab.startLevel(0));
await page.waitForTimeout(400);
const lv = await page.evaluate(() => window.__cubeLab.levelData(0));
for (const c of lv.cells) {
  await page.evaluate((y) => window.__cubeLab.setLayer(y), c[1]);
  await page.waitForTimeout(80);
  await clickCell({ x: c[0], y: c[1], z: c[2] });
}
const built = await page.evaluate(() => window.__cubeLab.getState());
ok('第 1 關：按目標形狀放置完成', built.count === lv.cells.length, 'count=' + built.count + '/' + lv.cells.length);

const phase = await page.evaluate(() => window.__cubeLab.checkLevel());
ok('第 1 關：檢查答案 → solved', phase === 'solved', 'phase=' + phase);

await page.waitForTimeout(400);
const stored = await page.evaluate(() => {
  const raw = localStorage.getItem('cube-shape-lab-kids-progress');
  return raw ? JSON.parse(raw) : null;
});
const storedStars = stored && stored.stars ? stored.stars['1'] : 0;
ok('第 1 關：星星 +1 並寫入 localStorage', storedStars >= 1,
  'stars=' + storedStars + ' completed=' + JSON.stringify(stored && stored.completed));
ok('星星 UI 同步', (await page.evaluate(() => window.__cubeLab.getState().stars)) === storedStars);

/* 進入第 2 關 */
await page.click('#win-next');
await page.waitForTimeout(600);
const lv2 = await page.evaluate(() => window.__cubeLab.getState());
ok('進入第 2 關', lv2.currentLevel === 2 && lv2.levelPhase === 'active',
  'level=' + lv2.currentLevel + ' phase=' + lv2.levelPhase);

/* 心理旋轉關卡：答錯有提示、答對完成（候選模型在主場景，須在關卡模式） */
await page.click('.tab[data-mode="level"]');
await page.waitForTimeout(300);
await page.evaluate(() => window.__cubeLab.startLevel(6));
await page.waitForTimeout(900);
const mental = await page.evaluate(() => {
  const s = window.__cubeLab.getState();
  return { type: s.currentLevelType, level: s.currentLevel };
});
ok('心理旋轉關卡載入', mental.type === 'mental' && mental.level === 7, JSON.stringify(mental));
const candCount = await page.evaluate(() => document.querySelectorAll('#lv-cands .candbtn').length);
ok('心理旋轉：3 個候選模型', candCount === 3, 'cands=' + candCount);

/* 在主場景點選候選模型：答錯應有提示，答對應完成關卡 */
const g = await page.evaluate(() => window.__cubeLab.gallery());
ok('心理旋轉：候選模型顯示於主場景', g.active === true && g.count === 3 && g.visible === true,
  JSON.stringify({ active: g.active, count: g.count, visible: g.visible }));
const wrongIndex = g.correctIndex === 0 ? 1 : 0;
await page.mouse.click(g.modelScreen[wrongIndex].x, g.modelScreen[wrongIndex].y);
await page.waitForTimeout(600);
const afterWrong = await page.evaluate(() => window.__cubeLab.getState());
ok('心理旋轉：答錯不會完成關卡', afterWrong.levelPhase === 'active', 'phase=' + afterWrong.levelPhase);
await page.mouse.click(g.modelScreen[g.correctIndex].x, g.modelScreen[g.correctIndex].y);
await page.waitForTimeout(700);
const afterRight = await page.evaluate(() => window.__cubeLab.getState());
ok('心理旋轉：答對即完成關卡', afterRight.levelPhase === 'solved', 'phase=' + afterRight.levelPhase);

/* ---------------- 4. 角度挑戰關卡 ---------------- */
await page.evaluate(() => window.__cubeLab.startLevel(14));
await page.waitForTimeout(500);
const angle = await page.evaluate(() => {
  const c = document.getElementById('lv-proj');
  const ctx = c.getContext('2d');
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 10) painted++;
  return { type: window.__cubeLab.getState().currentLevelType, painted, hidden: c.hidden };
});
ok('角度挑戰：2D 投影已繪製', angle.type === 'angle' && angle.painted > 500, JSON.stringify(angle));

/* ---------------- 5. 家長區防誤觸 ---------------- */
await page.evaluate(() => {
  document.getElementById('win-modal').classList.remove('show');
  window.__cubeLab.startLevel(0);
});
await page.waitForTimeout(400);
const parentBefore = await page.evaluate(() => document.getElementById('parent-modal').classList.contains('show'));
await page.click('#btn-parent');
await page.waitForTimeout(400);
const parentAfter1 = await page.evaluate(() => document.getElementById('parent-modal').classList.contains('show'));
ok('家長區：單次點擊不會開啟', parentBefore === false && parentAfter1 === false);
await page.waitForTimeout(2200);   // 等連按計數器重置
for (let i = 0; i < 6; i++) {
  const shown = await page.evaluate(() => document.getElementById('parent-modal').classList.contains('show'));
  if (shown) break;
  await page.click('#btn-parent');
  await page.waitForTimeout(160);
}
await page.waitForTimeout(400);
const parentAfter5 = await page.evaluate(() => document.getElementById('parent-modal').classList.contains('show'));
ok('家長區：連按 5 次開啟', parentAfter5 === true);
await page.click('#parent-close');
await page.waitForTimeout(300);

/* ---------------- 6. 其他功能驗證 ---------------- */
// (a) 提示功能：應高亮下一格並自動切換到該層
await page.evaluate(() => { document.getElementById('win-modal').classList.remove('show'); });
await page.click('.tab[data-mode="level"]');
await page.evaluate(() => window.__cubeLab.startLevel(2));
await page.waitForTimeout(500);
const hintInfo = await page.evaluate(() => {
  const lv = window.__cubeLab.levelData(2);
  const c = lv.cells[0];
  window.__cubeLab.setLayer(c[1]);
  return { y: c[1] };
});
const hintUsed = await page.evaluate(() => window.__cubeLab.hintLevel());
const hintState = await page.evaluate(() => window.__cubeLab.getState());
ok('提示功能：計次並切換到目標層', hintUsed === 1 && hintState.layer === hintInfo.y,
  'hints=' + hintUsed + ' layer=' + hintState.layer + '/' + hintInfo.y);

// (b) 角度挑戰：按目標形狀搭建後，投影相同即通過
await page.evaluate(() => window.__cubeLab.startLevel(14));
await page.waitForTimeout(600);
const angleLv = await page.evaluate(() => window.__cubeLab.levelData(14));
for (const c of angleLv.cells) {
  await page.evaluate((y) => window.__cubeLab.setLayer(y), c[1]);
  await page.waitForTimeout(60);
  await clickCell({ x: c[0], y: c[1], z: c[2] });
}
const anglePhase = await page.evaluate(() => window.__cubeLab.checkLevel());
ok('角度挑戰：投影相同即通過', anglePhase === 'solved', 'phase=' + anglePhase);
await page.evaluate(() => document.getElementById('win-modal').classList.remove('show'));

// (c) 家長區設定：格點大小與字級
await page.evaluate(() => window.__cubeLab.setSetting('gridSize', 3));
await page.waitForTimeout(400);
const gridState = await page.evaluate(() => ({
  grid: window.__cubeLab.getState().grid,
  layers: document.querySelectorAll('#layer-bar .layer-btn').length
}));
ok('家長區：格點可改為 3×3×3', gridState.grid === 3 && gridState.layers === 3, JSON.stringify(gridState));
await page.evaluate(() => window.__cubeLab.setSetting('gridSize', 5));
await page.waitForTimeout(300);
await page.evaluate(() => window.__cubeLab.setSetting('fontScale', 'xlarge'));
await page.waitForTimeout(300);
const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
ok('家長區：字級可調至特大 (26px)', fontSize === '26px', 'font=' + fontSize);
await page.evaluate(() => window.__cubeLab.setSetting('fontScale', 'large'));
await page.waitForTimeout(200);

/* ---------------- 7. 截圖 ---------------- */
async function shot(name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOTS + '/' + name });
  const st = fs.statSync(SHOTS + '/' + name);
  console.log('SHOT | ' + name + ' | ' + st.size + ' bytes');
}

// (1) 建造模式（含層選擇器）
await page.click('.tab[data-mode="build"]');
await page.evaluate(() => { document.getElementById('panel').scrollTop = 0; });
await page.evaluate(() => {
  window.__cubeLab.clearAll();
  window.__cubeLab.setLayer(1);
  window.__cubeLab.answerMental; // no-op
});
await page.waitForTimeout(300);
// 放幾粒小正方體，令畫面更有內容
const demoCells = [
  { x: 1, y: 1, z: 1 }, { x: 2, y: 1, z: 1 }, { x: 2, y: 1, z: 2 },
  { x: 2, y: 2, z: 2 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 0 }
];
for (const c of demoCells) {
  await page.evaluate(([y]) => window.__cubeLab.setLayer(y), [c.y]);
  await clickCell(c);
}
await page.evaluate(() => window.__cubeLab.setLayer(1));
await page.waitForTimeout(400);
await shot('kids-build.png');

// (2) 第 1 關照樣搭建
await page.click('.tab[data-mode="level"]');
await page.waitForTimeout(400);
await page.evaluate(() => { document.getElementById('panel').scrollTop = 0; });
await page.evaluate(() => window.__cubeLab.startLevel(0));
await page.waitForTimeout(1200);
await shot('kids-level1.png');

// (3) 心理旋轉題
await page.evaluate(() => window.__cubeLab.startLevel(6));
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const block = document.getElementById('lv-cand-block');
  if (block) block.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(800);
await shot('kids-quiz.png');

// (4) 進度頁
await page.click('.tab[data-mode="progress"]');
await page.waitForTimeout(700);
await shot('kids-progress.png');

// (5) 家長區
await page.evaluate(() => { for (let i = 0; i < 5; i++) document.getElementById('btn-parent').click(); });
await page.waitForTimeout(700);
await shot('kids-parent.png');

// (d) 記憶小挑戰（原型保留並降級）
await page.evaluate(() => {
  document.getElementById('parent-modal').classList.remove('show');
  document.getElementById('win-modal').classList.remove('show');
});
await page.click('.tab[data-mode="level"]');
await page.waitForTimeout(300);
await page.click('#btn-start');
await page.waitForTimeout(700);
const memState = await page.evaluate(() => ({
  active: window.__cubeLab.getState().memoryActive,
  phase: window.__cubeLab.getState().phase,
  countdown: document.getElementById('countdown').classList.contains('show')
}));
ok('記憶小挑戰可啟動並顯示倒數', memState.active === true && memState.phase === 'memory' && memState.countdown === true,
  JSON.stringify(memState));

/* ---------------- 7. 錯誤檢查 ---------------- */
ok('console error = 0', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 4)));
ok('pageerror = 0', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 4)));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log('\n=== 總結 ===');
console.log('通過 ' + (results.length - failed.length) + ' / ' + results.length);
if (failed.length) {
  for (const f of failed) console.log('未通過: ' + f.name + ' | ' + (f.detail || ''));
  process.exit(1);
}
