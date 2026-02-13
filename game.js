/* Game State */
const state = {
  players: {
    1: {
      name: "",
      photo: null,
      archetype: "Titan",
      stats: { hp: 0, speed: 0, maxHp: 0 },
      skills: [
        { name: "", type: "chaos", points: 0 },
        { name: "", type: "vampire", points: 0 },
        { name: "", type: "stun", points: 0 },
      ],
      frozen: false,
    },
    2: {
      name: "",
      photo: null,
      archetype: "Titan",
      stats: { hp: 0, speed: 0, maxHp: 0 },
      skills: [
        { name: "", type: "chaos", points: 0 },
        { name: "", type: "vampire", points: 0 },
        { name: "", type: "stun", points: 0 },
      ],
      frozen: false,
    },
  },
  turn: 1, // Player ID (1 or 2)
  battleActive: false,
  winnerId: null,
  mode: null, // null | 'host' | 'guest'
  conn: null,
  peer: null,
  mathChallenge: {
      active: false,
      correctAnswer: null,
      answered: false
  },
  guestProfileInitialized: false
};

const ARCHETYPES = {
  Titan: { 
      hpMean: 120, hpSigma: 25, speedMean: 30, speedSigma: 10,
      image: 'assets/titan.png',
      description: "A cybernetically enhanced juggernaut. The Titan sacrifices speed for immense durability, dominating the arena with raw power and resilience."
  },
  Ghost: { 
      hpMean: 70, hpSigma: 15, speedMean: 60, speedSigma: 12,
      image: 'assets/ghost.png',
      description: "A phantom assassin utilizing light-refraction cloaks. The Ghost relies on blinding speed and precision strikes to dismantle foes before they can react."
  },
  Maverick: { 
      hpMean: 95, hpSigma: 30, speedMean: 45, speedSigma: 18,
      image: 'assets/maverick.png',
      description: "A tactical wild card equipped with experimental tech. The Maverick balances offense and defense, adaptable to any combat scenario."
  },
};

const ACCESS_GATE = {
  question: "Where was this idea born?",
  answer: "BRUS",
};

/* --- Math & Logic --- */

function gaussianRandom(mean, sigma) {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return num * sigma + mean;
}

function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
}

function setStatus(msg, kind = "info") {
    const el = document.getElementById("validation-msg");
    if (!el) return;
    el.textContent = msg;
    if (kind === "ok") el.className = "text-emerald-400 mt-4 h-6 text-sm font-bold";
    else if (kind === "warn") el.className = "text-yellow-400 mt-4 h-6 text-sm font-bold";
    else el.className = "text-red-400 mt-4 h-6 text-sm font-bold";
}

function isOnlineReady() {
    return Boolean(state.mode && state.conn && state.conn.open);
}

function getRequiredValidationPlayers() {
    if (state.mode === 'guest') return [2];
    if (state.mode === 'host') return [1, 2];
    return [1];
}

function getLocalCreatorPlayerId() {
    if (state.mode === 'guest') return 2;
    return 1;
}

function updateSaveButtons() {
    const localPid = getLocalCreatorPlayerId();
    [1, 2].forEach((pid) => {
        const btn = document.getElementById(`p${pid}-save-btn`);
        if (!btn) return;
        if (pid === localPid) btn.classList.remove('hidden');
        else btn.classList.add('hidden');
    });
}

function syncLocalProfile() {
    if (!isOnlineReady()) return;
    const localPid = state.mode === 'guest' ? 2 : 1;
    sendData('PROFILE_SYNC', {
        char: state.players[localPid],
    });
}

// Access Gate Logic
function initAccessGate() {
    const gate = document.getElementById('access-gate');
    const input = document.getElementById('access-key');
    const btn = document.getElementById('access-btn');
    const msg = document.getElementById('access-msg');
    
    // Check if already authorized in this session (Safely)
    try {
        if (sessionStorage.getItem('access_granted') === 'true') {
            gate.classList.add('hidden');
            return;
        }
    } catch (e) {
        console.warn("Storage access restricted, session persistence disabled.");
    }
    
    const checkAccess = () => {
        const val = input.value.trim();
        
        // Visual Feedback for click
        btn.textContent = "VERIFYING...";
        btn.disabled = true;
        
        setTimeout(() => {
            if (val === ACCESS_GATE.answer) {
                try {
                    sessionStorage.setItem('access_granted', 'true');
                } catch(e) {}
                
                gate.style.transition = 'opacity 0.8s ease';
                gate.style.opacity = '0';
                setTimeout(() => gate.classList.add('hidden'), 800);
            } else {
                input.value = '';
                input.classList.add('shake-input');
                msg.textContent = "ACCESS DENIED";
                btn.textContent = "AUTHORIZE ACCESS";
                btn.disabled = false;
                
                setTimeout(() => {
                    input.classList.remove('shake-input');
                    msg.textContent = "";
                    input.focus();
                }, 500);
            }
        }, 300); // Artificial delay for effect
    };
    
    btn.addEventListener('click', checkAccess);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') checkAccess();
    });
    
    // Auto-focus on load
    input.focus();
}

function passAccessGate() {
    // Deprecated in favor of initAccessGate blocking overlay
    return sessionStorage.getItem('access_granted') === 'true';
}

function buildInviteLink(hostId) {
    const url = new URL(window.location.href);
    url.searchParams.set("join", hostId);
    return url.toString();
}

// function lockOpponentCreatorSlot() legacy implementation removed

/* --- Math Challenge Logic --- */

