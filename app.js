// Constants
const STRINGS = ['A', 'D', 'G', 'C']; // Display logic: A is string 0 (highest pitch)
const MAX_POS = 33; // Extended range to E6 (approx)
const PLAY_PAUSE_SECONDS = 4; // 4-second pause to play the note before hearing it
const POST_REVEAL_DELAY_MS = 2500; // Pause after playing the note before auto-advancing

// Full chromatic mapping helper
function buildNoteMap() {
    // Strings base notes: A3, D3, G2, C2 (Standard Cello Tuning)
    // MIDI values: C2=36, G2=43, D3=50, A3=57
    const stringBaseNotes = [
        { name: 'A', val: 57 }, // String 0
        { name: 'D', val: 50 }, // String 1
        { name: 'G', val: 43 }, // String 2
        { name: 'C', val: 36 }  // String 3
    ];

    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const map = {};

    stringBaseNotes.forEach((base, sIdx) => {
        let currentVal = base.val;
        for (let pos = 0; pos <= MAX_POS; pos++) {
            // Calculate note name at this position
            const octave = Math.floor(currentVal / 12) - 1; // MIDI C4=60 -> 60/12=5-1=4. C2=36 -> 3-1=2.
            const noteIdx = currentVal % 12;
            const noteName = notes[noteIdx];
            const key = `${noteName}/${octave}`;

            if (!map[key]) map[key] = [];
            map[key].push({ string: sIdx, pos: pos });

            currentVal++;
        }
    });

    return map;
}

const NOTE_POSITIONS = buildNoteMap();

// Initial State
const initialState = {
    currentNote: 'D/3',
    selectedString: null,
    selectedPos: null,
    status: 'waiting', // 'waiting' | 'revealed'
    feedbackMsg: 'Click "Start Quiz" to begin',
    allowTreble: false,
    allowTenor: false,
    mode: 'quiz', // 'quiz' or 'explore'
    quizRunning: false,
};

// UI References
const els = {
    staff: document.getElementById('vexflow-output'),
    board: document.getElementById('fingerboard'),
    feedback: document.getElementById('feedback-msg'),
    startPauseBtn: document.getElementById('start-pause-btn'),
    nextBtn: document.getElementById('next-btn'),
    quizActions: document.getElementById('quiz-actions'),
    trebleCheck: document.getElementById('treble-toggle'),
    tenorCheck: document.getElementById('tenor-toggle'),
    controlsOptions: document.querySelector('.controls-options'),
    quizBtn: document.getElementById('quiz-mode-btn'),
    exploreBtn: document.getElementById('explore-mode-btn'),
    instruction: document.getElementById('instruction-text'),
};

// State Proxy
const state = new Proxy(initialState, {
    set(target, property, value) {
        target[property] = value;
        render(property, value);
        return true;
    }
});

// Audio Setup (Tone.js)
let synth = null;
let audioStarted = false;

function initAudio() {
    if (synth) return;
    try {
        if (typeof Tone === 'undefined') {
            console.error("Tone.js not loaded");
            return;
        }

        // Warmer Cello Tone
        const filter = new Tone.Filter(1800, "lowpass").toDestination();

        // Use FMSynth for richer harmonic content
        synth = new Tone.PolySynth(Tone.FMSynth, {
            harmonicity: 3.01,
            modulationIndex: 14,
            oscillator: {
                type: "triangle"
            },
            envelope: {
                attack: 0.05,
                decay: 0.3,
                sustain: 0.4,
                release: 1.2
            },
            modulation: {
                type: "square"
            },
            modulationEnvelope: {
                attack: 0.05,
                decay: 0.2,
                sustain: 0.2,
                release: 0.1
            }
        }).connect(filter);

        synth.volume.value = -4;
    } catch (e) {
        console.error("Audio init error:", e);
    }
}

async function ensureAudio() {
    if (!audioStarted) {
        try {
            if (typeof Tone !== 'undefined') {
                await Tone.start();
                audioStarted = true;
                initAudio();
            }
        } catch (e) {
            console.error("Tone.start failed:", e);
        }
    }
}

// Unlock audio context on first interaction
document.body.addEventListener('click', () => {
    ensureAudio();
}, { once: true });

async function playNote(noteKey, duration = "8n") {
    await ensureAudio();
    if (!synth) return;

    // noteKey: "C#/3" -> "C#3"
    const cleanKey = noteKey.replace('/', '');
    try {
        synth.triggerAttackRelease(cleanKey, duration);
    } catch (e) {
        console.error("Play note error:", e);
    }
}

