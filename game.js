// game.js - основной движок
// Получение параметров из URL и localStorage
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('roomId');
const gameMode = urlParams.get('mode') || localStorage.getItem('gameMode');
const myPlayerId = urlParams.get('playerId') || localStorage.getItem('playerId');
const tankId = parseInt(urlParams.get('tankId') || localStorage.getItem('selectedTank') || '1');

if (!roomId || !myPlayerId) {
    alert('Ошибка: комната не найдена');
    window.location.href = 'index.html';
}

// Глобальные переменные
let canvas = document.getElementById('gameCanvas');
let ctx = canvas.getContext('2d');
let localTank = null;
let players = {}; // id -> tank object
let shells = {};
let powerups = {};
let lastSentTime = 0;
let lastFireTime = 0;
let frame = 0;
let animationId = null;
let camera = { x: 0, y: 0 };
let gameActive = true;
let winnerDeclared = false;
let myKills = 0;

// Настройки карты
let mapWidth = gameMode === 'duel' ? 1000 : 2000;
let mapHeight = gameMode === 'duel' ? 800 : 1500;
const tankRadius = 25;
const shellRadius = 5;

// Получаем стиль танка
const myStyle = tankStyles.find(t => t.id === tankId);

// Инициализация Firebase ссылок
const roomRef = window.db.ref(`rooms/${roomId}`);
const playersRef = window.db.ref(`rooms/${roomId}/players`);
const shellsRef = window.db.ref(`rooms/${roomId}/shells`);
const powerupsRef = window.db.ref(`rooms/${roomId}/powerups`);

// --- Определение способностей (объект с методами) ---
const abilities = {
    1: { // Скоростной
        onInit: (tank) => { tank.speedMultiplier = 1.5; },
        passive: true
    },
    2: { // Тяжелый
        onInit: (tank) => { tank.damageMultiplier = 1.5; },
        passive: true
    },
    3: { // Стрелок
        onInit: (tank) => { tank.cooldownMultiplier = 0.6; },
        passive: true
    },
    4: { // Лекарь
        onUpdate: (tank, delta) => { if (tank.health < tank.maxHealth) tank.health = Math.min(tank.maxHealth, tank.health + delta * 5); },
        passive: true
    },
    5: { // Защитник
        onActivate: (tank) => { if (Date.now() > (tank.lastAbility || 0)) { tank.effects.shieldUntil = Date.now() + 5000; tank.lastAbility = Date.now() + 15000; return true; } return false; },
        cooldown: 15000
    },
    6: { // Тормоз
        onActivate: (tank, gameState) => { 
            if (Date.now() > (tank.lastAbility || 0)) {
                let closest = null;
                let minDist = 201;
                for (let id in players) {
                    if (id !== tank.id && players[id].health > 0) {
                        let dist = Math.hypot(tank.x - players[id].x, tank.y - players[id].y);
                        if (dist < minDist) { minDist = dist; closest = players[id]; }
                    }
                }
                if (closest) { closest.effects.slowedUntil = Date.now() + 3000; closest.speedMultiplier *= 0.5; setTimeout(() => { if(closest.speedMultiplier) closest.speedMultiplier /= 0.5; }, 3000); }
                tank.lastAbility = Date.now() + 12000;
                return true;
            }
            return false;
        },
        cooldown: 12000
    },
    7: { // Близнец
        onActivate: (tank) => { if (Date.now() > (tank.lastAbility || 0)) { tank.twinShot = true; tank.lastAbility = Date.now() + 8000; return true; } return false; },
        cooldown: 8000
    },
    8: { // Охотник
        onShoot: (shell, tank, gameState) => { shell.homing = true; },
        passive: true
    },
    9: { // Дрифтер
        onInit: (tank) => { tank.rotationSpeedMultiplier = 1.3; },
        passive: true
    },
    10: { // Танк
        onHit: (tank, damage) => { return damage * 0.75; },
        passive: true
    },
    11: { // Тень
        onActivate: (tank) => { if (Date.now() > (tank.lastAbility || 0)) { tank.effects.invisibleUntil = Date.now() + 3000; tank.lastAbility = Date.now() + 10000; return true; } return false; },
        cooldown: 10000
    },
    12: { // Доктор
        onActivate: (tank) => { if (Date.now() > (tank.lastAbility || 0)) { tank.health = Math.min(tank.maxHealth, tank.health + 50); tank.lastAbility = Date.now() + 15000; return true; } return false; },
        cooldown: 15000
    },
    13: { // Подрывник
        onShoot: (shell) => { shell.explosive = true; },
        passive: true
    },
    14: { // Снайпер
        onInit: (tank) => { tank.rangeMultiplier = 1.3; },
        passive: true
    },
    15: { // Спринтер
        onInit: (tank) => { tank.effects.speedBoostUntil = Date.now() + 5000; tank.speedMultiplier = 1.5; setTimeout(() => { if(tank.speedMultiplier) tank.speedMultiplier /= 1.5; }, 5000); },
        passive: true
    },
    16: { // Рикошетчик
        onShoot: (shell, tank) => { if (tank.ricochetCount === undefined) tank.ricochetCount = 0; tank.ricochetCount++; if (tank.ricochetCount % 3 === 0) shell.ricochet = true; },
        passive: true
    },
    17: { // Броненосец
        onInit: (tank) => { tank.maxHealth += 50; tank.health += 50; },
        passive: true
    },
    18: { // Вампир
        onHitTarget: (tank, target, damage) => { tank.health = Math.min(tank.maxHealth, tank.health + 10); },
        passive: true
    },
    19: { // Глушитель
        onActivate: (tank, gameState) => {
            if (Date.now() > (tank.lastAbility || 0)) {
                for (let id in players) {
                    let p = players[id];
                    if (p !== tank && Math.hypot(tank.x - p.x, tank.y - p.y) < 300) {
                        p.effects.silencedUntil = Date.now() + 4000;
                    }
                }
                tank.lastAbility = Date.now() + 20000;
                return true;
            }
            return false;
        },
        cooldown: 20000
    },
    20: { // Маг
        onActivate: (tank) => {
            if (Date.now() > (tank.lastAbility || 0)) {
                let newX = tank.x + (Math.random() - 0.5) * 1000;
                let newY = tank.y + (Math.random() - 0.5) * 1000;
                newX = Math.min(mapWidth - tankRadius, Math.max(tankRadius, newX));
                newY = Math.min(mapHeight - tankRadius, Math.max(tankRadius, newY));
                tank.x = newX; tank.y = newY;
                tank.lastAbility = Date.now() + 18000;
                return true;
            }
            return false;
        },
        cooldown: 18000
    }
};

