import * as THREE from 'three';

/* ==========================================================
   NAV: scroll state, mobile toggle, smooth close-on-click
   ========================================================== */
const nav = document.getElementById('nav');
const navToggle = document.getElementById('nav-toggle');
const navLinks = document.querySelector('.nav-links');

window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

navToggle?.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});

navLinks?.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

/* ==========================================================
   HUD CLOCK
   ========================================================== */
const clockEl = document.getElementById('hud-clock');
function tickClock() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  if (clockEl) clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} UTC${(-d.getTimezoneOffset()/60>=0?'+':'')}${(-d.getTimezoneOffset()/60)}`;
}
tickClock();
setInterval(tickClock, 1000);

/* ==========================================================
   SCROLL REVEAL
   ========================================================== */
const revealEls = document.querySelectorAll('.reveal');
const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      io.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
revealEls.forEach(el => io.observe(el));

/* ==========================================================
   THREE.JS — SWARM NAVIGATION SCENE
   Mirrors the actual research: multiple agents, private goals,
   a communication graph that connects only nearby agents, and
   periodic sonar-style broadcast pulses (belief propagation).
   ========================================================== */
const canvas = document.getElementById('swarm-canvas');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const heroEl = document.querySelector('.hero');
const agentsHud = document.getElementById('hud-agents');

const COLORS = {
  cyan: 0xb3142f,   // primary red — agents, links, pulses
  amber: 0x2a2624,  // near-black secondary — subset of agents
  bg: 0xfdfcfb,      // paper-white fog to match page background
};

let width = heroEl.clientWidth;
let height = heroEl.clientHeight;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(width, height);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(COLORS.bg, 0.028);

const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 200);
camera.position.set(0, 9, 26);
camera.lookAt(0, -1, 0);

/* ---- seafloor / mission grid ---- */
const gridSize = 64;
const gridDiv = 32;
const grid = new THREE.GridHelper(gridSize, gridDiv, COLORS.cyan, COLORS.cyan);
grid.position.y = -6;
grid.material.transparent = true;
grid.material.opacity = 0.12;
scene.add(grid);

// a second faint grid, larger, for depth
const grid2 = new THREE.GridHelper(gridSize * 1.8, gridDiv, COLORS.cyan, COLORS.cyan);
grid2.position.y = -6.5;
grid2.material.transparent = true;
grid2.material.opacity = 0.045;
scene.add(grid2);

/* ---- agents ---- */
const AGENT_COUNT = 24;
const BOUNDS = { x: 20, y: 4, z: 14 };

const agentGeo = new THREE.ConeGeometry(0.22, 0.75, 6);
agentGeo.rotateX(Math.PI / 2);

const cyanMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan });
const amberMat = new THREE.MeshBasicMaterial({ color: COLORS.amber });

class Agent {
  constructor(isAmber) {
    this.mesh = new THREE.Mesh(agentGeo, isAmber ? amberMat : cyanMat);
    this.position = new THREE.Vector3(
      (Math.random() - 0.5) * BOUNDS.x * 2,
      -6 + Math.random() * BOUNDS.y,
      (Math.random() - 0.5) * BOUNDS.z * 2
    );
    this.velocity = new THREE.Vector3();
    this.target = this.newTarget();
    this.mesh.position.copy(this.position);
    scene.add(this.mesh);

    // small glow sprite beneath each agent
    const glowGeo = new THREE.SphereGeometry(0.06, 6, 6);
    this.glow = new THREE.Mesh(glowGeo, this.mesh.material);
    scene.add(this.glow);
  }
  newTarget() {
    return new THREE.Vector3(
      (Math.random() - 0.5) * BOUNDS.x * 2,
      -6 + Math.random() * BOUNDS.y,
      (Math.random() - 0.5) * BOUNDS.z * 2
    );
  }
  update(dt, speedMul) {
    const toTarget = this.target.clone().sub(this.position);
    const dist = toTarget.length();
    if (dist < 1.2) {
      this.target = this.newTarget();
    } else {
      toTarget.normalize().multiplyScalar(2.2 * speedMul);
      this.velocity.lerp(toTarget, 0.02);
    }
    this.position.addScaledVector(this.velocity, dt);
    this.mesh.position.copy(this.position);
    this.glow.position.copy(this.position);

    if (this.velocity.lengthSq() > 0.0001) {
      const lookTarget = this.position.clone().add(this.velocity);
      this.mesh.lookAt(lookTarget);
    }
  }
}

const agents = [];
for (let i = 0; i < AGENT_COUNT; i++) {
  agents.push(new Agent(i % 6 === 0));
}
if (agentsHud) agentsHud.textContent = `AGENTS: ${AGENT_COUNT} ACTIVE`;

/* ---- communication graph (line segments between near agents) ---- */
const MAX_LINKS = AGENT_COUNT * 6;
const linkGeo = new THREE.BufferGeometry();
const linkPositions = new Float32Array(MAX_LINKS * 2 * 3);
linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPositions, 3));
const linkMat = new THREE.LineBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.22 });
const linkLines = new THREE.LineSegments(linkGeo, linkMat);
scene.add(linkLines);

const COMM_RANGE = 8.5;

/* ---- sonar pulses (belief broadcast) ---- */
const MAX_PULSES = 6;
const pulses = [];
const pulseGeo = new THREE.RingGeometry(1, 1.04, 40);
pulseGeo.rotateX(-Math.PI / 2);

function spawnPulse() {
  if (pulses.length >= MAX_PULSES) return;
  const src = agents[Math.floor(Math.random() * agents.length)];
  const mat = new THREE.MeshBasicMaterial({
    color: Math.random() > 0.5 ? COLORS.cyan : COLORS.amber,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(pulseGeo, mat);
  mesh.position.copy(src.position);
  mesh.scale.setScalar(0.01);
  scene.add(mesh);
  pulses.push({ mesh, age: 0, life: 2.6 });
}

let pulseTimer = 0;

/* ---- mouse parallax ---- */
let mouseX = 0, mouseY = 0;
window.addEventListener('mousemove', (e) => {
  mouseX = (e.clientX / window.innerWidth - 0.5);
  mouseY = (e.clientY / window.innerHeight - 0.5);
}, { passive: true });

/* ---- resize ---- */
function onResize() {
  width = heroEl.clientWidth;
  height = heroEl.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
window.addEventListener('resize', onResize);

/* ---- animation loop ---- */
const clock = new THREE.Clock();
let angle = 0;
const speedMul = prefersReducedMotion ? 0.35 : 1;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  agents.forEach(a => a.update(dt, speedMul));

  // rebuild communication links
  let linkIdx = 0;
  const posAttr = linkGeo.attributes.position;
  outer:
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const d = agents[i].position.distanceTo(agents[j].position);
      if (d < COMM_RANGE) {
        if (linkIdx >= MAX_LINKS) break outer;
        const a = agents[i].position, b = agents[j].position;
        posAttr.array[linkIdx * 6 + 0] = a.x;
        posAttr.array[linkIdx * 6 + 1] = a.y;
        posAttr.array[linkIdx * 6 + 2] = a.z;
        posAttr.array[linkIdx * 6 + 3] = b.x;
        posAttr.array[linkIdx * 6 + 4] = b.y;
        posAttr.array[linkIdx * 6 + 5] = b.z;
        linkIdx++;
      }
    }
  }
  linkGeo.setDrawRange(0, linkIdx * 2);
  posAttr.needsUpdate = true;

  // sonar pulses
  pulseTimer += dt;
  if (pulseTimer > 1.4) {
    pulseTimer = 0;
    spawnPulse();
  }
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    p.age += dt;
    const t = p.age / p.life;
    p.mesh.scale.setScalar(0.01 + t * 6);
    p.mesh.material.opacity = 0.5 * (1 - t);
    if (t >= 1) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      pulses.splice(i, 1);
    }
  }

  // slow camera drift + parallax
  angle += dt * (prefersReducedMotion ? 0.01 : 0.03);
  const radius = 27;
  camera.position.x = Math.sin(angle) * radius * 0.35 + mouseX * 3;
  camera.position.z = 26 + Math.cos(angle) * 2;
  camera.position.y = 9 + mouseY * 1.5;
  camera.lookAt(0, -2, 0);

  renderer.render(scene, camera);
}
animate();
onResize();
