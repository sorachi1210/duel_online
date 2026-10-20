const socket = io();
const $ = id => document.getElementById(id);
const zoneNames = { deck:"山札", hand:"手札", mana:"マナゾーン", shield:"シールド", battle:"バトルゾーン", graveyard:"墓地" };
let state = null;
let selected = null;

socket.on("connect", () => { $("connection").textContent = "サーバー接続中"; $("connection").classList.add("online"); });
socket.on("disconnect", () => { $("connection").textContent = "切断"; $("connection").classList.remove("online"); });
socket.on("state", s => { state = s; $("lobby").hidden = true; $("game").hidden = false; render(); });

function call(event, data) {
  socket.emit(event, data, result => {
    if (result && result.ok === false) alert(result.error || "操作できませんでした。");
  });
}
function myPlayer(){ return state?.players?.[state.you]; }
function opponent(){ return state?.players?.[1-state.you]; }

$("createBtn").onclick = () => call("createRoom", { name: $("playerName").value });
$("joinBtn").onclick = () => call("joinRoom", { code: $("roomCode").value, name: $("playerName").value });
$("addCardBtn").onclick = () => {
  call("addCard", { name: $("cardName").value, cost: $("cardCost").value, zone: $("cardZone").value });
  $("cardName").value = "";
};
$("passBtn").onclick = () => call("passTurn", {});
$("moveBtn").onclick = () => {
  if (!selected) return alert("先に移動したいカードを選んでね。");
  call("moveCard", { cardId: selected.id, from: selected.zone, to: $("moveTo").value });
  selected = null;
};
function renderZone(container, player, zone, isMine) {
  const data = player.zones[zone];
  const hiddenCount = data && !Array.isArray(data) ? data.count : null;
  const cards = Array.isArray(data) ? data : [];
  const box = document.createElement("div");
  box.className = "zone";
  const title = document.createElement("h3");
  title.innerHTML = `<span>${zoneNames[zone]}</span><span class="zone-count">${hiddenCount !== null ? hiddenCount : cards.length}枚</span>`;
  box.appendChild(title);
  const list = document.createElement("div"); list.className = "cards";
  if (hiddenCount !== null) {
    const hint = document.createElement("span"); hint.className = "empty"; hint.textContent = zone === "hand" ? "相手の手札は非公開" : "枚数のみ表示"; list.appendChild(hint);
  } else if (!cards.length) {
    const empty = document.createElement("span"); empty.className = "empty"; empty.textContent = "カードなし"; list.appendChild(empty);
  } else {
    cards.forEach(card => {
      const el = document.createElement("button");
      el.className = "card" + (selected?.id === card.id ? " selected" : "");
      el.innerHTML = `<span class="cost">${Number(card.cost)||0}</span>${escapeHtml(card.name)}`;
      el.title = "選択して移動";
      el.onclick = () => { if (isMine) { selected = {id:card.id, zone}; $("selectedCard").textContent = card.name; render(); } };
      list.appendChild(el);
    });
  }
  box.appendChild(list); container.appendChild(box);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function render() {
  if (!state) return;
  $("roomLabel").textContent = state.code;
  $("turnLabel").textContent = state.turn;
  const me = myPlayer(), opp = opponent();
  $("myName").textContent = me?.name || "自分";
  $("opponentName").textContent = opp?.name || "相手が未参加";
  const mineTurn = state.activePlayer === state.you;
  $("turnStatus").textContent = state.players.length < 2 ? "相手の参加を待っています" : mineTurn ? "あなたのターン" : "相手のターン";
  $("passBtn").disabled = !mineTurn || state.players.length < 2;
  $("myZones").innerHTML = ""; $("opponentZones").innerHTML = "";
  ["battle","shield","mana","hand","graveyard","deck"].forEach(z => renderZone($("opponentZones"), opp || {zones:{}}, z, false));
  ["battle","shield","mana","hand","graveyard","deck"].forEach(z => renderZone($("myZones"), me, z, true));
  $("log").innerHTML = "";
  (state.log || []).forEach(line => { const li = document.createElement("li"); li.textContent = line; $("log").appendChild(li); });
  if (!selected) $("selectedCard").textContent = "未選択";
}