// VexFlow Setup
const { Renderer, Stave, StaveNote, Formatter } = Vex.Flow;

function renderStaff(noteKey) {
    els.staff.innerHTML = '';
    const width = state.mode === 'explore' ? 500 : 250;
    const renderer = new Renderer(els.staff, Renderer.Backends.SVG);
    renderer.resize(width, 160);
    const context = renderer.getContext();

    if (state.mode === 'explore') {
        renderExplorationStaves(context, noteKey);
    } else {
        renderQuizStave(context, noteKey);
    }
}

function renderQuizStave(context, noteKey) {
    let clef = 'bass';
    const val = getMidiValue(noteKey);

    if (state.allowTreble && val >= 60 && val <= 93) {
        if (state.allowTenor && val >= 50 && val <= 69 && val < 67) {
            clef = 'tenor';
        } else {
            clef = 'treble';
        }
    } else if (state.allowTenor && val >= 50 && val <= 69) {
        clef = 'tenor';
    }

    const stave = new Stave(25, 20, 200);
    stave.addClef(clef).setContext(context).draw();

    const finalKey = noteKey.toLowerCase();
    const note = new StaveNote({ clef: clef, keys: [finalKey], duration: "w" });
    if (finalKey.includes('#')) note.addModifier(new Vex.Flow.Accidental("#"));

    if (state.status === 'revealed') {
        note.setStyle({ fillStyle: "#4ade80", strokeStyle: "#4ade80" });
    }

    const voices = [new Vex.Flow.Voice({ num_beats: 4, beat_value: 4 }).addTickables([note])];
    new Formatter().joinVoices(voices).format(voices, 150);
    voices.forEach(v => v.draw(context, stave));
}

function renderExplorationStaves(context, noteKey) {
    const clefs = ['bass', 'tenor', 'treble'];
    let x = 10;

    clefs.forEach(clef => {
        const stave = new Stave(x, 20, 150);
        stave.addClef(clef).setContext(context).draw();

        const finalKey = noteKey.toLowerCase();
        const note = new StaveNote({ clef: clef, keys: [finalKey], duration: "w" });
        if (finalKey.includes('#')) note.addModifier(new Vex.Flow.Accidental("#"));

        note.setStyle({ fillStyle: "#38bdf8", strokeStyle: "#38bdf8" });

        const voices = [new Vex.Flow.Voice({ num_beats: 4, beat_value: 4 }).addTickables([note])];
        new Formatter().joinVoices(voices).format(voices, 100);
        voices.forEach(v => v.draw(context, stave));

        x += 160;
    });
}

function getMidiValue(noteKey) {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const parts = noteKey.split('/');
    const noteName = parts[0];
    const octave = parseInt(parts[1]);
    const noteIdx = notes.indexOf(noteName);
    if (noteIdx === -1) return 0;
    return (octave + 1) * 12 + noteIdx;
}

// Position Definitions (Overlapping, 4-semitone range)
const POSITIONS = [
    { name: '½ Half', start: 1, color: '#00FFFF' },      // Cyan
    { name: 'I First', start: 2, color: '#00FF00' },     // Lime
    { name: 'Up I / Lo II', start: 3, color: '#FFFF00' },// Yellow
    { name: 'II Second', start: 4, color: '#FFA500' },   // Orange
    { name: 'III Third', start: 5, color: '#FF00FF' },   // Magenta
    { name: 'Up III', start: 6, color: '#FF1493' },      // DeepPink
    { name: 'IV Fourth', start: 7, color: '#00BFFF' },   // DeepSkyBlue
    { name: 'Up IV', start: 8, color: '#ADFF2F' },       // GreenYellow
    { name: 'V Fifth', start: 10, color: '#FF4500' },    // OrangeRed
    { name: 'VI Sixth', start: 12, color: '#FF8C00' },   // DarkOrange
    { name: 'VII Seventh', start: 14, color: '#9400D3' } // DarkViolet
];

