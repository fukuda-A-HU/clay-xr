import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ClayField } from './sdf.js';
import { ButtonPanel } from './panel.js';

// ================= 設定 =================
const CLAY_HOME = new THREE.Vector3(0, 1.1, -0.45);
const MODES = {
  carve: { label: '押す', color: '#4fc3f7' },
  add: { label: '盛る', color: '#81c784' },
  smooth: { label: 'なでる', color: '#ffd54f' },
  pull: { label: 'つまむ', color: '#ff8a65' }, // デスクトップ用 (XR ではピンチが常に「つまむ」)
};
const state = { mode: 'carve', brushR: 0.015 };
const grabR = () => state.brushR * 2.2;
const PINCH_ON = 0.02, PINCH_OFF = 0.04, PRE_PINCH = 0.05; // m

// ================= レンダラーとシーン =================
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color(0x1d2026);
scene.background = BG;

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 50);
camera.position.set(0.24, 1.3, -0.02);

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3020, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(0.6, 2.5, 0.8);
scene.add(sun);
const rim = new THREE.DirectionalLight(0xaabbff, 0.7);
rim.position.set(-1, 1.2, -1.5);
scene.add(rim);

const floor = new THREE.GridHelper(6, 30, 0x454b57, 0x2c3038);
scene.add(floor);

// 作業台 (台座とパネル)。「手元へ」で丸ごと移動する
const workspace = new THREE.Group();
workspace.position.copy(CLAY_HOME);
scene.add(workspace);
const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(0.11, 0.13, 0.02, 48),
  new THREE.MeshStandardMaterial({ color: 0x4d525c, roughness: 0.6 }),
);
pedestal.position.y = -0.085;
workspace.add(pedestal);

// ================= 粘土 =================
const clay = new THREE.Group();
clay.position.copy(CLAY_HOME);
scene.add(clay);

const field = new ClayField({ N: 80, size: 0.4 });
field.resetCube(0.07, 0.01);

const clayMat = new THREE.MeshStandardMaterial({ color: 0xc98060, roughness: 0.78, metalness: 0 });
const chunkMeshes = new Map();

// 編集できる範囲 (格子の外枠) をうっすら表示
const bounds = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(field.size, field.size, field.size)),
  new THREE.LineBasicMaterial({ color: 0x8890a0, transparent: true, opacity: 0.15 }),
);
clay.add(bounds);

function remeshDirty() {
  const keys = field.takeDirty();
  for (const key of keys) {
    const { positions, normals, indices } = field.meshChunk(key);
    let m = chunkMeshes.get(key);
    if (!m) {
      m = new THREE.Mesh(new THREE.BufferGeometry(), clayMat);
      clay.add(m);
      chunkMeshes.set(key, m);
    }
    m.geometry.dispose();
    const g = new THREE.BufferGeometry();
    if (indices.length) {
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      g.setIndex(new THREE.BufferAttribute(indices, 1));
      g.computeBoundingSphere();
    }
    m.geometry = g;
    m.visible = indices.length > 0;
  }
  return keys.length;
}

// 座標変換: ワールド (m) ⇔ 格子座標
const _w = new THREE.Vector3();
function worldToGrid(w, out = new THREE.Vector3()) {
  out.copy(w);
  clay.worldToLocal(out);
  return out.addScalar(field.half).divideScalar(field.h);
}
function gridToWorld(g, out = new THREE.Vector3()) {
  out.copy(g).multiplyScalar(field.h).addScalar(-field.half);
  return clay.localToWorld(out);
}
const worldLenToGrid = (len) => len / (field.h * clay.scale.x);

function applyTool(mode, worldPos, strength = 0.5) {
  const g = worldToGrid(worldPos, _w);
  const r = worldLenToGrid(state.brushR);
  if (mode === 'carve') return field.carve(g, r);
  if (mode === 'add') return field.add(g, r);
  if (mode === 'smooth') return field.smooth(g, r * 1.4, strength);
  return false;
}

