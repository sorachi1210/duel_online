const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const ZONES = ["deck", "hand", "mana", "shield", "battle", "graveyard"];

function newRoom(code) {
  return {
    code,
    players: [],
    state: {
      turn: 0,
      activePlayer: 0,
      log: ["ルームを作成しました。2人目の参加を待っています。"],
      players: []
    }
  };
}
function addLog(room, message) {
  room.state.log.unshift(message);
  room.state.log = room.state.log.slice(0, 30);
}
function publicState(room, socketId) {
  const you = room.players.findIndex(p => p.id === socketId);
  const players = room.state.players.map((p, i) => ({
    name: p.name,
    zones: Object.fromEntries(ZONES.map(z => [
      z, z === "hand" && i !== you
        ? { count: p.zones.hand.length }
        : z === "deck" && i !== you
          ? { count: p.zones.deck.length }
          : p.zones[z]
    ]))
  }));
  return { code: room.code, you, activePlayer: room.state.activePlayer, turn: room.state.turn, log: room.state.log, players };
}
function broadcast(room) {
  for (const player of room.players) {
    io.to(player.id).emit("state", publicState(room, player.id));
  }
}
function roomFor(socket) {
  const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
  return room || null;
}
function playerIndex(room, socket) {
  return room.players.findIndex(p => p.id === socket.id);
}
function cleanName(value, fallback) {
  return String(value || fallback).trim().slice(0, 24) || fallback;
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name }, reply) => {
    let code;
    do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (rooms.has(code));
    const room = newRoom(code);
    room.players.push({ id: socket.id, name: cleanName(name, "プレイヤー1") });
    room.state.players.push({ name: room.players[0].name, zones: Object.fromEntries(ZONES.map(z => [z, []])) });
    rooms.set(code, room);
    socket.join(code);
    addLog(room, `${room.players[0].name} がルームを作成しました。`);
    reply?.({ ok: true, code });
    broadcast(room);
  });

  socket.on("joinRoom", ({ code, name }, reply) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply?.({ ok: false, error: "ルームが見つかりません。" });
    if (room.players.some(p => p.id === socket.id)) return reply?.({ ok: true, code });
    if (room.players.length >= 2) return reply?.({ ok: false, error: "このルームは満員です。" });
    const playerName = cleanName(name, "プレイヤー2");
    room.players.push({ id: socket.id, name: playerName });
    room.state.players.push({ name: playerName, zones: Object.fromEntries(ZONES.map(z => [z, []])) });
    socket.join(code);
    addLog(room, `${playerName} が参加しました。対戦準備完了！`);
    reply?.({ ok: true, code });
    broadcast(room);
  });

  socket.on("addCard", ({ name, cost, zone }, reply) => {
    const room = roomFor(socket);
    if (!room) return reply?.({ ok: false, error: "先にルームへ参加してください。" });
    const idx = playerIndex(room, socket);
    if (idx < 0 || !ZONES.includes(zone)) return reply?.({ ok: false, error: "操作を確認してください。" });
    const cardName = String(name || "").trim().slice(0, 60);
    if (!cardName) return reply?.({ ok: false, error: "カード名を入力してください。" });
    const card = { id: crypto.randomUUID(), name: cardName, cost: Math.max(0, Math.min(99, Number(cost) || 0)) };
    room.state.players[idx].zones[zone].push(card);
    addLog(room, `${room.players[idx].name} が「${card.name}」を ${zoneLabel(zone)} に追加しました。`);
    reply?.({ ok: true });
    broadcast(room);
  });

  socket.on("moveCard", ({ cardId, from, to }, reply) => {
    const room = roomFor(socket);
    if (!room) return reply?.({ ok: false, error: "ルームに参加していません。" });
    const idx = playerIndex(room, socket);
    if (!ZONES.includes(from) || !ZONES.includes(to)) return reply?.({ ok: false, error: "ゾーンが不正です。" });
    const zones = room.state.players[idx].zones;
    const at = zones[from].findIndex(c => c.id === cardId);
    if (at < 0) return reply?.({ ok: false, error: "カードが見つかりません。" });
    const [card] = zones[from].splice(at, 1);
    zones[to].push(card);
    addLog(room, `${room.players[idx].name} が「${card.name}」を ${zoneLabel(from)} から ${zoneLabel(to)} へ移動しました。`);
    reply?.({ ok: true });
    broadcast(room);
  });

  socket.on("passTurn", reply => {
    const room = roomFor(socket);
    if (!room) return reply?.({ ok: false, error: "ルームに参加していません。" });
    const idx = playerIndex(room, socket);
    if (room.players.length < 2) return reply?.({ ok: false, error: "相手の参加を待っています。" });
    if (room.state.activePlayer !== idx) return reply?.({ ok: false, error: "自分のターンではありません。" });
    room.state.activePlayer = 1 - room.state.activePlayer;
    room.state.turn += 1;
    addLog(room, `${room.players[room.state.activePlayer].name} のターンです。`);
    reply?.({ ok: true });
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = roomFor(socket);
    if (!room) return;
    const idx = playerIndex(room, socket);
    const [left] = room.players.splice(idx, 1);
    room.state.players.splice(idx, 1);
    if (room.players.length === 0) rooms.delete(room.code);
    else {
      room.state.activePlayer = 0;
      addLog(room, `${left.name} が切断しました。ルームは相手の再参加を待っています。`);
      broadcast(room);
    }
  });
});

function zoneLabel(z) {
  return ({ deck: "山札", hand: "手札", mana: "マナ", shield: "シールド", battle: "バトルゾーン", graveyard: "墓地" })[z] || z;
}
server.listen(PORT, () => console.log(`Prototype running at http://localhost:${PORT}`));
