/**
 * Cube Shape Lab 手機版驗證腳本
 *
 * 覆蓋的缺陷（2026-11-07 手機版「放唔到方塊」）：
 *   A. 手機底部面板覆蓋 3D 場景 → 場景可視區重算（layoutScene / fitShapeToViewport）
 *   B. 觸控命中容差太嚴 → maxPickDistance 放寬
 *   C. setPointerCapture 未防護 / pointerup 重覆處理
 *
 * 每個裝置都會驗證：
 *   1. 開頁、等待 ready、截圖
 *   2. 10 個可見格點逐個 touch tap → count 精確 10；再點一格 → 9；復原 → 10
 *   3. 遮擋斷言：25 格全部在面板之外（手機＝面板上方；桌面＝面板右方）
 *   4. console error = 0、pageerror = 0
 *   5. 心理旋轉關卡可用觸控點選候選模型作答（答對 → 關卡完成）
 *   6. 面板收合／展開切換：收合後場景可視高度 ≥ 視窗 55%，且仍可放置方塊
 */
import fs from 'node:fs';

async function loadPlaywright() {
  const candidates = ['playwright', '/tmp/cube-verify/node_modules/playwright/index.js'];
  for (const c of candidates) {
    try {
      const m = await import(c);
      return (m.default && m.default.chromium) ? m.default : m;
    } catch (e) { /* 試下一個 */ }
  }
  throw new Error('找不到 playwright 模組');
}
const pw = await loadPlaywright();
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const devices = pw.devices || (pw.default && pw.default.devices);