// Создание локального танка
function initLocalTank() {
    let spawnX = Math.random() * (mapWidth - 100) + 50;
    let spawnY = Math.random() * (mapHeight - 100) + 50;
    localTank = {
        id: myPlayerId,
        x: spawnX, y: spawnY,
        angle: 0, turretAngle: 0,
        health: myStyle.id === 17 ? 150 : 100,
        maxHealth: myStyle.id === 17 ? 150 : 100,
        speed: 200,
        rotationSpeed: 3,
        fireCooldown: 0.8,
        lastFireTime: 0,
        speedMultiplier: 1,
        damageMultiplier: 1,
        cooldownMultiplier: 1,
        rangeMultiplier: 1,
        effects: {},
        lastAbility: 0,
        characterId: tankId,
        kills: 0
    };
    // Применить пассивные способности
    if (abilities[tankId]) {
        let ab = abilities[tankId];
        if (ab.onInit) ab.onInit(localTank);
        if (ab.passive && ab.onUpdate) localTank.passiveUpdate = ab.onUpdate;
    }
    // Добавить в Firebase
    playersRef.child(myPlayerId).set({
        x: localTank.x, y: localTank.y,
        angle: localTank.angle, turretAngle: localTank.turretAngle,
        health: localTank.health, maxHealth: localTank.maxHealth,
        characterId: tankId, kills: 0
    });
    // onDisconnect удаление
    playersRef.child(myPlayerId).onDisconnect().remove();
}

// Обработка ввода
const keys = { w: false, s: false, a: false, d: false, arrowLeft: false, arrowRight: false, space: false, ePressed: false };
document.addEventListener('keydown', (e) => {
    let key = e.key.toLowerCase();
    if (key === 'w') keys.w = true;
    if (key === 's') keys.s = true;
    if (key === 'a') keys.a = true;
    if (key === 'd') keys.d = true;
    if (key === 'arrowleft') keys.arrowLeft = true;
    if (key === 'arrowright') keys.arrowRight = true;
    if (key === ' ' || key === 'space') { keys.space = true; e.preventDefault(); }
    if (key === 'e') { keys.ePressed = true; e.preventDefault(); }
});
document.addEventListener('keyup', (e) => {
    let key = e.key.toLowerCase();
    if (key === 'w') keys.w = false;
    if (key === 's') keys.s = false;
    if (key === 'a') keys.a = false;
    if (key === 'd') keys.d = false;
    if (key === 'arrowleft') keys.arrowLeft = false;
    if (key === 'arrowright') keys.arrowRight = false;
    if (key === ' ' || key === 'space') keys.space = false;
});