function pullBetween(gFrom, gTo) {
  const delta = new THREE.Vector3().subVectors(gTo, gFrom);
  return field.pull(gFrom, delta, worldLenToGrid(grabR()));
}

// ================= Undo =================
const undoStack = [];
function pushUndo() {
  undoStack.push(field.snapshot());
  if (undoStack.length > 30) undoStack.shift();
}
function undo() {
  const s = undoStack.pop();
  if (s) field.restore(s);
}
function resetClay() {
  pushUndo();
  field.resetCube(0.07, 0.01);
  clay.position.copy(workspace.position);
  clay.quaternion.copy(workspace.quaternion);
  clay.scale.setScalar(1);
  clay.updateMatrixWorld();
}

// ================= ブラシ表示 =================
function makeCursor() {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  m.renderOrder = 10;
  m.visible = false;
  scene.add(m);
  return m;
}
function showCursor(m, pos, radius, color, opacity) {
  m.visible = true;
  m.position.copy(pos);
  m.scale.setScalar(radius);
  m.material.color.set(color);
  m.material.opacity = opacity;
}
const desktopCursor = makeCursor();

// ================= デスクトップ操作 =================
// 粘土の上で左ドラッグ = 造形 / 何もない所で左ドラッグ = 視点回転
const el = renderer.domElement;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let stroke = null;

function rayFromEvent(e) {
  const rect = el.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray;
}

function raymarchWorld(ray, arr) {
  clay.updateMatrixWorld();
  const o = worldToGrid(ray.origin);
  const o2 = worldToGrid(new THREE.Vector3().copy(ray.origin).add(ray.direction));
  const dir = o2.sub(o).normalize();
  const t = field.raymarch(o, dir, arr);
  if (t === null) return null;
  return gridToWorld(o.addScaledVector(dir, t));
}

function applyDesktopStroke(ray, first) {
  const m = stroke.mode;
  if (m === 'pull') {
    const np = ray.intersectPlane(stroke.plane, new THREE.Vector3());
    if (!np) return;
    const gTo = worldToGrid(np.clone().add(stroke.offset));
    pullBetween(stroke.lastG, gTo);
    stroke.lastG.copy(gTo);
    showCursor(desktopCursor, np, grabR(), MODES.pull.color, 0.3);
    return;
  }
  // 削る・盛るはストローク開始時の形に当てる (同じ所をなぞっても掘り進まない・盛り上がり続けない)
  const arr = m === 'smooth' ? field.d : stroke.base;
  const hit = raymarchWorld(ray, arr);
  if (!hit) return;
  const center = hit.clone();
  if (m === 'carve') center.addScaledVector(ray.direction, state.brushR * 0.35);
  showCursor(desktopCursor, hit, state.brushR, MODES[m].color, 0.25);
  if (first || m === 'smooth') {
    applyTool(m, center, 0.5);
    stroke.lastC = center.clone();
    return;
  }
  const step = state.brushR * 0.3;
  const dist = center.distanceTo(stroke.lastC);
  if (dist < step) return;
  const n = Math.ceil(dist / step);
  const p = new THREE.Vector3();
  for (let i = 1; i <= n; i++) applyTool(m, p.lerpVectors(stroke.lastC, center, i / n));
  stroke.lastC.copy(center);
}

// OrbitControls より先に登録して、粘土に当たったら視点操作を止める
el.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting || e.button !== 0) return;
  const ray = rayFromEvent(e);
  const p = raymarchWorld(ray, field.d);
  if (!p) return;
  controls.enabled = false;
  el.setPointerCapture(e.pointerId);
  pushUndo();
  const offset = ray.direction.clone().multiplyScalar(grabR() * 0.25); // つまむ: 表面の少し内側をつかむ
  stroke = {
    id: e.pointerId,
    mode: state.mode,
    base: undoStack[undoStack.length - 1],
    offset,
    lastG: worldToGrid(p.clone().add(offset)),
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), p),
  };
  applyDesktopStroke(ray, true);
});
el.addEventListener('pointermove', (e) => {
  if (renderer.xr.isPresenting) return;
  const ray = rayFromEvent(e);
  if (stroke && e.pointerId === stroke.id) {
    applyDesktopStroke(ray, false);
    return;
  }
  const p = raymarchWorld(ray, field.d);
  if (p) {
    const pull = state.mode === 'pull';
    showCursor(desktopCursor, p, pull ? grabR() : state.brushR, MODES[state.mode].color, 0.22);
  } else desktopCursor.visible = false;
});
const endStroke = (e) => {
  if (!stroke || e.pointerId !== stroke.id) return;
  stroke = null;
  controls.enabled = true;
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
};
el.addEventListener('pointerup', endStroke);
el.addEventListener('pointercancel', endStroke);
el.addEventListener('pointerleave', () => { if (!stroke) desktopCursor.visible = false; });

