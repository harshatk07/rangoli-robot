/**
 * IoT-Based Autonomous Rangoli Drawing Robot
 * Student B.Tech Project Web Application Script
 * Final Production Version — Authoritative 610 x 610 mm Workspace & Pure State Engine
 */

let currentRobotMode = 'DEMO'; // 'DEMO' or 'REAL'
let selectedRobotId = null;
let activeOnlineRobots = [];
let isBackendConnected = false;

// Central Application State
window.drawingConfig = {
    size: 610,      // 300, 450, 525, 610 mm
    lineWidth: 3    // 2, 3, 4 mm
};

// Single Authoritative Physical (mm) to Canvas (px) Coordinate Transformation
function physicalToCanvas(x_mm, y_mm) {
    const canvasWidth = 600.0;
    const canvasHeight = 600.0;
    const workspaceWidth = 610.0;
    const workspaceHeight = 610.0;

    const cx = (x_mm / workspaceWidth) * canvasWidth;
    const cy = (y_mm / workspaceHeight) * canvasHeight;

    return { x: cx, y: cy };
}

function updateStatusDisplay() {
    const backendStatusText = document.getElementById('backendStatusText') || document.getElementById('wsStatusText');
    const backendStatusDot = document.getElementById('backendStatusDot') || document.getElementById('wsStatusDot');
    const robotStatusText = document.getElementById('robotStatusText') || document.getElementById('espStatusText');
    const robotStatusDot = document.getElementById('robotStatusDot') || document.getElementById('espStatusDot');

    // 1. Backend Status: ONLY Connected when WebSocket / Backend is reachable
    if (isBackendConnected) {
        if (backendStatusText) backendStatusText.textContent = 'Backend: Connected';
        if (backendStatusDot) backendStatusDot.style.backgroundColor = '#10B981';
    } else {
        if (backendStatusText) backendStatusText.textContent = 'Backend: Disconnected';
        if (backendStatusDot) backendStatusDot.style.backgroundColor = '#EF4444';
    }

    // 2. Robot Status: ONLY Connected when an actual physical ESP32 is registered & alive
    const hasOnlineRobot = activeOnlineRobots && activeOnlineRobots.length > 0;
    if (!isBackendConnected) {
        if (robotStatusText) robotStatusText.textContent = 'Robot: Disconnected';
        if (robotStatusDot) robotStatusDot.style.backgroundColor = '#EF4444';
    } else if (hasOnlineRobot) {
        const connectedId = selectedRobotId || activeOnlineRobots[0].robot_id;
        if (robotStatusText) robotStatusText.textContent = `Robot: ${connectedId} Connected`;
        if (robotStatusDot) robotStatusDot.style.backgroundColor = '#10B981';
    } else {
        if (robotStatusText) robotStatusText.textContent = 'Robot: Disconnected';
        if (robotStatusDot) robotStatusDot.style.backgroundColor = '#64748B';
    }
}

function setRobotMode(mode) {
    currentRobotMode = mode;
    const btnDemo = document.getElementById('btnModeDemo');
    const btnReal = document.getElementById('btnModeReal');
    const btnDiscover = document.getElementById('btnDiscoverRobots');
    const pillWsBackend = document.getElementById('pillWsBackend');
    const pillRobotStatus = document.getElementById('pillRobotStatus');

    if (mode === 'DEMO') {
        if (btnDemo) btnDemo.classList.add('active');
        if (btnReal) btnReal.classList.remove('active');
        if (btnDiscover) btnDiscover.style.display = 'none';
        if (pillWsBackend) pillWsBackend.style.display = 'none';
        if (pillRobotStatus) pillRobotStatus.style.display = 'none';
    } else {
        if (btnReal) btnReal.classList.add('active');
        if (btnDemo) btnDemo.classList.remove('active');
        if (btnDiscover) btnDiscover.style.display = 'inline-block';
        if (pillWsBackend) pillWsBackend.style.display = 'flex';
        if (pillRobotStatus) pillRobotStatus.style.display = 'flex';
    }
    updateStatusDisplay();
}

function openRobotDiscoveryModal() {
    const modal = document.getElementById('modalRobotDiscovery');
    if (modal) modal.style.display = 'flex';
    refreshDiscoveryRobotList();
}

function closeRobotDiscoveryModal() {
    const modal = document.getElementById('modalRobotDiscovery');
    if (modal) modal.style.display = 'none';
}

