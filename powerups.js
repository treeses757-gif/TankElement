// Power-up types for battle royale
window.powerupTypes = {
  HEALTH: { name: "Аптечка", color: "#FF69B4", effect: (tank) => { tank.health = Math.min(tank.maxHealth, tank.health + 25); } },
  DAMAGE_BOOST: { name: "Урон +20%", color: "#FF4500", effect: (tank) => { tank.damageBoost = (tank.damageBoost || 1) * 1.2; setTimeout(() => { tank.damageBoost = (tank.damageBoost || 1) / 1.2; }, 10000); } },
  SPEED_BOOST: { name: "Скорость +30%", color: "#1E90FF", effect: (tank) => { tank.speedBoost = (tank.speedBoost || 1) * 1.3; setTimeout(() => { tank.speedBoost = (tank.speedBoost || 1) / 1.3; }, 10000); } }
};

// Function to spawn a powerup in a random location
window.createPowerup = function(roomId, x, y, typeKey) {
  const powerupId = Date.now() + '_' + Math.random();
  const powerupRef = window.db.ref(`rooms/${roomId}/powerups/${powerupId}`);
  powerupRef.set({
    x: x,
    y: y,
    type: typeKey,
    createdAt: Date.now()
  });
  setTimeout(() => {
    powerupRef.remove();
  }, 15000);
};

// Apply powerup effect to tank
window.applyPowerup = function(tank, powerupType) {
  const p = window.powerupTypes[powerupType];
  if (p) p.effect(tank);
};