// Сенсорные кнопки
document.querySelectorAll('.touch-btn').forEach(btn => {
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        let action = btn.getAttribute('data-action');
        if (action === 'forward') keys.w = true;
        if (action === 'back') keys.s = true;
        if (action === 'left') keys.a = true;
        if (action === 'right') keys.d = true;
        if (action === 'turretLeft') keys.arrowLeft = true;
        if (action === 'turretRight') keys.arrowRight = true;
        if (action === 'shoot') keys.space = true;
        if (action === 'ability') keys.ePressed = true;
    });
    btn.addEventListener('touchend', (e) => {
        let action = btn.getAttribute('data-action');
        if (action === 'forward') keys.w = false;
        if (action === 'back') keys.s = false;
        if (action === 'left') keys.a = false;
        if (action === 'right') keys.d = false;
        if (action === 'turretLeft') keys.arrowLeft = false;
        if (action === 'turretRight') keys.arrowRight = false;
        if (action === 'shoot') keys.space = false;
        if (action === 'ability') keys.ePressed = false;
    });
});

// Обновление движения и стрельбы
let lastUpdate = Date.now();
function updateGame(delta) {
    if (!localTank || !gameActive) return;
    let dt = Math.min(delta, 0.033);
    let speed = localTank.speed * (localTank.speedMultiplier || 1) * (localTank.speedBoost || 1);
    let rotSpeed = (localTank.rotationSpeed || 3) * (localTank.rotationSpeedMultiplier || 1);
    if (keys.w) { localTank.x += Math.cos(localTank.angle * Math.PI/180) * speed * dt; localTank.y += Math.sin(localTank.angle * Math.PI/180) * speed * dt; }
    if (keys.s) { localTank.x -= Math.cos(localTank.angle * Math.PI/180) * speed * dt; localTank.y -= Math.sin(localTank.angle * Math.PI/180) * speed * dt; }
    if (keys.a) localTank.angle -= rotSpeed * 90 * dt;
    if (keys.d) localTank.angle += rotSpeed * 90 * dt;
    if (keys.arrowLeft) localTank.turretAngle -= 150 * dt;
    if (keys.arrowRight) localTank.turretAngle += 150 * dt;
    localTank.x = Math.min(mapWidth - tankRadius, Math.max(tankRadius, localTank.x));
    localTank.y = Math.min(mapHeight - tankRadius, Math.max(tankRadius, localTank.y));
    localTank.angle = (localTank.angle + 360) % 360;
    localTank.turretAngle = (localTank.turretAngle + 360) % 360;
    
    // Стрельба
    let cooldown = (localTank.fireCooldown || 0.8) * (localTank.cooldownMultiplier || 1);
    if (keys.space && Date.now() - localTank.lastFireTime > cooldown * 1000) {
        let shellAngle = localTank.turretAngle;
        let speedX = Math.cos(shellAngle * Math.PI/180) * 500;
        let speedY = Math.sin(shellAngle * Math.PI/180) * 500;
        let shellId = Date.now() + '_' + Math.random();
        let shellData = {
            x: localTank.x + Math.cos(shellAngle * Math.PI/180) * 35,
            y: localTank.y + Math.sin(shellAngle * Math.PI/180) * 35,
            vx: speedX, vy: speedY,
            owner: myPlayerId,
            damage: 20 * (localTank.damageMultiplier || 1),
            createdAt: Date.now()
        };
        if (abilities[tankId] && abilities[tankId].onShoot) abilities[tankId].onShoot(shellData, localTank);
        if (localTank.twinShot) {
            let offset = 10;
            let shell2 = {...shellData, x: shellData.x, y: shellData.y, vx: speedX + offset, vy: speedY - offset};
            shellsRef.child(shellId + '_2').set(shell2);
            localTank.twinShot = false;
        }
        shellsRef.child(shellId).set(shellData);
        localTank.lastFireTime = Date.now();
    }
    
    // Активация способности
    if (keys.ePressed && abilities[tankId] && abilities[tankId].onActivate) {
        let canUse = Date.now() > (localTank.lastAbility || 0) && (!localTank.effects.silencedUntil || Date.now() > localTank.effects.silencedUntil);
        if (canUse && abilities[tankId].onActivate(localTank, {players, shells})) {
            keys.ePressed = false;
            playersRef.child(myPlayerId).update({ lastAbility: localTank.lastAbility });
        }
    }
    
    // Пассивное обновление
    if (localTank.passiveUpdate) localTank.passiveUpdate(localTank, dt);
    if (abilities[tankId] && abilities[tankId].onUpdate && !localTank.passiveUpdate) abilities[tankId].onUpdate(localTank, dt);
    
    // Отправить позицию в Firebase с throttle
    if (Date.now() - lastSentTime > 50) {
        playersRef.child(myPlayerId).update({
            x: localTank.x, y: localTank.y,
            angle: localTank.angle, turretAngle: localTank.turretAngle,
            health: localTank.health
        });
        lastSentTime = Date.now();
    }
}