const controls = new OrbitControls(camera, el);
controls.target.copy(CLAY_HOME);
controls.enableDamping = true;
controls.minDistance = 0.15;
controls.maxDistance = 3;
controls.update();

// ================= XR: 手 =================
class OneEuro3 {
  constructor(minCutoff = 1.2, beta = 6, dCutoff = 1) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.x = null;
    this.dx = new THREE.Vector3();
    this.t = 0;
    this._raw = new THREE.Vector3();
  }
  static alpha(dt, cutoff) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(v, t) {
    if (!this.x || t - this.t > 0.2) {
      this.x = v.clone();
      this.dx.set(0, 0, 0);
      this.t = t;
      return this.x;
    }
    const dt = Math.max(t - this.t, 1e-3);
    this.t = t;
    this._raw.subVectors(v, this.x).divideScalar(dt);
    this.dx.lerp(this._raw, OneEuro3.alpha(dt, this.dCutoff));
    const cutoff = this.minCutoff + this.beta * this.dx.length();
    this.x.lerp(v, OneEuro3.alpha(dt, cutoff));
    return this.x;
  }
}

const handFactory = new XRHandModelFactory();
const hands = [0, 1].map((i) => {
  const hand = renderer.xr.getHand(i);
  const model = handFactory.createHandModel(hand, 'spheres');
  hand.add(model);
  scene.add(hand);
  const hs = {
    hand, model, connected: false, handedness: null,
    tipF: new OneEuro3(), pinchF: new OneEuro3(),
    tip: new THREE.Vector3(), pinchPos: new THREE.Vector3(),
    pinching: false, pinchMode: null, lastG: new THREE.Vector3(), grabOffset: new THREE.Vector3(),
    toolCenter: new THREE.Vector3(),
    touching: false, pressed: null,
    cursor: makeCursor(),
  };
  hand.addEventListener('connected', (e) => { hs.connected = true; hs.handedness = e.data.handedness; });
  hand.addEventListener('disconnected', () => { hs.connected = false; endPinch(hs); hs.touching = false; hs.cursor.visible = false; });
  return hs;
});

let manipDirty = true;
let manip = null;

function startPinch(hs) {
  hs.pinching = true;
  manipDirty = true;
  const g = worldToGrid(hs.pinchPos);
  const s = field.sample(g);
  const R = worldLenToGrid(grabR());
  if (s < R * 0.5) {
    hs.pinchMode = 'pull';
    pushUndo();
    // つまんだ所から表面の少し内側をつかむ (つかむ点と指の位置関係は保つ)
    const n = field.gradient(g, new THREE.Vector3());
    const inside = g.clone().addScaledVector(n, -(s + R * 0.25));
    hs.grabOffset.subVectors(gridToWorld(inside), hs.pinchPos);
    hs.lastG.copy(inside);
  } else {
    hs.pinchMode = 'move';
  }
}
function endPinch(hs) {
  if (!hs.pinching) return;
  hs.pinching = false;
  hs.pinchMode = null;
  manipDirty = true;
}

