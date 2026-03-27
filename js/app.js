// app.js — Main application: Firebase, bottle library, adapter creation

import { generateScad, validatePitch } from './scad.js';
import { initPreview, updatePreview } from './preview.js';

// ── Firebase Setup ──────────────────────────────────────────

const firebaseConfig = {
    apiKey: "AIzaSyAgZKifbSpZkMjBEDspKjDLxOtmC_QYtBM",
    authDomain: "bottlecap-691da.firebaseapp.com",
    projectId: "bottlecap-691da",
    storageBucket: "bottlecap-691da.firebasestorage.app",
    messagingSenderId: "531741061891",
    appId: "1:531741061891:web:c4c6d432204b0c7ce52f36",
    measurementId: "G-G49Q93DKKR"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;

auth.signInAnonymously().catch(err => {
    console.warn('Anonymous auth failed:', err);
    showToast('Could not connect to cloud. Designs will not be saved.', 'error');
});

auth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) loadBottles();
});

// ── State ───────────────────────────────────────────────────

let bottlesCache = [];
let editingBottleId = null;

// ── Tab Navigation ──────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const view = tab.dataset.view;
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.view').forEach(v =>
            v.classList.toggle('active', v.id === `view-${view}`)
        );
        if (view === 'create') {
            // Initialize preview on first switch
            if (!previewInitialized) {
                initPreview(document.getElementById('preview-container'));
                previewInitialized = true;
            }
            populateSelectors();
        }
    });
});

let previewInitialized = false;

// ══════════════════════════════════════════════════════════════
// BOTTLE LIBRARY
// ══════════════════════════════════════════════════════════════

async function loadBottles() {
    const grid = document.getElementById('bottle-grid');
    grid.innerHTML = '<div class="spinner"></div>';

    try {
        const snapshot = await db.collection('bottles')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();

        bottlesCache = [];
        snapshot.forEach(doc => {
            bottlesCache.push({ id: doc.id, ...doc.data() });
        });

        renderBottleGrid(bottlesCache);
    } catch (err) {
        console.error('Load bottles error:', err);
        grid.innerHTML = '<div class="empty-state">Could not load bottles. Check Firestore rules.</div>';
    }
}