function generateMathProblem() {
    const types = ['add', 'mul', 'alg', 'quad'];
    const type = types[Math.floor(Math.random() * types.length)];
    let q = "", a = "", options = [];
    
    // Helper to generate distinct wrong answers
    const getDistractors = (correct, count, range) => {
        let res = [correct];
        while(res.length < count + 1) {
            let n = correct + Math.floor((Math.random() - 0.5) * range);
            if(n !== correct && !res.includes(n)) res.push(n);
        }
        return res.sort(() => Math.random() - 0.5);
    };

    if (type === 'add') {
        const x = Math.floor(Math.random() * 50) + 10;
        const y = Math.floor(Math.random() * 50) + 10;
        q = `${x} + ${y} = ?`;
        a = (x + y).toString();
        options = getDistractors(x+y, 3, 20).map(String);
    } 
    else if (type === 'mul') {
        const x = Math.floor(Math.random() * 12) + 2;
        const y = Math.floor(Math.random() * 12) + 2;
        q = `${x} × ${y} = ?`;
        a = (x * y).toString();
        options = getDistractors(x*y, 3, 20).map(String);
    } 
    else if (type === 'alg') {
        const x = Math.floor(Math.random() * 10) + 1;
        const m = Math.floor(Math.random() * 5) + 2;
        const b = Math.floor(Math.random() * 10) + 1;
        const c = m * x + b;
        q = `${m}x + ${b} = ${c}, x = ?`;
        a = x.toString();
        options = getDistractors(x, 3, 10).map(String);
    } 
    else if (type === 'quad') {
        // (x - r1)(x - r2) = x^2 - (r1+r2)x + r1*r2 = 0
        const r1 = Math.floor(Math.random() * 14) - 7; // -7 to 7
        const r2 = Math.floor(Math.random() * 14) - 7;
        const b = -(r1 + r2);
        const c = r1 * r2;
        
        // Format: x^2 + bx + c = 0
        const bStr = b >= 0 ? `+ ${b}x` : `- ${Math.abs(b)}x`;
        const cStr = c >= 0 ? `+ ${c}` : `- ${Math.abs(c)}`;
        q = `x² ${bStr} ${cStr} = 0`;
        
        // Answer format: "x = r1, x = r2" (sorted)
        const formatAns = (v1, v2) => {
            const min = Math.min(v1, v2);
            const max = Math.max(v1, v2);
            return `x=${min}, x=${max}`;
        };
        
        a = formatAns(r1, r2);
        
        // Distractors
        options = [a];
        // Wrong signs
        if(formatAns(-r1, -r2) !== a) options.push(formatAns(-r1, -r2));
        // Mixed signs
        if(formatAns(-r1, r2) !== a) options.push(formatAns(-r1, r2));
        // Wrong values
        while(options.length < 4) {
            let f = formatAns(r1 + Math.floor(Math.random()*4)-2, r2 + Math.floor(Math.random()*4)-2);
            if(!options.includes(f)) options.push(f);
        }
        options.sort(() => Math.random() - 0.5);
    }
    
    return { q, a, options };
}

function startMathPhase() {
    state.battleActive = false; // Prevent moves while solving
    state.mathChallenge.active = true;
    state.mathChallenge.answered = false;
    
    // Only host generates and syncs the same problem to guest.
    if (state.mode === 'guest') return;

    const problem = generateMathProblem();
    state.mathChallenge.correctAnswer = problem.a;

    // Send to guest
    if (state.mode === 'host') {
        sendData('MATH_START', problem);
    }
    
    renderMathModal(problem);
}

function renderMathModal(problem) {
    const modal = document.getElementById('math-modal');
    modal.classList.remove('hidden');
    document.getElementById('math-question').textContent = problem.q;
    
    const optsDiv = document.getElementById('math-options');
    optsDiv.innerHTML = '';
    
    problem.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = "bg-slate-700 hover:bg-purple-600 text-white font-bold py-4 rounded-xl text-lg transition-all transform hover:scale-105";
        btn.textContent = opt;
        btn.onclick = () => handleMathAnswer(opt, btn);
        optsDiv.appendChild(btn);
    });
    
    document.getElementById('math-status').textContent = "Solve!";
}

function handleMathAnswer(ans, btn) {
    if (state.mathChallenge.answered) return;
    
    if (ans === state.mathChallenge.correctAnswer) {
        state.mathChallenge.answered = true;
        btn.classList.add('bg-emerald-500');
        document.getElementById('math-status').textContent = "CORRECT! Seizing initiative...";
        
        if (state.mode === 'host') {
            sendData('MATH_SOLVED', { winner: 1 });
            resolveMathPhase(1);
        } else if (state.mode === 'guest') {
            sendData('MATH_SOLVED', { winner: 2 });
            // Guest waits for Host to confirm/sync turn
        }

    } else {
        // Penalty
        btn.classList.add('bg-red-500', 'shake');
        btn.disabled = true;
        setTimeout(() => btn.classList.remove('bg-red-500', 'shake'), 500);
    }
}

function resolveMathPhase(winnerId) {
    state.mathChallenge.active = false;
    document.getElementById('math-modal').classList.add('hidden');
    state.turn = winnerId;
    
    // If online host, sync the turn
    if (state.mode === 'host') {
        sendData('SYNC_TURN', { turn: state.turn });
    }
    
    state.battleActive = true;
    log(`Math Validated! ${state.players[winnerId].name} takes the turn!`);
    updateTurnUI();
}

/* --- Initialization & UI Setup --- */

document.addEventListener("DOMContentLoaded", () => {
  initAccessGate(); // Initialize blocking overlay
  setupCreatorUI(1);
  setupCreatorUI(2);
    renderPlayerToCreator(1);
    renderPlayerToCreator(2);
    updateSaveButtons();
  toggleCardLock(2, true);
  checkValidation();
    
  // Barracks & Online UI
  document.getElementById('barracks-btn').addEventListener('click', () => {
      document.getElementById('barracks-modal').classList.remove('hidden');
      renderBarracks();
  });
  
  document.getElementById('p1-save-btn').addEventListener("click", () => {
      saveCharacter(1);
      renderBarracks();
  });
  document.getElementById('p2-save-btn').addEventListener("click", () => {
      saveCharacter(2);
      renderBarracks();
  });

  document.getElementById('online-btn').addEventListener('click', () => {
      document.getElementById('online-modal').classList.remove('hidden');
  });

  // Online Event Listeners
  document.getElementById('host-game-btn').addEventListener('click', hostGame);
  document.getElementById('copy-invite-btn').addEventListener('click', copyInviteLink);
  document.getElementById('join-game-btn').addEventListener('click', () => {
      const id = document.getElementById('join-id-input').value;
      if(id) joinGame(id);
  });

  // Check for shared build in URL
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has("p1_name")) {
    loadSharedBuild();
  }
  if (urlParams.has("join")) {
    const hostId = urlParams.get("join");
    if (hostId) {
      document.getElementById("join-id-input").value = hostId;
      document.getElementById("online-modal").classList.remove("hidden");
      setStatus("Invite link detected. Click Join to connect.", "warn");
    }
  }

  document
    .getElementById("start-battle-btn")
    .addEventListener("click", startBattle);
  document.getElementById('share-btn').addEventListener('click', shareBuild);
  document.getElementById('online-modal').classList.remove('hidden');
  setStatus("Online only: host or join a room to enable battle.", "warn");
});