// 何もない所をつまむ: 片手で移動、両手で回転・拡大縮小
function updateObjectManip(movers) {
  if (manipDirty || !manip || manip.count !== movers.length) {
    manipDirty = false;
    manip = { count: movers.length };
    if (movers.length === 1) {
      manip.offset = clay.position.clone().sub(movers[0].pinchPos);
    } else if (movers.length >= 2) {
      const [a, b] = movers;
      manip.v0 = b.pinchPos.clone().sub(a.pinchPos);
      manip.mid0 = a.pinchPos.clone().add(b.pinchPos).multiplyScalar(0.5);
      manip.pos0 = clay.position.clone();
      manip.quat0 = clay.quaternion.clone();
      manip.scale0 = clay.scale.x;
    }
  }
  if (movers.length === 1) {
    clay.position.copy(movers[0].pinchPos).add(manip.offset);
  } else if (movers.length >= 2 && manip.v0.length() > 0.01) {
    const [a, b] = movers;
    const v = b.pinchPos.clone().sub(a.pinchPos);
    const mid = a.pinchPos.clone().add(b.pinchPos).multiplyScalar(0.5);
    const newScale = THREE.MathUtils.clamp(manip.scale0 * v.length() / manip.v0.length(), 0.25, 4);
    const s = newScale / manip.scale0;
    const q = new THREE.Quaternion().setFromUnitVectors(manip.v0.clone().normalize(), v.normalize());
    clay.quaternion.copy(q).multiply(manip.quat0);
    clay.scale.setScalar(newScale);
    clay.position.copy(mid).add(manip.pos0.clone().sub(manip.mid0).applyQuaternion(q).multiplyScalar(s));
  }
  clay.updateMatrixWorld();
}

const _tipRaw = new THREE.Vector3(), _thumbRaw = new THREE.Vector3(), _mid = new THREE.Vector3();

function updateXR(dt, t) {
  clay.updateMatrixWorld();
  const movers = [];
  for (const hs of hands) {
    const tipJ = hs.hand.joints['index-finger-tip'];
    const thumbJ = hs.hand.joints['thumb-tip'];
    if (!hs.connected || !tipJ || !thumbJ || !tipJ.visible || !thumbJ.visible) {
      hs.cursor.visible = false;
      endPinch(hs);
      hs.touching = false;
      continue;
    }
    tipJ.getWorldPosition(_tipRaw);
    thumbJ.getWorldPosition(_thumbRaw);
    hs.tip.copy(hs.tipF.filter(_tipRaw, t));
    _mid.addVectors(_tipRaw, _thumbRaw).multiplyScalar(0.5);
    hs.pinchPos.copy(hs.pinchF.filter(_mid, t));
    const pinchDist = _tipRaw.distanceTo(_thumbRaw);

    // ボタン
    if (!hs.pinching && panel.press(hs.tip, hs)) {
      hs.cursor.visible = false;
      continue;
    }

    // ピンチ (ヒステリシス付き)
    if (!hs.pinching && pinchDist < PINCH_ON) startPinch(hs);
    else if (hs.pinching && pinchDist > PINCH_OFF) endPinch(hs);

    if (hs.pinching) {
      if (hs.pinchMode === 'pull') {
        const g = worldToGrid(_w.addVectors(hs.pinchPos, hs.grabOffset));
        pullBetween(hs.lastG, g);
        hs.lastG.copy(g);
        showCursor(hs.cursor, hs.pinchPos, grabR(), MODES.pull.color, 0.35);
      } else {
        movers.push(hs);
        showCursor(hs.cursor, hs.pinchPos, 0.008, '#ffffff', 0.6);
      }
      continue;
    }

    // 指先の道具。指を閉じかけている間 (つまもうとしている) は使わない
    const tool = MODES[state.mode] && state.mode !== 'pull' ? state.mode : null;
    const allowed = tool && pinchDist > PRE_PINCH;
    const r = worldLenToGrid(state.brushR);
    // 押す: ブラシ球を指の腹の側に置き、指先が表面に触れたときだけ削れるようにする
    const center = hs.toolCenter.copy(hs.tip);
    const distalJ = hs.hand.joints['index-finger-phalanx-distal'];
    if (tool === 'carve' && distalJ && distalJ.visible) {
      const dir = distalJ.getWorldPosition(_thumbRaw).sub(_tipRaw).normalize(); // 指先 → 根元
      center.addScaledVector(dir, state.brushR * 0.7);
    }
    const s = field.sample(worldToGrid(center, _w));
    const trigger = tool === 'carve' ? r : tool === 'add' ? r * 0.6 : r * 0.5;
    if (allowed && s < trigger) {
      if (!hs.touching) { pushUndo(); hs.touching = true; }
      applyTool(tool, center, dt * 6);
    } else if (s > trigger + r * 0.3 || !allowed) {
      hs.touching = false;
    }
    showCursor(hs.cursor, center, state.brushR, tool ? MODES[tool].color : '#ffffff',
      allowed ? (hs.touching ? 0.45 : 0.22) : 0.08);
  }
  updateObjectManip(movers);
}

