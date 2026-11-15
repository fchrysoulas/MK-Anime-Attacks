import { MODULE_ID, isAttackMessage, sanitizeSettings, calculateClash, interpolate } from "./core.js";

const queue = [];
const seenMessages = new Set();
let draining = false;
let activeAnimation = null;

Hooks.once("init", () => {
  const register = (key, config) => game.settings.register(MODULE_ID, key, {
    scope: "world", config: true, ...config
  });
  register("enabled", {
    name: "Enable Anime Attacks", type: Boolean, default: true,
    hint: "Play cinematic effects for supported attack rolls with selected targets."
  });
  register("clientEnabled", {
    name: "Show Animations on This Client", scope: "client", type: Boolean, default: true
  });
  register("cameraEnabled", {
    name: "Camera Zoom on This Client", scope: "client", type: Boolean, default: true,
    hint: "Disable to keep your camera stationary during attack effects."
  });
  register("zoomScale", {
    name: "Dramatic Zoom Scale", type: Number, default: 2,
    range: { min: 1, max: 4, step: 0.1 }
  });
  for (const [key, name, defaultValue] of [
    ["moveDuration", "Approach Duration (milliseconds)", 500],
    ["holdDuration", "Clash Hold Duration (milliseconds)", 600],
    ["returnDuration", "Return Duration (milliseconds)", 500]
  ]) {
    register(key, { name, type: Number, default: defaultValue, range: { min: 0, max: 5000, step: 50 } });
  }
  register("approachDistance", {
    name: "Clash Center Distance (grid squares)", type: Number, default: 1,
    hint: "Large token footprints are kept apart. Tokens already closer are not pushed away.",
    range: { min: 0.25, max: 4, step: 0.25 }
  });
});

Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
  if (userId !== game.user.id || !game.settings.get(MODULE_ID, "enabled")) return;
  if (!isAttackMessage(message, game.system.id)) return;
  const { scene, token } = message.speaker ?? {};
  if (!scene || !token || scene !== canvas.scene?.id) return;
  const targetIds = [...new Set(Array.from(game.user.targets ?? [])
    .filter(target => target.document?.parent?.id === scene && target.document.id !== token)
    .map(target => target.document.id))];
  if (!targetIds.length) return;
  message.updateSource({
    [`flags.${MODULE_ID}.sceneId`]: scene,
    [`flags.${MODULE_ID}.attackerId`]: token,
    [`flags.${MODULE_ID}.targetIds`]: targetIds
  });
});

// Foundry broadcasts chat creation. Each eligible client plays one local effect;
// no GM coordinator, socket, or TokenDocument update is needed.
Hooks.on("createChatMessage", enqueueMessage);
Hooks.on("canvasTearDown", () => {
  queue.length = 0;
  activeAnimation?.cancel(false);
});
Hooks.on("deleteToken", document => cancelForToken(document));
Hooks.on("updateToken", (document, changes) => {
  if (["x", "y", "width", "height", "rotation", "texture", "hidden", "alpha", "elevation", "levels"].some(key => key in changes)) {
    cancelForToken(document);
  }
});

function cancelForToken(document) {
  if (activeAnimation?.documents.includes(document)) activeAnimation.cancel(true);
}