// Helper to lock/unlock a player card
function toggleCardLock(pid, isLocked) {
    const card = document.getElementById(pid === 1 ? 'p1-column' : 'p2-column');
    const status = document.getElementById(pid === 1 ? 'p1-status' : 'p2-status');
    const title = document.getElementById(pid === 1 ? 'p1-title' : 'p2-title');
    
    if (isLocked) {
        card.classList.add('opacity-60', 'pointer-events-none');
        card.classList.remove('opacity-100');
        status.textContent = pid === 1 ? "HOST" : "OPPONENT";
        status.className = "px-3 py-1 bg-slate-700 text-slate-400 text-xs font-bold rounded-full border border-slate-600";
    } else {
        card.classList.remove('opacity-60', 'pointer-events-none');
        card.classList.add('opacity-100');
        status.textContent = "YOU";
        status.className = pid === 1 
            ? "px-3 py-1 bg-cyan-900/30 text-cyan-400 text-xs font-bold rounded-full border border-cyan-500/30"
            : "px-3 py-1 bg-purple-900/30 text-purple-400 text-xs font-bold rounded-full border border-purple-500/30";
    }

    updateSaveButtons();
}

function setupCreatorUI(pid) {
  // Archetype Selection
  document.querySelectorAll(`.p${pid}-arch`).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      // UI Update: Remove active class from all, add to clicked
      // Note: btn is the .archetype-card container now
      document
        .querySelectorAll(`.p${pid}-arch`)
        .forEach((b) => {
           b.classList.remove("border-cyan-500", "border-purple-500", "ring-2", "ring-white");
           b.classList.add("border-slate-700");
           b.querySelector("img").classList.remove("opacity-100");
           b.querySelector("img").classList.add("opacity-60");
        });
      
      const target = e.currentTarget; // The div with data-player
      const colorClass = pid === 1 ? "border-cyan-500" : "border-purple-500";
      target.classList.remove("border-slate-700");
      target.classList.add(colorClass, "ring-2", "ring-white");
      target.querySelector("img").classList.remove("opacity-60");
      target.querySelector("img").classList.add("opacity-100");

      // State Update
      state.players[pid].archetype = target.dataset.type;

      // Update UI immediately via render
      renderPlayerToCreator(pid);
      checkValidation();
    });
  });

  // Photo Upload
  const fileInput = document.getElementById(`p${pid}-upload`);
  
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        state.players[pid].photo = e.target.result;
        renderPlayerToCreator(pid);
        checkValidation();
      };
      reader.readAsDataURL(file);
    }
  });

  // Inputs Parsing
  [
    "name",
    "s1-name",
    "s1-type",
    "s1-points",
    "s2-name",
    "s2-type",
    "s2-points",
    "s3-name",
    "s3-type",
    "s3-points",
  ].forEach((id) => {
    const el = document.getElementById(`p${pid}-${id}`);
    el.addEventListener("input", () => {
      updatePlayerState(pid);
      checkValidation();
    });
  });
}

function updatePlayerState(pid) {
  const p = state.players[pid];
  p.name = document.getElementById(`p${pid}-name`).value;

  let totalPoints = 0;
  for (let i = 0; i < 3; i++) {
    const sName = document.getElementById(`p${pid}-s${i + 1}-name`).value;
    const sType = document.getElementById(`p${pid}-s${i + 1}-type`).value;
        const pointsInput = document.getElementById(`p${pid}-s${i + 1}-points`);
        const rawPoints = parseInt(pointsInput.value);
        const sPoints = clamp(Number.isFinite(rawPoints) ? rawPoints : 0, 0, 100);
        pointsInput.value = sPoints;

    p.skills[i] = { name: sName, type: sType, points: sPoints };
    totalPoints += sPoints;
  }

  // Update Remaining Points UI
  const pointsRem = 100 - totalPoints;
  const pointsSpan = document.getElementById(`p${pid}-points`);
  pointsSpan.textContent = `${pointsRem} PTS`;

  if (pointsRem < 0) pointsSpan.className = "text-xs font-mono font-bold text-red-500";
  else if (pointsRem === 0) pointsSpan.className = "text-xs font-mono font-bold text-emerald-400";
  else pointsSpan.className = "text-xs font-mono font-bold text-yellow-400";

    if ((state.mode === 'host' && pid === 1) || (state.mode === 'guest' && pid === 2)) {
        syncLocalProfile();
    }
}

