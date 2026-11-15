import test from "node:test";
import assert from "node:assert/strict";

let fixtureNumber = 0;

async function fixture(options = {}) {
  const generation = options.generation ?? 12;
  const hooks = new Map();
  const settings = new Map();
  const frames = new Map();
  const listeners = new Map();
  const containers = [];
  const sprites = [];
  const pans = [];
  let now = 0;
  let frameNumber = 0;
  const user = { id: "player", isGM: false, targets: new Set() };
  class Container {
    constructor() { this.children = []; this.destroyed = false; containers.push(this); }
    addChild(child) { this.children.push(child); child.parent = this; return child; }
    removeChild(child) { this.children = this.children.filter(value => value !== child); child.parent = null; }
    destroy(config) {
      this.destroyed = true;
      if (options.failDestroy) throw Error("Container destruction failed");
      this.destroyOptions = config;
      for (const child of this.children) child.destroy(config);
      this.children = [];
    }
  }
  class Sprite {
    constructor(texture) {
      if (options.failSprite && sprites.length === 1) throw Error("Sprite setup failed");
      this.texture = texture;
      this.anchor = { copyFrom: value => this.anchorValue = { ...value } };
      this.scale = { x: 1, y: 1 };
      this.position = { x: 0, y: 0, set: (x, y) => { this.position.x = x; this.position.y = y; } };
      sprites.push(this);
    }
    destroy(config) { this.destroyed = true; this.destroyOptions = config; }
  }
  const scene = { id: "scene", updateEmbeddedDocuments() { assert.fail("Real token documents must never be updated"); } };
  const makeToken = (id, x, y = 0) => {
    const document = { id, x, y, width: 1, height: 1, parent: scene,
      testUserPermission: () => options.authorOwns !== false };
    return {
      document, center: { x: x + 50, y: y + 50 }, w: 100, h: 100, isVisible: true,
      actor: { testUserPermission: () => options.authorOwns !== false },
      mesh: { visible: true, renderable: true, destroyed: false,
        texture: { valid: true }, position: { x: x + 50, y: y + 50 },
        anchor: { x: 0.5, y: 0.5 }, width: 100, height: 100,
        scale: { x: -1, y: 1 }, rotation: 0.5, tint: 0x123456, worldAlpha: 0.8 }
    };
  };
  const attacker = makeToken("attacker", 0);
  const target = makeToken("target", 1000);
  const target2 = makeToken("target2", 1500);
  const tokens = new Map([attacker, target, target2].map(token => [token.document.id, token]));
  user.targets.add(target);
  if (generation >= 14) {
    for (const token of tokens.values()) {
      token.document.levelId = "ground";
      token.document.locatedInLevel = level => token.document.levelId === level.id;
    }
  }
  const stage = new Container();
  stage.pivot = { x: 400, y: 300 };
  stage.scale = { x: 1 };
  const view = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); }
  };
  const canvas = {
    ready: true, scene, stage, app: options.canvasElement ? { canvas: view } : { view }, grid: { size: 100 },
    level: generation >= 14 ? { id: "ground" } : undefined,
    photosensitiveMode: options.photosensitive ?? false,
    tokens: { get: id => tokens.get(id) },
    pan: position => {
      if (options.failPan) throw Error("Camera failed");
      pans.push(position);
      Object.assign(stage.pivot, { x: position.x, y: position.y });
      stage.scale.x = position.scale;
    }
  };
  const game = {
    user, users: new Map([[user.id, user]]), system: { id: "dnd5e" }, release: { generation },
    settings: { register: (module, key, config) => settings.set(key, config.default), get: (module, key) => settings.get(key) }
  };
  const globalNames = ["Hooks", "game", "canvas", "PIXI", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "addEventListener", "removeEventListener"];
  const previous = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const clock = test.mock.method(performance, "now", () => now);
  const errorLog = test.mock.method(console, "error", () => {});
  Object.assign(globalThis, {
    Hooks: {
      once: (name, callback) => hooks.set(name, callback),
      on: (name, callback) => hooks.set(name, callback)
    },
    game, canvas, PIXI: { Container, Sprite },
    addEventListener: view.addEventListener, removeEventListener: view.removeEventListener,
    requestAnimationFrame: callback => { frames.set(++frameNumber, callback); return frameNumber; },
    cancelAnimationFrame: id => frames.delete(id),
    matchMedia: () => ({ matches: options.reducedMotion ?? false })
  });
  await import("../scripts/anime-attacks.js?fixture=" + ++fixtureNumber);
  hooks.get("init")();
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const advance = async ms => {
    now += ms;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(now);
    await flush();
  };
  const message = (id = "message") => ({
    id, ...(generation >= 13 ? { author: user } : { user }),
    visible: true, isContentVisible: true, isRoll: true,
    speaker: { scene: "scene", token: "attacker" },
    flags: { dnd5e: { roll: { type: "attack" } } },
    updateSource(update) {
      for (const [path, value] of Object.entries(update)) {
        const keys = path.split(".");
        let current = this;
        for (const key of keys.slice(0, -1)) current = current[key] ??= {};
        current[keys.at(-1)] = value;
      }
    }
  });
  const prepare = (msg = message()) => {
    hooks.get("preCreateChatMessage")(msg, {}, {}, user.id);
    return msg;
  };
  const play = msg => hooks.get("createChatMessage")(msg, {}, user.id);
  const restore = async () => {
    hooks.get("canvasTearDown")();
    await flush();
    clock.mock.restore();
    errorLog.mock.restore();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
  return { hooks, settings, frames, listeners, containers, sprites, pans, canvas, scene,
    attacker, target, target2, user, message, prepare, play, advance, flush, restore, errorLog };
}

