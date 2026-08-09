/**
 * IoT-Based Autonomous Rangoli Drawing Robot
 * Student B.Tech Project Web Application Script
 * Final Clean Version — No Browser Alerts / Custom Modals / Real WebSocket Heartbeats
 */

let currentRobotMode = 'DEMO'; // 'DEMO' or 'REAL'
let selectedRobotId = null;
let activeOnlineRobots = [];

function setRobotMode(mode) {
    currentRobotMode = mode;
    const btnDemo = document.getElementById('btnModeDemo');
    const btnReal = document.getElementById('btnModeReal');
    const espStatusDot = document.getElementById('espStatusDot');
    const espStatusText = document.getElementById('espStatusText');

    if (mode === 'DEMO') {
        if (btnDemo) btnDemo.classList.add('active');
        if (btnReal) btnReal.classList.remove('active');
        if (espStatusText) espStatusText.textContent = '● DEMO ROBOT (Simulation)';
        if (espStatusDot) espStatusDot.style.backgroundColor = '#F59E0B';
    } else {
        if (btnReal) btnReal.classList.add('active');
        if (btnDemo) btnDemo.classList.remove('active');
        updateRobotConnectionHeaderPill();
    }
}

function updateRobotConnectionHeaderPill() {
    if (currentRobotMode === 'DEMO') return;

    const espStatusDot = document.getElementById('espStatusDot');
    const espStatusText = document.getElementById('espStatusText');

    if (selectedRobotId && activeOnlineRobots.some(r => r.robot_id === selectedRobotId)) {
        if (espStatusText) espStatusText.textContent = `● ${selectedRobotId} Connected`;
        if (espStatusDot) espStatusDot.style.backgroundColor = '#10B981';
    } else if (activeOnlineRobots.length > 0) {
        selectedRobotId = activeOnlineRobots[0].robot_id;
        if (espStatusText) espStatusText.textContent = `● ${selectedRobotId} Connected`;
        if (espStatusDot) espStatusDot.style.backgroundColor = '#10B981';
    } else {
        selectedRobotId = null;
        if (espStatusText) espStatusText.textContent = '● No Robot Connected';
        if (espStatusDot) espStatusDot.style.backgroundColor = '#64748B';
    }
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

    listContainer.innerHTML = '<div style="text-align: center; color: #64748B; padding: 20px;">Searching for connected ESP32 robots...</div>';

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
                                IP: ${r.ip || '192.168.4.1'} | Battery: ${r.battery || 95}% (${r.battery_voltage || 12.2}V)
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
        updateRobotConnectionHeaderPill();
    } catch (e) {
        listContainer.innerHTML = '<div style="color: #EF4444; text-align: center; padding: 15px;">Failed to query backend robot registry.</div>';
    }
}