// Слушатели Firebase
playersRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (!data) return;
    for (let id in data) {
        if (id === myPlayerId) continue;
        players[id] = data[id];
    }
    for (let id in players) if (!data[id]) delete players[id];
});

shellsRef.on('child_added', (snap) => {
    shells[snap.key] = snap.val();
});
shellsRef.on('child_removed', (snap) => { delete shells[snap.key]; });

powerupsRef.on('child_added', (snap) => { powerups[snap.key] = snap.val(); });
powerupsRef.on('child_removed', (snap) => { delete powerups[snap.key]; });

// Обновление таблицы лидеров
function updateLeaderboard() {
    let leaderboardList = document.getElementById('leaderboardList');
    let list = [];
    for (let id in players) {
        list.push({ id: id, kills: players[id].kills || 0, health: players[id].health });
    }
    if (localTank) list.push({ id: myPlayerId, kills: localTank.kills, health: localTank.health });
    list.sort((a,b) => b.kills - a.kills);
    leaderboardList.innerHTML = list.slice(0,10).map(p => `<li>${p.id === myPlayerId ? '👤' : '🎮'} ${p.id.slice(-4)}: ${p.kills} убийств</li>`).join('');
}

// Отрисовка
function render() {
    if (!localTank) return;
    camera.x = localTank.x - canvas.width/2;
    camera.y = localTank.y - canvas.height/2;
    camera.x = Math.min(mapWidth - canvas.width, Math.max(0, camera.x));
    camera.y = Math.min(mapHeight - canvas.height, Math.max(0, camera.y));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    // Сетка
    ctx.strokeStyle = "#444";
    for (let i = 0; i < mapWidth; i+=50) {
        ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,mapHeight); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(mapWidth,i); ctx.stroke();
    }
    // Усиления
    for (let id in powerups) {
        let p = powerups[id];
        ctx.fillStyle = window.powerupTypes?.[p.type]?.color || "gold";
        ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI*2); ctx.fill();
    }
    // Танки других игроков
    for (let id in players) {
        let p = players[id];
        let style = tankStyles.find(t => t.id === p.characterId) || tankStyles[0];
        if (p.effects && p.effects.invisibleUntil && Date.now() < p.effects.invisibleUntil) continue;
        ctx.fillStyle = style.colorHull;
        ctx.beginPath(); ctx.rect(p.x-20, p.y-20, 40, 40); ctx.fill();
        ctx.fillStyle = style.colorTurret;
        ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, Math.PI*2); ctx.fill();
        let turretEndX = p.x + Math.cos(p.turretAngle * Math.PI/180) * 25;
        let turretEndY = p.y + Math.sin(p.turretAngle * Math.PI/180) * 25;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(turretEndX, turretEndY); ctx.lineWidth = 8; ctx.stroke();
        ctx.fillStyle = "red";
        ctx.fillRect(p.x-25, p.y-35, 50, 8);
        ctx.fillStyle = "lime";
        ctx.fillRect(p.x-25, p.y-35, 50 * (p.health/p.maxHealth), 8);
    }
    // Свой танк
    if (localTank) {
        let style = myStyle;
        ctx.fillStyle = style.colorHull;
        ctx.beginPath(); ctx.rect(localTank.x-20, localTank.y-20, 40, 40); ctx.fill();
        ctx.fillStyle = style.colorTurret;
        ctx.beginPath(); ctx.arc(localTank.x, localTank.y, 18, 0, Math.PI*2); ctx.fill();
        let turretEndX = localTank.x + Math.cos(localTank.turretAngle * Math.PI/180) * 25;
        let turretEndY = localTank.y + Math.sin(localTank.turretAngle * Math.PI/180) * 25;
        ctx.beginPath(); ctx.moveTo(localTank.x, localTank.y); ctx.lineTo(turretEndX, turretEndY); ctx.lineWidth = 8; ctx.stroke();
        ctx.fillStyle = "red";
        ctx.fillRect(localTank.x-25, localTank.y-35, 50, 8);
        ctx.fillStyle = "lime";
        ctx.fillRect(localTank.x-25, localTank.y-35, 50 * (localTank.health/localTank.maxHealth), 8);
    }
    // Снаряды
    for (let id in shells) {
        let s = shells[id];
        ctx.fillStyle = "yellow";
        ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
    document.getElementById('healthFill').style.width = `${(localTank.health/localTank.maxHealth)*100}%`;
    let cdLeft = Math.max(0, (localTank.lastAbility || 0) - Date.now());
    let cdPercent = (cdLeft / (abilities[tankId]?.cooldown || 1)) * 100;
    document.getElementById('abilityCooldownOverlay').style.height = `${cdPercent}%`;
    updateLeaderboard();
}