test("player client animates locally with exact timing and restores shared state", async t => {
  const f = await fixture();
  t.after(f.restore);
  const message = f.prepare();
  const documents = JSON.stringify([f.attacker.document, f.target.document]);
  const done = f.play(message);
  assert.equal(f.sprites.length, 2);
  assert.equal(f.attacker.mesh.renderable, false);
  await f.advance(250);
  assert.equal(f.sprites[0].position.x, 275);
  assert.equal(f.pans.at(-1).scale, 1.5);
  await f.advance(250);
  assert.equal(f.sprites[0].position.x, 500);
  assert.equal(f.pans.at(-1).scale, 2);
  await f.advance(600);
  assert.equal(f.sprites[0].position.x, 500);
  await f.advance(250);
  assert.equal(f.sprites[0].position.x, 275);
  await f.advance(250);
  await done;
  assert.equal(JSON.stringify([f.attacker.document, f.target.document]), documents);
  assert.equal(f.attacker.mesh.renderable, true);
  assert.equal(f.target.mesh.renderable, true);
  assert.equal(f.canvas.stage.children.length, 0);
  assert.deepEqual(f.pans.at(-1), { x: 400, y: 300, scale: 1 });
  assert.equal(f.listeners.size, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.sprites[0].destroyOptions.texture, false);
  assert.equal(f.sprites[0].destroyOptions.baseTexture, false);
  assert.equal(f.sprites[0].rotation, 0.5);
  assert.equal(f.sprites[0].scale.x, -1);
});

test("ordinary chat cannot capture targets or trigger animation", async t => {
  const f = await fixture();
  t.after(f.restore);
  const message = f.message();
  message.isRoll = false;
  message.flags = {};
  f.prepare(message);
  assert.equal(message.flags["anime-attacks"], undefined);
  await f.play(message);
  assert.equal(f.sprites.length, 0);
});

test("capture excludes self and tokens from other scenes", async t => {
  const f = await fixture();
  t.after(f.restore);
  f.user.targets.add(f.attacker);
  f.user.targets.add({ document: { id: "other", parent: { id: "elsewhere" } } });
  assert.deepEqual(f.prepare().flags["anime-attacks"].targetIds, ["target"]);
});

test("duplicate messages do not create duplicate animations", async t => {
  const f = await fixture();
  t.after(f.restore);
  const message = f.prepare();
  const done = f.play(message);
  await f.play(message);
  assert.equal(f.sprites.length, 2);
  await f.advance(1600);
  await done;
  await f.play(message);
  assert.equal(f.sprites.length, 2);
});

test("rapid attacks and all targets are queued in order", async t => {
  const f = await fixture();
  t.after(f.restore);
  f.user.targets.add(f.target2);
  const done = f.play(f.prepare(f.message("first")));
  f.user.targets.delete(f.target2);
  await f.play(f.prepare(f.message("second")));
  assert.equal(f.sprites.length, 2);
  await f.advance(1600);
  assert.equal(f.sprites.length, 4);
  await f.advance(1600);
  assert.equal(f.sprites.length, 6);
  await f.advance(1600);
  await done;
  assert.equal(f.frames.size, 0);
});

for (const restriction of ["private", "blind", "hiddenTarget", "unowned", "optOut", "reducedMotion", "wrongScene"]) {
  test("does not animate when restricted: " + restriction, async t => {
    const f = await fixture({ authorOwns: restriction !== "unowned", reducedMotion: restriction === "reducedMotion" });
    t.after(f.restore);
    const message = f.prepare();
    if (restriction === "private") message.visible = false;
    if (restriction === "blind") message.isContentVisible = false;
    if (restriction === "hiddenTarget") f.target.isVisible = false;
    if (restriction === "optOut") f.settings.set("clientEnabled", false);
    if (restriction === "wrongScene") f.canvas.scene = { id: "other" };
    await f.play(message);
    assert.equal(f.sprites.length, 0);
  });
}

