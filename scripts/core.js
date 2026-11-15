export const MODULE_ID = "anime-attacks";

/** Use structured roll metadata, never translated chat text or item-card HTML. */
export function isAttackMessage(message, systemId) {
  const flags = message.flags ?? {};
  if (flags[MODULE_ID]?.attack === false) return false;
  const legacyShadowdarkRoll = systemId === "shadowdark"
    && flags.shadowdark?.isRoll === true && flags.shadowdark?.rolls?.main?.roll;
  if (!message.isRoll && !message.rolls?.length && !legacyShadowdarkRoll) return false;
  if (flags[MODULE_ID]?.attack === true) return true;
  switch (systemId) {
    case "dnd5e":
      return flags.dnd5e?.roll?.type === "attack"
        || Array.from(message.rolls ?? []).some(roll => roll.options?.type === "attack");
    case "pf2e":
      return ["attack-roll", "spell-attack-roll"].includes(flags.pf2e?.context?.type);
    case "shadowdark":
      return (flags.shadowdark?.rollConfig ?? message.rollConfig)?.type === "attack";
    default:
      return false;
  }
}

export function sanitizeSettings(values) {
  const bounded = (key, fallback, min, max) => {
    const value = values[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value)) : fallback;
  };
  return {
    moveDuration: bounded("moveDuration", 500, 0, 5000),
    holdDuration: bounded("holdDuration", 600, 0, 5000),
    returnDuration: bounded("returnDuration", 500, 0, 5000),
    zoomScale: bounded("zoomScale", 2, 1, 4),
    approachDistance: bounded("approachDistance", 1, 0.25, 4)
  };
}

/** Token centers and rendered footprints also work on hex and gridless scenes. */
export function calculateClash(attacker, target, requestedDistance) {
  const a = attacker.center;
  const b = target.center;
  if (![a?.x, a?.y, b?.x, b?.y, attacker.w, attacker.h, target.w, target.h, requestedDistance].every(Number.isFinite)) return null;
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  if (!distance || requestedDistance < 0) return null;
  const direction = { x: (b.x - a.x) / distance, y: (b.y - a.y) / distance };
  const footprint = (Math.abs(direction.x) * (attacker.w + target.w)
    + Math.abs(direction.y) * (attacker.h + target.h)) / 2;
  const separation = Math.min(distance, Math.max(requestedDistance, footprint));
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return {
    midpoint,
    attacker: { x: midpoint.x - direction.x * separation / 2, y: midpoint.y - direction.y * separation / 2 },
    target: { x: midpoint.x + direction.x * separation / 2, y: midpoint.y + direction.y * separation / 2 }
  };
}

export function interpolate(from, to, progress, ease = true) {
  const clamped = Math.max(0, Math.min(1, progress));
  const amount = ease ? clamped * clamped * (3 - 2 * clamped) : clamped;
  return from + (to - from) * amount;
}
