/**
 * IoT-Based Autonomous Rangoli Drawing Robot
 * Student B.Tech Project Web Application Script
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('simCanvas');
    const ctx = canvas.getContext('2d');

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
    const btnStart = document.getElementById('btnStart');
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
            valEstTime.textContent = "00:00";
            valTimeDetail.textContent = "Path: 0.0 m | Delays: 0.0s";
            return;
        }

        const travelTimeSec = totalPathLengthMm / currentSpeedMmPerSec;
        const turnDelaySec = totalTurns * 0.8;
        const dispenserDelaySec = totalActuations * 0.06;
        const totalSec = Math.round(travelTimeSec + turnDelaySec + dispenserDelaySec);

        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        valEstTime.textContent = formatted;
        valTimeDetail.textContent = `Path: ${(totalPathLengthMm / 1000.0).toFixed(2)}m | Speed: ${currentSpeedMmPerSec}mm/s`;
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
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const x = c * 75;
                const y = r * 75;
                ctx.strokeRect(x, y, 75, 75);

                const label = `${String.fromCharCode(65 + r)}${c + 1}`;
                ctx.fillStyle = (r === 0 && c === 0) ? '#ec4899' : '#64748b';
                ctx.font = '10px sans-serif';
                ctx.fillText(label, x + 6, y + 16);
            }
        }
    }

    // Draw Planned Vector Path Layer
    function drawPlannedPathLayer() {
        if (!executionSegments) return;

        ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);

        executionSegments.forEach(seg => {
            const pts = seg.pts;
            if (pts.length < 2) return;

            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i][0], pts[i][1]);
            }
            ctx.stroke();
        });

        ctx.setLineDash([]);
    }

    // Draw Robot Body, Wheels & Outrigger Nozzle Layer
    function drawRobotLayer(x, y, thetaDeg) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((thetaDeg * Math.PI) / 180.0);

        // Robot Body Chassis
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // Left & Right Wheels
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-12, -22, 14, 5);
        ctx.fillRect(-12, 17, 14, 5);

        // Hopper Circle
        ctx.fillStyle = 'rgba(236, 72, 153, 0.3)';
        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // Front Nozzle Outrigger (+60mm offset)
        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(60, 0);
        ctx.stroke();

        ctx.fillStyle = isPowderOn ? '#ec4899' : '#64748b';
        ctx.beginPath();
        ctx.arc(60, 0, 4, 0, 2 * Math.PI);
        ctx.fill();

        ctx.restore();
    }

    function renderViewport() {
        ctx.clearRect(0, 0, 600, 600);
        drawGridLayer();
        drawPlannedPathLayer();

        // Draw Powder Trail Layer
        ctx.drawImage(powderCanvas, 0, 0);

        // Draw Robot Layer
        drawRobotLayer(robotX, robotY, robotTheta);

        updateUI();
    }

    function updateUI() {
        valGrid.textContent = getGridCellName(robotX, robotY);
        valPose.textContent = `${robotX.toFixed(1)}, ${robotY.toFixed(1)} mm`;
        valState.textContent = robotState;

        if (isPowderOn) {
            valPowder.textContent = 'ON';
            valPowder.className = 'status-val badge-on';
        } else {
            valPowder.textContent = 'OFF';
            valPowder.className = 'status-val badge-off';
        }
    }

    renderViewport();

    // Reset Simulation State
    function resetSimulation() {
        if (animFrame) cancelAnimationFrame(animFrame);
        isRunning = false;
        isPaused = false;
        robotX = 0.0; robotY = 0.0; robotTheta = 0.0;
        isPowderOn = false;
        robotState = 'IDLE';

        txtProgress.textContent = '0%';
        barProgress.style.width = '0%';

        btnStart.disabled = executionSegments.length === 0;
        btnStart.textContent = '▶ Start';
        btnPause.disabled = true;

        powderCtx.clearRect(0, 0, 600, 600);
        renderViewport();
    }

    btnReset.addEventListener('click', resetSimulation);

    // Load Demo Path Button
    btnDemo.addEventListener('click', async () => {
        btnDemo.disabled = true;
        btnDemo.textContent = 'Loading...';

        try {
            const res = await fetch('/api/demo_path');
            const data = await res.json();

            if (data.status === 'success') {
                executionSegments = data.execution_segments;
                espCommands = data.esp32_commands;

                // Calculate Path Stats for Time Estimator
                totalPathLengthMm = 0.0;
                totalTurns = 0;
                totalActuations = 0;

                executionSegments.forEach(seg => {
                    const pts = seg.pts;
                    for (let i = 0; i < pts.length - 1; i++) {
                        totalPathLengthMm += Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
                    }
                });

                calculateEstimatedTime();
                btnStart.disabled = false;
                btnReset.disabled = false;
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

    // Start Simulation Button
    btnStart.addEventListener('click', () => {
        if (executionSegments.length === 0) return;

        if (isRunning && isPaused) {
            isPaused = false;
            btnPause.textContent = '⏸ Pause';
            animate();
            return;
        }

        resetSimulation();
        isRunning = true;
        isPaused = false;
        btnStart.disabled = true;
        btnPause.disabled = false;
        robotState = 'MOVING';

        animate();
    });

    // Pause Simulation Button
    btnPause.addEventListener('click', () => {
        if (!isRunning) return;
        isPaused = !isPaused;
        btnPause.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
        if (isPaused) {
            robotState = 'PAUSED';
            updateUI();
        } else {
            animate();
        }
    });

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
            btnStart.disabled = false;
            btnStart.textContent = '▶ Re-Start';
            btnPause.disabled = true;
            renderViewport();
            return;
        }

        const seg = executionSegments[segIdx];
        const pts = seg.pts;
        isPowderOn = seg.dispense;
        robotState = isPowderOn ? 'DRAWING' : 'MOVING';

        // Update Progress Bar
        const pct = Math.min(100, Math.round(((segIdx + 1) / executionSegments.length) * 100));
        txtProgress.textContent = `${pct}%`;
        barProgress.style.width = `${pct}%`;

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

                powderCtx.fillStyle = '#ec4899';
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

                    // Display Intermediate Stages
                    if (data.image_urls) {
                        const pipelineCard = document.getElementById('pipelineCard');
                        if (pipelineCard) pipelineCard.style.display = 'block';

                        const t = Date.now();
                        document.getElementById('imgOriginal').src = data.image_urls.original + '?t=' + t;
                        document.getElementById('imgGrayscale').src = data.image_urls.grayscale + '?t=' + t;
                        document.getElementById('imgThreshold').src = data.image_urls.threshold + '?t=' + t;
                        document.getElementById('imgEdges').src = data.image_urls.edges + '?t=' + t;
                    }

                    // Calculate Path Stats
                    totalPathLengthMm = 0.0;
                    executionSegments.forEach(seg => {
                        const pts = seg.pts;
                        for (let i = 0; i < pts.length - 1; i++) {
                            totalPathLengthMm += Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
                        }
                    });

                    calculateEstimatedTime();
                    btnStart.disabled = false;
                    btnReset.disabled = false;
                    if (btnSendWifi) btnSendWifi.disabled = false;

                    resetSimulation();
                } else {
                    alert('Error: ' + data.error);
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
            const ip = document.getElementById('espIp').value;
            btnSendWifi.disabled = true;
            espStatusText.textContent = `ESP32: Transmitting to ${ip}...`;

            try {
                const res = await fetch('/api/send_to_esp32', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ esp32_ip: ip, commands: espCommands })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    espStatusText.textContent = `ESP32: Transmitted (${espCommands.length} Cmds)`;
                    espStatusDot.style.backgroundColor = '#10b981';
                    alert('Commands successfully sent to ESP32!');
                } else {
                    espStatusText.textContent = `ESP32: Transmission Error`;
                    espStatusDot.style.backgroundColor = '#ef4444';
                    alert('Error: ' + data.message);
                }
            } catch (err) {
                espStatusText.textContent = `ESP32: Connection Failed`;
                espStatusDot.style.backgroundColor = '#ef4444';
                alert('Connection failed: ' + err.message);
            } finally {
                btnSendWifi.disabled = false;
            }
        });
    }
});
