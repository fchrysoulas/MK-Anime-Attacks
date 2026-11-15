const MODULE_ID = "anime-attacks";

const SETTINGS = {
  enabled: "enabled",
  zoomScale: "zoomScale",
  moveDuration: "moveDuration",
  holdDuration: "holdDuration",
  returnDuration: "returnDuration",
  approachDistance: "approachDistance"
};

let animationRunning = false;

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);

  game.settings.register(MODULE_ID, SETTINGS.enabled, {
    name: "Enable Anime Attack",
    hint: "If enabled, attack rolls trigger the cinematic movement animation.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.zoomScale, {
    name: "Dramatic Zoom Scale",
    hint: "Camera zoom level during the attack animation.",
    scope: "world",
    config: true,
    type: Number,
    default: 2.0,
    range: {
      min: 1,
      max: 4,
      step: 0.1
    }
  });

  game.settings.register(MODULE_ID, SETTINGS.moveDuration, {
    name: "Move Duration",
    hint: "How long the tokens take to move toward each other, in milliseconds.",
    scope: "world",
    config: true,
    type: Number,
    default: 500
  });

  game.settings.register(MODULE_ID, SETTINGS.holdDuration, {
    name: "Clash Hold Duration",
    hint: "How long the tokens remain close together before returning, in milliseconds.",
    scope: "world",
    config: true,
    type: Number,
    default: 600
  });

  game.settings.register(MODULE_ID, SETTINGS.returnDuration, {
    name: "Return Duration",
    hint: "How long the tokens take to return to their original positions, in milliseconds.",
    scope: "world",
    config: true,
    type: Number,
    default: 500
  });

  game.settings.register(MODULE_ID, SETTINGS.approachDistance, {
    name: "Approach Distance",
    hint: "Distance between attacker and target at the clash point, in grid squares.",
    scope: "world",
    config: true,
    type: Number,
    default: 1,
    range: {
      min: 0.25,
      max: 4,
      step: 0.25
    }
  });
});

/**
 * Store currently targeted tokens on the chat message before it is created.
 */
Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
  if (!game.settings.get(MODULE_ID, SETTINGS.enabled)) return;
  if (userId !== game.user.id) return;

  const speaker = message.speaker;
  if (!speaker?.scene || !speaker?.token) return;

  const targets = Array.from(game.user.targets ?? []);
  if (!targets.length) return;

  const targetIds = targets
    .filter(t => t?.document?.id)
    .map(t => t.document.id);

  if (!targetIds.length) return;

  message.updateSource({
    [`flags.${MODULE_ID}.sceneId`]: speaker.scene,
    [`flags.${MODULE_ID}.attackerId`]: speaker.token,
    [`flags.${MODULE_ID}.targetIds`]: targetIds
  });
});

/**
 * GM performs the animation once the chat message exists.
 */
Hooks.on("createChatMessage", async (message) => {
  if (!game.settings.get(MODULE_ID, SETTINGS.enabled)) return;
  if (!game.user.isGM) return;
  if (animationRunning) return;

  const flags = message.flags?.[MODULE_ID];
  if (!flags?.sceneId || !flags?.attackerId || !flags?.targetIds?.length) return;

  const scene = game.scenes.get(flags.sceneId);
  if (!scene || scene.id !== canvas.scene?.id) return;

  const attacker = canvas.tokens.get(flags.attackerId);
  const target = canvas.tokens.get(flags.targetIds[0]);

  if (!attacker || !target) return;

  await runAnimeAttackAnimation(attacker, target);
});

async function runAnimeAttackAnimation(attacker, target) {
  animationRunning = true;

  try {
    const moveDuration = game.settings.get(MODULE_ID, SETTINGS.moveDuration);
    const holdDuration = game.settings.get(MODULE_ID, SETTINGS.holdDuration);
    const returnDuration = game.settings.get(MODULE_ID, SETTINGS.returnDuration);
    const zoomScale = game.settings.get(MODULE_ID, SETTINGS.zoomScale);
    const approachDistanceSquares = game.settings.get(MODULE_ID, SETTINGS.approachDistance);

    const gridSize = canvas.grid.size;
    const approachDistance = approachDistanceSquares * gridSize;

    const attackerDoc = attacker.document;
    const targetDoc = target.document;

    const attackerOriginal = {
      x: attackerDoc.x,
      y: attackerDoc.y
    };

    const targetOriginal = {
      x: targetDoc.x,
      y: targetDoc.y
    };

    const attackerCenter = getTokenCenter(attacker);
    const targetCenter = getTokenCenter(target);

    const midpoint = {
      x: (attackerCenter.x + targetCenter.x) / 2,
      y: (attackerCenter.y + targetCenter.y) / 2
    };

    const vector = normalizeVector({
      x: targetCenter.x - attackerCenter.x,
      y: targetCenter.y - attackerCenter.y
    });

    const attackerClashCenter = {
      x: midpoint.x - vector.x * approachDistance / 2,
      y: midpoint.y - vector.y * approachDistance / 2
    };

    const targetClashCenter = {
      x: midpoint.x + vector.x * approachDistance / 2,
      y: midpoint.y + vector.y * approachDistance / 2
    };

    const attackerNewPos = centerToTokenPosition(attacker, attackerClashCenter);
    const targetNewPos = centerToTokenPosition(target, targetClashCenter);

    const originalView = {
      x: canvas.stage.pivot.x,
      y: canvas.stage.pivot.y,
      scale: canvas.stage.scale.x
    };

    await dramaticPan(midpoint, zoomScale, moveDuration);

    await canvas.scene.updateEmbeddedDocuments("Token", [
      {
        _id: attackerDoc.id,
        x: attackerNewPos.x,
        y: attackerNewPos.y
      },
      {
        _id: targetDoc.id,
        x: targetNewPos.x,
        y: targetNewPos.y
      }
    ], {
      animate: true
    });

    await wait(moveDuration + holdDuration);

    await canvas.scene.updateEmbeddedDocuments("Token", [
      {
        _id: attackerDoc.id,
        x: attackerOriginal.x,
        y: attackerOriginal.y
      },
      {
        _id: targetDoc.id,
        x: targetOriginal.x,
        y: targetOriginal.y
      }
    ], {
      animate: true
    });

    await wait(returnDuration);

    await canvas.animatePan({
      x: originalView.x,
      y: originalView.y,
      scale: originalView.scale,
      duration: returnDuration
    });

  } catch (err) {
    console.error(`${MODULE_ID} | Animation failed`, err);
  } finally {
    animationRunning = false;
  }
}

function getTokenCenter(token) {
  const gridSize = canvas.grid.size;

  return {
    x: token.document.x + token.document.width * gridSize / 2,
    y: token.document.y + token.document.height * gridSize / 2
  };
}

function centerToTokenPosition(token, center) {
  const gridSize = canvas.grid.size;

  return {
    x: center.x - token.document.width * gridSize / 2,
    y: center.y - token.document.height * gridSize / 2
  };
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y);

  if (length === 0) {
    return { x: 1, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

async function dramaticPan(point, scale, duration) {
  await canvas.animatePan({
    x: point.x,
    y: point.y,
    scale,
    duration
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}