function renderBottleGrid(bottles) {
    const grid = document.getElementById('bottle-grid');

    if (bottles.length === 0) {
        grid.innerHTML = '<div class="empty-state">No bottles yet. Click "+ Add Bottle" to save your first bottle.</div>';
        return;
    }

    grid.innerHTML = bottles.map(b => {
        const isMine = currentUser && b.createdBy === currentUser.uid;
        return `<div class="bottle-card" data-id="${b.id}">
            <div class="card-image">
                ${b.imageUrl
                    ? `<img src="${sanitizeUrl(b.imageUrl)}" alt="${esc(b.name)}" loading="lazy"
                           onerror="this.parentElement.innerHTML='<span class=placeholder>&#x1f9f4;</span>'">`
                    : '<span class="placeholder">&#x1f9f4;</span>'}
            </div>
            <div class="card-body">
                <h4>${esc(b.name)}${isMine ? ' <span class="my-badge">mine</span>' : ''}</h4>
                <div class="card-specs">
                    OD: ${b.od?.toFixed(1) || '?'}mm
                    &middot; Pitch: ${b.pitch?.toFixed(2) || '?'}mm
                    &middot; Starts: ${b.starts || '?'}
                </div>
            </div>
            <div class="card-footer">
                <span>${b.createdAt ? new Date(b.createdAt.seconds * 1000).toLocaleDateString() : ''}</span>
                ${isMine ? '<span style="color:var(--accent);font-size:0.75rem;">Click to edit</span>' : ''}
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.bottle-card').forEach(card => {
        card.addEventListener('click', () => {
            const bottle = bottlesCache.find(b => b.id === card.dataset.id);
            if (!bottle) return;
            const isMine = currentUser && bottle.createdBy === currentUser.uid;
            if (isMine) {
                openBottleModal(bottle);
            }
        });
    });
}

// Library search
document.getElementById('library-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    if (!q) { renderBottleGrid(bottlesCache); return; }
    renderBottleGrid(bottlesCache.filter(b =>
        b.name?.toLowerCase().includes(q)
    ));
});

// ── Add/Edit Bottle Modal ───────────────────────────────────

const bottleModal = document.getElementById('bottle-modal');

document.getElementById('btn-add-bottle').addEventListener('click', () => {
    openBottleModal(null);
});

function openBottleModal(bottle) {
    editingBottleId = bottle ? bottle.id : null;
    document.getElementById('bottle-modal-title').textContent = bottle ? 'Edit Bottle' : 'Add Bottle';
    document.getElementById('bm-delete').style.display = bottle ? 'inline-flex' : 'none';

    document.getElementById('bm-name').value = bottle?.name || '';
    document.getElementById('bm-image').value = bottle?.imageUrl || '';
    document.getElementById('bm-od').value = bottle?.od || '';
    document.getElementById('bm-pitch').value = bottle?.pitch || '';
    document.getElementById('bm-thread-width').value = bottle?.threadWidth || '';
    document.getElementById('bm-valley-width').value = bottle?.valleyWidth || '';
    document.getElementById('bm-starts').value = bottle?.starts || 1;
    document.getElementById('bm-depth').value = bottle?.depth || '';
    document.getElementById('bm-turns').value = bottle?.turns || 2;
    document.getElementById('bm-wall').value = bottle?.wall || 3;
    document.getElementById('bm-pitch-note').style.display = 'none';

    bottleModal.classList.add('open');
}

document.getElementById('bm-cancel').addEventListener('click', () => {
    bottleModal.classList.remove('open');
});

bottleModal.addEventListener('click', (e) => {
    if (e.target === bottleModal) bottleModal.classList.remove('open');
});

// Pitch cross-validation in modal
['bm-pitch', 'bm-thread-width', 'bm-valley-width'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        const p = parseFloat(document.getElementById('bm-pitch').value) || 0;
        const tw = parseFloat(document.getElementById('bm-thread-width').value) || 0;
        const vw = parseFloat(document.getElementById('bm-valley-width').value) || 0;
        const noteEl = document.getElementById('bm-pitch-note');

        if (p > 0 && tw > 0 && vw > 0) {
            const { pitch, warning } = validatePitch(p, tw, vw);
            if (warning) {
                noteEl.textContent = warning;
                noteEl.className = 'pitch-note warn';
            } else {
                noteEl.textContent = `Measurements consistent -- pitch: ${pitch.toFixed(2)} mm`;
                noteEl.className = 'pitch-note ok';
            }
            noteEl.style.display = 'block';
        } else {
            noteEl.style.display = 'none';
        }
    });
});

// Save bottle
document.getElementById('bm-save').addEventListener('click', async () => {
    if (!currentUser) {
        showToast('Not connected. Please refresh.', 'error');
        return;
    }

    const name = document.getElementById('bm-name').value.trim();
    if (!name) { showToast('Please enter a bottle name.', 'error'); return; }

    const od = parseFloat(document.getElementById('bm-od').value) || 0;
    const measuredPitch = parseFloat(document.getElementById('bm-pitch').value) || 0;
    const threadWidth = parseFloat(document.getElementById('bm-thread-width').value) || 0;
    const valleyWidth = parseFloat(document.getElementById('bm-valley-width').value) || 0;
    const depth = parseFloat(document.getElementById('bm-depth').value) || 0;

    if (!od || !measuredPitch || !threadWidth || !depth) {
        showToast('Please fill in at least diameter, pitch, thread width, and depth.', 'error');
        return;
    }

    const { pitch } = validatePitch(measuredPitch, threadWidth, valleyWidth);

    const data = {
        name,
        imageUrl: document.getElementById('bm-image').value.trim(),
        od,
        pitch: pitch > 0 ? pitch : measuredPitch,
        threadWidth,
        valleyWidth,
        starts: parseInt(document.getElementById('bm-starts').value) || 1,
        depth,
        turns: parseFloat(document.getElementById('bm-turns').value) || 2,
        wall: parseFloat(document.getElementById('bm-wall').value) || 3,
    };

    const btn = document.getElementById('bm-save');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        if (editingBottleId) {
            await db.collection('bottles').doc(editingBottleId).update(data);
            showToast('Bottle updated.', 'success');
        } else {
            data.createdBy = currentUser.uid;
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('bottles').add(data);
            showToast('Bottle saved!', 'success');
        }

        bottleModal.classList.remove('open');
        await loadBottles();
    } catch (err) {
        console.error('Save bottle error:', err);
        showToast('Failed to save: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Bottle';
    }
});

// Delete bottle
document.getElementById('bm-delete').addEventListener('click', async () => {
    if (!editingBottleId) return;
    if (!confirm('Delete this bottle? This cannot be undone.')) return;

    try {
        await db.collection('bottles').doc(editingBottleId).delete();
        showToast('Bottle deleted.', 'success');
        bottleModal.classList.remove('open');
        await loadBottles();
    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
    }
});


// ══════════════════════════════════════════════════════════════
// CREATE ADAPTER
// ══════════════════════════════════════════════════════════════

function populateSelectors() {
    const selA = document.getElementById('select-a');
    const selB = document.getElementById('select-b');
    const prevA = selA.value;
    const prevB = selB.value;

    const options = '<option value="">-- Choose a bottle --</option>' +
        bottlesCache.map(b =>
            `<option value="${b.id}">${esc(b.name)} (${b.od?.toFixed(1) || '?'}mm)</option>`
        ).join('');

    selA.innerHTML = options;
    selB.innerHTML = options;

    // Restore previous selections
    if (prevA) selA.value = prevA;
    if (prevB) selB.value = prevB;
}

function getSelectedBottle(selectId) {
    const id = document.getElementById(selectId).value;
    if (!id) return null;
    return bottlesCache.find(b => b.id === id) || null;
}

function showBottleSummary(summaryId, bottle) {
    const el = document.getElementById(summaryId);
    if (!bottle) {
        el.classList.add('hidden');
        return;
    }

    el.classList.remove('hidden');
    el.innerHTML = `
        <div class="summary-image">
            ${bottle.imageUrl
                ? `<img src="${sanitizeUrl(bottle.imageUrl)}" alt="${esc(bottle.name)}"
                       onerror="this.parentElement.innerHTML='<span class=placeholder>&#x1f9f4;</span>'">`
                : '<span class="placeholder">&#x1f9f4;</span>'}
        </div>
        <div>
            <div class="summary-name">${esc(bottle.name)}</div>
            <div class="summary-specs">
                OD: ${bottle.od?.toFixed(1)}mm &middot;
                Pitch: ${bottle.pitch?.toFixed(2)}mm &middot;
                Depth: ${bottle.depth?.toFixed(2)}mm<br>
                Width: ${bottle.threadWidth?.toFixed(2)}mm &middot;
                Starts: ${bottle.starts} &middot;
                Turns: ${bottle.turns}
            </div>
        </div>`;
}

function bottleToFormData(bottle) {
    return {
        label: bottle.name || 'Bottle',
        od: bottle.od || 0,
        pitch: bottle.pitch || 0,
        threadWidth: bottle.threadWidth || 0,
        valleyWidth: bottle.valleyWidth || 0,
        starts: bottle.starts || 1,
        depth: bottle.depth || 0,
        turns: bottle.turns || 2,
        wall: bottle.wall || 3,
    };
}

function onSelectionChange() {
    const bottleA = getSelectedBottle('select-a');
    const bottleB = getSelectedBottle('select-b');

    showBottleSummary('summary-a', bottleA);
    showBottleSummary('summary-b', bottleB);

    const bothSelected = bottleA && bottleB;
    document.getElementById('btn-download').disabled = !bothSelected;
    document.getElementById('btn-save-adapter').disabled = !bothSelected;

    if (bothSelected) {
        refreshPreview();
    }
}

document.getElementById('select-a').addEventListener('change', onSelectionChange);
document.getElementById('select-b').addEventListener('change', onSelectionChange);
document.getElementById('clearance').addEventListener('input', () => {
    if (getSelectedBottle('select-a') && getSelectedBottle('select-b')) refreshPreview();
});
document.getElementById('connector-h').addEventListener('input', () => {
    if (getSelectedBottle('select-a') && getSelectedBottle('select-b')) refreshPreview();
});

// ── Preview ─────────────────────────────────────────────────

let previewDebounce = null;

function refreshPreview() {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(() => {
        const bottleA = getSelectedBottle('select-a');
        const bottleB = getSelectedBottle('select-b');
        if (!bottleA || !bottleB) return;

        const clearance = parseFloat(document.getElementById('clearance').value) || 0.3;
        const connH = parseFloat(document.getElementById('connector-h').value) || 8.0;

        try {
            const info = updatePreview(
                bottleToFormData(bottleA),
                bottleToFormData(bottleB),
                clearance, connH
            );

            document.getElementById('stat-height').textContent = info.total_h.toFixed(1) + ' mm';
            document.getElementById('stat-od').textContent = (info.conn_r * 2).toFixed(1) + ' mm';
            document.getElementById('stat-bore').textContent = (info.flow_r * 2).toFixed(1) + ' mm';
            document.getElementById('stat-cap-a').textContent = info.a_cap_h.toFixed(1) + ' mm';
            document.getElementById('stat-cap-b').textContent = info.b_cap_h.toFixed(1) + ' mm';
        } catch (err) {
            console.error('Preview error:', err);
        }
    }, 200);
}

// ── Download .scad ──────────────────────────────────────────

document.getElementById('btn-download').addEventListener('click', () => {
    const bottleA = getSelectedBottle('select-a');
    const bottleB = getSelectedBottle('select-b');
    if (!bottleA || !bottleB) return;

    const clearance = parseFloat(document.getElementById('clearance').value) || 0.3;
    const connH = parseFloat(document.getElementById('connector-h').value) || 8.0;

    const scadCode = generateScad(
        bottleToFormData(bottleA),
        bottleToFormData(bottleB),
        clearance, connH
    );

    const blob = new Blob([scadCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bottleA.name}_to_${bottleB.name}.scad`.replace(/\s+/g, '_');
    a.click();
    URL.revokeObjectURL(url);

    showToast('OpenSCAD file downloaded. Open in OpenSCAD and press F6 to render.', 'success');
});

// ── Save Adapter ────────────────────────────────────────────

const saveModal = document.getElementById('save-modal');

document.getElementById('btn-save-adapter').addEventListener('click', () => {
    const bottleA = getSelectedBottle('select-a');
    const bottleB = getSelectedBottle('select-b');
    if (!bottleA || !bottleB) return;

    document.getElementById('save-name').value = `${bottleA.name} to ${bottleB.name}`;
    document.getElementById('save-desc').value = '';
    saveModal.classList.add('open');
});

document.getElementById('save-cancel').addEventListener('click', () => {
    saveModal.classList.remove('open');
});

saveModal.addEventListener('click', (e) => {
    if (e.target === saveModal) saveModal.classList.remove('open');
});

document.getElementById('save-confirm').addEventListener('click', async () => {
    if (!currentUser) {
        showToast('Not connected. Please refresh.', 'error');
        return;
    }

    const bottleA = getSelectedBottle('select-a');
    const bottleB = getSelectedBottle('select-b');
    if (!bottleA || !bottleB) return;

    const name = document.getElementById('save-name').value.trim();
    if (!name) { showToast('Please enter a name.', 'error'); return; }

    const btn = document.getElementById('save-confirm');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        await db.collection('designs').add({
            name,
            description: document.getElementById('save-desc').value.trim(),
            bottleAId: bottleA.id,
            bottleBId: bottleB.id,
            bottleAName: bottleA.name,
            bottleBName: bottleB.name,
            clearance: parseFloat(document.getElementById('clearance').value) || 0.3,
            connectorHeight: parseFloat(document.getElementById('connector-h').value) || 8.0,
            createdBy: currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        saveModal.classList.remove('open');
        showToast('Adapter design saved!', 'success');
    } catch (err) {
        showToast('Save failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
});


// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════

function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function sanitizeUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return '';
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