function renderPlayerToCreator(pid) {
  const p = state.players[pid];
  document.getElementById(`p${pid}-name`).value = p.name || "";
  
  const activeArch = ARCHETYPES[p.archetype];
  const desc = document.querySelector(`.p${pid}-arch-desc`);
  if (activeArch) {
      const hpMin = Math.max(10, Math.floor(activeArch.hpMean - activeArch.hpSigma));
      const hpMax = Math.floor(activeArch.hpMean + activeArch.hpSigma);
      const speedMin = Math.max(5, Math.floor(activeArch.speedMean - activeArch.speedSigma));
      const speedMax = Math.floor(activeArch.speedMean + activeArch.speedSigma);
      desc.innerHTML = `${activeArch.description}<br><span class="text-slate-300 not-italic font-semibold">Expected HP:</span> ${hpMin}-${hpMax} · <span class="text-slate-300 not-italic font-semibold">Expected SPD:</span> ${speedMin}-${speedMax}`;
  }

  // Highlight selected archetype card
  document.querySelectorAll(`.p${pid}-arch`).forEach((b) => {
       const isSelected = b.dataset.type === p.archetype;
       const colorClass = pid === 1 ? "border-cyan-500" : "border-purple-500";
       
       if (isSelected) {
           b.classList.remove("border-slate-700");
           b.classList.add(colorClass, "ring-2", "ring-white");
           b.querySelector("img").classList.remove("opacity-60");
           b.querySelector("img").classList.add("opacity-100");
       } else {
           b.classList.remove(colorClass, "ring-2", "ring-white");
           b.classList.add("border-slate-700");
           b.querySelector("img").classList.remove("opacity-100");
           b.querySelector("img").classList.add("opacity-60");
       }
  });

  // Photo Preview
  // If photo is uploaded, show it. If not, show blank or default? 
  // Design says separate photo upload. So p1-preview checks p.photo.
  const preview = document.getElementById(`p${pid}-preview`);
  if (p.photo) {
      preview.src = p.photo;
  } else {
      // If no photo, maybe show archetype image or a placeholder?
      // Let's show archetype image if available, else placeholder.
      preview.src = activeArch ? activeArch.image : "https://via.placeholder.com/150";
  }

  for (let i = 0; i < 3; i++) {
    document.getElementById(`p${pid}-s${i + 1}-name`).value = p.skills[i].name || "";
    document.getElementById(`p${pid}-s${i + 1}-type`).value = p.skills[i].type || "chaos";
    document.getElementById(`p${pid}-s${i + 1}-points`).value = p.skills[i].points || 0;
  }
  updatePlayerState(pid);
}

function checkValidation() {
  let valid = true;
  let msg = "";

    const requiredPlayers = getRequiredValidationPlayers();

    requiredPlayers.forEach((pid) => {
    const p = state.players[pid];
    let pts = 0;
    p.skills.forEach((s) => (pts += s.points));

    if (!p.name) {
      valid = false;
      msg = `Player ${pid} needs a name.`;
    } else if (pts !== 100) {
      valid = false;
      msg = `Player ${pid} must use exactly 100 points.`;
    }
  });

  const btn = document.getElementById("start-battle-btn");
  if (valid && !state.mode) {
    valid = false;
    msg = "Choose Host or Join to enter an online 1v1 room.";
  } else if (valid && !isOnlineReady()) {
    valid = false;
    msg = "Waiting for online connection...";
    } else if (valid && state.mode === 'guest') {
        valid = false;
        msg = "Connected as Player 2. Waiting for host to start.";
  }

  if (valid) {
    btn.disabled = false;
    btn.classList.remove("opacity-50", "cursor-not-allowed");
    btn.classList.add("animate-pulse");
    setStatus("Ready: online 1v1 free-held mode.", "ok");
  } else {
    btn.disabled = true;
    btn.classList.add("opacity-50", "cursor-not-allowed");
    btn.classList.remove("animate-pulse");
    setStatus(msg, "warn");
  }
}

/* --- Battle Logic --- */

async function startBattle() {
    if (state.mode === 'guest') {
        setStatus("Only the host can start the battle.", "warn");
        return;
    }

  if (!isOnlineReady()) {
    setStatus("Connect online first (Host or Join) before starting.", "warn");
    document.getElementById('online-modal').classList.remove('hidden');
    return;
  }

  // UI Switch
  document.getElementById("creator-screen").classList.add("hidden");
  document.getElementById("arena-screen").classList.remove("hidden");
  document.getElementById("arena-screen").classList.add("flex");

    // Setup Arena UI
    for(let i=1; i<=2; i++) {
        document.getElementById(`p${i}-arena-name`).textContent = state.players[i].name;
        document.getElementById(`p${i}-arena-img`).src = state.players[i].photo || ARCHETYPES[state.players[i].archetype].image;
    }

    if (state.mode === 'host') {
        sendData('START_BATTLE', {});
    }

    log("Initialzing Battle...");
    await rollStatsAnimation();
    
    // Start Math Challenge
    if (state.mode === 'host') {
        startMathPhase();
    } else {
        log("Waiting for host to start Math Phase...");
    }
}