async function selectRobotTarget(robotId) {
    selectedRobotId = robotId;
    try {
        await fetch(`/api/robots/${robotId}/select`, { method: 'POST' });
    } catch (e) {}
    refreshDiscoveryRobotList();
    updateRobotConnectionHeaderPill();
}

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('simCanvas');
    const ctx = canvas ? canvas.getContext('2d') : null;

    // Telemetry & Status Elements
    const valState = document.getElementById('valState');
    const valPose = document.getElementById('valPose');
    const valHeading = document.getElementById('valHeading');
    const valPowder = document.getElementById('valPowder');
    const txtProgress = document.getElementById('txtProgress');
    const barProgress = document.getElementById('barProgress');
    const valEstTime = document.getElementById('valEstTime');
    const valRemTime = document.getElementById('valRemTime');
    const wsStatusText = document.getElementById('wsStatusText');
    const wsStatusDot = document.getElementById('wsStatusDot');

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
    let executionSegments = [];
    let espCommands = [];
    let animFrame = null;
    let isRunning = false;
    let isPaused = false;

    let robotX = 0.0;
    let robotY = 0.0;
    let robotTheta = 0.0;
    let isPowderOn = false;
    let robotState = 'IDLE';

    let currentSpeedMmPerSec = 80.0;
    let totalPathLengthMm = 0.0;

    // Off-screen canvas for persistent powder trail
    const powderCanvas = document.createElement('canvas');
    powderCanvas.width = 600;
    powderCanvas.height = 600;
    const powderCtx = powderCanvas.getContext('2d');

    function calculateEstimatedTime() {
        if (totalPathLengthMm === 0 || executionSegments.length === 0) {
            if (valEstTime) valEstTime.textContent = "00:00";
            if (valRemTime) valRemTime.textContent = "00:00";
            return;
        }

        let drawDistMm = 0.0;
        let travelDistMm = 0.0;

        executionSegments.forEach(seg => {
            const pts = seg.pts;
            for (let i = 0; i < pts.length - 1; i++) {
                const d = Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
                if (seg.type === 'DRAW' && seg.dispense) {
                    drawDistMm += d;
                } else {
                    travelDistMm += d;
                }
            }
        });

        const totalDistMm = drawDistMm + travelDistMm;
        const totalSec = Math.round(totalDistMm / currentSpeedMmPerSec);

        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        if (valEstTime) valEstTime.textContent = formatted;
        if (valRemTime) valRemTime.textContent = formatted;

        const valDrawDist = document.getElementById('valDrawDist');
        const valTravelDist = document.getElementById('valTravelDist');
        const valTotalDist = document.getElementById('valTotalDist');
        const valPowderUsage = document.getElementById('valPowderUsage');
        const valPathCount = document.getElementById('valPathCount');
        const valTurnCount = document.getElementById('valTurnCount');

        if (valDrawDist) valDrawDist.textContent = `${(drawDistMm / 1000.0).toFixed(2)} m`;
        if (valTravelDist) valTravelDist.textContent = `${(travelDistMm / 1000.0).toFixed(2)} m`;
        if (valTotalDist) valTotalDist.textContent = `${(totalDistMm / 1000.0).toFixed(2)} m`;
        if (valPowderUsage) valPowderUsage.textContent = `${Math.round((drawDistMm / 1000.0) * 12.5)} g`;
        if (valPathCount) valPathCount.textContent = executionSegments.length;
        if (valTurnCount) valTurnCount.textContent = Math.max(0, executionSegments.length * 2);
    }

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

                    totalPathLengthMm = 0.0;
                    executionSegments.forEach(seg => {
                        const pts = seg.pts;
                        for (let i = 0; i < pts.length - 1; i++) {
                            totalPathLengthMm += Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
                        }
                    });

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

    // Drawing Size Selector
    document.querySelectorAll('input[name="sizeOpt"]').forEach(radio => {
        radio.addEventListener('change', () => {
            calculateEstimatedTime();
        });
    });

    // Draw Planned Vector Path Layer
    function drawPlannedPathLayer() {
        if (!ctx || !executionSegments) return;

        executionSegments.forEach(seg => {
            const pts = seg.pts;
            if (pts.length < 2) return;

            ctx.beginPath();
            if (seg.type === 'DRAW' && seg.dispense) {
                ctx.strokeStyle = '#2563EB'; // Solid Blue = Drawing path
                ctx.lineWidth = 2.0;
                ctx.setLineDash([]);
            } else {
                ctx.strokeStyle = '#94A3B8'; // Dashed Gray = Travel path
                ctx.lineWidth = 1.2;
                ctx.setLineDash([4, 4]);
            }

            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i][0], pts[i][1]);
            }
            ctx.stroke();
        });

        ctx.setLineDash([]);
    }

    // Render Canvas Viewport
    function renderViewport() {
        if (!ctx) return;

        ctx.clearRect(0, 0, 600, 600);
        drawPlannedPathLayer();

        // Draw powder trail
        ctx.drawImage(powderCanvas, 0, 0);

        // Update Robot SVG position
        const svgRobot = document.getElementById('robotSvgVisual');
        if (svgRobot) {
            svgRobot.style.transform = `translate(${robotX - 22}px, ${robotY - 24}px) rotate(${robotTheta}deg)`;
        }

        // Update Telemetry readouts
        if (valState) valState.textContent = robotState;
        if (valPose) valPose.textContent = `${robotX.toFixed(1)}, ${robotY.toFixed(1)} mm`;
        const valHeading = document.getElementById('valHeading');
        if (valHeading) valHeading.textContent = `${robotTheta.toFixed(1)}°`;
        if (valPowder) {
            valPowder.textContent = isPowderOn ? 'ON' : 'OFF';
            valPowder.className = isPowderOn ? 'status-badge badge-on' : 'status-badge badge-off';
        }
    }

    // Reset Simulation State
    function resetSimulation() {
        if (animFrame) cancelAnimationFrame(animFrame);
        isRunning = false;
        isPaused = false;
        segIdx = 0;
        ptIdx = 0;
        lerpProgress = 0.0;

        powderCtx.clearRect(0, 0, 600, 600);

        if (executionSegments.length > 0 && executionSegments[0].pts.length > 0) {
            robotX = executionSegments[0].pts[0][0];
            robotY = executionSegments[0].pts[0][1];
        } else {
            robotX = 0;
            robotY = 0;
        }

        robotTheta = 0;
        isPowderOn = false;
        robotState = 'IDLE';

        if (btnStart) btnStart.textContent = '▶ START DRAWING';
        if (btnPause) btnPause.textContent = '⏸ PAUSE';

        if (txtProgress) txtProgress.textContent = '0%';
        const valStatProgress = document.getElementById('valStatProgress');
        if (valStatProgress) valStatProgress.textContent = '0 %';
        if (barProgress) barProgress.style.width = '0%';

        renderViewport();
    }

    // Start Button Interactivity
    if (btnStart) {
        btnStart.addEventListener('click', async () => {
            if (executionSegments.length === 0) {
                // Inline status prompt if no Rangoli loaded
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
                // Send automated motion payload to real ESP32
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
                powderCtx.clearRect(0, 0, 600, 600);
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

    // Emergency Stop Button Interactivity
    if (btnEmergencyStop) {
        btnEmergencyStop.addEventListener('click', async () => {
            if (animFrame) cancelAnimationFrame(animFrame);
            isRunning = false;
            isPaused = false;
            robotState = 'EMERGENCY_STOP';
            isPowderOn = false;

            if (valState) valState.textContent = 'EMERGENCY_STOP';

            try {
                await fetch('/api/jobs/current/emergency-stop', { method: 'POST' });
            } catch (e) {}

            renderViewport();
        });
    }

    // Animation Loop
    let segIdx = 0;
    let ptIdx = 0;
    let lerpProgress = 0.0;

    function animate() {
        if (!isRunning || isPaused) return;

        if (segIdx >= executionSegments.length) {
            isRunning = false;
            robotState = 'COMPLETED';
            isPowderOn = false;
            if (btnStart) btnStart.textContent = '▶ RE-START DRAWING';
            renderViewport();
            return;
        }

        const seg = executionSegments[segIdx];
        const pts = seg.pts;
        isPowderOn = seg.dispense;
        robotState = isPowderOn ? 'DRAWING' : 'MOVING';

        const pct = Math.min(100, Math.round(((segIdx + 1) / executionSegments.length) * 100));
        if (txtProgress) txtProgress.textContent = `${pct}%`;
        const valStatProgress = document.getElementById('valStatProgress');
        if (valStatProgress) valStatProgress.textContent = `${pct} %`;
        if (barProgress) barProgress.style.width = `${pct}%`;

        if (ptIdx < pts.length - 1) {
            const p1 = pts[ptIdx];
            const p2 = pts[ptIdx + 1];

            lerpProgress += 0.15;
            if (lerpProgress >= 1.0) {
                lerpProgress = 0.0;
                ptIdx++;
                robotX = p2[0];
                robotY = p2[1];
            } else {
                robotX = p1[0] + (p2[0] - p1[0]) * lerpProgress;
                robotY = p1[1] + (p2[1] - p1[1]) * lerpProgress;
            }

            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            if (Math.hypot(dx, dy) > 0.1) {
                robotTheta = (Math.atan2(dy, dx) * 180.0) / Math.PI;
            }

            // Render Powder Trail at Nozzle Tip (+60mm offset)
            if (isPowderOn) {
                const rad = (robotTheta * Math.PI) / 180.0;
                const nozX = robotX + 60.0 * Math.cos(rad);
                const nozY = robotY + 60.0 * Math.sin(rad);

                powderCtx.fillStyle = '#10B981'; // Green = Completed drawing
                powderCtx.beginPath();
                powderCtx.arc(nozX, nozY, 3, 0, 2 * Math.PI);
                powderCtx.fill();
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

            const formData = new FormData();
            formData.append('image', fileInput.files[0]);

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

                    totalPathLengthMm = 0.0;
                    executionSegments.forEach(seg => {
                        const pts = seg.pts;
                        for (let i = 0; i < pts.length - 1; i++) {
                            totalPathLengthMm += Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
                        }
                    });

                    calculateEstimatedTime();
                    resetSimulation();
                } else {
                    executionSegments = [];
                    espCommands = [];
                    resetSimulation();
                }
            } catch (err) {
            } finally {
                processBtn.disabled = false;
                processBtn.textContent = 'Process Rangoli Image';
            }
        });
    }

    // Live Backend WebSocket Connection Handler
    function connectDashboardWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        let socket = null;
        try {
            socket = new WebSocket(wsUrl);
        } catch (e) {
            return;
        }

        socket.onopen = () => {
            if (wsStatusText) wsStatusText.textContent = '● Backend Connected';
            if (wsStatusDot) wsStatusDot.style.backgroundColor = '#10B981';
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'robot_connection_update') {
                    activeOnlineRobots = data.robots || [];
                    updateRobotConnectionHeaderPill();
                }
                if (data.telemetry) {
                    const tel = data.telemetry;
                    if (valPose) valPose.textContent = `${tel.x || 0.0}, ${tel.y || 0.0} mm`;
                    const valHeading = document.getElementById('valHeading');
                    if (valHeading) valHeading.textContent = `${tel.heading || 0.0}°`;
                    const valBatteryPct = document.getElementById('valBatteryPct');
                    if (valBatteryPct) valBatteryPct.textContent = `${tel.battery_pct || 95}% (${tel.battery_voltage || 12.2}V)`;
                }
            } catch (err) {}
        };

        socket.onclose = () => {
            if (wsStatusText) wsStatusText.textContent = '● Backend Disconnected';
            if (wsStatusDot) wsStatusDot.style.backgroundColor = '#EF4444';
            setTimeout(connectDashboardWebSocket, 3000);
        };

        socket.onerror = () => {
            if (wsStatusText) wsStatusText.textContent = '● Backend Error';
            if (wsStatusDot) wsStatusDot.style.backgroundColor = '#EF4444';
        };
    }

    // Initiate WebSocket telemetry connection
    connectDashboardWebSocket();

    // Initial Viewport Draw
    renderViewport();
});