// ================= XR: パネル =================
const bw = 0.062, bh = 0.04, gap = 0.008;
const col = (i) => (i - 1) * (bw + gap);
const row = (j) => -j * (bh + gap);
const panel = new ButtonPanel([
  ...['carve', 'add', 'smooth'].map((m, i) => ({
    id: m, label: MODES[m].label, x: col(i), y: row(0), w: bw, h: bh, color: MODES[m].color,
    onPress: () => setMode(m), isActive: () => state.mode === m,
  })),
  { id: 'smaller', label: '− 小', x: col(0), y: row(1), w: bw, h: bh, onPress: () => setBrush(state.brushR - 0.003) },
  { id: 'size', label: () => `${Math.round(state.brushR * 1000)}mm`, x: col(1), y: row(1), w: bw, h: bh },
  { id: 'bigger', label: '+ 大', x: col(2), y: row(1), w: bw, h: bh, onPress: () => setBrush(state.brushR + 0.003) },
  { id: 'undo', label: '↶ 戻す', x: col(0), y: row(2), w: bw, h: bh, onPress: undo },
  { id: 'recenter', label: '手元へ', x: col(1), y: row(2), w: bw, h: bh, onPress: recenter },
  { id: 'reset', label: 'リセット', x: col(2), y: row(2), w: bw, h: bh, onPress: resetClay },
], {
  title: ['指先で触れる: 選んだ道具', 'つまむ: 粘土を引っ張る', '空中でつまむ: 移動 / 両手: 回転・拡大'],
});
panel.group.position.set(-0.3, 0.02, 0.08);
panel.group.rotation.set(-0.3, 0.6, 0, 'YXZ');
panel.group.visible = false;
workspace.add(panel.group);

// 頭の前 (少し下) に作業台と粘土を持ってくる
function recenter() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const head = cam.position.clone();
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  workspace.position.copy(head).addScaledVector(fwd, 0.42).add(new THREE.Vector3(0, -0.32, 0));
  workspace.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
  workspace.updateMatrixWorld();
  clay.position.copy(workspace.position);
  clay.quaternion.copy(workspace.quaternion);
  clay.updateMatrixWorld();
  manipDirty = true;
}

// ================= XR セッション =================
let xrMode = null;
let savedCam = null;
let recenterIn = 0;

function applyEnvironment() {
  const ar = xrMode === 'immersive-ar';
  scene.background = ar ? null : BG;
  floor.visible = !ar;
  for (const hs of hands) hs.model.visible = !ar; // パススルーでは本物の手が見える
  panel.group.visible = !!xrMode;
  bounds.visible = !xrMode;
  desktopCursor.visible = false;
}