async function refreshDiscoveryRobotList() {
    const listContainer = document.getElementById('discoveryRobotList');
    if (!listContainer) return;

    try {
        const res = await fetch('/api/robots');
        const data = await res.json();
        const robots = data.robots || [];
        activeOnlineRobots = robots;

        if (robots.length === 0) {
            listContainer.innerHTML = `
                <div style="background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 8px; padding: 20px; text-align: center; color: #64748B; font-size: 0.88rem;">
                    No ESP32 robots currently connected.<br>
                    <span style="font-size: 0.78rem; color: #94A3B8;">Connect physical ESP32 to /robot/ws WebSocket endpoint.</span>
                </div>
            `;
        } else {
            let html = '';
            robots.forEach(r => {
                const isSel = r.robot_id === selectedRobotId;
                html += `
                    <div style="background: #F8FAFC; border: 1px solid ${isSel ? '#2563EB' : '#E2E8F0'}; border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 800; color: #0F172A; font-size: 0.95rem;">
                                ${r.robot_id} <span style="color: #10B981; font-size: 0.8rem; font-weight: 700; margin-left: 6px;">● ONLINE</span>
                            </div>
                            <div style="font-size: 0.78rem; color: #64748B; margin-top: 2px;">
                                IP: ${r.ip || '192.168.4.1'} | Battery: ${r.battery !== undefined ? r.battery + '%' : '—'} (${r.battery_voltage !== undefined ? r.battery_voltage + 'V' : '—'})
                            </div>
                            <div style="font-size: 0.78rem; color: #64748B; margin-top: 1px;">
                                State: ${r.state || 'IDLE'} | Last heartbeat: ${r.last_seen_sec || 0.8}s ago
                            </div>
                        </div>
                        <button type="button" class="btn btn-primary" onclick="selectRobotTarget('${r.robot_id}')" style="padding: 6px 12px; font-size: 0.8rem; background: ${isSel ? '#10B981' : '#2563EB'};">
                            ${isSel ? '✓ SELECTED' : 'SELECT ROBOT'}
                        </button>
                    </div>
                `;
            });
            listContainer.innerHTML = html;
        }
        updateStatusDisplay();
    } catch (e) {
        if (listContainer) listContainer.innerHTML = '<div style="color: #EF4444; text-align: center; padding: 15px;">Failed to query backend robot registry.</div>';
        updateStatusDisplay();
    }
}

async function selectRobotTarget(robotId) {
    selectedRobotId = robotId;
    try {
        await fetch(`/api/robots/${robotId}/select`, { method: 'POST' });
    } catch (e) {}
    refreshDiscoveryRobotList();
    updateStatusDisplay();
}

// Global Control Functions for Drawing Size and Line Width
window.updateActiveConfigBadge = function() {
    const badge = document.getElementById('txtActiveConfigBadge');
    if (badge) {
        badge.textContent = `Active Config: Size ${window.drawingConfig.size} × ${window.drawingConfig.size} mm | Width ${window.drawingConfig.lineWidth} mm`;
    }
};

window.setDrawingSize = function(size) {
    let s = parseInt(size) || 610;
    if (![300, 450, 525, 610].includes(s)) s = 610;
    window.drawingConfig.size = s;

    [300, 450, 525, 610].forEach(val => {
        const btn = document.getElementById(`btnSize${val}`);
        if (btn) {
            if (val === s) {
                btn.classList.add('active');
                btn.style.border = '1px solid #2563EB';
                btn.style.background = '#EFF6FF';
                btn.style.color = '#1D4ED8';
            } else {
                btn.classList.remove('active');
                btn.style.border = '1px solid #CBD5E1';
                btn.style.background = '#F8FAFC';
                btn.style.color = '#0F172A';
            }
        }
    });

    const gridBadge = document.querySelector('.hud-badge');
    if (gridBadge) {
        gridBadge.textContent = `610 × 610 mm (${s} × ${s} mm)`;
    }

    window.updateActiveConfigBadge();
    if (window.recalculateDrawing) window.recalculateDrawing();
};

