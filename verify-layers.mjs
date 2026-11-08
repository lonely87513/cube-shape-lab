/**
 * Cube Shape Lab「👀 全部層顯示」開關驗證腳本
 *
 * 覆蓋的功能（2026-11-08 Nathan：沒法同時顯示所有層嗎）：
 *   1. 開關預設為「開」，按鈕顯示「開」
 *   2. 開啟時：其他層用「淡色實心」（Mesh），不再用半透明線框（LineSegments）
 *   3. 關閉時：回復原本行為 —— 其他層只餘線框，沒有實心方塊
 *   4. 切換開關不會清空進度、不會重新載入場景
 *   5. 擺放／移除邏輯不變：仍然只可以在當前層落手
 *   6. 手機版收合面板時開關仍然可見、可以點擊
 *   7. 偏好會記住（localStorage），重新載入後維持原設定
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

/** 顏色亮度（0–255），用來確認「淡色」真的比較淡 */
function luma(hex) {
  if (!hex) return -1;
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

const CASES = [
  { key: 'iphone', name: 'iPhone 13', device: devices['iPhone 13'] },
  { key: 'desktop', name: '桌面 1280×800', viewport: { width: 1280, height: 800 } }
];

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

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

  /* ---------- 1. 預設為「開」 ---------- */
  const def = await page.evaluate(() => ({
    on: window.__cubeLab.getShowAllLayers(),
    btnText: document.getElementById('tg-all-layers').textContent.trim(),
    pressed: document.getElementById('tg-all-layers').getAttribute('aria-pressed'),
    hasClass: document.getElementById('tg-all-layers').classList.contains('on')
  }));
  ok(c.name + '：開關預設為開', def.on === true && def.btnText === '開' && def.pressed === 'true' && def.hasClass === true,
    JSON.stringify(def));

  /* ---------- 2. 造出跨層的形狀 ---------- */
  const occupied = [];
  async function placeOnLayer(layer, count) {
    for (let i = 0; i < count; i++) {
      await page.evaluate((y) => window.__cubeLab.setLayer(y), layer);
      await page.waitForTimeout(140);
      const cells = await page.evaluate(() => window.__cubeLab.visibleCells());
      const cell = cells.find((cc) => !occupied.some((o) => o.x === cc.x && o.y === cc.y && o.z === cc.z));
      if (!cell) return;
      const p = await page.evaluate(([x, y, z]) => window.__cubeLab.cellScreen(x, y, z), [cell.x, cell.y, cell.z]);
      await page.touchscreen.tap(p.x, p.y);
      await page.waitForTimeout(110);
      occupied.push({ x: cell.x, y: cell.y, z: cell.z });
    }
  }
  await page.evaluate(() => window.__cubeLab.clearAll());
  await placeOnLayer(0, 2);   // 底層 2 粒
  await placeOnLayer(1, 2);   // 當前層 2 粒
  await placeOnLayer(2, 1);   // 上層 1 粒
  await page.evaluate(() => window.__cubeLab.setLayer(1));
  await page.waitForTimeout(300);

  const total = await page.evaluate(() => window.__cubeLab.getState().count);
  ok(c.name + '：已造出跨 3 層共 5 粒的形狀', total === 5, 'count=' + total);

  /* ---------- 3. 開啟時：其他層為淡色實心 ---------- */
  const on = await page.evaluate(() => window.__cubeLab.layerRender());
  ok(c.name + '：開啟時當前層為實心 Mesh', on.currentSolid === 2 && on.currentType === 'Mesh',
    JSON.stringify(on));
  ok(c.name + '：開啟時其他層為實心 Mesh（非線框）', on.fadedSolid === 3 && on.fadedType === 'Mesh',
    'fadedSolid=' + on.fadedSolid + ' type=' + on.fadedType);
  ok(c.name + '：開啟時沒有半透明線框', on.ghostWire === 0, 'ghostWire=' + on.ghostWire);
  ok(c.name + '：開啟時實心方塊總數＝全部方塊數', on.currentSolid + on.fadedSolid === 5,
    (on.currentSolid + on.fadedSolid) + '/5');
  ok(c.name + '：其他層顏色比當前層淡', luma(on.fadedColor) > luma(on.currentColor),
    'current=' + on.currentColor + ' (luma ' + luma(on.currentColor) + ') / faded=' + on.fadedColor + ' (luma ' + luma(on.fadedColor) + ')');

  /* ---------- 4. 關閉時：回復「只見當前層」 ---------- */
  await page.evaluate(() => { window.__marker = 'keep-me'; });   // 用來偵測有沒有重新載入
  await page.click('#tg-all-layers');
  await page.waitForTimeout(400);
  const off = await page.evaluate(() => ({
    render: window.__cubeLab.layerRender(),
    marker: window.__marker,
    count: window.__cubeLab.getState().count,
    btnText: document.getElementById('tg-all-layers').textContent.trim(),
    pressed: document.getElementById('tg-all-layers').getAttribute('aria-pressed')
  }));
  ok(c.name + '：關閉後按鈕變成「關」', off.btnText === '關' && off.pressed === 'false',
    off.btnText + ' / ' + off.pressed);
  ok(c.name + '：關閉時其他層沒有實心方塊', off.render.fadedSolid === 0, 'fadedSolid=' + off.render.fadedSolid);
  ok(c.name + '：關閉時其他層回復線框', off.render.ghostWire === 3 && off.render.ghostType === 'LineSegments',
    'ghostWire=' + off.render.ghostWire + ' type=' + off.render.ghostType);
  ok(c.name + '：關閉時當前層仍然是實心', off.render.currentSolid === 2 && off.render.currentType === 'Mesh',
    'currentSolid=' + off.render.currentSolid);
  ok(c.name + '：切換開關不會清空進度', off.count === 5, 'count=' + off.count);
  ok(c.name + '：切換開關不會重新載入場景', off.marker === 'keep-me', 'marker=' + off.marker);

  /* ---------- 5. 擺放邏輯不變：仍然只可以在當前層落手 ---------- */
  await page.evaluate(() => window.__cubeLab.setLayer(0));
  await page.waitForTimeout(220);
  const otherLayer = await page.evaluate(() => {
    const cell = window.__cubeLab.getState().cells.find((x) => x.y === 1);
    return cell ? window.__cubeLab.cellScreen(cell.x, cell.y, cell.z) : null;
  });
  if (otherLayer) {
    await page.touchscreen.tap(otherLayer.x, otherLayer.y);
    await page.waitForTimeout(200);
  }
  const afterOther = await page.evaluate(() => window.__cubeLab.getState());
  ok(c.name + '：不能在非當前層落手', afterOther.count === 5, 'count=' + afterOther.count);

  /* ---------- 6. 手機版：收合面板時開關仍然可見、可點擊 ---------- */
  if (c.key === 'iphone') {
    await page.evaluate(() => window.__cubeLab.setPanelCollapsed(true));
    await page.waitForTimeout(500);
    const vis = await page.evaluate(() => {
      const b = document.getElementById('tg-all-layers');
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return { w: r.width, h: r.height, top: r.top, display: cs.display, visibility: cs.visibility };
    });
    ok(c.name + '：收合面板時開關仍然可見', vis.w > 20 && vis.h > 20 && vis.visibility === 'visible' && vis.display !== 'none',
      JSON.stringify(vis));
    await page.click('#tg-all-layers');
    await page.waitForTimeout(350);
    const back = await page.evaluate(() => window.__cubeLab.getShowAllLayers());
    ok(c.name + '：收合面板時仍可切換開關', back === true, 'showAll=' + back);
    const renderAfter = await page.evaluate(() => window.__cubeLab.layerRender());
    ok(c.name + '：重新開啟後其他層回復實心', renderAfter.fadedSolid === 3 && renderAfter.ghostWire === 0,
      JSON.stringify(renderAfter));
  }

  /* ---------- 7. 偏好會記住 ---------- */
  await page.evaluate(() => window.__cubeLab.setShowAllLayers(false));
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__cubeLab && window.__cubeLab.ready, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const persisted = await page.evaluate(() => window.__cubeLab.getShowAllLayers());
  ok(c.name + '：重新載入後記住「關」', persisted === false, 'showAll=' + persisted);
  await page.evaluate(() => window.__cubeLab.setShowAllLayers(true));
  await page.waitForTimeout(200);

  /* ---------- 8. 截圖 ---------- */
  await page.evaluate(() => {
    window.__cubeLab.clearAll();
    window.__cubeLab.setLayer(1);
  });
  await page.waitForTimeout(200);
  for (const cell of [
    { x: 1, y: 1, z: 1 }, { x: 2, y: 1, z: 1 }, { x: 2, y: 1, z: 2 },
    { x: 2, y: 2, z: 2 }, { x: 1, y: 0, z: 1 }
  ]) {
    await page.evaluate(([y]) => window.__cubeLab.setLayer(y), [cell.y]);
    await page.waitForTimeout(160);
    const p = await page.evaluate(([x, y, z]) => window.__cubeLab.cellScreen(x, y, z), [cell.x, cell.y, cell.z]);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(110);
  }
  await page.evaluate(() => window.__cubeLab.setLayer(1));
  await page.waitForTimeout(500);

  async function shot(name) {
    await page.waitForFunction(() => {
      const t = document.getElementById('toast');
      return !t || !t.classList.contains('show');
    }, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: SHOTS + '/' + name });
    const st = fs.statSync(SHOTS + '/' + name);
    console.log('SHOT | ' + name + ' | ' + st.size + ' bytes');
  }

  await shot('layers-' + c.key + '-all-on.png');
  await page.evaluate(() => window.__cubeLab.setShowAllLayers(false));
  await page.waitForTimeout(500);
  await shot('layers-' + c.key + '-all-off.png');
  await page.evaluate(() => window.__cubeLab.setShowAllLayers(true));

  /* ---------- 9. 錯誤檢查 ---------- */
  ok(c.name + '：console error = 0', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
  ok(c.name + '：pageerror = 0', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log('\n=== 總結 ===');
console.log('通過 ' + (results.length - failed.length) + ' / ' + results.length);
if (failed.length) {
  for (const f of failed) console.log('未通過: ' + f.name + ' | ' + (f.detail || ''));
  process.exit(1);
}