test("scene switch cleans the old overlay without panning the new scene", async t => {
  const f = await fixture();
  t.after(f.restore);
  const done = f.play(f.prepare());
  await f.advance(250);
  const panCount = f.pans.length;
  f.canvas.scene = { id: "new-scene" };
  await f.advance(10);
  await done;
  assert.equal(f.pans.length, panCount);
  assert.equal(f.canvas.stage.children.length, 0);
  assert.equal(f.attacker.mesh.renderable, true);
});

test("teardown cancels active and queued effects", async t => {
  const f = await fixture();
  t.after(f.restore);
  const done = f.play(f.prepare(f.message("first")));
  await f.play(f.prepare(f.message("second")));
  f.hooks.get("canvasTearDown")();
  await done;
  assert.equal(f.frames.size, 0);
  assert.equal(f.sprites.length, 2);
  assert.equal(f.attacker.mesh.renderable, true);
});

for (const hook of ["deleteToken", "updateToken"]) {
  test(hook + " cancels without overwriting real token movement", async t => {
    const f = await fixture();
    t.after(f.restore);
    const done = f.play(f.prepare());
    f.target.document.x = 777;
    f.hooks.get(hook)(f.target.document, { x: 777 });
    await done;
    assert.equal(f.target.document.x, 777);
    assert.equal(f.target.mesh.renderable, true);
    assert.equal(f.frames.size, 0);
  });
}

test("camera input cancels and preserves the user's new camera view", async t => {
  const f = await fixture();
  t.after(f.restore);
  const done = f.play(f.prepare());
  await f.advance(250);
  const panCount = f.pans.length;
  f.listeners.get("wheel")();
  await done;
  assert.equal(f.pans.length, panCount);
  assert.equal(f.attacker.mesh.renderable, true);
});

test("camera opt-out leaves the camera untouched", async t => {
  const f = await fixture();
  t.after(f.restore);
  f.settings.set("cameraEnabled", false);
  const done = f.play(f.prepare());
  await f.advance(250);
  assert.equal(f.sprites[0].position.x, 275);
  await f.advance(1350);
  await done;
  assert.equal(f.pans.length, 0);
});

test("partial sprite setup failure restores the already hidden original", async t => {
  const f = await fixture({ failSprite: true });
  t.after(f.restore);
  await f.play(f.prepare());
  assert.equal(f.attacker.mesh.renderable, true);
  assert.equal(f.target.mesh.renderable, true);
  assert.equal(f.canvas.stage.children.length, 0);
  assert.ok(f.errorLog.mock.calls.length);
});

test("animation and camera restoration errors still remove stand-ins", async t => {
  const f = await fixture({ failPan: true });
  t.after(f.restore);
  const done = f.play(f.prepare());
  await f.advance(250);
  await done;
  assert.equal(f.attacker.mesh.renderable, true);
  assert.equal(f.target.mesh.renderable, true);
  assert.equal(f.canvas.stage.children.length, 0);
  assert.equal(f.frames.size, 0);
});

test("zero-duration settings complete without dividing by zero", async t => {
  const f = await fixture();
  t.after(f.restore);
  for (const key of ["moveDuration", "holdDuration", "returnDuration"]) f.settings.set(key, 0);
  const done = f.play(f.prepare());
  await f.advance(0);
  await done;
  assert.equal(f.canvas.stage.children.length, 0);
  assert.equal(f.frames.size, 0);
});

test("token suppressed by another module is never revealed", async t => {
  const f = await fixture();
  t.after(f.restore);
  f.target.mesh.renderable = false;
  const done = f.play(f.prepare());
  assert.equal(f.sprites.length, 0);
  await done;
  assert.equal(f.target.mesh.renderable, false);
});

test("camera input clears queued messages and the current message's remaining targets", async t => {
  const f = await fixture();
  t.after(f.restore);
  f.user.targets.add(f.target2);
  const done = f.play(f.prepare(f.message("first")));
  await f.play(f.prepare(f.message("second")));
  await f.advance(250);
  f.listeners.get("wheel")();
  await f.flush();
  assert.equal(f.sprites.length, 2);
  assert.equal(f.frames.size, 0);
  await done;
});

test("camera navigation keys cancel queued effects", async t => {
  const f = await fixture();
  t.after(f.restore);
  const done = f.play(f.prepare());
  await f.advance(250);
  const panCount = f.pans.length;
  f.listeners.get("keydown")({ key: "ArrowRight" });
  await done;
  assert.equal(f.pans.length, panCount);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.frames.size, 0);
});