window.setLineWidth = function(width) {
    let w = parseInt(width) || 3;
    if (![2, 3, 4].includes(w)) w = 3;
    window.drawingConfig.lineWidth = w;

    [2, 3, 4].forEach(val => {
        const btn = document.getElementById(`btnWidth${val}`);
        if (btn) {
            if (val === w) {
                btn.classList.add('active');
                btn.style.border = '1px solid #2563EB';
                btn.style.background = '#EFF6FF';
                btn.style.color = '#1D4ED8';
            } else {
                btn.classList.remove('active');
                btn.style.border = '1px solid #CBD5E1';
                btn.style.background = '#F8FAFC';
                btn.style.color = '#0F172A';
            }
        }
    });

    window.updateActiveConfigBadge();
    if (window.recalculateDrawing) window.recalculateDrawing();
};

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('simCanvas');
    const ctx = canvas ? canvas.getContext('2d') : null;

    // Telemetry & Status Elements
    const valState = document.getElementById('valState');
    const valPose = document.getElementById('valPose');
    const valHeading = document.getElementById('valHeading');
    const valSpeed = document.getElementById('valSpeed');
    const valPowder = document.getElementById('valPowder');
    const valBatteryPct = document.getElementById('valBatteryPct');
    const txtProgress = document.getElementById('txtProgress');
    const barProgress = document.getElementById('barProgress');
    const valEstTime = document.getElementById('valEstTime');
    const valRemTime = document.getElementById('valRemTime');

    // Controls Buttons
    const btnStart = document.getElementById('btnStartDrawing');
    const btnPause = document.getElementById('btnPause');
    const btnResume = document.getElementById('btnResume');
    const btnStop = document.getElementById('btnStop');
    const btnEmergencyStop = document.getElementById('btnEmergencyStop');

    // Upload & Form Controls
    const uploadForm = document.getElementById('uploadForm');
    const dropzone = document.getElementById('dropzone');
    const imageInput = document.getElementById('imageInput');
    const btnLoadUrl = document.getElementById('btnLoadUrl');
    const imageUrlInput = document.getElementById('imageUrlInput');

    // System State Variables
    let rawContoursData = []; // Raw unscaled polylines from image processing
    let executionSegments = [];
    let espCommands = [];
    let animFrame = null;
    let isRunning = false;
    let isPaused = false;

    // Robot HOME coordinate = TOP-LEFT corner (0.0, 0.0) mm inside 610x610 mm physical workspace
    let robotX = 0.0; 
    let robotY = 0.0; 
    let robotTheta = 0.0; // deg
    let isPowderOn = false;
    let robotState = 'IDLE';

    let currentSpeedMmPerSec = 80.0; // Draw speed: 80 mm/s
    let currentTravelSpeedMmPerSec = 150.0; // Travel speed: 150 mm/s
    let totalPathLengthMm = 0.0;
    let totalDrawDistMm = 0.0;
    let totalTravelDistMm = 0.0;
    let totalEstimatedSec = 0;
    let executedDistMm = 0.0;

    let segIdx = 0;
    let ptIdx = 0;
    let lerpProgress = 0.0;

    // Helper: Rescales raw contours to selected size (300, 450, 525, 610 mm) centered in 610x610 mm workspace
    function buildScaledExecutionSegments(contours, targetSizeMm) {
        if (!contours || contours.length === 0) return [];

        // 1. Gather all points to compute original bounding box
        let allPts = [];
        contours.forEach(c => {
            if (Array.isArray(c)) {
                c.forEach(pt => {
                    if (Array.isArray(pt) && pt.length >= 2) {
                        allPts.push(pt);
                    }
                });
            }
        });

        if (allPts.length === 0) return [];

        let minX = Math.min(...allPts.map(p => p[0]));
        let maxX = Math.max(...allPts.map(p => p[0]));
        let minY = Math.min(...allPts.map(p => p[1]));
        let maxY = Math.max(...allPts.map(p => p[1]));

        let wPx = Math.max(1.0, maxX - minX);
        let hPx = Math.max(1.0, maxY - minY);

        // 2. Safety margin of 20 mm from workspace boundary
        const marginMm = 20.0;
        const availableSizeMm = Math.max(50.0, targetSizeMm - (2.0 * marginMm));

        const scale = Math.min(availableSizeMm / wPx, availableSizeMm / hPx);

        // Center inside 610x610 mm physical workspace at (305, 305) mm
        const offsetX = 305.0 - (wPx * scale) / 2.0;
        const offsetY = 305.0 - (hPx * scale) / 2.0;

        // 3. Build scaled polylines
        let scaledContours = contours.map(c => {
            return c.map(pt => [
                Math.round((offsetX + (pt[0] - minX) * scale) * 10.0) / 10.0,
                Math.round((offsetY + (pt[1] - minY) * scale) * 10.0) / 10.0
            ]);
        });

        // 4. Build execution segments with Nearest-Neighbor ordering & Initial HOME travel path from (0,0)
        let segments = [];
        let currPos = [0.0, 0.0]; // Startup & Reset HOME position (0,0) mm

        let unvisited = [...scaledContours];

        while (unvisited.length > 0) {
            let bestIdx = 0;
            let bestDist = Infinity;
            let bestReverse = false;

            for (let i = 0; i < unvisited.length; i++) {
                const path = unvisited[i];
                const dStart = Math.hypot(path[0][0] - currPos[0], path[0][1] - currPos[1]);
                const dEnd = Math.hypot(path[path.length - 1][0] - currPos[0], path[path.length - 1][1] - currPos[1]);

                if (dStart < bestDist) {
                    bestDist = dStart;
                    bestIdx = i;
                    bestReverse = false;
                }
                if (dEnd < bestDist) {
                    bestDist = dEnd;
                    bestIdx = i;
                    bestReverse = true;
                }
            }

            let nextPath = unvisited.splice(bestIdx, 1)[0];
            if (bestReverse) nextPath.reverse();

            const startPt = nextPath[0];
            const endPt = nextPath[nextPath.length - 1];

            // Travel path MOVE segment from currPos to startPt
            const travelDist = Math.hypot(startPt[0] - currPos[0], startPt[1] - currPos[1]);
            if (travelDist > 0.5 || segments.length === 0) {
                segments.push({
                    type: 'MOVE',
                    dispense: false,
                    pts: [[currPos[0], currPos[1]], [startPt[0], startPt[1]]]
                });
            }

            // Drawing path DRAW segment
            segments.push({
                type: 'DRAW',
                dispense: true,
                pts: nextPath
            });

            currPos = [endPt[0], endPt[1]];
        }

        return segments;
    }

    function calculateEstimatedTime() {
        const valDrawDist = document.getElementById('valDrawDist');
        const valTravelDist = document.getElementById('valTravelDist');
        const valTotalDist = document.getElementById('valTotalDist');
        const valPowderUsage = document.getElementById('valPowderUsage');
        const valPathCount = document.getElementById('valPathCount');
        const valTurnCount = document.getElementById('valTurnCount');

        if (!executionSegments || executionSegments.length === 0) {
            if (valEstTime) valEstTime.textContent = "—";
            if (valRemTime) valRemTime.textContent = "—";
            if (valDrawDist) valDrawDist.textContent = "—";
            if (valTravelDist) valTravelDist.textContent = "—";
            if (valTotalDist) valTotalDist.textContent = "—";
            if (valPowderUsage) valPowderUsage.textContent = "—";
            if (valPathCount) valPathCount.textContent = "—";
            if (valTurnCount) valTurnCount.textContent = "—";
            return;
        }

        totalDrawDistMm = 0.0;
        totalTravelDistMm = 0.0;
        let drawSegCount = 0;
        let turnCount = 0;

        executionSegments.forEach(seg => {
            const pts = seg.pts;
            if (seg.type === 'DRAW' && seg.dispense) drawSegCount++;
            if (pts.length > 2) turnCount += (pts.length - 2);

            for (let i = 0; i < pts.length - 1; i++) {
                const d = Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
                if (seg.type === 'DRAW' && seg.dispense) {
                    totalDrawDistMm += d;
                } else {
                    totalTravelDistMm += d;
                }
            }
        });

        totalPathLengthMm = totalDrawDistMm + totalTravelDistMm;

        const drawSec = totalDrawDistMm / currentSpeedMmPerSec;
        const travelSec = totalTravelDistMm / currentTravelSpeedMmPerSec;
        totalEstimatedSec = Math.round(drawSec + travelSec);

        const mins = Math.floor(totalEstimatedSec / 60);
        const secs = totalEstimatedSec % 60;
        const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        if (valEstTime) valEstTime.textContent = formatted;
        if (valRemTime) valRemTime.textContent = formatted;

        const powderGrams = Math.round((totalDrawDistMm / 1000.0) * window.drawingConfig.lineWidth * 4.17); // Estimated powder usage: 4.17g per (m * mm_width)

        if (valDrawDist) valDrawDist.textContent = `${(totalDrawDistMm / 1000.0).toFixed(2)} m`;
        if (valTravelDist) valTravelDist.textContent = `${(totalTravelDistMm / 1000.0).toFixed(2)} m`;
        if (valTotalDist) valTotalDist.textContent = `${(totalPathLengthMm / 1000.0).toFixed(2)} m`;
        if (valPowderUsage) valPowderUsage.textContent = `${powderGrams} g`;
        if (valPathCount) valPathCount.textContent = drawSegCount;
        if (valTurnCount) valTurnCount.textContent = turnCount;
    }

    window.recalculateDrawing = function() {
        if (rawContoursData && rawContoursData.length > 0) {
            executionSegments = buildScaledExecutionSegments(rawContoursData, window.drawingConfig.size);
        }
        calculateEstimatedTime();
        resetSimulation();
    };

    // Dropzone Interactivity
    if (dropzone && imageInput) {
        dropzone.addEventListener('click', () => imageInput.click());

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#2563EB';
            dropzone.style.background = '#EFF6FF';
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = '#CBD5E1';
            dropzone.style.background = '#F8FAFC';
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#CBD5E1';
            dropzone.style.background = '#F8FAFC';

            if (e.dataTransfer.files.length > 0) {
                imageInput.files = e.dataTransfer.files;
                const textEl = dropzone.querySelector('.dropzone-text strong');
                if (textEl) textEl.textContent = `Selected: ${e.dataTransfer.files[0].name}`;
            }
        });

        imageInput.addEventListener('change', () => {
            if (imageInput.files.length > 0) {
                const textEl = dropzone.querySelector('.dropzone-text strong');
                if (textEl) textEl.textContent = `Selected: ${imageInput.files[0].name}`;
            }
        });
    }

    // Import Image URL Interactivity
    if (btnLoadUrl && imageUrlInput) {
        btnLoadUrl.addEventListener('click', async () => {
            const url = imageUrlInput.value.trim();
            if (!url) return;

            btnLoadUrl.disabled = true;
            btnLoadUrl.textContent = 'Importing...';

            try {
                const res = await fetch('/api/import-url', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ url: url })
                });
                const data = await res.json();

                if (data.status === 'success') {
                    executionSegments = data.execution_segments;
                    espCommands = data.esp32_commands;

                    // Extract raw draw contours for local size scaling
                    rawContoursData = executionSegments
                        .filter(s => s.type === 'DRAW')
                        .map(s => s.pts);

                    calculateEstimatedTime();
                    resetSimulation();
                }
            } catch (err) {
            } finally {
                btnLoadUrl.disabled = false;
                btnLoadUrl.textContent = 'Import';
            }
        });
    }

    // Draw Planned Vector Path Layer & Executed Completed Path
    function drawPlannedPathLayer() {
        if (!ctx || !executionSegments || executionSegments.length === 0) return;

        // 1. Render Path Preview Layer (Solid Blue for DRAW, Dashed Gray for TRAVEL)
        executionSegments.forEach(seg => {
            const pts = seg.pts;
            if (pts.length < 2) return;

            ctx.beginPath();
            if (seg.type === 'DRAW' && seg.dispense) {
                ctx.strokeStyle = '#2563EB'; // Solid Blue = Drawing path preview
                ctx.lineWidth = 2.0;
                ctx.setLineDash([]);
            } else {
                ctx.strokeStyle = '#94A3B8'; // Dashed Gray = Travel path preview
                ctx.lineWidth = 1.2;
                ctx.setLineDash([4, 4]);
            }

            const p0 = physicalToCanvas(pts[0][0], pts[0][1]);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < pts.length; i++) {
                const p = physicalToCanvas(pts[i][0], pts[i][1]);
                ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        });

        ctx.setLineDash([]);

        // 2. Render Executed Completed Drawing Layer (Solid Emerald Green #10B981) Behind Robot
        if (segIdx > 0 || ptIdx > 0 || lerpProgress > 0 || robotState === 'COMPLETED') {
            ctx.strokeStyle = '#10B981'; // Emerald Green = Completed Rangoli drawing
            ctx.lineWidth = Math.max(2.5, window.drawingConfig.lineWidth);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            for (let s = 0; s < executionSegments.length; s++) {
                if (s > segIdx && robotState !== 'COMPLETED') break;

                const seg = executionSegments[s];
                if (seg.type !== 'DRAW' || !seg.dispense) continue; // Green line traces ONLY active DRAW strokes!

                const pts = seg.pts;
                if (pts.length < 2) continue;

                ctx.beginPath();
                const p0 = physicalToCanvas(pts[0][0], pts[0][1]);
                ctx.moveTo(p0.x, p0.y);

                if (s < segIdx || robotState === 'COMPLETED') {
                    for (let i = 1; i < pts.length; i++) {
                        const p = physicalToCanvas(pts[i][0], pts[i][1]);
                        ctx.lineTo(p.x, p.y);
                    }
                } else if (s === segIdx) {
                    for (let i = 1; i <= ptIdx; i++) {
                        const p = physicalToCanvas(pts[i][0], pts[i][1]);
                        ctx.lineTo(p.x, p.y);
                    }
                    if (ptIdx < pts.length - 1) {
                        const currPx = physicalToCanvas(robotX, robotY);
                        ctx.lineTo(currPx.x, currPx.y);
                    }
                }
                ctx.stroke();
            }
        }

        // Render Start Point (Green) & End Point (Red) Markers on DRAW path via physicalToCanvas
        const firstDrawSeg = executionSegments.find(s => s.type === 'DRAW') || executionSegments[0];
        const lastDrawSeg = [...executionSegments].reverse().find(s => s.type === 'DRAW') || executionSegments[executionSegments.length - 1];

        if (firstDrawSeg && firstDrawSeg.pts.length > 0) {
            const startPtMm = firstDrawSeg.pts[0];
            const startPx = physicalToCanvas(startPtMm[0], startPtMm[1]);
            ctx.fillStyle = '#10B981';
            ctx.beginPath();
            ctx.arc(startPx.x, startPx.y, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        if (lastDrawSeg && lastDrawSeg.pts.length > 0) {
            const endPtMm = lastDrawSeg.pts[lastDrawSeg.pts.length - 1];
            const endPx = physicalToCanvas(endPtMm[0], endPtMm[1]);
            ctx.fillStyle = '#EF4444';
            ctx.beginPath();
            ctx.arc(endPx.x, endPx.y, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    // Render Plain White Canvas Background (No Grid Lines)
    function drawCanvasLightGrid() {
        if (!ctx) return;

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 600, 600);

        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(0, 0, 600, 600);
    }

    // Render Canvas Viewport & Exact Robot Placement via physicalToCanvas
    function renderViewport() {
        if (!ctx) return;

        drawCanvasLightGrid();
        drawPlannedPathLayer();

        const canvasRobotPt = physicalToCanvas(robotX, robotY);

        // Render Active Dispensing Nozzle Indicator ONLY while active DRAWING!
        if (isPowderOn && robotState === 'DRAWING') {
            const rad = (robotTheta * Math.PI) / 180.0;
            const nozMmX = robotX + 60.0 * Math.cos(rad);
            const nozMmY = robotY + 60.0 * Math.sin(rad);
            const nozPx = physicalToCanvas(nozMmX, nozMmY);

            ctx.fillStyle = '#10B981';
            ctx.beginPath();
            ctx.arc(nozPx.x, nozPx.y, 4, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }

        // Update Robot SVG position EXACTLY on top of canvasRobotPt (Clamped inside viewport bounds)
        const svgRobot = document.getElementById('robotSvgVisual');
        if (svgRobot) {
            const clampedPxX = Math.max(22, Math.min(578, canvasRobotPt.x));
            const clampedPxY = Math.max(22, Math.min(578, canvasRobotPt.y));
            svgRobot.style.left = '0px';
            svgRobot.style.top = '0px';
            svgRobot.style.transform = `translate(${clampedPxX - 22}px, ${clampedPxY - 22}px) rotate(${robotTheta}deg)`;
        }

        // Strict Telemetry Isolation for REAL vs DEMO mode
        if (currentRobotMode === 'REAL') {
            const isRobotConnected = selectedRobotId && activeOnlineRobots.some(r => r.robot_id === selectedRobotId);
            if (!isRobotConnected) {
                if (valState) valState.textContent = 'OFFLINE';
                if (valPose) valPose.textContent = '—';
                if (valHeading) valHeading.textContent = '—';
                if (valSpeed) valSpeed.textContent = '—';
                if (valPowder) {
                    valPowder.textContent = 'OFF';
                    valPowder.className = 'status-badge badge-off';
                }
                if (valBatteryPct) valBatteryPct.textContent = '—';
            }
        } else {
            // DEMO mode simulated telemetry
            if (valState) valState.textContent = robotState;
            if (valPose) valPose.textContent = `${robotX.toFixed(1)}, ${robotY.toFixed(1)} mm (SIM)`;
            if (valHeading) valHeading.textContent = `${robotTheta.toFixed(1)}°`;
            if (valSpeed) valSpeed.textContent = `${currentSpeedMmPerSec.toFixed(1)} mm/s`;
            if (valPowder) {
                valPowder.textContent = isPowderOn ? 'ON' : 'OFF';
                valPowder.className = isPowderOn ? 'status-badge badge-on' : 'status-badge badge-off';
            }
            if (valBatteryPct) valBatteryPct.textContent = '95% (SIM)';
        }
    }

    // Reset Simulation State (Robot marker stays at HOME (0.0, 0.0) mm Top-Left before execution)
    function resetSimulation() {
        if (animFrame) cancelAnimationFrame(animFrame);
        isRunning = false;
        isPaused = false;
        segIdx = 0;
        ptIdx = 0;
        lerpProgress = 0.0;
        executedDistMm = 0.0;

        // Robot marker is at HOME (0.0, 0.0) mm Top-Left corner
        robotX = 0.0;
        robotY = 0.0;
        robotTheta = 0.0;
        isPowderOn = false;
        robotState = 'IDLE';

        if (btnStart) btnStart.textContent = '▶ START DRAWING';
        if (btnPause) btnPause.textContent = '⏸ PAUSE';

        if (txtProgress) txtProgress.textContent = '0%';
        const valStatProgress = document.getElementById('valStatProgress');
        if (valStatProgress) valStatProgress.textContent = '0 %';
        if (barProgress) barProgress.style.width = '0%';

        if (valEstTime && valRemTime && valEstTime.textContent !== '—') {
            valRemTime.textContent = valEstTime.textContent;
        }

        renderViewport();
    }

    // Start Button Interactivity
    if (btnStart) {
        btnStart.addEventListener('click', async () => {
            if (!executionSegments || executionSegments.length === 0) {
                btnStart.textContent = '⚠️ Upload Rangoli First';
                setTimeout(() => { btnStart.textContent = '▶ START DRAWING'; }, 2000);
                return;
            }

            if (currentRobotMode === 'REAL') {
                if (!selectedRobotId || !activeOnlineRobots.some(r => r.robot_id === selectedRobotId)) {
                    btnStart.textContent = '⚠️ Connect an ESP32 robot before starting';
                    setTimeout(() => { btnStart.textContent = '▶ START DRAWING'; }, 3000);
                    return;
                }
                try {
                    await fetch('/api/jobs', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            robot_id: selectedRobotId,
                            commands: espCommands
                        })
                    });
                } catch (e) {}
            }

            if (segIdx >= executionSegments.length || robotState === 'COMPLETED') {
                segIdx = 0;
                ptIdx = 0;
                lerpProgress = 0.0;
                executedDistMm = 0.0;
                robotX = 0.0;
                robotY = 0.0;
            }

            isRunning = true;
            isPaused = false;
            robotState = 'DRAWING';
            btnStart.textContent = 'DRAWING IN PROGRESS...';

            animate();
        });
    }

    // Pause Button Interactivity
    if (btnPause) {
        btnPause.addEventListener('click', () => {
            if (!isRunning) return;
            isPaused = !isPaused;
            btnPause.textContent = isPaused ? '▶ RESUME' : '⏸ PAUSE';
            robotState = isPaused ? 'PAUSED' : 'DRAWING';
            if (isPaused) isPowderOn = false;
            if (!isPaused) animate();
        });
    }

    // Resume Button Interactivity
    if (btnResume) {
        btnResume.addEventListener('click', () => {
            if (isPaused) {
                isPaused = false;
                if (btnPause) btnPause.textContent = '⏸ PAUSE';
                robotState = 'DRAWING';
                animate();
            }
        });
    }

    // Stop Button Interactivity
    if (btnStop) {
        btnStop.addEventListener('click', () => {
            resetSimulation();
        });
    }

    // Reset Button Interactivity
    const btnReset = document.getElementById('btnReset');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            resetSimulation();
        });
    }

    // Emergency Stop Button Interactivity
    if (btnEmergencyStop) {
        btnEmergencyStop.addEventListener('click', async () => {
            if (animFrame) cancelAnimationFrame(animFrame);
            isRunning = false;
            isPaused = false;
            robotState = 'EMERGENCY_STOP';
            isPowderOn = false;

            if (valState) valState.textContent = 'EMERGENCY_STOP';

            const isRobotConnected = selectedRobotId && activeOnlineRobots.some(r => r.robot_id === selectedRobotId);
            if (currentRobotMode === 'REAL' && !isRobotConnected) {
                btnEmergencyStop.textContent = '🛑 E-STOP (ESP32 Not Connected)';
                setTimeout(() => { btnEmergencyStop.textContent = '🛑 EMERGENCY STOP'; }, 3000);
            }

            try {
                await fetch('/api/jobs/current/emergency-stop', { method: 'POST' });
            } catch (e) {}

            renderViewport();
        });
    }

    // Animation Loop
    function animate() {
        if (!isRunning || isPaused) return;

        if (segIdx >= executionSegments.length) {
            isRunning = false;
            robotState = 'COMPLETED';
            isPowderOn = false;
            if (btnStart) btnStart.textContent = '▶ RE-START DRAWING';

            if (txtProgress) txtProgress.textContent = '100%';
            const valStatProgress = document.getElementById('valStatProgress');
            if (valStatProgress) valStatProgress.textContent = '100 %';
            if (barProgress) barProgress.style.width = '100%';
            if (valRemTime) valRemTime.textContent = '00:00';

            renderViewport();
            return;
        }

        const seg = executionSegments[segIdx];
        const pts = seg.pts;

        // Powder is ON ONLY during DRAW strokes!
        isPowderOn = (seg.type === 'DRAW' && seg.dispense === true);
        robotState = isPowderOn ? 'DRAWING' : 'MOVING';

        // Calculate Executed Path Progress & Remaining Time
        const pct = Math.min(100, Math.round((executedDistMm / Math.max(1.0, totalPathLengthMm)) * 100));
        if (txtProgress) txtProgress.textContent = `${pct}%`;
        const valStatProgress = document.getElementById('valStatProgress');
        if (valStatProgress) valStatProgress.textContent = `${pct} %`;
        if (barProgress) barProgress.style.width = `${pct}%`;

        if (totalEstimatedSec > 0) {
            const remSec = Math.max(0, Math.round(totalEstimatedSec * (1.0 - (executedDistMm / Math.max(1.0, totalPathLengthMm)))));
            const rMins = Math.floor(remSec / 60);
            const rSecs = remSec % 60;
            if (valRemTime) valRemTime.textContent = `${String(rMins).padStart(2, '0')}:${String(rSecs).padStart(2, '0')}`;
        }

        if (ptIdx < pts.length - 1) {
            const p1 = pts[ptIdx];
            const p2 = pts[ptIdx + 1];

            lerpProgress += 0.15;
            let stepDist = 0.0;

            if (lerpProgress >= 1.0) {
                stepDist = Math.hypot(p2[0] - robotX, p2[1] - robotY);
                lerpProgress = 0.0;
                ptIdx++;
                robotX = p2[0];
                robotY = p2[1];
            } else {
                const nextX = p1[0] + (p2[0] - p1[0]) * lerpProgress;
                const nextY = p1[1] + (p2[1] - p1[1]) * lerpProgress;
                stepDist = Math.hypot(nextX - robotX, nextY - robotY);
                robotX = nextX;
                robotY = nextY;
            }

            executedDistMm += stepDist;

            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            if (Math.hypot(dx, dy) > 0.1) {
                robotTheta = (Math.atan2(dy, dx) * 180.0) / Math.PI;
            }

            renderViewport();
            animFrame = requestAnimationFrame(animate);
        } else {
            segIdx++;
            ptIdx = 0;
            lerpProgress = 0.0;
            animFrame = requestAnimationFrame(animate);
        }
    }

    // Process Image Form Handler
    if (uploadForm) {
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fileInput = document.getElementById('imageInput');
            const processBtn = document.getElementById('processBtn');

            if (!fileInput.files || !fileInput.files[0]) return;

            const sizeStr = window.drawingConfig.size === 300 ? 'small' : (window.drawingConfig.size === 450 ? 'medium' : (window.drawingConfig.size === 525 ? 'large' : 'full'));

            const formData = new FormData();
            formData.append('image', fileInput.files[0]);
            formData.append('drawing_size', sizeStr);

            processBtn.disabled = true;
            processBtn.textContent = 'Processing Image...';

            try {
                const res = await fetch('/api/process', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();

                if (data.status === 'success') {
                    executionSegments = data.execution_segments;
                    espCommands = data.esp32_commands;

                    // Extract raw draw contours for instant client-side size scaling
                    rawContoursData = executionSegments
                        .filter(s => s.type === 'DRAW')
                        .map(s => s.pts);

                    calculateEstimatedTime();
                    resetSimulation();
                } else {
                    rawContoursData = [];
                    executionSegments = [];
                    espCommands = [];
                    resetSimulation();
                }
            } catch (err) {
            } finally {
                processBtn.disabled = false;
                processBtn.textContent = 'PROCESS RANGOLI DESIGN';
            }
        });
    }

    // Live Backend & Robot WebSocket Connection Handler
    function connectDashboardWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        let socket = null;
        try {
            socket = new WebSocket(wsUrl);
        } catch (e) {
            isBackendConnected = false;
            updateStatusDisplay();
            return;
        }

        socket.onopen = () => {
            isBackendConnected = true;
            updateStatusDisplay();
            refreshDiscoveryRobotList();
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'robot_connection_update') {
                    activeOnlineRobots = data.robots || [];
                    updateStatusDisplay();
                    renderViewport();
                }
                if (data.telemetry && currentRobotMode === 'REAL') {
                    const tel = data.telemetry;
                    if (valPose) valPose.textContent = (tel.x !== undefined && tel.x !== null) ? `${tel.x}, ${tel.y} mm` : '—';
                    if (valHeading) valHeading.textContent = (tel.heading !== undefined && tel.heading !== null) ? `${tel.heading}°` : '—';
                    if (valSpeed) valSpeed.textContent = (tel.speed !== undefined && tel.speed !== null) ? `${tel.speed} mm/s` : '—';
                    if (valBatteryPct) valBatteryPct.textContent = (tel.battery_pct !== undefined && tel.battery_pct !== null) ? `${tel.battery_pct}% (${tel.battery_voltage || ''}V)` : '—';
                    if (valPowder) {
                        valPowder.textContent = tel.powder_active ? 'ON' : 'OFF';
                        valPowder.className = tel.powder_active ? 'status-badge badge-on' : 'status-badge badge-off';
                    }
                    if (valState) valState.textContent = tel.state || 'OFFLINE';
                }
            } catch (err) {}
        };

        socket.onclose = () => {
            isBackendConnected = false;
            updateStatusDisplay();
            setTimeout(connectDashboardWebSocket, 3000);
        };

        socket.onerror = () => {
            isBackendConnected = false;
            updateStatusDisplay();
        };
    }

    // Initiate WebSocket connection & status display
    setRobotMode('DEMO');
    connectDashboardWebSocket();
    window.updateActiveConfigBadge();

    // Initial Viewport Draw & Calculations
    calculateEstimatedTime();
    resetSimulation();
});
