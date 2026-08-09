/**
 * IoT-Based Autonomous Rangoli Drawing Robot
 * Student B.Tech Project Web Application Script
 */

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

    // Buttons
    const btnDemo = document.getElementById('btnDemo');
    const btnStart = document.getElementById('btnStartDrawing') || document.getElementById('btnStart');
    const btnPause = document.getElementById('btnPause');
    const btnReset = document.getElementById('btnReset');
    const btnSendWifi = document.getElementById('btnSendWifi');
    const uploadForm = document.getElementById('uploadForm');

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
        if (valTimeDetail) valTimeDetail.textContent = `Path: ${(totalPathLengthMm / 1000.0).toFixed(2)}m | Speed: ${currentSpeedMmPerSec}mm/s`;
    }

    // Speed Selector Radio Listener
    document.querySelectorAll('input[name="speedOpt"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'slow') currentSpeedMmPerSec = 50.0;
            else if (val === 'medium') currentSpeedMmPerSec = 80.0;
            else if (val === 'fast') currentSpeedMmPerSec = 120.0;

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

            if (isRunning && !isPaused) return;

            isRunning = true;
            isPaused = false;
            robotState = 'RUNNING';

            btnStart.disabled = true;
            if (btnPause) btnPause.disabled = false;

            segIdx = 0;
            ptIdx = 0;
            lerpProgress = 0.0;

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

            if (!fileInput.files[0]) return;

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

    // Initial Viewport Draw
    drawGridLayer();
});