function initFingerboard() {
    els.board.innerHTML = '';

    STRINGS.forEach((strName, sIdx) => {
        const col = document.createElement('div');
        col.className = 'string-column';

        for (let pIdx = 0; pIdx <= MAX_POS; pIdx++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.string = sIdx;
            cell.dataset.pos = pIdx;

            const cleanName = getNoteNameOnly(sIdx, pIdx);

            const content = document.createElement('span');
            content.className = 'cell-content';
            content.textContent = cleanName;
            cell.appendChild(content);

            const activePositions = POSITIONS.filter(p => pIdx >= p.start && pIdx <= p.start + 3);

            if (activePositions.length > 0) {
                const markerContainer = document.createElement('div');
                markerContainer.className = 'cell-markers';

                activePositions.forEach(p => {
                    const marker = document.createElement('div');
                    marker.className = 'pos-marker';
                    marker.style.backgroundColor = p.color;
                    marker.title = p.name;
                    markerContainer.appendChild(marker);
                });

                cell.appendChild(markerContainer);
            }

            if (pIdx === 0) {
                cell.style.borderBottom = '2px solid rgba(255,255,255,0.2)';
                cell.style.marginBottom = '4px';
            }

            if (pIdx === 12 || pIdx === 24) {
                const dot = document.createElement('div');
                dot.className = 'octave-dot';
                cell.appendChild(dot);
            }

            cell.addEventListener('click', () => handleCellClick(sIdx, pIdx));
            col.appendChild(cell);
        }
        els.board.appendChild(col);
    });

    updateLegend();
}

