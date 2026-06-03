/* ============================================================
   MINESWEEPER · RETRO EDITION
   Pure JS, no dependencies. Persists best times in localStorage.
   ============================================================ */

(() => {
  "use strict";

  // ----- Configuration ------------------------------------------------

  const DIFFICULTIES = {
    beginner:     { rows: 9,  cols: 9,  mines: 10, timeLimit: 60,  cellSize: 28 },
    intermediate: { rows: 16, cols: 16, mines: 40, timeLimit: 240, cellSize: 26 },
    expert:       { rows: 16, cols: 30, mines: 99, timeLimit: 600, cellSize: 22 },
  };

  const STORAGE_KEY = "minesweeper.retro.scores.v1";
  const FACE = { happy: "😊", wow: "😮", dead: "😵", cool: "😎" };

  // ----- DOM ----------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const boardEl       = $("board");
  const mineCountEl   = $("mine-count");
  const timerEl       = $("timer");
  const timeLabelEl   = $("time-label");
  const faceEl        = $("face");
  const resetBtn      = $("reset-btn");
  const segButtons    = document.querySelectorAll(".seg-btn");
  const attackToggle  = $("time-attack-toggle");
  const newRecordEl   = $("new-record-msg");
  const clearScoresBtn = $("clear-scores");
  const toastEl       = $("toast");

  // ----- State --------------------------------------------------------

  /** @type {"beginner"|"intermediate"|"expert"} */
  let difficulty = "beginner";
  let timeAttack = false;

  let rows = 0, cols = 0, totalMines = 0, timeLimit = 0;
  let grid = [];           // 2D array of cells: { mine, value, revealed, flagged }
  let flagsPlaced = 0;
  let cellsRevealed = 0;
  let firstClick = true;
  let gameOver = false;
  let won = false;
  let startedAt = 0;       // ms timestamp
  let timerHandle = null;
  let timeAttackRemaining = 0;

  // ----- Storage ------------------------------------------------------

  function loadScores() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultScores();
      const parsed = JSON.parse(raw);
      return { ...defaultScores(), ...parsed };
    } catch {
      return defaultScores();
    }
  }

  function defaultScores() {
    return { beginner: null, intermediate: null, expert: null, attack: null };
  }

  function saveScores(scores) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
    } catch {
      /* storage may be disabled — silently ignore */
    }
  }

  function renderScores() {
    const scores = loadScores();
    document.querySelectorAll("[data-score]").forEach((el) => {
      const key = el.dataset.score;
      const v = scores[key];
      if (v == null) {
        el.textContent = "--:--";
        el.classList.add("empty");
      } else {
        el.textContent = formatTime(v);
        el.classList.remove("empty");
      }
    });
  }

  // ----- Helpers ------------------------------------------------------

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function setFace(name) {
    faceEl.textContent = FACE[name] || FACE.happy;
  }

  function setMineCount(n) {
    mineCountEl.textContent = String(Math.max(-99, n)).padStart(3, "0");
    mineCountEl.classList.toggle("ok",   n === 0);
    mineCountEl.classList.toggle("warn", n < 0);
  }

  function setTimer(n) {
    timerEl.textContent = String(Math.max(0, n)).padStart(3, "0");
    timerEl.classList.toggle("ok",   timeAttack && n > 30);
    timerEl.classList.toggle("warn", timeAttack && n <= 30);
  }

  function showToast(message, kind = "info", duration = 1800) {
    toastEl.textContent = message;
    toastEl.className = `toast show ${kind}`;
    clearTimeout(showToast._h);
    showToast._h = setTimeout(() => {
      toastEl.classList.remove("show");
    }, duration);
  }

  // ----- Board setup --------------------------------------------------

  function applyDifficulty() {
    const cfg = DIFFICULTIES[difficulty];
    rows = cfg.rows;
    cols = cfg.cols;
    totalMines = cfg.mines;
    timeLimit = cfg.timeLimit;
    timeAttackRemaining = timeLimit;

    document.documentElement.style.setProperty("--cell-size", `${cfg.cellSize}px`);

    boardEl.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
    boardEl.style.gridTemplateRows    = `repeat(${rows}, var(--cell-size))`;
  }

  function buildEmptyGrid() {
    grid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({
        mine: false,
        value: 0,
        revealed: false,
        flagged: false,
      }))
    );
  }

  function renderBoard() {
    boardEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement("button");
        cell.className = "cell";
        cell.type = "button";
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `Cell ${r + 1}, ${c + 1}`);
        frag.appendChild(cell);
      }
    }
    boardEl.appendChild(frag);
  }

  // ----- Mine placement (after first click) ---------------------------

  function placeMines(safeR, safeC) {
    // Build a list of forbidden positions: the first-click cell and its 8 neighbors.
    const forbidden = new Set();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = safeR + dr, c = safeC + dc;
        if (inBounds(r, c)) forbidden.add(`${r},${c}`);
      }
    }

    const candidates = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!forbidden.has(`${r},${c}`)) candidates.push([r, c]);
      }
    }

    // Fisher–Yates shuffle, pick first N
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const mineCount = Math.min(totalMines, candidates.length);
    for (let i = 0; i < mineCount; i++) {
      const [r, c] = candidates[i];
      grid[r][c].mine = true;
    }

    // Compute neighbor values
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c].mine) continue;
        let n = 0;
        forEachNeighbor(r, c, (nr, nc) => { if (grid[nr][nc].mine) n++; });
        grid[r][c].value = n;
      }
    }
  }

  function inBounds(r, c) { return r >= 0 && r < rows && c >= 0 && c < cols; }

  function forEachNeighbor(r, c, fn) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc)) fn(nr, nc);
      }
    }
  }

  // ----- Game flow ----------------------------------------------------

  function newGame({ resetDifficulty = false } = {}) {
    stopTimer();
    if (resetDifficulty) applyDifficulty();
    buildEmptyGrid();
    renderBoard();
    flagsPlaced = 0;
    cellsRevealed = 0;
    firstClick = true;
    gameOver = false;
    won = false;
    timeAttackRemaining = timeLimit;
    setFace("happy");
    setMineCount(totalMines);
    setTimer(timeAttack ? timeLimit : 0);
    timeLabelEl.textContent = timeAttack ? "TIME LEFT" : "TIME";
    newRecordEl.classList.remove("show");
    newRecordEl.textContent = "";
  }

  function startTimer() {
    if (timerHandle) return;
    startedAt = performance.now();
    timerHandle = setInterval(tick, 250);
  }

  function stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function tick() {
    if (gameOver) return;
    const elapsed = (performance.now() - startedAt) / 1000;
    if (timeAttack) {
      timeAttackRemaining = Math.max(0, timeLimit - elapsed);
      setTimer(Math.ceil(timeAttackRemaining));
      if (timeAttackRemaining <= 0) {
        endGame(false, "TIME UP!");
      }
    } else {
      setTimer(Math.min(999, Math.floor(elapsed)));
    }
  }

  function elapsedSeconds() {
    return (performance.now() - startedAt) / 1000;
  }

  // ----- Input handling ----------------------------------------------

  function getCellEl(r, c) {
    return boardEl.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
  }

  function onBoardMouseDown(e) {
    if (gameOver) return;
    const cell = e.target.closest(".cell");
    if (!cell) return;
    if (e.button === 2 || e.button === 0) {
      // press feedback via face
      if (e.button === 0 && cell.classList.contains("flagged")) return;
      if (e.button === 0 && !cell.classList.contains("revealed")) setFace("wow");
    }
  }

  function onBoardMouseUp(e) {
    if (gameOver) {
      if (e.target.closest(".cell") || e.target === boardEl) setFace(won ? "cool" : "dead");
      return;
    }
    const cell = e.target.closest(".cell");
    if (!cell) { setFace("happy"); return; }
    if (e.button === 0) setFace("happy");
  }

  function onBoardContextMenu(e) {
    e.preventDefault();
    if (gameOver) return;
    const cell = e.target.closest(".cell");
    if (!cell) return;
    const r = +cell.dataset.row, c = +cell.dataset.col;
    flag(r, c);
  }

  function onBoardClick(e) {
    if (gameOver) return;
    const cell = e.target.closest(".cell");
    if (!cell) return;
    if (e.button !== 0) return;
    const r = +cell.dataset.row, c = +cell.dataset.col;
    if (grid[r][c].flagged) return;
    reveal(r, c);
  }

  // ----- Reveal logic -------------------------------------------------

  function reveal(r, c) {
    if (!inBounds(r, c)) return;
    const cell = grid[r][c];
    if (cell.revealed || cell.flagged) return;

    if (firstClick) {
      firstClick = false;
      placeMines(r, c);
      startTimer();
    }

    if (cell.mine) {
      // Boom
      const el = getCellEl(r, c);
      cell.revealed = true;
      el.classList.add("revealed", "exploded");
      el.textContent = "*";
      revealAllMines();
      endGame(false, "BOOM!");
      return;
    }

    floodReveal(r, c);
    checkWin();
  }

  function floodReveal(startR, startC) {
    const stack = [[startR, startC]];
    while (stack.length) {
      const [r, c] = stack.pop();
      const cell = grid[r][c];
      if (cell.revealed || cell.flagged) continue;
      cell.revealed = true;
      cellsRevealed++;

      const el = getCellEl(r, c);
      el.classList.add("revealed");
      if (cell.value > 0) {
        el.dataset.value = String(cell.value);
        el.textContent = String(cell.value);
      } else {
        forEachNeighbor(r, c, (nr, nc) => {
          if (!grid[nr][nc].revealed && !grid[nr][nc].flagged) {
            stack.push([nr, nc]);
          }
        });
      }
    }
  }

  // ----- Flagging -----------------------------------------------------

  function flag(r, c) {
    if (!inBounds(r, c)) return;
    const cell = grid[r][c];
    if (cell.revealed) return;
    const el = getCellEl(r, c);

    if (cell.flagged) {
      cell.flagged = false;
      flagsPlaced--;
      el.classList.remove("flagged");
      el.textContent = "";
    } else {
      cell.flagged = true;
      flagsPlaced++;
      el.classList.add("flagged");
      el.textContent = "F";
    }
    setMineCount(totalMines - flagsPlaced);
  }

  // ----- Win / lose ---------------------------------------------------

  function revealAllMines() {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        const el = getCellEl(r, c);
        if (cell.mine && !cell.flagged) {
          el.classList.add("revealed", "mine");
          el.textContent = "*";
        } else if (!cell.mine && cell.flagged) {
          el.classList.add("revealed", "mine-wrong");
          el.textContent = "x";
        }
      }
    }
  }

  function checkWin() {
    const totalCells = rows * cols;
    if (cellsRevealed === totalCells - totalMines) {
      // auto-flag remaining mines for a clean look
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = grid[r][c];
          if (cell.mine && !cell.flagged) {
            cell.flagged = true;
            const el = getCellEl(r, c);
            el.classList.add("flagged");
            el.textContent = "F";
          }
        }
      }
      flagsPlaced = totalMines;
      setMineCount(0);
      endGame(true, "CLEARED!");
    }
  }

  function endGame(isWin, message) {
    gameOver = true;
    won = isWin;
    stopTimer();
    setFace(isWin ? "cool" : "dead");
    showToast(message, isWin ? "win" : "lose", isWin ? 2400 : 1800);

    if (isWin) handleWinScore();
  }

  function handleWinScore() {
    // Time attack: best = fastest clear → record seconds used (limit - remaining).
    // Classic: best = fastest clear → record seconds elapsed.
    const savedTime = timeAttack
      ? Math.max(0, timeLimit - timeAttackRemaining)
      : elapsedSeconds();

    const scores = loadScores();
    if (timeAttack) {
      if (scores.attack == null || savedTime < scores.attack) {
        scores.attack = savedTime;
        flashRecord(`NEW TIME ATTACK RECORD: ${formatTime(savedTime)}`);
      }
    } else {
      if (scores[difficulty] == null || savedTime < scores[difficulty]) {
        scores[difficulty] = savedTime;
        flashRecord(`NEW ${difficulty.toUpperCase()} RECORD: ${formatTime(savedTime)}`);
      }
    }

    saveScores(scores);
    renderScores();
  }

  let recordTimer = null;
  function flashRecord(msg) {
    newRecordEl.textContent = `★ ${msg} ★`;
    newRecordEl.classList.add("show");
    clearTimeout(recordTimer);
    recordTimer = setTimeout(() => newRecordEl.classList.remove("show"), 5000);
  }

  // ----- Wire up ------------------------------------------------------

  function bindEvents() {
    // Click on board — delegate
    boardEl.addEventListener("click", onBoardClick);
    boardEl.addEventListener("contextmenu", onBoardContextMenu);
    boardEl.addEventListener("mousedown", onBoardMouseDown);
    boardEl.addEventListener("mouseup", onBoardMouseUp);

    // Reset button
    resetBtn.addEventListener("click", () => newGame());

    // Difficulty segmented control
    segButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.difficulty;
        if (next === difficulty) return;
        difficulty = next;
        segButtons.forEach((b) => {
          const active = b === btn;
          b.classList.toggle("active", active);
          b.setAttribute("aria-selected", active ? "true" : "false");
        });
        applyDifficulty();
        newGame();
      });
    });

    // Time attack toggle
    attackToggle.addEventListener("change", (e) => {
      timeAttack = e.target.checked;
      newGame();
    });

    // Clear scores
    clearScoresBtn.addEventListener("click", () => {
      saveScores(defaultScores());
      renderScores();
      showToast("SCORES CLEARED", "info", 1200);
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (e.key === "F2") {
        e.preventDefault();
        newGame();
      }
    });
  }

  // ----- Boot ---------------------------------------------------------

  function init() {
    applyDifficulty();
    bindEvents();
    renderScores();
    newGame();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
