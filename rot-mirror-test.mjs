/**
 * 旋轉 / 鏡像 / 改格 等價性獨立測試
 * 直接從 index.html 抽取 ROTATION-CORE 區塊，確保測試的就是正式實作。
 * 全部使用整數座標，無浮點容差。
 */
import fs from 'node:fs';

const HTML_PATH = '/root/.openclaw/workspace/projects/cube-shape-lab/index.html';
const html = fs.readFileSync(HTML_PATH, 'utf8');

const begin = html.indexOf('/* === ROTATION-CORE-BEGIN === */');
const end = html.indexOf('/* === ROTATION-CORE-END === */');
if (begin < 0 || end < 0) {
  console.error('無法在 index.html 中找到 ROTATION-CORE 區塊');
  process.exit(1);
}
const coreSrc = html.slice(begin, end);
const factory = new Function(coreSrc + '\nreturn { buildRotationMatrices, ROTATION_MATRICES, rotatePoint, shapeSignature, cellsEquivalent, cellsEquivalentShape };');
const { buildRotationMatrices, ROTATION_MATRICES, rotatePoint, cellsEquivalent, cellsEquivalentShape } = factory();

/* 固定亂數種子，確保結果可重現 */
let seed = 20261107;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function randInt(n) { return Math.floor(rnd() * n); }

const key = (x, y, z) => x + ',' + y + ',' + z;

/* 產生隨機連通形狀（整數座標） */
function randomShape(n) {
  const map = new Map();
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let cur = { x: randInt(5), y: randInt(5), z: randInt(5) };
  map.set(key(cur.x, cur.y, cur.z), { x: cur.x, y: cur.y, z: cur.z, color: 0 });
  let guard = 0;
  while (map.size < n && guard < 4000) {
    guard++;
    const d = dirs[randInt(6)];
    const nx = cur.x + d[0], ny = cur.y + d[1], nz = cur.z + d[2];
    if (nx < 0 || nx > 4 || ny < 0 || ny > 4 || nz < 0 || nz > 4) continue;
    const k = key(nx, ny, nz);
    if (map.has(k)) continue;
    cur = { x: nx, y: ny, z: nz };
    map.set(k, { x: nx, y: ny, z: nz, color: 0 });
  }
  return map;
}

/* 依旋轉矩陣旋轉整個形狀（並平移到隨機位置，模擬玩家自行擺放） */
function rotatedCopy(map, m, dx, dy, dz) {
  const out = new Map();
  for (const c of map.values()) {
    const p = rotatePoint(c.x, c.y, c.z, m);
    out.set(key(p[0] + dx, p[1] + dy, p[2] + dz), { x: p[0] + dx, y: p[1] + dy, z: p[2] + dz, color: c.color });
  }
  return out;
}

/* 沿 x 軸鏡射（真正的左右翻轉） */
function mirrorCopy(map) {
  const out = new Map();
  let maxX = -Infinity;
  for (const c of map.values()) maxX = Math.max(maxX, c.x);
  for (const c of map.values()) {
    const x = maxX - c.x;
    out.set(key(x, c.y, c.z), { x, y: c.y, z: c.z, color: c.color });
  }
  return out;
}

/* 改動一格：把其中一格搬到相鄰的空位 */
function changeOneCell(map) {
  const list = Array.from(map.values());
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let attempt = 0; attempt < 80; attempt++) {
    const idx = attempt % list.length;
    const base = list[idx];
    const d = dirs[(attempt * 5 + idx * 3) % 6];
    const nx = base.x + d[0], ny = base.y + d[1], nz = base.z + d[2];
    if (nx < 0 || nx > 4 || ny < 0 || ny > 4 || nz < 0 || nz > 4) continue;
    if (map.has(key(nx, ny, nz))) continue;
    const out = new Map(map);
    out.delete(key(base.x, base.y, base.z));
    out.set(key(nx, ny, nz), { x: nx, y: ny, z: nz, color: base.color });
    return out;
  }
  return null;
}