async function rollStatsAnimation() {
    // If Guest, we wait for stats from Host. We don't roll logic, just animation.
    if (state.mode === 'guest') {
        const p1Stats = document.getElementById('p1-speed-display');
        const p2Stats = document.getElementById('p2-speed-display');
        const p1Hp = document.getElementById('p1-hp-text');
        const p2Hp = document.getElementById('p2-hp-text');
        
        // Scanning Phase
        for(let i=0; i<15; i++) {
            p1Stats.innerHTML = `<span class="scanning-text">SCANNING...</span>`;
            p2Stats.innerHTML = `<span class="scanning-text">SCANNING...</span>`;
            p1Hp.innerHTML = `<span class="scanning-text">Analyzing Bio-Data...</span>`;
            p2Hp.innerHTML = `<span class="scanning-text">Analyzing Bio-Data...</span>`;
            await new Promise(r => setTimeout(r, 100));
        }
        return; // Stats set via network sync
    }

    const p1Stats = document.getElementById('p1-speed-display');
  const p2Stats = document.getElementById("p2-speed-display");
  const p1Hp = document.getElementById("p1-hp-text");
  const p2Hp = document.getElementById("p2-hp-text");

    // Generating Final Stats
    [1, 2].forEach(id => {
        const arch = ARCHETYPES[state.players[id].archetype];
        
        let health = Math.floor(gaussianRandom(arch.hpMean, arch.hpSigma));
        if (health < 10) health = 10;
        
        let speed = Math.floor(gaussianRandom(arch.speedMean, arch.speedSigma));
        if (speed < 5) speed = 5;

        state.players[id].stats = { hp: health, maxHp: health, speed: speed };
    });

    if (state.mode === 'host') {
        sendData('SYNC_STATS', { 
            p1: state.players[1].stats, 
            p2: state.players[2].stats 
        });
    }

    // Animation Loop
  for (let i = 0; i < 15; i++) {
    p1Stats.innerHTML = `<span class="scanning-text">SCANNING...</span>`;
    p2Stats.innerHTML = `<span class="scanning-text">SCANNING...</span>`;
    p1Hp.innerHTML = `<span class="scanning-text">Analyzing Bio-Data...</span>`;
    p2Hp.innerHTML = `<span class="scanning-text">Analyzing Bio-Data...</span>`;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Final Set
  for (let i = 1; i <= 2; i++) {
    const p = state.players[i];
    document.getElementById(`p${i}-speed-display`).textContent =
      `SPD: ${p.stats.speed}`;
    document.getElementById(`p${i}-hp-text`).textContent =
      `${p.stats.hp} / ${p.stats.maxHp} HP`;
    document.getElementById(`p${i}-arch-display`).textContent =
      `ARCH: ${p.archetype}`;
  }
}

function updateTurnUI() {
  const active = state.turn;
  const passive = active === 1 ? 2 : 1;

  // Visual Indicators
  document
    .getElementById(`p${active}-card`)
    .classList.add(
      "border-cyan-400",
      "shadow-cyan-500/50",
      "transform",
      "scale-105",
    );
  document
    .getElementById(`p${passive}-card`)
    .classList.remove(
      "border-cyan-400",
      "shadow-cyan-500/50",
      "transform",
      "scale-105",
    );

  const turnIndicator = document.getElementById("turn-indicator");
  turnIndicator.textContent = `${state.players[active].name}'s TURN`;

  // Action Buttons
  const btnContainer = document.getElementById("action-buttons");
  btnContainer.innerHTML = "";

  // Online Turn Control
  let canAct = true;
  if (state.mode === 'host' && active !== 1) canAct = false;
  if (state.mode === 'guest' && active !== 2) canAct = false;

  if (!canAct && isOnlineReady()) {
      btnContainer.innerHTML = `<div class="text-center text-slate-500 italic py-4 waiting-turn">Waiting for Opponent...</div>`;
      return;
  }

  if (state.players[active].frozen) {
    log(`${state.players[active].name} is FROZEN and skips their turn!`);
    state.players[active].frozen = false;
    document
      .getElementById(`p${active}-freeze-overlay`)
      .classList.add("hidden");
    setTimeout(() => {
      endTurn();
    }, 1500);
    return;
  }

  state.players[active].skills.forEach((skill, idx) => {
    const btn = document.createElement("button");

    // Style based on type
    let bgClass = "bg-slate-700 hover:bg-slate-600";
    if (skill.type === "chaos")
      bgClass =
        "bg-red-900/50 hover:bg-red-700/50 border border-red-500/30 text-red-100";
    if (skill.type === "vampire")
      bgClass =
        "bg-purple-900/50 hover:bg-purple-700/50 border border-purple-500/30 text-purple-100";
    if (skill.type === "stun")
      bgClass =
        "bg-blue-900/50 hover:bg-blue-700/50 border border-blue-500/30 text-blue-100";

    btn.className = `${bgClass} py-3 px-2 rounded-lg font-bold transition-all text-sm flex flex-col items-center gap-1`;
    btn.innerHTML = `
            <span class="text-xs opacity-70 tracking-wider uppercase">${skill.type}</span>
            <span class="text-base">${skill.name || "Unnamed Skill"}</span>
            <span class="text-xs bg-black/30 px-2 rounded-full">${skill.points} pts</span>
        `;

    btn.onclick = () => executeMove(skill);
    btnContainer.appendChild(btn);
  });
}

async function executeMove(skill, fromNetwork = false) {
    if (!state.battleActive) return;

    // Online Check: If it's not my turn and I clicked (not from network), ignore
    if (state.mode === 'host' && state.turn === 2 && !fromNetwork) return;
    if (state.mode === 'guest' && state.turn === 1 && !fromNetwork) return;

    // Send Move if local interaction in online mode
    if (!fromNetwork) {
        if (state.mode === 'host' || state.mode === 'guest') {
            sendData('MOVE', { skill });
            // If Guest, we stop here and wait for Host to calculate result and send back
            // If Host, we proceed to calculate logic
            if (state.mode === 'guest') {
                // Visual feedback only, real logic comes from Host sync
                document.getElementById('action-buttons').innerHTML = ''; 
                return;
            }
        }
    }
    
    // Disable buttons
    document.getElementById('action-buttons').innerHTML = '';

    const attackerId = state.turn;
  const defenderId = attackerId === 1 ? 2 : 1;
  const attacker = state.players[attackerId];
  const defender = state.players[defenderId];

  // Jump Animation
  const jumpClass = attackerId === 1 ? "attack-jump-right" : "attack-jump-left";
  document.getElementById(`p${attackerId}-arena-img`).classList.add(jumpClass);
  setTimeout(
    () =>
      document
        .getElementById(`p${attackerId}-arena-img`)
        .classList.remove(jumpClass),
    500,
  );

  log(`${attacker.name} uses ${skill.name}!`);
  await new Promise((r) => setTimeout(r, 600));

  // Accuracy Check
  let accuracy = 100;
  if (skill.type === "chaos") accuracy = 70;
  if (skill.type === "stun") accuracy = 85;
  if (skill.type === "vampire") accuracy = 95;

  if (Math.random() * 100 > accuracy) {
    log(`...but it MISSED!`);
    endTurn();
    return;
  }

  // Damage Calculation
  let damage = 0;
  let isCrit = false; // For screen shake

  if (skill.type === "chaos") {
    const mult = gaussianRandom(1.5, 1.2);
    damage = Math.floor(skill.points * mult);
    if (damage > skill.points * 2.5) isCrit = true;
  } else if (skill.type === "vampire") {
    damage = Math.floor(skill.points * 0.6);
        const heal = Math.floor(damage * 0.5); // increased heal for visibility
        if (heal > 0) {
            attacker.stats.hp = Math.min(attacker.stats.hp + heal, attacker.stats.maxHp);
            createFloatingText(attackerId, `+${heal}`, 'heal-float');
            updateHpBars();
            log(`${attacker.name} drains ${heal} HP!`);
            createParticles(attackerId, 'heal');
        }
    } else if (skill.type === 'stun') {
        damage = Math.floor(skill.points * 0.4); // slightly buffed dmg
        if (Math.random() < 0.45) { // 45% chance
            defender.frozen = true;
            document.getElementById(`p${defenderId}-freeze-overlay`).classList.remove('hidden');
            log(`❄️ ${defender.name} is FROZEN!`);
            createParticles(defenderId, 'stun');
        }
    }

    if (damage < 0) damage = 0;
    
    // Apply Damage
    defender.stats.hp -= damage;
    if (defender.stats.hp < 0) defender.stats.hp = 0;
    
    createFloatingText(defenderId, `-${damage}`, 'damage-float');
    updateHpBars();
    
    // Hit Reaction Animation
    const recoilClass = defenderId === 1 ? 'hit-recoil-left' : 'hit-recoil-right';
    document.getElementById(`p${defenderId}-arena-img`).classList.add(recoilClass);
    setTimeout(() => document.getElementById(`p${defenderId}-arena-img`).classList.remove(recoilClass), 400);

    // Particles on Hit
    if(damage > 0) {
        if(skill.type === 'chaos') createParticles(defenderId, 'chaos');
        else if(skill.type === 'vampire') createParticles(defenderId, 'vampire');
        else createParticles(defenderId, 'stun'); // generic reuse for standard
    }
    
    log(`It deals ${damage} damage!`);

  if (isCrit) {
    document.body.classList.add("screen-shake");
    setTimeout(() => document.body.classList.remove("screen-shake"), 500);
    log(`CRITICAL HIT! Massize variance spike!`);
  }

    // Sync State after move (Host only)
    if (state.mode === 'host') {
        sendData('SYNC_STATE', { 
            players: state.players,
            logs: [] // Logs handled separately in real-time
        });
    }

    if (defender.stats.hp <= 0) {
        endGame(attackerId);
    } else {
        setTimeout(endTurn, 1000);
    }
}

function createFloatingText(playerId, text, className) {
    const container = document.getElementById(`p${playerId}-floater-container`);
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    el.style.left = `${Math.random() * 40 - 20}px`; // random x offset
    container.appendChild(el);
    setTimeout(() => el.remove(), 1000);
}

function createParticles(playerId, type) {
    const target = document.getElementById(`p${playerId}-arena-img`);
    const rect = target.getBoundingClientRect();
    const container = document.getElementById('particles');
    
    // Spawn more particles for better effect
    const count = type === 'victory' ? 50 : 20;

    for(let i=0; i<count; i++) {
        const p = document.createElement('div');
        p.classList.add('particle');
        
        if (type === 'victory') {
            // Random colors for victory
            const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500'];
            p.classList.add(colors[Math.floor(Math.random() * colors.length)], 'particle-victory');
        } else {
            p.classList.add(`particle-${type}`);
        }
        
        // Random position around center of target
        const x = rect.left + rect.width/2 + (Math.random()-0.5) * 50;
        const y = rect.top + rect.height/2 + (Math.random()-0.5) * 50;
        
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        
        const size = Math.random()*8 + 4;
        p.style.width = `${size}px`;
        p.style.height = `${size}px`;
        
        // Randomize animation
        p.style.animationDuration = `${0.6 + Math.random()*0.6}s`;
        
        container.appendChild(p);
        setTimeout(() => p.remove(), 1500);
    }
}

function updateHpBars() {
  [1, 2].forEach((id) => {
    const p = state.players[id];
    const bar = document.getElementById(`p${id}-hp-bar`);
    const pct = (p.stats.hp / p.stats.maxHp) * 100;
    bar.style.width = `${pct}%`;
    document.getElementById(`p${id}-hp-text`).textContent =
      `${p.stats.hp} / ${p.stats.maxHp} HP`;
  });
}

function log(msg) {
  const el = document.getElementById("battle-log");
  const line = document.createElement("div");
  line.className = "mb-1 border-b border-slate-700/50 pb-1 last:border-0";
  line.innerHTML = `<span class="text-slate-500">[${new Date().toLocaleTimeString().slice(0, 5)}]</span> ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function endTurn() {
    // Start Math Phase for next turn
    if (state.mode === 'host') {
        startMathPhase();
    }
}

function endGame(winnerId) {
  state.battleActive = false;
  state.winnerId = winnerId;
  document.getElementById("victory-overlay").classList.remove("hidden");
  document.getElementById("winner-name").textContent =
    `${state.players[winnerId].name} WINS!`;
  document.getElementById("share-btn").classList.remove("hidden");
  
  // Victory Celebration
  const interval = setInterval(() => {
    if(document.getElementById("victory-overlay").classList.contains("hidden")) {
        clearInterval(interval);
        return;
    }
    createParticles(winnerId, 'victory'); // Uses our enhanced particle function
  }, 300);
}

/* --- Share Logic --- */

function shareBuild() {
    const winnerId = state.winnerId || 1; // Default to P1 if sharing from creator (feature expansion) or if winnerId not set
    const p = state.players[winnerId];
    
    const params = new URLSearchParams();
    params.set('name', p.name);
    params.set('arch', p.archetype);
    
    p.skills.forEach((s, i) => {
        params.set(`s${i+1}n`, s.name);
        params.set(`s${i+1}t`, s.type);
        params.set(`s${i+1}p`, s.points);
    });
    
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('share-btn');
        const originalText = btn.textContent;
        btn.textContent = "Copied! 📋";
        setTimeout(() => btn.textContent = originalText, 2000);
    });
}

// Note: Simple serialization for MVP. 
// Ideally w/ compression but URL params are fine for this scope.
function loadSharedBuild() {
    const urlParams = new URLSearchParams(window.location.search);
    
    const p2 = state.players[2];
    p2.name = urlParams.get('name') || "Challenger";
    p2.archetype = urlParams.get('arch') || "Titan"; // Default if missing
    
    // Decode skills (s1n, s1t, s1p...)
    for(let i=0; i<3; i++) {
        p2.skills[i].name = urlParams.get(`s${i+1}n`) || `Skill ${i+1}`;
        p2.skills[i].type = urlParams.get(`s${i+1}t`) || "chaos";
        p2.skills[i].points = parseInt(urlParams.get(`s${i+1}p`)) || 0;
    }
    
    // Validate points just in case URL is messed up
    let total = 0;
    p2.skills.forEach(s => total += s.points);
    if (total !== 100) {
        // Simple fix: reset to default if invalid
        p2.skills[0].points = 40;
        p2.skills[1].points = 30;
        p2.skills[2].points = 30;
    }

    renderPlayerToCreator(2);
    
    log("Challenger loaded from URL!");
}

/* --- Barracks (Local Storage) --- */

function saveCharacter(pid) {
    const p = state.players[pid];
    if(!p.name) {
        setStatus("Character needs a name before saving.", "warn");
        return;
    }
    
    const charData = {
        id: Date.now(),
        name: p.name,
        photo: p.photo,
        archetype: p.archetype,
        skills: JSON.parse(JSON.stringify(p.skills))
    };
    
    const library = JSON.parse(localStorage.getItem('gba_library') || '[]');
    library.push(charData);
    localStorage.setItem('gba_library', JSON.stringify(library));
    setStatus(`${p.name} saved to Barracks.`, "ok");
}

function loadCharacter(id) {
    const library = JSON.parse(localStorage.getItem('gba_library') || '[]');
    const char = library.find(c => c.id === id);
    if(!char) return;

    const localPid = getLocalCreatorPlayerId();
    const target = state.players[localPid];
    target.name = char.name;
    target.photo = char.photo;
    target.archetype = char.archetype;
    target.skills = JSON.parse(JSON.stringify(char.skills)); // Deep copy

    renderPlayerToCreator(localPid);
    checkValidation();
    if ((state.mode === 'host' && localPid === 1) || (state.mode === 'guest' && localPid === 2)) {
        syncLocalProfile();
    }
    document.getElementById('barracks-modal').classList.add('hidden');
}

function deleteCharacter(id) {
    if(!confirm("Delete this hero permanently?")) return;
    let library = JSON.parse(localStorage.getItem('gba_library') || '[]');
    library = library.filter(c => c.id !== id);
    localStorage.setItem('gba_library', JSON.stringify(library));
    renderBarracks();
}

function renderBarracks() {
    const list = document.getElementById('barracks-list');
    const library = JSON.parse(localStorage.getItem('gba_library') || '[]');
    
    list.innerHTML = '';
    
    if(library.length === 0) {
        list.innerHTML = '<p class="text-slate-500 italic col-span-2 text-center">No heroes saved yet.</p>';
        return;
    }
    
    library.forEach(char => {
        const card = document.createElement('div');
        card.className = "bg-slate-900 p-3 rounded-xl border border-slate-700 flex gap-3 items-center hover:border-cyan-500 transition-colors cursor-pointer group";
        
        card.innerHTML = `
            <img src="${char.photo || 'https://via.placeholder.com/50'}" class="w-12 h-12 rounded-full object-cover border border-slate-600">
            <div class="flex-grow">
                <h4 class="font-bold text-white text-sm">${char.name}</h4>
                <div class="text-xs text-slate-400">${char.archetype}</div>
            </div>
            <button class="delete-btn text-slate-600 hover:text-red-400 p-2 z-10" title="Delete">🗑️</button>
        `;
        
        // Load on click
        card.addEventListener('click', (e) => {
            if(!e.target.closest('.delete-btn')) {
                loadCharacter(char.id);
            }
        });
        
        // Delete action
        card.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteCharacter(char.id);
        });
        
        list.appendChild(card);
    });
}

/* --- PeerJS Multiplayer --- */

function initPeer() {
    return new Promise((resolve, reject) => {
        if (state.peer) return resolve(state.peer);
        const peer = new Peer();
        peer.on('open', (id) => {
            console.log('My peer ID is: ' + id);
            state.peer = peer;
            resolve(peer);
        });
        peer.on('error', (err) => console.error(err));
    });
}

function hostGame() {
    if (!passAccessGate()) return; // Double check
    initPeer().then(peer => {
        state.mode = 'host';
        updateSaveButtons();
        document.getElementById('host-game-btn').classList.add('hidden');
        document.getElementById('host-link-area').classList.remove('hidden');
        document.getElementById('host-link-input').value = buildInviteLink(peer.id);
        
        // Wait for connection
        peer.on('connection', (conn) => {
            setupConnection(conn);
            // Hide modal implies start
            document.getElementById('online-modal').classList.add('hidden');
            setStatus("Opponent connected. You can start the online 1v1 battle.", "ok");
            checkValidation();
        });
        setStatus("Room created. Share the Room ID and wait for your opponent.", "warn");
        checkValidation();
    });
}

function joinGame(hostId) {
    if (!passAccessGate()) return; // Double check
    initPeer().then(peer => {
        state.mode = 'guest';
        updateSaveButtons();
        const cleanHostId = normalizeHostId(hostId);
        if (!cleanHostId) {
            setStatus("Invalid invite or room ID.", "warn");
            return;
        }
        const conn = peer.connect(cleanHostId);
        setupConnection(conn);
        setStatus("Joining room...", "warn");
        checkValidation();
    });
}

function normalizeHostId(rawInput) {
    const value = (rawInput || "").trim();
    if (!value) return "";
    if (!value.includes("://")) return value;
    try {
        const url = new URL(value);
        return url.searchParams.get("join") || "";
    } catch {
        return "";
    }
}

function copyInviteLink() {
    const input = document.getElementById("host-link-input");
    if (!input || !input.value) {
        setStatus("Create a room first to generate an invite link.", "warn");
        return;
    }
    navigator.clipboard.writeText(input.value).then(() => {
        setStatus("Invite link copied. Send it to your opponent.", "ok");
    }).catch(() => {
        setStatus("Copy failed. Manually copy the invite link.", "warn");
    });
}

function setupConnection(conn) {
    state.conn = conn;
    
    conn.on('open', () => {
        console.log("Connected to peer!");
        
        // Handshake
        // Host is P1, Guest is P2.
        
        // Guest Initialization Logic
        if (state.mode === 'guest') {
            if (!state.guestProfileInitialized) {
                // MOVE local P1 data to P2 slot
                state.players[2] = JSON.parse(JSON.stringify(state.players[1]));
                // Reset P1 to empty/host placeholder? Actually we wait for handshake.
                state.guestProfileInitialized = true;
            }
            
            // UI Update for Guest
            renderPlayerToCreator(2); // Show my data in P2 slot
            
            // LOCK P1 (Host), UNLOCK P2 (Me)
            toggleCardLock(1, true);
            toggleCardLock(2, false);
            
            setStatus("Connected to Host. You are Player 2.", "ok");
        } else {
            // Host Initialization Logic
            // LOCK P2 (Guest), UNLOCK P1 (Me)
            toggleCardLock(1, false);
            toggleCardLock(2, true);
        }

        const myChar = state.mode === 'guest' ? state.players[2] : state.players[1]; 
        
        sendData('HANDSHAKE', { char: myChar });
        
        document.getElementById('online-modal').classList.add('hidden');
        checkValidation();
    });

    conn.on('data', (data) => handleData(data));
    conn.on('error', (err) => {
        console.error("Connection error:", err);
        setStatus("Connection error. Check room link and retry.", "warn");
    });
    conn.on('close', () => {
        state.conn = null;
        state.battleActive = false;
        state.guestProfileInitialized = false;
        state.mode = null;
        updateSaveButtons();
        setStatus("Connection closed. Re-open Online and reconnect.", "warn");
        checkValidation();
    });
}

function sendData(type, payload) {
    if (state.conn && state.conn.open) {
        state.conn.send({ type, payload });
    }
}

function handleData(data) {
    const { type, payload } = data;
    console.log("Received:", type, payload);
    
    if (type === 'HANDSHAKE') {
        if (state.mode === 'guest') {
            state.players[1] = payload.char; // Load host char
            
            // Allow Guest to "Ready Up" -> In this simple version, handshake implies ready.
            // Update UI
            renderPlayerToCreator(1);
            renderPlayerToCreator(2);
            
            // Wait for Host to START battle.
            document.getElementById('start-battle-btn').disabled = true;
            document.getElementById('start-battle-btn').textContent = "WAITING FOR HOST...";
            setStatus("Connected to host. Waiting for host to start.", "ok");
            checkValidation();
            
        } else {
            // I am Host. My char is P1. Guest char (payload) goes to P2.
            state.players[2] = payload.char;
            renderPlayerToCreator(2);
            // Verify and Enable Start
            setStatus("Guest profile synced. Ready when both builds are valid.", "ok");
            checkValidation();
        }

    } else if (type === 'PROFILE_SYNC') {
        if (state.mode === 'guest') {
            state.players[1] = JSON.parse(JSON.stringify(payload.char));
            renderPlayerToCreator(1);
        } else if (state.mode === 'host') {
            state.players[2] = JSON.parse(JSON.stringify(payload.char));
            renderPlayerToCreator(2);
        }
        checkValidation();
        
    } else if (type === 'SYNC_STATS') {
        // Guest receives rolled stats
        state.players[1].stats = payload.p1;
        state.players[2].stats = payload.p2;
        
        // Update UI
        updateHpBars();
        for(let i=1; i<=2; i++) {
            document.getElementById(`p${i}-speed-display`).textContent = `SPD: ${state.players[i].stats.speed}`;
            document.getElementById(`p${i}-hp-text`).textContent = `${state.players[i].stats.hp} / ${state.players[i].stats.maxHp} HP`;
            document.getElementById(`p${i}-arch-display`).textContent = `ARCH: ${state.players[i].archetype}`;
        }
        
    } else if (type === 'SYNC_TURN') {
        state.turn = payload.turn;
        updateTurnUI();
        
    } else if (type === 'START_BATTLE') {
        // Guest receives start command
        document.getElementById('creator-screen').classList.add('hidden');
        document.getElementById('arena-screen').classList.remove('hidden');
        document.getElementById('arena-screen').classList.add('flex');
        
        // Setup Arena UI
        for(let i=1; i<=2; i++) {
            document.getElementById(`p${i}-arena-name`).textContent = state.players[i].name;
            document.getElementById(`p${i}-arena-img`).src = state.players[i].photo || ARCHETYPES[state.players[i].archetype].image;
        }
        
        rollStatsAnimation(); // Visuals only for guest
        
    } else if (type === 'MOVE') {
        // Host receives Move command from Guest
        if(state.mode === 'host') {
             executeMove(payload.skill, true);
        }
        
    } else if (type === 'SYNC_STATE') {
        // Guest receives full state update (HP, etc) from Host
        state.players[1] = payload.players[1];
        state.players[2] = payload.players[2];
        updateHpBars();
        // Also ensure UI reflects frozen state etc?
    } else if (type === 'MATH_START') {
        state.mathChallenge.active = true;
        state.mathChallenge.answered = false;
        state.battleActive = false;
        state.mathChallenge.correctAnswer = payload.a;
        renderMathModal(payload);
    } else if (type === 'MATH_SOLVED') {
        if (state.mode === 'host') {
            sendData('MATH_SOLVED', payload);
        }
        resolveMathPhase(payload.winner);
    }
}
