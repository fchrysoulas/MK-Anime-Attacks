import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { isAttackMessage, sanitizeSettings, calculateClash, interpolate } from "../scripts/core.js";

test("manifest references real entry points and keeps its established module ID", () => {
  const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url)));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(manifest.id, "anime-attacks");
  assert.equal(manifest.version, pkg.version);
  for (const path of [...manifest.esmodules, ...manifest.styles]) {
    assert.ok(existsSync(new URL("../" + path, import.meta.url)), path);
  }
});

test("ordinary chat and item cards never count as attack rolls", () => {
  for (const system of ["dnd5e", "pf2e", "shadowdark", "other"]) {
    assert.equal(isAttackMessage({ content: "Attack! Damage!", flags: {} }, system), false);
    assert.equal(isAttackMessage({ flags: { "anime-attacks": { attack: true } } }, system), false);
  }
});

test("recognizes structured metadata for supported systems", () => {
  const roll = flags => ({ isRoll: true, flags });
  assert.equal(isAttackMessage(roll({ dnd5e: { roll: { type: "attack" } } }), "dnd5e"), true);
  assert.equal(isAttackMessage({ rolls: [{ options: { type: "attack" } }] }, "dnd5e"), true);
  assert.equal(isAttackMessage(roll({ pf2e: { context: { type: "attack-roll" } } }), "pf2e"), true);
  assert.equal(isAttackMessage(roll({ pf2e: { context: { type: "spell-attack-roll" } } }), "pf2e"), true);
  assert.equal(isAttackMessage(roll({ shadowdark: { rollConfig: { type: "attack" } } }), "shadowdark"), true);
  assert.equal(isAttackMessage({ isRoll: true, rollConfig: { type: "attack" } }, "shadowdark"), true);
});

test("damage, saves, spell checks and foreign system flags do not trigger", () => {
  for (const type of ["damage", "save", "check", "spell", "item"]) {
    assert.equal(isAttackMessage({ isRoll: true, flags: { dnd5e: { roll: { type } } } }, "dnd5e"), false);
    assert.equal(isAttackMessage({ isRoll: true, flags: { shadowdark: { rollConfig: { type } } } }, "shadowdark"), false);
  }
  assert.equal(isAttackMessage({ isRoll: true, flags: { dnd5e: { roll: { type: "attack" } } } }, "unknown"), false);
});

test("explicit opt-in requires a roll, and explicit opt-out takes priority", () => {
  assert.equal(isAttackMessage({ rolls: [{}], flags: { "anime-attacks": { attack: true } } }, "other"), true);
  assert.equal(isAttackMessage({ isRoll: true, flags: {
    dnd5e: { roll: { type: "attack" } }, "anime-attacks": { attack: false }
  } }, "dnd5e"), false);
});

test("settings bound finite numbers and replace invalid values", () => {
  assert.deepEqual(sanitizeSettings({ moveDuration: -1, holdDuration: Infinity, returnDuration: NaN,
    zoomScale: 99, approachDistance: "oops" }), {
    moveDuration: 0, holdDuration: 600, returnDuration: 500, zoomScale: 4, approachDistance: 1
  });
  assert.equal(sanitizeSettings({ returnDuration: 999999 }).returnDuration, 5000);
  assert.equal(sanitizeSettings({ holdDuration: 0 }).holdDuration, 0);
});

const token = (x, y, w = 100, h = 100) => ({ center: { x, y }, w, h });

test("clash geometry preserves midpoint and configured spacing", () => {
  const clash = calculateClash(token(50, 50), token(1050, 50), 100);
  assert.deepEqual(clash, { midpoint: { x: 550, y: 50 }, attacker: { x: 500, y: 50 }, target: { x: 600, y: 50 } });
});

test("large and diagonal footprints stay apart without pushing close tokens outward", () => {
  const large = calculateClash(token(0, 0, 400, 400), token(1000, 0, 200, 200), 100);
  assert.equal(large.target.x - large.attacker.x, 300);
  const close = calculateClash(token(0, 0), token(50, 0), 400);
  assert.equal(close.attacker.x, 0);
  assert.equal(close.target.x, 50);
  const diagonal = calculateClash(token(0, 0), token(1000, 1000), 100);
  assert.ok(Math.hypot(diagonal.target.x - diagonal.attacker.x, diagonal.target.y - diagonal.attacker.y) >= 141);
});

test("coincident centers and invalid coordinates are safely skipped", () => {
  assert.equal(calculateClash(token(50, 50), token(50, 50), 100), null);
  assert.equal(calculateClash(token(NaN, 0), token(100, 0), 100), null);
  assert.equal(calculateClash(token(0, 0), token(100, 0), Infinity), null);
});

test("interpolation clamps endpoints and eases smoothly", () => {
  assert.equal(interpolate(0, 100, -1), 0);
  assert.equal(interpolate(0, 100, 0.5), 50);
  assert.equal(interpolate(0, 100, 2), 100);
  assert.ok(interpolate(0, 100, 0.25) < 25);
});

test("legacy Shadowdark cards require an explicit marker instead of guessing from their rolls", () => {
  const message = { flags: { shadowdark: { isRoll: true, rolls: { main: { roll: { formula: "1d20+3" } } } } } };
  assert.equal(isAttackMessage(message, "shadowdark"), false);
  message.flags["anime-attacks"] = { attack: true };
  assert.equal(isAttackMessage(message, "shadowdark"), true);
});
