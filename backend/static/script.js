/**
 * IoT-Based Autonomous Rangoli Drawing Robot
 * Student B.Tech Project Web Application Script
 */

let currentRobotMode = 'DEMO'; // Default DEMO mode

function setRobotMode(mode) {
    currentRobotMode = mode;
    const btnDemo = document.getElementById('btnModeDemo');
    const btnReal = document.getElementById('btnModeReal');
    const espStatusDot = document.getElementById('espStatusDot');
    const espStatusText = document.getElementById('espStatusText');

    if (mode === 'DEMO') {
        if (btnDemo) btnDemo.classList.add('active');
        if (btnReal) btnReal.classList.remove('active');
        if (espStatusText) espStatusText.textContent = '🟡 DEMO ROBOT (Simulation)';
        if (espStatusDot) espStatusDot.style.backgroundColor = '#F59E0B';
    } else {
        if (btnReal) btnReal.classList.add('active');
        if (btnDemo) btnDemo.classList.remove('active');
        if (espStatusText) espStatusText.textContent = '🟢 REAL ROBOT (WSS Active)';
        if (espStatusDot) espStatusDot.style.backgroundColor = '#10B981';
    }
}

function openRobotDiscoveryModal() {
    alert("🔍 Searching for ESP32 Cloud Robots...\n\nStatus: Backend WSS Listener Active on /robot/ws\nRegistered Robots: BOT-01 (Online)");
}

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('simCanvas');
    const ctx = canvas ? canvas.getContext('2d') : null;

    // UI Elements
    const valState = document.getElementById('valState');
    const valGrid = document.getElementById('valGrid');
    const valPose = document.getElementById('valPose');
    const valPowder = document.getElementById('valPowder');
    const txtProgress = document.getElementById('txtProgress');
    const barProgress = document.getElementById('barProgress');
    const valEstTime = document.getElementById('valEstTime');
    const valTimeDetail = document.getElementById('valTimeDetail');
    const espStatusText = document.getElementById('espStatusText');
    const espStatusDot = document.getElementById('espStatusDot');

    // Buttons & Inputs
    const btnDemo = document.getElementById('btnDemo');
    const btnStart = document.getElementById('btnStartDrawing') || document.getElementById('btnStart');
    const btnPause = document.getElementById('btnPause');
    const btnResume = document.getElementById('btnResume');
    const btnStop = document.getElementById('btnStop');
    const btnReset = document.getElementById('btnReset');
    const btnEmergencyStop = document.getElementById('btnEmergencyStop');
    const btnSendWifi = document.getElementById('btnSendWifi');
    const uploadForm = document.getElementById('uploadForm');
    const dropzone = document.getElementById('dropzone');
    const imageInput = document.getElementById('imageInput');
    const btnLoadUrl = document.getElementById('btnLoadUrl');
    const imageUrlInput = document.getElementById('imageUrlInput');

    // State Variables
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

    let currentSpeedMmPerSec = 80.0; // Default Medium
    let totalPathLengthMm = 0.0;
    let totalTurns = 0;
    let totalActuations = 0;

    // Off-screen canvas for persistent powder trail
    const powderCanvas = document.createElement('canvas');
    powderCanvas.width = 600;
    powderCanvas.height = 600;
    const powderCtx = powderCanvas.getContext('2d');

    function getGridCellName(x, y) {
        const r = Math.min(7, Math.max(0, Math.floor(y / 75.0)));
        const c = Math.min(7, Math.max(0, Math.floor(x / 75.0)));
        return `${String.fromCharCode(65 + r)}${c + 1}`;
    }

    // Calculate Estimated Completion Time dynamically
    function calculateEstimatedTime() {
        if (totalPathLengthMm === 0) {
            if (valEstTime) valEstTime.textContent = "00:00";
            if (valTimeDetail) valTimeDetail.textContent = "Path: 0.0 m | Delays: 0.0s";
            return;
        }

        const travelTimeSec = totalPathLengthMm / currentSpeedMmPerSec;
        const turnDelaySec = totalTurns * 0.8;
        const dispenserDelaySec = totalActuations * 0.06;
        const totalSec = Math.round(travelTimeSec + turnDelaySec + dispenserDelaySec);

        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        if (valEstTime) valEstTime.textContent = formatted;

        const valDrawDist = document.getElementById('valDrawDist');
        const valTravelDist = document.getElementById('valTravelDist');
        const valPowderUsage = document.getElementById('valPowderUsage');
        const valPathCount = document.getElementById('valPathCount');
        const valTurnCount = document.getElementById('valTurnCount');

        const drawDistM = (totalPathLengthMm / 1000.0).toFixed(1);
        const travelDistM = (totalPathLengthMm * 0.15 / 1000.0).toFixed(1);
        const powderG = Math.round((totalPathLengthMm / 1000.0) * 12.5);

        if (valDrawDist) valDrawDist.textContent = `${drawDistM} m`;
        if (valTravelDist) valTravelDist.textContent = `${travelDistM} m`;
        if (valPowderUsage) valPowderUsage.textContent = `${powderG} g`;
        if (valPathCount) valPathCount.textContent = executionSegments.length;
        if (valTurnCount) valTurnCount.textContent = Math.round(executionSegments.length * 1.5);
    }

    // Dropzone Click & Drag & Drop Handling
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

    // Import Image URL Button Handling
    if (btnLoadUrl && imageUrlInput) {
        btnLoadUrl.addEventListener('click', async () => {
            const url = imageUrlInput.value.trim();
            if (!url) {
                alert('Please paste a valid image URL.');
                return;
            }

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

                    if (btnStart) btnStart.disabled = false;
                    if (btnReset) btnReset.disabled = false;
                    if (btnSendWifi) btnSendWifi.disabled = false;

                    resetSimulation();
                } else {
                    alert('URL Import Error: ' + (data.error || 'Failed to import image from URL'));
                }
            } catch (err) {
                alert('URL Import Failed: ' + err.message);
            } finally {
                btnLoadUrl.disabled = false;
                btnLoadUrl.textContent = 'Import';
            }
        });
    }

    // Speed Selector Radio Listener
    document.querySelectorAll('input[name="sizeOpt"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            calculateEstimatedTime();
        });
    });

    // Draw 8x8 Grid Canvas Layer
    function drawGridLayer() {
        if (!ctx) return;
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const x = c * 75;
                const y = r * 75;
                ctx.strokeRect(x, y, 75, 75);

                const label = `${String.fromCharCode(65 + r)}${c + 1}`;
                ctx.fillStyle = (r === 0 && c === 0) ? '#2563EB' : '#94A3B8';
                ctx.font = '10px sans-serif';
                ctx.fillText(label, x + 6, y + 16);
            }
        }
    }

    // Draw Planned Vector Path Layer
    function drawPlannedPathLayer() {
        if (!ctx || !executionSegments) return;

        executionSegments.forEach(seg => {
            const pts = seg.pts;
            if (pts.length < 2) return;

            ctx.beginPath();
            if (seg.type === 'DRAW') {
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
        drawGridLayer();
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
        if (valGrid) valGrid.textContent = getGridCellName(robotX, robotY);
        if (valPose) valPose.textContent = `${robotX.toFixed(1)}, ${robotY.toFixed(1)} mm`;
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

        if (btnStart) {
            btnStart.disabled = false;
            btnStart.textContent = '🚀 Start Drawing';
        }
        if (btnPause) {
            btnPause.disabled = true;
            btnPause.textContent = '⏸️ Pause';
        }

        if (txtProgress) txtProgress.textContent = '0%';
        const valProgressPct = document.getElementById('valProgressPct');
        if (valProgressPct) valProgressPct.textContent = '0%';
        const valStatProgress = document.getElementById('valStatProgress');
        if (valStatProgress) valStatProgress.textContent = '0 %';
        if (barProgress) barProgress.style.width = '0%';

        renderViewport();
    }

    // Load Demo Path Button
    if (btnDemo) {
        btnDemo.addEventListener('click', async () => {
            btnDemo.disabled = true;
            btnDemo.textContent = 'Loading Demo...';

            try {
                const res = await fetch('/api/demo_path');
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

                    if (btnStart) btnStart.disabled = false;
                    if (btnReset) btnReset.disabled = false;
                    if (btnSendWifi) btnSendWifi.disabled = false;

                    resetSimulation();
                }
            } catch (err) {
                alert('Failed to load demo path: ' + err.message);
            } finally {
                btnDemo.disabled = false;
                btnDemo.textContent = 'Load Demo Path';
            }
        });
    }

    // Reset Button
    if (btnReset) {
        btnReset.addEventListener('click', resetSimulation);
    }

    // Start Simulation Button
    if (btnStart) {
        btnStart.addEventListener('click', () => {
            if (executionSegments.length === 0) {
                alert('Please upload a Rangoli design or click "Load Demo Path" first.');
                return;
            }

            if (segIdx >= executionSegments.length || robotState === 'COMPLETE') {
                segIdx = 0;
                ptIdx = 0;
                lerpProgress = 0.0;
                powderCtx.clearRect(0, 0, 600, 600);
            }

            isRunning = true;
            isPaused = false;
            robotState = 'RUNNING';

            btnStart.disabled = true;
            if (btnPause) { btnPause.disabled = false; btnPause.textContent = '⏸️ Pause'; }
            if (btnResume) btnResume.disabled = false;
            if (btnStop) btnStop.disabled = false;

            animate();
        });
    }

    // Pause Simulation Button
    if (btnPause) {
        btnPause.addEventListener('click', () => {
            if (!isRunning) return;
            isPaused = !isPaused;
            btnPause.textContent = isPaused ? '▶️ Resume' : '⏸️ Pause';
            if (isPaused) {
                robotState = 'PAUSED';
                if (valState) valState.textContent = 'PAUSED';
            } else {
                animate();
            }
        });
    }

    // Resume Button
    if (btnResume) {
        btnResume.addEventListener('click', () => {
            if (isPaused) {
                isPaused = false;
                if (btnPause) btnPause.textContent = '⏸️ Pause';
                animate();
            }
        });
    }

    // Stop Button
    if (btnStop) {
        btnStop.addEventListener('click', () => {
            resetSimulation();
        });
    }

    // Emergency Stop Button
    if (btnEmergencyStop) {
        btnEmergencyStop.addEventListener('click', async () => {
            if (animFrame) cancelAnimationFrame(animFrame);
            isRunning = false;
            isPaused = false;
            robotState = 'EMERGENCY_STOP';
            isPowderOn = false;
            if (valState) valState.textContent = 'EMERGENCY_STOP';
            if (espStatusText) espStatusText.textContent = '🚨 EMERGENCY STOP ACTIVATED';
            if (espStatusDot) espStatusDot.style.backgroundColor = '#DC2626';
            alert('🚨 EMERGENCY STOP ACTIVATED! All motion and powder dispensing stopped immediately.');
            try {
                await fetch('/api/jobs/current/emergency-stop', { method: 'POST' });
            } catch (e) {}
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
            robotState = 'COMPLETE';
            isPowderOn = false;
            if (btnStart) {
                btnStart.disabled = false;
                btnStart.textContent = '▶ Re-Start';
            }
            if (btnPause) btnPause.disabled = true;
            renderViewport();
            return;
        }

        const seg = executionSegments[segIdx];
        const pts = seg.pts;
        isPowderOn = seg.dispense;
        robotState = isPowderOn ? 'DRAWING' : 'MOVING';

        // Update Progress Bar
        const pct = Math.min(100, Math.round(((segIdx + 1) / executionSegments.length) * 100));
        if (txtProgress) txtProgress.textContent = `${pct}%`;
        const valProgressPct = document.getElementById('valProgressPct');
        if (valProgressPct) valProgressPct.textContent = `${pct}%`;
        const valStatProgress = document.getElementById('valStatProgress');
        if (valStatProgress) valStatProgress.textContent = `${pct}%`;
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

    // Process Custom Image Upload Form
    if (uploadForm) {
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fileInput = document.getElementById('imageInput');
            const processBtn = document.getElementById('processBtn');

            if (!fileInput.files || !fileInput.files[0]) {
                alert('Please browse and select an image file first.');
                return;
            }

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
                    if (btnStart) btnStart.disabled = false;
                    if (btnReset) btnReset.disabled = false;
                    if (btnSendWifi) btnSendWifi.disabled = false;

                    resetSimulation();
                } else {
                    alert('Error: ' + (data.error || 'Unknown error'));
                }
            } catch (err) {
                alert('Processing failed: ' + err.message);
            } finally {
                processBtn.disabled = false;
                processBtn.textContent = 'Process Rangoli Image';
            }
        });
    }

    // Wireless Send to ESP32 Button
    if (btnSendWifi) {
        btnSendWifi.addEventListener('click', async () => {
            const ipEl = document.getElementById('espIp');
            const ip = ipEl ? ipEl.value : '192.168.4.1';
            btnSendWifi.disabled = true;
            if (espStatusText) espStatusText.textContent = `ESP32: Transmitting to ${ip}...`;

            try {
                const res = await fetch('/api/send_to_esp32', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ esp32_ip: ip, commands: espCommands })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    if (espStatusText) espStatusText.textContent = `ESP32: Transmitted (${espCommands.length} Cmds)`;
                    if (espStatusDot) espStatusDot.style.backgroundColor = '#10b981';
                    alert('Commands successfully sent to ESP32!');
                } else {
                    if (espStatusText) espStatusText.textContent = `ESP32: Transmission Error`;
                    if (espStatusDot) espStatusDot.style.backgroundColor = '#ef4444';
                    alert('Error: ' + data.message);
                }
            } catch (err) {
                if (espStatusText) espStatusText.textContent = `ESP32: Connection Failed`;
                if (espStatusDot) espStatusDot.style.backgroundColor = '#ef4444';
                alert('Connection failed: ' + err.message);
            } finally {
                btnSendWifi.disabled = false;
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
            console.warn('[WS] Failed to initiate WebSocket connection:', e);
            return;
        }

        socket.onopen = () => {
            console.log('[WS] Connected to FastAPI backend WebSocket server.');
            if (espStatusText && currentRobotMode === 'DEMO') {
                espStatusText.textContent = '🟢 Backend WSS Connected (DEMO)';
                if (espStatusDot) espStatusDot.style.backgroundColor = '#10B981';
            }
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'robot_connection_update') {
                    const onlineRobots = data.robots || [];
                    if (onlineRobots.length > 0 && currentRobotMode === 'REAL') {
                        if (espStatusText) espStatusText.textContent = `🟢 ESP32: Connected (${onlineRobots[0]})`;
                        if (espStatusDot) espStatusDot.style.backgroundColor = '#10B981';
                    }
                }
            } catch (err) {
                console.error('[WS] Message parse error:', err);
            }
        };

        socket.onclose = () => {
            console.log('[WS] Connection closed. Reconnecting in 3s...');
            setTimeout(connectDashboardWebSocket, 3000);
        };

        socket.onerror = (err) => {
            console.warn('[WS] WebSocket error:', err);
        };
    }

    // Initiate WebSocket telemetry connection
    connectDashboardWebSocket();

    // Initial Viewport Draw
    drawGridLayer();
});