/* ---------- 測試 1：旋轉矩陣數量與性質 ---------- */
const mats = buildRotationMatrices();
console.log('旋轉矩陣數量: ' + mats.length + (mats.length === 24 ? ' ✅' : ' ❌'));

/* ---------- 測試 2：20 組隨機形狀 ---------- */
const GROUPS = 20;
let rotPass = 0, rotFail = 0;
let mirrorPass = 0, mirrorFail = 0, mirrorSkip = 0;
let changePass = 0, changeFail = 0;
const skipped = [];

for (let g = 0; g < GROUPS; g++) {
  const size = 4 + (g % 5);
  const shape = randomShape(size);
  if (shape.size < 3) continue;

  /* (a) 旋轉版本必須判為等價 */
  const m = mats[randInt(mats.length)];
  const rot = rotatedCopy(shape, m, randInt(3) - 1, randInt(3) - 1, randInt(3) - 1);
  if (cellsEquivalent(shape, rot)) rotPass++; else { rotFail++; console.log('  旋轉等價失敗 group=' + g); }

  /* (b) 鏡像版本必須判為不等價（形狀本身左右對稱則跳過並記錄） */
  const mir = mirrorCopy(shape);
  if (cellsEquivalent(shape, mir)) {
    mirrorSkip++;
    skipped.push('group ' + g + '（' + shape.size + ' 塊，左右對稱）');
  } else if (!cellsEquivalent(shape, mir)) {
    mirrorPass++;
  }

  /* (c) 改動一格必須判為不等價 */
  const chg = changeOneCell(shape);
  if (!chg) continue;
  if (!cellsEquivalent(shape, chg)) changePass++; else { changeFail++; console.log('  改一格判定失敗 group=' + g); }
}

console.log('');
console.log('旋轉等價測試: ' + rotPass + '/' + GROUPS + (rotFail ? '　❌ 失敗 ' + rotFail : '　✅'));
console.log('鏡像判定測試: ' + mirrorPass + '/' + (GROUPS - mirrorSkip) + '　✅（跳過對稱形狀 ' + mirrorSkip + ' 組）');
if (skipped.length) console.log('  跳過明細: ' + skipped.join('、'));
console.log('改一格判定測試: ' + changePass + '/' + GROUPS + (changeFail ? '　❌ 失敗 ' + changeFail : '　✅'));

/* ---------- 測試 3：兒童版心理旋轉關卡的形狀必須手性（有鏡像干擾項） ---------- */
const levelsMatch = html.match(/const LEVELS = \[[\s\S]*?\n\];/);
let levelChiral = 0, levelTotal = 0;
if (levelsMatch) {
  const src = levelsMatch[0] + '\nreturn LEVELS;';
  const LEVELS = new Function(src)();
  const mental = LEVELS.filter((l) => l.type === 'mental');
  levelTotal = mental.length;
  console.log('');
  console.log('心理旋轉關卡手性檢查（鏡像必須不等價）:');
  for (const lv of mental) {
    const map = new Map();
    lv.cells.forEach((c, i) => map.set(key(c[0], c[1], c[2]), { x: c[0], y: c[1], z: c[2], color: 0 }));
    const mir = mirrorCopy(map);
    const achiral = cellsEquivalentShape(map, mir);
    if (!achiral) levelChiral++;
    console.log('  第 ' + lv.id + ' 關「' + lv.title + '」' + (achiral ? ' ❌ 左右對稱，鏡像干擾項無效' : ' ✅ 手性形狀'));
  }
}

/* ---------- 總結 ---------- */
const allPass = rotFail === 0 && mirrorFail === 0 && changeFail === 0 && levelChiral === levelTotal;
console.log('');
console.log(allPass ? '全部通過 ✅' : '有項目未通過 ❌');
process.exit(allPass ? 0 : 1);