async function startXR(mode) {
  if (renderer.xr.isPresenting) return;
  try {
    const session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'hand-tracking'] });
    const feats = session.enabledFeatures;
    renderer.xr.setReferenceSpaceType(feats && !feats.includes('local-floor') ? 'local' : 'local-floor');
    savedCam = { pos: camera.position.clone(), quat: camera.quaternion.clone(), target: controls.target.clone() };
    xrMode = mode;
    if (state.mode === 'pull') setMode('carve');
    session.addEventListener('end', () => {
      xrMode = null;
      applyEnvironment();
      for (const hs of hands) { endPinch(hs); hs.cursor.visible = false; }
      if (savedCam) {
        camera.position.copy(savedCam.pos);
        camera.quaternion.copy(savedCam.quat);
        controls.target.copy(savedCam.target);
        controls.update();
      }
    });
    await renderer.xr.setSession(session);
    applyEnvironment();
    recenterIn = 3; // 数フレーム待って頭の位置が取れてから
  } catch (err) {
    setXRMessage(`XR を開始できませんでした: ${err.message}`);
  }
}

// ================= 画面 UI =================
const ui = {
  modes: document.getElementById('modes'),
  size: document.getElementById('size'),
  sizeVal: document.getElementById('sizeVal'),
  xrmsg: document.getElementById('xrmsg'),
};
function setXRMessage(t) { ui.xrmsg.textContent = t; }

for (const [m, def] of Object.entries(MODES)) {
  const b = document.createElement('button');
  b.dataset.mode = m;
  b.textContent = def.label;
  b.style.setProperty('--accent', def.color);
  b.onclick = () => setMode(m);
  ui.modes.appendChild(b);
}
function setMode(m) {
  state.mode = m;
  for (const b of ui.modes.children) b.classList.toggle('active', b.dataset.mode === m);
}
function setBrush(r) {
  state.brushR = THREE.MathUtils.clamp(r, 0.006, 0.04);
  ui.size.value = Math.round(state.brushR * 1000);
  ui.sizeVal.textContent = `${Math.round(state.brushR * 1000)}mm`;
}
ui.size.oninput = () => setBrush(ui.size.value / 1000);
document.getElementById('undo').onclick = undo;
document.getElementById('reset').onclick = resetClay;
document.getElementById('export').onclick = exportGLB;
document.getElementById('vr').onclick = () => startXR('immersive-vr');
document.getElementById('ar').onclick = () => startXR('immersive-ar');
setMode(state.mode);
setBrush(state.brushR);

addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  const keys = { 1: 'carve', 2: 'add', 3: 'smooth', 4: 'pull' };
  if (keys[e.key]) setMode(keys[e.key]);
  if (e.key === '[') setBrush(state.brushR - 0.002);
  if (e.key === ']') setBrush(state.brushR + 0.002);
});

async function checkXR() {
  const vrBtn = document.getElementById('vr'), arBtn = document.getElementById('ar');
  if (!navigator.xr) {
    setXRMessage(window.isSecureContext
      ? 'このブラウザは WebXR に対応していません (デスクトップ操作のみ)。'
      : 'WebXR には HTTPS か localhost が必要です。');
    vrBtn.disabled = arBtn.disabled = true;
    return;
  }
  const [vr, ar] = await Promise.all([
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
  ]);
  vrBtn.disabled = !vr;
  arBtn.disabled = !ar;
  if (!vr && !ar) setXRMessage('XR デバイスが見つかりません (デスクトップ操作のみ)。');
}
checkXR();

function exportGLB() {
  bounds.visible = false;
  new GLTFExporter().parse(clay, (glb) => {
    bounds.visible = !xrMode;
    const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'clay.glb' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, (err) => { bounds.visible = !xrMode; alert(`書き出しに失敗しました: ${err}`); }, { binary: true, onlyVisible: true });
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ================= ループ =================
let lastT = 0;
renderer.setAnimationLoop((tms) => {
  const t = tms / 1000;
  const dt = lastT ? Math.min(0.05, t - lastT) : 1 / 60;
  lastT = t;
  if (renderer.xr.isPresenting) {
    updateXR(dt, t);
    panel.refresh();
  } else {
    controls.update();
  }
  remeshDirty();
  renderer.render(scene, camera);
  if (recenterIn > 0 && --recenterIn === 0) recenter();
});

// デバッグ用
window.__clay = { field, clay, state, setMode, setBrush, undo, applyTool, chunkMeshes, camera, controls, hands, updateXR, panel, workspace, undoStack };