function clientEnabled() {
  return game.settings.get(MODULE_ID, "enabled")
    && game.settings.get(MODULE_ID, "clientEnabled")
    && !canvas.photosensitiveMode
    && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function messageEligible(message, userId) {
  if (!clientEnabled() || !canvas.ready || !message.visible || !message.isContentVisible) return false;
  // Custom system cards may not use core Roll objects, so also honor the blind flag.
  if (message.blind && !game.user.isGM) return false;
  if (!isAttackMessage(message, game.system.id)) return false;
  const flags = message.flags?.[MODULE_ID];
  if (!flags || flags.sceneId !== canvas.scene?.id || flags.sceneId !== message.speaker?.scene
    || flags.attackerId !== message.speaker?.token || !Array.isArray(flags.targetIds)) return false;
  const authorReference = message.author ?? message.user;
  const author = typeof authorReference === "string" ? game.users.get(authorReference) : authorReference;
  if (!author || (userId && userId !== author.id)) return false;
  const attacker = canvas.tokens.get(flags.attackerId);
  return Boolean(attacker && (author.isGM
    || attacker.actor?.testUserPermission(author, "OWNER")
    || attacker.document.testUserPermission(author, "OWNER")));
}

async function enqueueMessage(message, options, userId) {
  if (!message.id || seenMessages.has(message.id) || !messageEligible(message, userId)) return;
  if (queue.length >= 20) {
    console.warn("anime-attacks | Animation queue is full; skipping effect");
    return;
  }
  seenMessages.add(message.id);
  if (seenMessages.size > 1000) seenMessages.delete(seenMessages.values().next().value);
  queue.push({ message, userId, scene: canvas.scene, level: canvas.level });
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const next = queue.shift();
      if (canvas.scene !== next.scene || canvas.level !== next.level
        || !messageEligible(next.message, next.userId)) continue;
      const flags = next.message.flags[MODULE_ID];
      for (const targetId of new Set(flags.targetIds)) {
        if (canvas.scene !== next.scene || canvas.level !== next.level
          || !messageEligible(next.message, next.userId)) break;
        if (typeof targetId !== "string" || targetId === flags.attackerId) continue;
        const attacker = canvas.tokens.get(flags.attackerId);
        const target = canvas.tokens.get(targetId);
        if (!visibleToken(attacker) || !visibleToken(target)) continue;
        const completed = await runAnimeAttackAnimation(attacker, target, next.message);
        if (!completed) break;
      }
    }
  } catch (error) {
    console.error("anime-attacks | Animation failed", error);
  } finally {
    draining = false;
  }
}

function visibleToken(token, allowSuppressed = false) {
  // v14 can display tokens from another level. Animate only the viewed floor.
  if (canvas.level && token?.document?.locatedInLevel
    && !token.document.locatedInLevel(canvas.level)) return false;
  return Boolean(token?.isVisible && !token.destroyed && token.mesh?.visible
    && !token.mesh.destroyed && token.mesh.texture?.valid
    && (allowSuppressed || token.mesh.renderable !== false));
}