function updateLegend() {
    const legendList = document.querySelector('.legend ul');
    if (!legendList) return;
    legendList.innerHTML = '';

    POSITIONS.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="dot" style="background-color: ${p.color}"></span> ${p.name}`;
        legendList.appendChild(li);
    });
}

function getNoteNameOnly(stringIdx, posIdx) {
    const bases = [57, 50, 43, 36];
    const val = bases[stringIdx] + posIdx;
    const notes = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
    return notes[val % 12];
}

function handleCellClick(stringIdx, posIdx) {
    const actualNote = getKeyForPos(stringIdx, posIdx);
    if (actualNote) {
        playNote(actualNote, "8n");
    }

    state.selectedString = stringIdx;
    state.selectedPos = posIdx;

    if (state.mode === 'explore') {
        if (actualNote) {
            state.currentNote = actualNote;
            state.feedbackMsg = `Note: ${actualNote.split('/')[0]} (Octave ${actualNote.split('/')[1]})`;
        }
    }
}

function getKeyForPos(s, p) {
    for (const [k, v] of Object.entries(NOTE_POSITIONS)) {
        if (v.some(vp => vp.string === s && vp.pos === p)) return k;
    }
    return null;
}

// Quiz Timers
let countdownInterval = null;
let revealTimeout = null;
let advanceTimeout = null;

function clearQuizTimers() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    if (revealTimeout) {
        clearTimeout(revealTimeout);
        revealTimeout = null;
    }
    if (advanceTimeout) {
        clearTimeout(advanceTimeout);
        advanceTimeout = null;
    }
}

function startNoteCountdown() {
    clearQuizTimers();

    if (state.mode !== 'quiz' || !state.quizRunning) return;

    let remaining = PLAY_PAUSE_SECONDS;
    state.status = 'waiting';
    state.feedbackMsg = `Play the note... (${remaining}s)`;

    countdownInterval = setInterval(() => {
        remaining--;
        if (remaining > 0 && state.status === 'waiting') {
            state.feedbackMsg = `Play the note... (${remaining}s)`;
        }
    }, 1000);

    revealTimeout = setTimeout(() => {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        if (state.mode !== 'quiz' || !state.quizRunning) return;

        // Reveal and play the note after 4 seconds
        const [noteName, octave] = state.currentNote.split('/');
        state.status = 'revealed';
        state.feedbackMsg = `Note: ${noteName} (Octave ${octave})`;
        playNote(state.currentNote, "2n");

        // Automatically advance to the next note after a short pause
        advanceTimeout = setTimeout(() => {
            if (state.mode === 'quiz' && state.quizRunning) {
                nextLevel();
            }
        }, POST_REVEAL_DELAY_MS);
    }, PLAY_PAUSE_SECONDS * 1000);
}

// UI Update
function render(property, value) {
    if (property === 'currentNote') {
        renderStaff(value);
    }

    if (property === 'feedbackMsg') {
        els.feedback.textContent = value;
        els.feedback.className = state.status;
        if (state.mode === 'explore') {
            els.feedback.style.color = '#38bdf8';
        } else {
            els.feedback.style.color = state.status === 'revealed' ? 'var(--success)' : 'white';
        }
    }

    if (property === 'quizRunning') {
        if (els.startPauseBtn) {
            els.startPauseBtn.textContent = value ? 'Pause' : 'Start Quiz';
            els.startPauseBtn.classList.toggle('running', value);
        }
    }

    if (property === 'mode') {
        els.quizBtn.classList.toggle('active', value === 'quiz');
        els.exploreBtn.classList.toggle('active', value === 'explore');
        if (els.quizActions) {
            els.quizActions.style.display = value === 'quiz' ? 'flex' : 'none';
        }

        if (els.controlsOptions) {
            els.controlsOptions.style.display = value === 'quiz' ? 'flex' : 'none';
        }

        if (value === 'quiz') {
            els.instruction.textContent = 'Play the note shown on the staff, then listen to check.';
        } else {
            els.instruction.textContent = 'Select a position to see its notation.';
        }

        clearQuizTimers();
        state.quizRunning = false;
        state.status = 'waiting';
        state.selectedString = null;
        state.selectedPos = null;

        if (value === 'quiz') {
            pickRandomNote();
            state.feedbackMsg = 'Click "Start Quiz" to begin';
        } else {
            state.feedbackMsg = 'Explore Mode: Click a position.';
            renderStaff(state.currentNote);
        }
    }

    if (
        property === 'selectedString' ||
        property === 'selectedPos' ||
        property === 'status' ||
        property === 'allowTreble' ||
        property === 'allowTenor'
    ) {
        updateGridVisuals();
        if (property === 'status' || property === 'allowTreble' || property === 'allowTenor') {
            renderStaff(state.currentNote);
        }
    }
}

function updateGridVisuals() {
    const cells = document.querySelectorAll('.cell');

    let targetPositions = [];
    if (state.mode === 'quiz' && state.status === 'revealed') {
        targetPositions = NOTE_POSITIONS[state.currentNote] || [];
    } else if (state.mode === 'explore' && state.selectedString !== null) {
        const k = getKeyForPos(state.selectedString, state.selectedPos);
        targetPositions = NOTE_POSITIONS[k] || [];
    }

    cells.forEach(cell => {
        cell.classList.remove('active', 'correct', 'incorrect');

        const s = parseInt(cell.dataset.string);
        const p = parseInt(cell.dataset.pos);

        const isTarget = targetPositions.some(vp => vp.string === s && vp.pos === p);

        if (state.selectedString === s && state.selectedPos === p) {
            cell.classList.add('active');
        } else if (isTarget) {
            cell.classList.add('correct');
        }
    });
}

// Quiz Pool
let quizPool = [];

function pickRandomNote() {
    const keys = Object.keys(NOTE_POSITIONS);

    const ranges = [];
    ranges.push({ min: 36, max: 62 });

    if (state.allowTenor) {
        ranges.push({ min: 50, max: 69 }); // D3 - A4
    }
    if (state.allowTreble) {
        ranges.push({ min: 60, max: 93 }); // C4 - A6
    }

    const validKeys = keys.filter(k => {
        const v = getMidiValue(k);
        return ranges.some(r => v >= r.min && v <= r.max);
    });

    if (quizPool.length === 0) {
        quizPool = [...validKeys];
        if (quizPool.length === 0) return;
    }

    const idx = Math.floor(Math.random() * quizPool.length);
    const note = quizPool[idx];
    quizPool.splice(idx, 1);

    state.status = 'waiting';
    state.selectedString = null;
    state.selectedPos = null;
    state.currentNote = note;
}

function nextLevel() {
    if (state.mode === 'explore') return;

    clearQuizTimers();
    pickRandomNote();

    if (state.quizRunning) {
        startNoteCountdown();
    } else {
        state.feedbackMsg = 'Click "Start Quiz" to begin';
    }
}

// Mode Listeners
if (els.quizBtn) els.quizBtn.addEventListener('click', () => { state.mode = 'quiz'; });
if (els.exploreBtn) els.exploreBtn.addEventListener('click', () => { state.mode = 'explore'; });

// Quiz Control Listeners
if (els.startPauseBtn) {
    els.startPauseBtn.addEventListener('click', async () => {
        await ensureAudio();
        if (state.quizRunning) {
            clearQuizTimers();
            state.quizRunning = false;
            state.feedbackMsg = 'Quiz paused';
        } else {
            state.quizRunning = true;
            // If current note was already revealed, advance to a fresh note; otherwise start 4s timer for current note
            if (state.status === 'revealed') {
                nextLevel();
            } else {
                startNoteCountdown();
            }
        }
    });
}

if (els.nextBtn) {
    els.nextBtn.addEventListener('click', async () => {
        await ensureAudio();
        state.quizRunning = true;
        nextLevel();
    });
}

// Checkbox Listeners
els.trebleCheck.addEventListener('change', (e) => {
    state.allowTreble = e.target.checked;
    quizPool = [];
    if (state.mode === 'quiz') nextLevel();
});

els.tenorCheck.addEventListener('change', (e) => {
    state.allowTenor = e.target.checked;
    quizPool = [];
    if (state.mode === 'quiz') nextLevel();
});

// Init
initFingerboard();
pickRandomNote();