// Проверка победы
function checkGameEnd() {
    if (winnerDeclared) return;
    let alivePlayers = 0;
    let lastAlive = null;
    if (localTank.health > 0) { alivePlayers++; lastAlive = myPlayerId; }
    for (let id in players) if (players[id].health > 0) { alivePlayers++; lastAlive = id; }
    if (gameMode === 'duel' && alivePlayers <= 1) {
        gameActive = false;
        winnerDeclared = true;
        alert(lastAlive === myPlayerId ? "Победа!" : "Поражение!");
    } else if (gameMode === 'battle' && alivePlayers <= 1 && alivePlayers > 0) {
        gameActive = false;
        winnerDeclared = true;
        alert(lastAlive === myPlayerId ? "Королевская битва выиграна!" : "Вы погибли...");
    }
}

// Основной цикл
let lastTimestamp = 0;
function gameLoop(now) {
    let delta = Math.min(0.033, (now - lastTimestamp) / 1000);
    lastTimestamp = now;
    if (gameActive && localTank && localTank.health > 0) {
        updateGame(delta);
        for (let id in shells) {
            let s = shells[id];
            s.x += s.vx * delta;
            s.y += s.vy * delta;
            if (s.x < 0 || s.x > mapWidth || s.y < 0 || s.y > mapHeight) {
                shellsRef.child(id).remove();
                continue;
            }
            let hit = false;
            for (let pid in players) {
                let p = players[pid];
                if (s.owner === pid) continue;
                if (Math.hypot(s.x - p.x, s.y - p.y) < tankRadius + 5 && p.health > 0) {
                    let damage = s.damage;
                    if (abilities[p.characterId]?.onHit) damage = abilities[p.characterId].onHit(p, damage);
                    let newHealth = Math.max(0, p.health - damage);
                    playersRef.child(pid).update({ health: newHealth });
                    if (newHealth <= 0) {
                        if (s.owner === myPlayerId) localTank.kills++;
                        else if (players[s.owner]) players[s.owner].kills = (players[s.owner].kills || 0) + 1;
                        playersRef.child(pid).remove();
                    }
                    shellsRef.child(id).remove();
                    hit = true;
                    break;
                }
            }
            if (!hit && localTank && s.owner !== myPlayerId && Math.hypot(s.x - localTank.x, s.y - localTank.y) < tankRadius + 5 && localTank.health > 0) {
                let damage = s.damage;
                if (abilities[tankId]?.onHit) damage = abilities[tankId].onHit(localTank, damage);
                localTank.health = Math.max(0, localTank.health - damage);
                playersRef.child(myPlayerId).update({ health: localTank.health });
                shellsRef.child(id).remove();
                if (localTank.health <= 0) gameActive = false;
            }
        }
        for (let id in powerups) {
            let p = powerups[id];
            if (Math.hypot(p.x - localTank.x, p.y - localTank.y) < tankRadius + 12) {
                if (window.applyPowerup) window.applyPowerup(localTank, p.type);
                powerupsRef.child(id).remove();
            }
        }
        if (gameMode === 'battle' && Math.random() < 0.02) {
            let randX = Math.random() * (mapWidth - 100) + 50;
            let randY = Math.random() * (mapHeight - 100) + 50;
            let type = Object.keys(window.powerupTypes || {})[Math.floor(Math.random() * 3)] || "HEALTH";
            if (window.createPowerup) window.createPowerup(roomId, randX, randY, type);
        }
        checkGameEnd();
    }
    render();
    animationId = requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
initLocalTank();
roomRef.child('info').update({ currentPlayers: (Object.keys(players).length + 1) });
gameLoop(0);

document.getElementById('exitGameBtn').addEventListener('click', () => {
    playersRef.child(myPlayerId).remove();
    roomRef.child('info').once('value', (snap) => {
        let current = snap.val()?.currentPlayers || 0;
        roomRef.child('info').update({ currentPlayers: Math.max(0, current-1) });
    });
    window.location.href = 'index.html';
});