async function runAnimeAttackAnimation(attacker, target, message) {
  const scene = canvas.scene;
  const stage = canvas.stage;
  const level = canvas.level;
  const sameView = () => canvas.scene === scene && canvas.stage === stage && canvas.level === level;
  const settings = sanitizeSettings(Object.fromEntries([
    "moveDuration", "holdDuration", "returnDuration", "zoomScale", "approachDistance"
  ].map(key => [key, game.settings.get(MODULE_ID, key)])));
  const clash = calculateClash(attacker, target, settings.approachDistance * canvas.grid.size);
  if (!clash) return true;
  const originalView = { x: stage.pivot.x, y: stage.pivot.y, scale: stage.scale.x };
  const zoomView = { ...clash.midpoint, scale: settings.zoomScale };
  const cameraEnabled = game.settings.get(MODULE_ID, "cameraEnabled");
  const view = canvas.app.canvas ?? canvas.app.view;
  const participants = [];
  let overlay;
  let frameId;
  let finished = false;

  return new Promise(resolve => {
    // Every cleanup step is independent, so one failure cannot skip restoration.
    const cleanup = action => {
      try { action(); }
      catch (error) { console.error("anime-attacks | Animation cleanup failed", error); }
    };
    const finish = (restoreView = true, completed = false) => {
      if (finished) return;
      finished = true;
      cleanup(() => cancelAnimationFrame(frameId));
      cleanup(() => view.removeEventListener("pointerdown", onInteraction, true));
      cleanup(() => view.removeEventListener("wheel", onInteraction, true));
      cleanup(() => globalThis.removeEventListener?.("keydown", onKeyDown, true));
      for (const { mesh, renderable } of participants) {
        cleanup(() => { if (!mesh.destroyed) mesh.renderable = renderable; });
      }
      if (overlay && !overlay.destroyed) {
        cleanup(() => overlay.parent?.removeChild(overlay));
        // Textures belong to Foundry; never destroy them with the stand-ins.
        cleanup(() => overlay.destroy({ children: true, texture: false, baseTexture: false }));
      }
      if (restoreView && cameraEnabled && canvas.ready && sameView()) {
        cleanup(() => canvas.pan(originalView));
      }
      activeAnimation = null;
      resolve(completed);
    };
    const onInteraction = () => {
      queue.length = 0;
      finish(false);
    };
    const onKeyDown = event => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "+", "-", "="].includes(event.key)) {
        onInteraction();
      }
    };
    activeAnimation = { documents: [attacker.document, target.document], cancel: finish };

    try {
      overlay = new PIXI.Container();
      overlay.eventMode = "none";
      overlay.zIndex = Number.MAX_SAFE_INTEGER;
      stage.addChild(overlay);
      for (const [token, destination] of [[attacker, clash.attacker], [target, clash.target]]) {
        const mesh = token.mesh;
        const sprite = new PIXI.Sprite(mesh.texture);
        overlay.addChild(sprite);
        sprite.anchor.copyFrom(mesh.anchor);
        sprite.width = Math.abs(mesh.width);
        sprite.height = Math.abs(mesh.height);
        sprite.scale.x *= Math.sign(mesh.scale.x) || 1;
        sprite.scale.y *= Math.sign(mesh.scale.y) || 1;
        sprite.rotation = mesh.rotation;
        sprite.tint = mesh.tint;
        sprite.alpha = mesh.worldAlpha;
        const origin = { x: mesh.position.x, y: mesh.position.y };
        sprite.position.set(origin.x, origin.y);
        participants.push({
          token, mesh, sprite, origin, renderable: mesh.renderable,
          destination: { x: origin.x + destination.x - token.center.x, y: origin.y + destination.y - token.center.y }
        });
        mesh.renderable = false;
      }
      view.addEventListener("pointerdown", onInteraction, true);
      view.addEventListener("wheel", onInteraction, true);
      globalThis.addEventListener?.("keydown", onKeyDown, true);
      const start = performance.now();
      const total = settings.moveDuration + settings.holdDuration + settings.returnDuration;

      const frame = now => {
        if (finished) return;
        try {
          if (!sameView() || !messageEligible(message)
            || participants.some(({ token, mesh }) => token.mesh !== mesh || !visibleToken(token, true))) {
            finish();
            return;
          }
          const elapsed = Math.max(0, now - start);
          if (elapsed >= total) {
            finish(true, true);
            return;
          }
          const returning = elapsed >= settings.moveDuration + settings.holdDuration;
          const progress = returning
            ? (elapsed - settings.moveDuration - settings.holdDuration) / (settings.returnDuration || 1)
            : elapsed / (settings.moveDuration || 1);
          const amount = interpolate(0, 1, settings.moveDuration === 0 && !returning ? 1 : progress);
          for (const { sprite, origin, destination } of participants) {
            const from = returning ? destination : origin;
            const to = returning ? origin : destination;
            sprite.position.set(interpolate(from.x, to.x, amount, false), interpolate(from.y, to.y, amount, false));
          }
          if (cameraEnabled) {
            const from = returning ? zoomView : originalView;
            const to = returning ? originalView : zoomView;
            canvas.pan(Object.fromEntries(["x", "y", "scale"].map(key => [key, interpolate(from[key], to[key], amount, false)])));
          }
          frameId = requestAnimationFrame(frame);
        } catch (error) {
          console.error("anime-attacks | Animation failed", error);
          finish();
        }
      };
      frameId = requestAnimationFrame(frame);
    } catch (error) {
      console.error("anime-attacks | Animation setup failed", error);
      finish();
    }
  });
}