test("losing visibility during animation stops remaining target effects", async t => {
  const f = await fixture();
  t.after(f.restore);
  f.user.targets.add(f.target2);
  const message = f.prepare();
  const done = f.play(message);
  message.isContentVisible = false;
  await f.advance(250);
  await done;
  assert.equal(f.sprites.length, 2);
  assert.equal(f.attacker.mesh.renderable, true);
  assert.equal(f.frames.size, 0);
});

test("a forged message author cannot animate another user's attacker", async t => {
  const f = await fixture();
  t.after(f.restore);
  const message = f.prepare();
  message.user = { id: "someone-else", isGM: true };
  await f.play(message);
  assert.equal(f.sprites.length, 0);
});

test("a failed overlay destruction does not skip camera restoration", async t => {
  const f = await fixture({ failDestroy: true });
  t.after(f.restore);
  const done = f.play(f.prepare());
  await f.advance(250);
  await f.advance(1350);
  await done;
  assert.deepEqual(f.pans.at(-1), { x: 400, y: 300, scale: 1 });
  assert.equal(f.attacker.mesh.renderable, true);
  assert.equal(f.canvas.stage.children.length, 0);
  assert.equal(f.frames.size, 0);
});

test("blind system cards are hidden from players even if core considers their contents visible", async t => {
  const f = await fixture();
  t.after(f.restore);
  const message = f.prepare();
  message.blind = true;
  await f.play(message);
  assert.equal(f.sprites.length, 0);
});

test("a viewing GM plays one effect and does not require a separate coordinator", async t => {
  const f = await fixture();
  t.after(f.restore);
  f.user.isGM = true;
  const done = f.play(f.prepare());
  assert.equal(f.sprites.length, 2);
  await f.advance(1600);
  await done;
  assert.equal(f.frames.size, 0);
});

for (const generation of [12, 13, 14]) {
  test('Foundry v' + generation + ' API-shaped fixture completes a local cinematic', async t => {
    const f = await fixture({ generation });
    t.after(f.restore);
    const message = f.prepare();
    if (generation >= 13) {
      Object.defineProperty(message, 'user', { get() { throw Error('Legacy user accessor read'); } });
    }
    const done = f.play(message);
    assert.equal(f.sprites.length, 2);
    await f.advance(500);
    assert.equal(f.sprites[0].position.x, 500);
    await f.advance(1100);
    await done;
    assert.equal(f.attacker.mesh.renderable, true);
    assert.equal(f.canvas.stage.children.length, 0);
    assert.deepEqual(f.pans.at(-1), { x: 400, y: 300, scale: 1 });
    assert.equal(f.listeners.size, 0);
  });
}

test('v14 level changes cancel active and queued effects without restoring the old camera', async t => {
  const f = await fixture({ generation: 14 });
  t.after(f.restore);
  f.user.targets.add(f.target2);
  const done = f.play(f.prepare(f.message('first')));
  await f.play(f.prepare(f.message('second')));
  await f.advance(250);
  const panCount = f.pans.length;
  f.canvas.level = { id: 'upper' };
  await f.advance(1);
  await done;
  assert.equal(f.sprites.length, 2);
  assert.equal(f.pans.length, panCount);
  assert.equal(f.attacker.mesh.renderable, true);
  assert.equal(f.canvas.stage.children.length, 0);
  assert.equal(f.frames.size, 0);
});

test('visible v14 tokens located on another level do not create stand-ins', async t => {
  const f = await fixture({ generation: 14 });
  t.after(f.restore);
  f.target.document.levelId = 'upper';
  await f.play(f.prepare());
  assert.equal(f.sprites.length, 0);
});

for (const property of ['elevation', 'levels']) {
  test('v14 participant ' + property + ' changes cancel the effect', async t => {
    const f = await fixture({ generation: 14 });
    t.after(f.restore);
    const done = f.play(f.prepare());
    f.hooks.get('updateToken')(f.target.document, { [property]: property === 'levels' ? ['upper'] : 100 });
    await done;
    assert.equal(f.target.mesh.renderable, true);
    assert.equal(f.frames.size, 0);
  });
}

test('Foundry photosensitive mode disables cinematic effects', async t => {
  const f = await fixture({ generation: 13, photosensitive: true });
  t.after(f.restore);
  await f.play(f.prepare());
  assert.equal(f.sprites.length, 0);
});

test('canvas element accessor works when app.view is unavailable', async t => {
  const f = await fixture({ generation: 14, canvasElement: true });
  t.after(f.restore);
  const done = f.play(f.prepare());
  assert.equal(f.sprites.length, 2);
  await f.advance(1600);
  await done;
  assert.equal(f.listeners.size, 0);
  assert.equal(f.frames.size, 0);
});