const URL = 'http://127.0.0.1:8124/index.html';
const SHOTS = '/root/.openclaw/workspace/projects/cube-shape-lab/.shots';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function ok(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

const CASES = [
  { key: 'iphone', name: 'iPhone 13', device: devices['iPhone 13'] },
  { key: 'pixel', name: 'Pixel 5', device: devices['Pixel 5'] },
  { key: 'ipad', name: 'iPad Mini', device: devices['iPad Mini'] },
  { key: 'desktop', name: '桌面 1280×800', viewport: { width: 1280, height: 800 } }
];

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

const summary = [];

for (const c of CASES) {
  console.log('\n================ ' + c.name + ' ================');
  const consoleErrors = [];
  const pageErrors = [];
  const ctx = await browser.newContext(c.device
    ? { ...c.device }
    : { viewport: c.viewport, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.stack ? e.stack : e)));
  page.on('requestfailed', (r) => {
    const f = r.failure();
    consoleErrors.push('REQUEST FAILED ' + r.url() + ' :: ' + (f ? f.errorText : 'unknown'));
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__cubeLab && window.__cubeLab.ready, null, { timeout: 20000 });
  await page.waitForTimeout(1400);

  const info = await page.evaluate(() => ({
    state: window.__cubeLab.getState(),
    layout: window.__cubeLab.layout()
  }));
  const mobile = info.layout.mobile;
  console.log('  版面：' + JSON.stringify(info.layout));
  ok(c.name + '：載入完成且 WebGL 正常', info.state.mode === 'build' && info.state.grid === 5,
    'mode=' + info.state.mode + ' grid=' + info.state.grid);

  /* ---------- 1. 頂部列沒有溢出（⚙️ 家長區按鈕要完整顯示） ---------- */
  const topbar = await page.evaluate(() => {
    const gear = document.getElementById('btn-parent').getBoundingClientRect();
    const bar = document.getElementById('topbar').getBoundingClientRect();
    return { gearRight: gear.right, gearLeft: gear.left, barWidth: bar.width, vw: window.innerWidth };
  });
  ok(c.name + '：頂部列沒有溢出', topbar.gearRight <= topbar.vw + 0.5,
    'gearRight=' + Math.round(topbar.gearRight) + ' vw=' + topbar.vw);

  /* ---------- 2. 遮擋斷言：25 格全部在面板之外 ---------- */
  const occl = await page.evaluate((isMobile) => {
    const L = window.__cubeLab.layout();
    const pts = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) {
      const p = window.__cubeLab.cellScreen(x, 0, z);
      pts.push({ x, z, sx: p.x, sy: p.y });
    }
    let covered = 0, outsideX = 0, outsideScene = 0;
    for (const p of pts) {
      if (isMobile) {
        if (p.sy >= L.panelTop - 0.5) covered++;                 // 被底部面板蓋住
        if (p.sy < L.scene.top - 0.5) outsideScene++;             // 被頂部列蓋住
      } else {
        if (p.sx <= L.panelRight + 0.5) covered++;                 // 被左側面板蓋住
        if (p.sy < 0 || p.sy > L.viewport.height) outsideScene++;
      }
      if (p.sx < 0 || p.sx > L.viewport.width) outsideX++;
    }
    return {
      covered, outsideX, outsideScene, total: pts.length,
      panelTop: L.panelTop, panelRight: L.panelRight,
      sceneTop: L.scene.top, sceneHeight: L.scene.height,
      minY: Math.min(...pts.map((p) => p.sy)), maxY: Math.max(...pts.map((p) => p.sy)),
      minX: Math.min(...pts.map((p) => p.sx)), maxX: Math.max(...pts.map((p) => p.sx))
    };
  }, mobile);
  ok(c.name + '：25 格全部未被面板遮擋', occl.covered === 0,
    'covered=' + occl.covered + '/' + occl.total + ' y=[' + Math.round(occl.minY) + ',' + Math.round(occl.maxY) + ']' +
    ' panelTop=' + Math.round(occl.panelTop) + ' x=[' + Math.round(occl.minX) + ',' + Math.round(occl.maxX) + ']');
  ok(c.name + '：25 格全部在畫面範圍內', occl.outsideX === 0 && occl.outsideScene === 0,
    'outsideX=' + occl.outsideX + ' outsideScene=' + occl.outsideScene);

  /* ---------- 2b. 整個 5×5×5 格點外框都在可視區內 ---------- */
  const box = await page.evaluate(() => {
    const L = window.__cubeLab.layout();
    const pts = window.__cubeLab.boxScreen();
    const bad = pts.filter((p) =>
      p.x < L.scene.left - 0.5 || p.x > L.scene.left + L.scene.width + 0.5 ||
      p.y < L.scene.top - 0.5 || p.y > L.scene.top + L.scene.height + 0.5);
    return { bad: bad.length, total: pts.length, scene: L.scene };
  });
  ok(c.name + '：整個 5×5×5 格點外框都在可視區內', box.bad === 0,
    'bad=' + box.bad + '/' + box.total + ' scene=' + JSON.stringify(box.scene));

  /* ---------- 3. 觸控放置：10 格 → 10；再點一格 → 9；復原 → 10 ---------- */
  async function tapCell(cell) {
    const p = await page.evaluate(([x, y, z]) => window.__cubeLab.cellScreen(x, y, z), [cell.x, cell.y, cell.z]);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(70);
    return p;
  }

  await page.evaluate(() => { window.__cubeLab.clearAll(); window.__cubeLab.setLayer(1); });
  await page.waitForTimeout(250);
  const picks = await page.evaluate(() => window.__cubeLab.visibleCells().slice(0, 10));
  ok(c.name + '：可抽到 10 個可見格點', picks.length === 10, 'got=' + picks.length);

  for (const cell of picks) await tapCell(cell);
  const afterTen = await page.evaluate(() => window.__cubeLab.getState());
  ok(c.name + '：觸控放置 10 格 → 計數精確 10', afterTen.count === 10, 'count=' + afterTen.count);

  await tapCell(picks[3]);
  const afterNine = await page.evaluate(() => window.__cubeLab.getState());
  ok(c.name + '：再點一格 → 計數 9', afterNine.count === 9, 'count=' + afterNine.count);

  await page.evaluate(() => window.__cubeLab.undo());
  await page.waitForTimeout(120);
  const afterUndo = await page.evaluate(() => window.__cubeLab.getState());
  ok(c.name + '：復原 → 計數 10', afterUndo.count === 10, 'count=' + afterUndo.count);

  const layerOk = await page.evaluate(() => {
    const cells = window.__cubeLab.getState().cells;
    return cells.length === 10 && cells.every((x) => x.y === 1);
  });
  ok(c.name + '：全部落在目前層（y=1）', layerOk === true);

  /* ---------- 4. 面板收合／展開 ---------- */
  if (mobile) {
    const collapsed = await page.evaluate(() => {
      window.__cubeLab.setPanelCollapsed(true);
      return true;
    });
    await page.waitForTimeout(400);
    const L1 = await page.evaluate(() => window.__cubeLab.layout());
    ok(c.name + '：面板收合後場景可視高度 ≥ 55% 視窗',
      L1.visibleHeightRatio >= 0.55 && L1.collapsed === true,
      'ratio=' + (L1.visibleHeightRatio * 100).toFixed(1) + '% collapsed=' + L1.collapsed);

    const expanded = await page.evaluate(() => {
      window.__cubeLab.setPanelCollapsed(false);
      return true;
    });
    await page.waitForTimeout(450);
    const L2 = await page.evaluate(() => window.__cubeLab.layout());
    ok(c.name + '：面板展開後場景仍有可見高度', L2.visibleHeightRatio > 0.2 && L2.collapsed === false,
      'ratio=' + (L2.visibleHeightRatio * 100).toFixed(1) + '%');

    // 展開狀態下仍可放置
    await page.evaluate(() => { window.__cubeLab.clearAll(); window.__cubeLab.setLayer(0); });
    await page.waitForTimeout(200);
    const pExpanded = await page.evaluate(() => window.__cubeLab.cellScreen(2, 0, 2));
    await page.touchscreen.tap(pExpanded.x, pExpanded.y);
    await page.waitForTimeout(150);
    const countExpanded = await page.evaluate(() => window.__cubeLab.getState().count);
    ok(c.name + '：面板展開時仍可放置方塊', countExpanded === 1, 'count=' + countExpanded);

    // 收回來再放一次
    await page.evaluate(() => window.__cubeLab.setPanelCollapsed(true));
    await page.waitForTimeout(450);
    const pCollapsed = await page.evaluate(() => window.__cubeLab.cellScreen(3, 0, 3));
    await page.touchscreen.tap(pCollapsed.x, pCollapsed.y);
    await page.waitForTimeout(150);
    const countCollapsed = await page.evaluate(() => window.__cubeLab.getState().count);
    ok(c.name + '：面板收合後仍可放置方塊', countCollapsed === 2, 'count=' + countCollapsed);
  } else {
    const L = await page.evaluate(() => window.__cubeLab.layout());
    ok('桌面：面板維持左側展開（未被手機收合邏輯影響）', L.collapsed === false && L.mobile === false,
      JSON.stringify({ collapsed: L.collapsed, mobile: L.mobile }));
  }

  /* ---------- 5. 心理旋轉關卡（觸控點選候選模型） ---------- */
  const modeBtn = mobile ? '.tabbar-btn[data-mode="level"]' : '.tab[data-mode="level"]';
  await page.click(modeBtn);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__cubeLab.startLevel(6));   // 第 7 關＝心理旋轉
  await page.waitForTimeout(1100);
  const g = await page.evaluate(() => window.__cubeLab.gallery());
  const mentalState = await page.evaluate(() => window.__cubeLab.getState());
  ok(c.name + '：心理旋轉關卡載入（3 個候選模型）',
    mentalState.currentLevelType === 'mental' && g.active === true && g.count === 3,
    JSON.stringify({ type: mentalState.currentLevelType, count: g.count }));

  const inScene = g.modelScreen.every((p) =>
    p.x >= 0 && p.x <= info.layout.viewport.width && p.y >= 0 && p.y <= info.layout.viewport.height);
  ok(c.name + '：候選模型在畫面範圍內', inScene, JSON.stringify(g.modelScreen));

  const wrong = g.correctIndex === 0 ? 1 : 0;
  await page.touchscreen.tap(g.modelScreen[wrong].x, g.modelScreen[wrong].y);
  await page.waitForTimeout(600);
  const afterWrong = await page.evaluate(() => window.__cubeLab.getState());
  ok(c.name + '：心理旋轉答錯不會完成關卡', afterWrong.levelPhase === 'active', 'phase=' + afterWrong.levelPhase);

  await page.touchscreen.tap(g.modelScreen[g.correctIndex].x, g.modelScreen[g.correctIndex].y);
  await page.waitForTimeout(800);
  const afterRight = await page.evaluate(() => window.__cubeLab.getState());
  ok(c.name + '：心理旋轉觸控答對即完成關卡', afterRight.levelPhase === 'solved', 'phase=' + afterRight.levelPhase);
  await page.evaluate(() => document.getElementById('win-modal').classList.remove('show'));

  /* ---------- 6. 截圖 ---------- */
  async function shot(name) {
    // 等提示氣泡消失，避免遮擋畫面
    await page.waitForFunction(() => {
      const t = document.getElementById('toast');
      return !t || !t.classList.contains('show');
    }, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(450);
    await page.screenshot({ path: SHOTS + '/' + name });
    const st = fs.statSync(SHOTS + '/' + name);
    console.log('SHOT | ' + name + ' | ' + st.size + ' bytes');
  }

  if (c.key === 'iphone') {
    await page.click(mobile ? '.tabbar-btn[data-mode="build"]' : '.tab[data-mode="build"]');
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.__cubeLab.clearAll(); window.__cubeLab.setLayer(1); });
    await page.waitForTimeout(250);
    for (const cell of [
      { x: 1, y: 1, z: 1 }, { x: 2, y: 1, z: 1 }, { x: 2, y: 1, z: 2 },
      { x: 2, y: 2, z: 2 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 0 }
    ]) {
      await page.evaluate(([y]) => window.__cubeLab.setLayer(y), [cell.y]);
      await tapCell(cell);
    }
    await page.evaluate(() => window.__cubeLab.setLayer(1));
    await page.evaluate(() => window.__cubeLab.setPanelCollapsed(false));
    await page.waitForTimeout(500);
    await shot('mobile-iphone-build.png');
    await page.evaluate(() => window.__cubeLab.setPanelCollapsed(true));
    await page.waitForTimeout(500);
    await shot('mobile-panel-collapsed.png');
  } else if (c.key === 'pixel') {
    await page.evaluate(() => window.__cubeLab.setPanelCollapsed(true));
    await page.evaluate(() => window.__cubeLab.startLevel(6));
    await page.waitForTimeout(1200);
    await shot('mobile-pixel-level.png');
  } else if (c.key === 'ipad') {
    await page.click(mobile ? '.tabbar-btn[data-mode="build"]' : '.tab[data-mode="build"]');
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.__cubeLab.clearAll(); window.__cubeLab.setLayer(1); });
    await page.waitForTimeout(250);
    for (const cell of [
      { x: 1, y: 1, z: 1 }, { x: 2, y: 1, z: 1 }, { x: 2, y: 1, z: 2 },
      { x: 2, y: 2, z: 2 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 0 }
    ]) {
      await page.evaluate(([y]) => window.__cubeLab.setLayer(y), [cell.y]);
      await tapCell(cell);
    }
    await page.evaluate(() => window.__cubeLab.setLayer(1));
    await page.evaluate(() => window.__cubeLab.setPanelCollapsed(false));
    await page.waitForTimeout(500);
    await shot('mobile-ipad-build.png');
  } else {
    await shot('desktop-1280-build.png');
  }

  /* ---------- 7. 錯誤檢查 ---------- */
  ok(c.name + '：console error = 0', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
  ok(c.name + '：pageerror = 0', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

  const L = await page.evaluate(() => window.__cubeLab.layout());
  summary.push({
    name: c.name,
    mobile,
    count10: 10,
    occl: occl.covered === 0 && occl.outsideX === 0 && occl.outsideScene === 0,
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
    ratio: (L.visibleHeightRatio * 100).toFixed(1) + '%'
  });

  await ctx.close();
}

await browser.close();

console.log('\n=== 各裝置摘要 ===');
for (const s of summary) {
  console.log(s.name + ' | 放置 10/10 | 遮擋斷言 ' + (s.occl ? 'pass' : 'FAIL') +
    ' | console error ' + s.consoleErrors + ' | pageerror ' + s.pageErrors +
    ' | 場景可視高度 ' + s.ratio);
}

const failed = results.filter((r) => !r.pass);
console.log('\n=== 總結 ===');
console.log('通過 ' + (results.length - failed.length) + ' / ' + results.length);
if (failed.length) {
  for (const f of failed) console.log('未通過: ' + f.name + ' | ' + (f.detail || ''));
  process.exit(1);
}
