/**
 * Autonomous Rangoli Drawing Robot Dashboard Control System
 * Production FastAPI + Outbound ESP32 WSS Transport Architecture
 * Workspace: 610 × 610 mm (2 × 2 ft)
 */

// Global Single Source of Truth Application State
const appState = {
    robotMode: "DEMO",              // "DEMO" | "REAL"
    robotConnection: "DISCONNECTED", // "DISCONNECTED" | "CONNECTING" | "CONNECTED"
    robotState: "IDLE",             // "IDLE" | "PROCESSING" | "READY" | "SIMULATING" | "DRAWING" | "PAUSED" | "STOPPED" | "COMPLETED" | "EMERGENCY_STOP" | "ERROR"
    selectedRobot: null,            // null or { robot_id, connection, status, firmware_version }
    currentJob: null,               // null or { job_id, total_commands, current_command, progress }
    processedSegments: []           // Executable polyline trajectory segments
};

document.addEventListener('DOMContentLoaded', () => {
    // Canvas & Context Setup (Internal Buffer Resolution: 610 x 610 px)
    const canvas = document.getElementById('simCanvas');
    const ctx = canvas.getContext('2d');

    // DOM Elements References
    const btnModeDemo = document.getElementById('btnModeDemo');
    const btnModeReal = document.getElementById('btnModeReal');
    const btnScanRobots = document.getElementById('btnScanRobots');

    const espStatusDot = document.getElementById('espStatusDot');
    const espStatusText = document.getElementById('espStatusText');

    const valState = document.getElementById('valState');
    const txtProgress = document.getElementById('txtProgress');
    const barProgress = document.getElementById('barProgress');

    const valEstTime = document.getElementById('valEstTime');
    const valRemTime = document.getElementById('valRemTime');
    const valDrawDist = document.getElementById('valDrawDist');
    const valTravelDist = document.getElementById('valTravelDist');
    const valPowderUsage = document.getElementById('valPowderUsage');
    const valProgressPct = document.getElementById('valProgressPct');
    const valPathCount = document.getElementById('valPathCount');
    const valTurnCount = document.getElementById('valTurnCount');

    const btnPause = document.getElementById('btnPause');
    const btnResume = document.getElementById('btnResume');
    const btnStop = document.getElementById('btnStop');
    const btnEmergencyStop = document.getElementById('btnEmergencyStop');
    const btnReset = document.getElementById('btnReset');

    const uploadForm = document.getElementById('uploadForm');
    const dropzone = document.getElementById('dropzone');
    const imageInput = document.getElementById('imageInput');
    const imageUrlInput = document.getElementById('imageUrlInput');
    const uploadErrorMessage = document.getElementById('uploadErrorMessage');

    const completionSummaryCard = document.getElementById('completionSummaryCard');
    const processingCard = document.getElementById('processingCard');
    const processStepBadge = document.getElementById('processStepBadge');

    const modalNotConnected = document.getElementById('modalNotConnected');
    const btnModalScan = document.getElementById('btnModalScan');
    const btnModalClose = document.getElementById('btnModalClose');

    const btnEmptyUpload = document.getElementById('btnEmptyUpload');
    if (btnEmptyUpload) {
        btnEmptyUpload.addEventListener('click', () => {
            if (imageInput) imageInput.click();
        });
    }

    // Authoritative Discovery Modal Elements
    const robotDiscoveryModal = document.getElementById('robotDiscoveryModal');
    const closeRobotDiscovery = document.getElementById('closeRobotDiscovery');
    const robotDiscoveryContent = document.getElementById('robotDiscoveryContent');

    // SVG Overlay Robot Visual Reference
    const robotSvgVisual = document.getElementById('robotSvgVisual');
    const robotStatusLed = document.getElementById('robotStatusLed');
    const robotDispenserNozzle = document.getElementById('robotDispenserNozzle');

    // Interactive Legend Visibility Layers
    const legendLayers = {
        start: true,
        end: true,
        draw: true,
        completed: true,
        travel: true
    };

    // Pipeline Data & Motion Animation State
    let rawUnscaledSegments = [];
    let espCommands = [];
    let animFrame = null;
    let animSegIdx = 0;
    let animPtIdx = 0;
    let totalEstimatedSeconds = 0;
    let totalDrawLengthMm = 0.0;
    let totalDryLengthMm = 0.0;
    let totalTurnsCount = 0;
    let currentLineWidthMm = 3.0;
    let currentDrawingSizeMm = 610.0;

    // Pose Tracking State (x, y in mm, heading in degrees)
    let robotPose = { x: 305.0, y: 305.0, heading: 0.0, powder: false };

    // ============================================================================
    // UNIFIED COORDINATE TRANSFORMATION ENGINE (610 x 610 mm -> CANVAS & SVG)
    // ============================================================================
    function mmToCanvasCoords(xMm, yMm) {
        // Internal canvas resolution is 610 x 610 px (1 mm = 1 px)
        const scaleX = canvas.width / 610.0;
        const scaleY = canvas.height / 610.0;
        return {
            x: xMm * scaleX,
            y: yMm * scaleY
        };
    }

    // Interactive Legend Toggle Event Handlers
    const legendContainer = document.getElementById('workspaceLegend');
    if (legendContainer) {
        legendContainer.querySelectorAll('.legend-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const layer = btn.getAttribute('data-layer');
                if (layer && legendLayers.hasOwnProperty(layer)) {
                    legendLayers[layer] = !legendLayers[layer];
                    btn.classList.toggle('active', legendLayers[layer]);
                    btn.classList.toggle('muted', !legendLayers[layer]);
                    renderViewport();
                }
            });
        });
    }

    // ============================================================================
    // 1. CENTRALIZED MODE & FSM CONTROL SYSTEM
    // ============================================================================

    window.setRobotMode = function(mode) {
        if (mode !== "DEMO" && mode !== "REAL") return;
        if (['SIMULATING', 'DRAWING', 'PROCESSING'].includes(appState.robotState)) {
            alert("Cannot switch robot mode while drawing or simulation is active.");
            return;
        }

        appState.robotMode = mode;

        if (mode === "REAL") {
            checkRealRobotConnectionStatus();
        }

        renderModeButtons();
        renderHeaderStatus();
        renderPrimaryRobotAction();
        renderRobotControls();
        renderViewport();
    };

    function setFSMState(state) {
        appState.robotState = state;

        if (valState) {
            valState.textContent = state.replace('_', ' ');
            valState.className = 'status-badge';
            if (['DRAWING', 'SIMULATING', 'READY'].includes(state)) {
                valState.classList.add('badge-drawing');
            } else if (['EMERGENCY_STOP', 'ERROR'].includes(state)) {
                valState.style.backgroundColor = '#FEF2F2';
                valState.style.color = '#EF4444';
            } else {
                valState.classList.add('badge-idle');
            }
        }

        const isLocked = ['PROCESSING', 'SIMULATING', 'DRAWING', 'PAUSED'].includes(state);

        if (imageInput) imageInput.disabled = isLocked;
        if (imageUrlInput) imageUrlInput.disabled = isLocked;
        if (dropzone) {
            dropzone.style.pointerEvents = isLocked ? 'none' : 'auto';
            dropzone.style.opacity = isLocked ? '0.6' : '1.0';
        }

        document.querySelectorAll('input[name="sizeOpt"], input[name="widthOpt"]').forEach(r => r.disabled = isLocked);

        // Show Reset/Recovery button ONLY when Emergency Stop is active
        if (btnReset) {
            btnReset.style.display = (state === 'EMERGENCY_STOP') ? 'block' : 'none';
        }

        renderHeaderStatus();
        renderPrimaryRobotAction();
        renderRobotControls();
        renderViewport();
    }

    // Radio Listeners for Drawing Size and Line Width
    document.querySelectorAll('input[name="sizeOpt"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.querySelectorAll('input[name="sizeOpt"]').forEach(r => {
                const label = r.closest('.option-btn');
                if (label) label.classList.toggle('active', r.checked);
            });

            const val = e.target.value;
            if (val === 'small') currentDrawingSizeMm = 300.0;
            else if (val === 'medium') currentDrawingSizeMm = 450.0;
            else if (val === 'large') currentDrawingSizeMm = 525.0;
            else currentDrawingSizeMm = 610.0;

            applyDrawingSizeScaling();
        });
    });

    document.querySelectorAll('input[name="widthOpt"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.querySelectorAll('input[name="widthOpt"]').forEach(r => {
                const label = r.closest('.option-btn');
                if (label) label.classList.toggle('active', r.checked);
            });

            currentLineWidthMm = parseFloat(e.target.value) || 3.0;
            updateMetrics();
            renderViewport();
        });
    });

    // ============================================================================
    // 2. UI RENDER FUNCTIONS
    // ============================================================================

    function renderModeButtons() {
        if (!btnModeDemo || !btnModeReal) return;

        const isBusy = ['SIMULATING', 'DRAWING', 'PROCESSING'].includes(appState.robotState);

        btnModeDemo.disabled = isBusy;
        btnModeReal.disabled = isBusy;

        btnModeDemo.style.opacity = isBusy ? '0.65' : '1.0';
        btnModeReal.style.opacity = isBusy ? '0.65' : '1.0';

        if (appState.robotMode === 'DEMO') {
            btnModeDemo.style.background = '#EAB308';
            btnModeDemo.style.color = '#FFFFFF';
            btnModeDemo.classList.add('active');

            btnModeReal.style.background = '#E2E8F0';
            btnModeReal.style.color = '#64748B';
            btnModeReal.classList.remove('active');
        } else {
            btnModeReal.style.background = '#10B981';
            btnModeReal.style.color = '#FFFFFF';
            btnModeReal.classList.add('active');

            btnModeDemo.style.background = '#E2E8F0';
            btnModeDemo.style.color = '#64748B';
            btnModeDemo.classList.remove('active');
        }

        if (btnScanRobots) {
            btnScanRobots.style.display = (appState.robotMode === 'REAL') ? 'inline-block' : 'none';
        }
    }

    function renderHeaderStatus() {
        if (!espStatusDot || !espStatusText) return;

        if (appState.robotMode === 'DEMO') {
            espStatusDot.style.backgroundColor = '#EAB308';
            if (appState.robotState === 'SIMULATING') {
                espStatusText.textContent = `🟡 DEMO ROBOT — Simulating Path`;
            } else if (appState.robotState === 'PAUSED') {
                espStatusText.textContent = `🟡 DEMO ROBOT — Simulation Paused`;
            } else if (['COMPLETED', 'STOPPED'].includes(appState.robotState)) {
                espStatusText.textContent = `🟡 DEMO ROBOT — Simulation Complete`;
            } else if (appState.processedSegments.length > 0) {
                espStatusText.textContent = `🟡 DEMO ROBOT — Simulation Ready`;
            } else {
                espStatusText.textContent = `🟡 DEMO ROBOT — Simulation Only`;
            }
        } else {
            if (appState.robotConnection === 'CONNECTED' && appState.selectedRobot) {
                espStatusDot.style.backgroundColor = '#10B981';
                espStatusText.textContent = `🟢 REAL ROBOT — Connected (${appState.selectedRobot.robot_id})`;
            } else {
                espStatusDot.style.backgroundColor = '#EF4444';
                espStatusText.textContent = `🔴 REAL ROBOT — Disconnected`;
            }
        }
    }

    function renderPrimaryRobotAction() {
        const container = document.getElementById('primaryControlContainer');
        if (!container) return;

        container.innerHTML = ''; // Ensure EXACTLY ONE primary button exists in DOM

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'btnPrimaryAction';
        btn.className = 'btn btn-primary btn-lg btn-start-drawing';

        // EMERGENCY STOP STATE OVERRIDE
        if (appState.robotState === 'EMERGENCY_STOP') {
            btn.disabled = true;
            btn.textContent = '⚠️ EMERGENCY STOP ACTIVE';
            btn.style.background = '#EF4444';
            container.appendChild(btn);
            return;
        }

        if (appState.robotMode === 'DEMO') {
            const hasDesign = appState.processedSegments.length > 0;
            const isBusy = ['PROCESSING', 'SIMULATING', 'PAUSED'].includes(appState.robotState);

            btn.disabled = !hasDesign || isBusy;

            if (appState.robotState === 'SIMULATING') {
                btn.textContent = '⏳ Simulating...';
            } else if (appState.robotState === 'PAUSED') {
                btn.textContent = 'Simulation Paused';
            } else {
                btn.textContent = '🚀 START SIMULATION';
            }

            btn.addEventListener('click', () => {
                if (appState.robotMode !== 'DEMO') return;
                if (appState.processedSegments.length === 0) {
                    showUploadError("No drawing loaded. Upload and process a Rangoli design first.");
                    return;
                }
                if (completionSummaryCard) completionSummaryCard.style.display = 'none';

                startDemoSimulation();
            });

            if (!hasDesign) {
                const notice = document.createElement('div');
                notice.style.fontSize = '0.8rem';
                notice.style.color = '#64748B';
                notice.style.marginTop = '6px';
                notice.style.textAlign = 'center';
                notice.textContent = 'No drawing loaded. Upload and process a Rangoli design first.';
                container.appendChild(btn);
                container.appendChild(notice);
                return;
            }

        } else {
            // REAL ROBOT MODE
            const isConnected = appState.robotConnection === 'CONNECTED';
            const hasDesign = appState.processedSegments.length > 0;
            const isBusy = ['PROCESSING', 'DRAWING', 'PAUSED'].includes(appState.robotState);

            btn.disabled = isBusy;

            if (appState.robotState === 'DRAWING') {
                btn.textContent = '📤 Drawing on Robot...';
            } else if (appState.robotState === 'PAUSED') {
                btn.textContent = 'Drawing Paused';
            } else {
                btn.textContent = '🚀 START DRAWING';
            }

            btn.addEventListener('click', async () => {
                if (appState.robotMode !== 'REAL') return;

                // REAL MODE DISCONNECTED: Open warning modal, ZERO fake drawing/progress
                if (appState.robotConnection !== 'CONNECTED') {
                    showRobotNotConnectedModal(appState.selectedRobot ? appState.selectedRobot.robot_id : 'BOT-01');
                    return;
                }

                if (!hasDesign) {
                    showUploadError("No drawing loaded. Upload and process a Rangoli design first.");
                    return;
                }

                if (completionSummaryCard) completionSummaryCard.style.display = 'none';

                try {
                    btn.textContent = '⏳ Creating Job...';
                    const jobRes = await fetch('/api/jobs', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            robot_id: appState.selectedRobot ? appState.selectedRobot.robot_id : 'BOT-01',
                            commands: espCommands
                        })
                    });
                    const jobData = await jobRes.json();
                    if (!jobRes.ok || !jobData.job_id) {
                        alert("Failed to create job on server.");
                        renderPrimaryRobotAction();
                        return;
                    }

                    appState.currentJob = jobData;

                    btn.textContent = '📤 Sending WSS Command...';
                    const startRes = await fetch(`/api/jobs/${jobData.job_id}/start`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'}
                    });
                    const startData = await startRes.json();

                    if (startRes.ok && startData.status === 'success') {
                        setFSMState('DRAWING');
                    } else {
                        alert(`Robot error: ${startData.message || 'Failed to start job.'}`);
                        setFSMState('IDLE');
                    }
                } catch (err) {
                    console.error("Start Job Error:", err);
                    alert("Network error communicating with server.");
                    setFSMState('IDLE');
                }
            });
        }

        container.appendChild(btn);
    }

    function renderRobotControls() {
        if (!btnPause || !btnResume || !btnStop) return;

        if (appState.robotMode === 'DEMO') {
            if (appState.robotState === 'SIMULATING') {
                btnPause.disabled = false;
                btnResume.disabled = true;
                btnStop.disabled = false;
            } else if (appState.robotState === 'PAUSED') {
                btnPause.disabled = true;
                btnResume.disabled = false;
                btnStop.disabled = false;
            } else {
                btnPause.disabled = true;
                btnResume.disabled = true;
                btnStop.disabled = true;
            }
        } else {
            // REAL ROBOT MODE
            if (appState.robotConnection === 'CONNECTED') {
                if (appState.robotState === 'DRAWING') {
                    btnPause.disabled = false;
                    btnResume.disabled = true;
                    btnStop.disabled = false;
                } else if (appState.robotState === 'PAUSED') {
                    btnPause.disabled = true;
                    btnResume.disabled = false;
                    btnStop.disabled = false;
                } else {
                    btnPause.disabled = true;
                    btnResume.disabled = true;
                    btnStop.disabled = true;
                }
            } else {
                btnPause.disabled = true;
                btnResume.disabled = true;
                btnStop.disabled = true;
            }
        }
    }

    // Mode Buttons Click Event Listeners
    if (btnModeDemo) {
        btnModeDemo.addEventListener('click', () => {
            setRobotMode('DEMO');
        });
    }

    if (btnModeReal) {
        btnModeReal.addEventListener('click', () => {
            setRobotMode('REAL');
        });
    }

    // ============================================================================
    // 3. DEMO MODE SIMULATION CONTROLLER
    // ============================================================================

    function startDemoSimulation() {
        if (animFrame) cancelAnimationFrame(animFrame);

        animSegIdx = 0;
        animPtIdx = 0;
        setFSMState('SIMULATING');

        animFrame = requestAnimationFrame(demoSimulationLoop);
    }

    function demoSimulationLoop() {
        if (appState.robotMode !== 'DEMO' || appState.robotState !== 'SIMULATING') return;

        const segments = appState.processedSegments;
        if (!segments || segments.length === 0 || animSegIdx >= segments.length) {
            // Simulation Complete
            setFSMState('COMPLETED');
            if (txtProgress) txtProgress.textContent = "100%";
            if (barProgress) barProgress.style.width = "100%";
            if (valProgressPct) valProgressPct.textContent = "100 %";
            if (completionSummaryCard) completionSummaryCard.style.display = 'block';
            updateMetrics();
            renderViewport();
            return;
        }

        const seg = segments[animSegIdx];
        const pts = seg.pts;

        if (!pts || pts.length === 0) {
            animSegIdx++;
            animPtIdx = 0;
            animFrame = requestAnimationFrame(demoSimulationLoop);
            return;
        }

        // Current target point
        const pt = pts[animPtIdx];
        robotPose.x = pt[0];
        robotPose.y = pt[1];
        robotPose.powder = (seg.type === 'DRAW');

        // Calculate heading angle based on path segment direction
        if (animPtIdx > 0) {
            const prevPt = pts[animPtIdx - 1];
            const dx = pt[0] - prevPt[0];
            const dy = pt[1] - prevPt[1];
            if (Math.hypot(dx, dy) > 0.5) {
                robotPose.heading = (Math.atan2(dy, dx) * 180.0 / Math.PI) + 90.0;
            }
        }

        // Calculate progress percentage
        let totalPts = 0;
        let donePts = 0;
        for (let i = 0; i < segments.length; i++) {
            const count = segments[i].pts ? segments[i].pts.length : 0;
            totalPts += count;
            if (i < animSegIdx) donePts += count;
            else if (i === animSegIdx) donePts += animPtIdx;
        }

        const pct = totalPts > 0 ? Math.min(100, Math.round((donePts / totalPts) * 100)) : 0;
        if (txtProgress) txtProgress.textContent = `${pct}%`;
        if (barProgress) barProgress.style.width = `${pct}%`;
        if (valProgressPct) valProgressPct.textContent = `${pct} %`;

        renderViewport();

        animPtIdx++;
        if (animPtIdx >= pts.length) {
            animSegIdx++;
            animPtIdx = 0;
        }

        animFrame = requestAnimationFrame(demoSimulationLoop);
    }

    // Hardware Control Event Listeners (Pause / Resume / Stop / Emergency Stop)
    if (btnPause) {
        btnPause.addEventListener('click', async () => {
            if (appState.robotMode === 'DEMO') {
                if (appState.robotState === 'SIMULATING') {
                    if (animFrame) cancelAnimationFrame(animFrame);
                    setFSMState('PAUSED');
                }
            } else if (appState.robotMode === 'REAL' && appState.currentJob) {
                await fetch(`/api/jobs/${appState.currentJob.job_id}/pause`, { method: 'POST' });
                setFSMState('PAUSED');
            }
        });
    }

    if (btnResume) {
        btnResume.addEventListener('click', async () => {
            if (appState.robotMode === 'DEMO') {
                if (appState.robotState === 'PAUSED') {
                    setFSMState('SIMULATING');
                    animFrame = requestAnimationFrame(demoSimulationLoop);
                }
            } else if (appState.robotMode === 'REAL' && appState.currentJob) {
                await fetch(`/api/jobs/${appState.currentJob.job_id}/resume`, { method: 'POST' });
                setFSMState('DRAWING');
            }
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', async () => {
            if (animFrame) cancelAnimationFrame(animFrame);

            if (appState.robotMode === 'REAL' && appState.currentJob) {
                await fetch(`/api/jobs/${appState.currentJob.job_id}/stop`, { method: 'POST' });
            }

            animSegIdx = 0;
            animPtIdx = 0;
            if (appState.processedSegments.length > 0 && appState.processedSegments[0].pts.length > 0) {
                const p0 = appState.processedSegments[0].pts[0];
                robotPose.x = p0[0];
                robotPose.y = p0[1];
            }
            if (txtProgress) txtProgress.textContent = "0%";
            if (barProgress) barProgress.style.width = "0%";
            if (valProgressPct) valProgressPct.textContent = "0 %";
            setFSMState('STOPPED');
        });
    }

    if (btnEmergencyStop) {
        btnEmergencyStop.addEventListener('click', async () => {
            if (animFrame) cancelAnimationFrame(animFrame);
            robotPose.powder = false;

            if (appState.robotMode === 'REAL') {
                const jobId = appState.currentJob ? appState.currentJob.job_id : 'current';
                await fetch(`/api/jobs/${jobId}/emergency-stop`, { method: 'POST' });
            }

            setFSMState('EMERGENCY_STOP');
            alert("🚨 EMERGENCY STOP ACTIVATED!\nAll hardware operations immediately halted.");
        });
    }

    if (btnReset) {
        btnReset.addEventListener('click', () => {
            if (animFrame) cancelAnimationFrame(animFrame);
            animSegIdx = 0;
            animPtIdx = 0;
            if (appState.processedSegments.length > 0 && appState.processedSegments[0].pts.length > 0) {
                const p0 = appState.processedSegments[0].pts[0];
                robotPose.x = p0[0];
                robotPose.y = p0[1];
            }
            if (txtProgress) txtProgress.textContent = "0%";
            if (barProgress) barProgress.style.width = "0%";
            if (valProgressPct) valProgressPct.textContent = "0 %";
            setFSMState('IDLE');
        });
    }

    // ============================================================================
    // 4. REAL ROBOT CONNECTION & SINGLE AUTHORITATIVE DISCOVERY MODAL SYSTEM
    // ============================================================================

    async function checkRealRobotConnectionStatus() {
        try {
            const res = await fetch('/api/robots');
            const data = await res.json();
            if (data.status === 'success' && data.robots && data.robots.length > 0) {
                const connectedRobot = data.robots.find(r => r.connection === 'CONNECTED') || data.robots[0];
                if (connectedRobot.connection === 'CONNECTED') {
                    appState.robotConnection = 'CONNECTED';
                    appState.selectedRobot = connectedRobot;
                } else {
                    appState.robotConnection = 'DISCONNECTED';
                    appState.selectedRobot = null;
                }
            } else {
                appState.robotConnection = 'DISCONNECTED';
                appState.selectedRobot = null;
            }
        } catch (err) {
            appState.robotConnection = 'DISCONNECTED';
            appState.selectedRobot = null;
        }

        renderHeaderStatus();
        renderPrimaryRobotAction();
        renderRobotControls();
        renderViewport();
    }

    function openRobotDiscoveryModal() {
        const modal = document.getElementById('robotDiscoveryModal');
        if (!modal) return;

        modal.classList.add('is-open');
        document.body.classList.add('modal-open');

        renderRobotDiscoveryLoading();
        scanCloudRobots();
    }

    function closeRobotDiscoveryModal() {
        const modal = document.getElementById('robotDiscoveryModal');
        if (!modal) return;

        modal.classList.remove('is-open');
        document.body.classList.remove('modal-open');
    }

    function renderRobotDiscoveryLoading() {
        const content = document.getElementById('robotDiscoveryContent');
        if (!content) return;

        content.innerHTML = `
            <div class="radar-scan-box" style="text-align: center; padding: 36px 0;">
                <div class="radar-circle" style="margin: 0 auto 16px auto;">
                    <span style="font-size: 2.2rem;">📡</span>
                </div>
                <h4 style="font-size: 1.1rem; font-weight: 700; color: #0F172A; margin-bottom: 4px;">Scanning for robots...</h4>
                <p style="font-size: 0.88rem; color: #64748B;">Checking secure cloud connections</p>
            </div>
        `;
    }

    async function scanCloudRobots() {
        const content = document.getElementById('robotDiscoveryContent');
        if (!content) return;

        try {
            const res = await fetch('/api/robots');
            const data = await res.json();

            if (data.status === 'success' && data.robots && data.robots.length > 0) {
                renderRobotDiscoveryResults(data.robots);
            } else {
                renderRobotDiscoveryEmpty();
            }
        } catch (err) {
            content.innerHTML = `
                <div style="text-align: center; padding: 24px; color: #EF4444;">
                    <p>Network error connecting to backend registry API.</p>
                </div>
            `;
        }
    }

    function renderRobotDiscoveryEmpty() {
        const content = document.getElementById('robotDiscoveryContent');
        if (!content) return;

        content.innerHTML = `
            <div style="text-align: center; padding: 36px 12px;">
                <div style="font-size: 3.5rem; margin-bottom: 12px; color: #64748B;">🤖</div>
                <h3 style="font-size: 1.25rem; font-weight: 700; color: #0F172A; margin: 0 0 10px 0;">No Robots Online</h3>
                <p style="font-size: 0.9rem; color: #64748B; max-width: 420px; margin: 0 auto 24px auto; line-height: 1.5;">
                    No authenticated ESP32 robots are currently connected to the cloud.<br><br>
                    Make sure your robot is powered on, connected to Wi-Fi, and configured for outbound WSS.
                </p>
                <button type="button" id="btnDiscoveryRetry" class="btn btn-primary" style="padding: 12px 28px; font-size: 0.95rem; font-weight: 700; border-radius: 10px;">
                    🔄 Scan Again
                </button>
            </div>
        `;
        const btnRetry = content.querySelector('#btnDiscoveryRetry');
        if (btnRetry) btnRetry.addEventListener('click', scanCloudRobots);
    }

    function renderRobotDiscoveryResults(robots) {
        const content = document.getElementById('robotDiscoveryContent');
        if (!content) return;

        let html = `<div class="robot-cards-list" style="padding: 16px 0;">`;
        robots.forEach(r => {
            const isConn = r.connection === 'CONNECTED';
            const dotColor = isConn ? '#10B981' : '#EF4444';
            const statusText = isConn ? 'ONLINE' : 'OFFLINE';

            html += `
                <div class="robot-card" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px; margin-bottom: 14px;">
                    <div class="robot-card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div class="robot-id-title" style="display: flex; align-items: center; gap: 8px; font-size: 1.05rem; font-weight: 700; color: #0F172A;">
                            <span style="width: 10px; height: 10px; border-radius: 50%; background-color: ${dotColor}; display: inline-block;"></span>
                            <strong>${r.robot_id}</strong>
                        </div>
                        <span class="status-badge ${isConn ? 'badge-drawing' : 'badge-idle'}">${statusText}</span>
                    </div>
                    <div class="robot-card-details" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.85rem; color: #64748B; background: #FFFFFF; padding: 12px; border-radius: 8px; border: 1px solid #F1F5F9; margin-bottom: 14px;">
                        <div><span>Hardware:</span> <strong>ESP32-S3</strong></div>
                        <div><span>Firmware:</span> <strong>${r.firmware_version || '1.0.0'}</strong></div>
                        <div><span>Wi-Fi:</span> <strong>-58 dBm</strong></div>
                        <div><span>Workspace:</span> <strong>610 × 610 mm</strong></div>
                    </div>
                    <button type="button" class="btn btn-primary btn-select-card" data-robot-id="${r.robot_id}" style="width: 100%; height: 44px; font-weight: 700;">
                        SELECT ROBOT
                    </button>
                </div>
            `;
        });
        html += `</div>`;
        content.innerHTML = html;

        content.querySelectorAll('.btn-select-card').forEach(btn => {
            btn.addEventListener('click', async () => {
                const botId = btn.getAttribute('data-robot-id');
                await selectRobotById(botId);
            });
        });
    }

    async function selectRobotById(robotId) {
        try {
            const res = await fetch(`/api/robots/${robotId}/select`, { method: 'POST' });
            const data = await res.json();
            if (data.connected) {
                appState.robotConnection = 'CONNECTED';
                appState.selectedRobot = { robot_id: robotId, connection: 'CONNECTED' };
                closeRobotDiscoveryModal();
                renderHeaderStatus();
                renderPrimaryRobotAction();
                renderRobotControls();
                renderViewport();
                alert(`🟢 Successfully selected and connected to Robot ${robotId}!`);
            } else {
                appState.robotConnection = 'DISCONNECTED';
                appState.selectedRobot = null;
                alert(`🔴 Robot ${robotId} selected, but currently disconnected.`);
            }
        } catch (err) {
            alert("Network error selecting robot.");
        }
    }

    if (btnScanRobots) {
        btnScanRobots.addEventListener('click', openRobotDiscoveryModal);
    }

    if (closeRobotDiscovery) {
        closeRobotDiscovery.addEventListener('click', closeRobotDiscoveryModal);
    }

    // Keyboard ESC key closes modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeRobotDiscoveryModal();
            if (modalNotConnected) modalNotConnected.style.display = 'none';
        }
    });

    // Click outside backdrop to close
    if (robotDiscoveryModal) {
        robotDiscoveryModal.addEventListener('click', (e) => {
            if (e.target === robotDiscoveryModal) closeRobotDiscoveryModal();
        });
    }

    if (modalNotConnected) {
        modalNotConnected.addEventListener('click', (e) => {
            if (e.target === modalNotConnected) modalNotConnected.style.display = 'none';
        });
    }

    function showRobotNotConnectedModal(robotId = 'BOT-01') {
        const modalRobotId = document.getElementById('modalRobotId');
        if (modalRobotId) modalRobotId.textContent = robotId;
        if (modalNotConnected) modalNotConnected.style.display = 'flex';
    }

    if (btnModalClose) {
        btnModalClose.addEventListener('click', () => {
            if (modalNotConnected) modalNotConnected.style.display = 'none';
        });
    }

    if (btnModalScan) {
        btnModalScan.addEventListener('click', () => {
            if (modalNotConnected) modalNotConnected.style.display = 'none';
            openRobotDiscoveryModal();
        });
    }

    // Automatic Browser Real-Time Stream WebSocket Client (/ws)
    function initBrowserWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

        try {
            const ws = new WebSocket(wsUrl);

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'robot_connection_update') {
                        checkRealRobotConnectionStatus();
                    } else if (msg.type === 'telemetry' && appState.robotMode === 'REAL') {
                        const tel = msg.telemetry || {};
                        if (tel.robot_id === (appState.selectedRobot ? appState.selectedRobot.robot_id : null)) {
                            robotPose.x = tel.x || robotPose.x;
                            robotPose.y = tel.y || robotPose.y;
                            robotPose.heading = tel.heading || 0.0;
                            robotPose.powder = !!tel.powder_on;

                            if (tel.progress !== undefined && txtProgress) {
                                txtProgress.textContent = `${tel.progress}%`;
                                if (barProgress) barProgress.style.width = `${tel.progress}%`;
                            }
                            renderViewport();
                        }
                    }
                } catch (e) {}
            };

            ws.onclose = () => {
                setTimeout(initBrowserWebSocket, 3000); // Auto reconnect loop
            };
        } catch (e) {}
    }

    initBrowserWebSocket();

    // ============================================================================
    // 5. IMAGE PROCESSING & UPLOAD PIPELINE
    // ============================================================================

    function showUploadError(msg) {
        if (uploadErrorMessage) {
            uploadErrorMessage.textContent = msg;
            uploadErrorMessage.style.display = 'block';
        }
    }

    function clearUploadError() {
        if (uploadErrorMessage) {
            uploadErrorMessage.style.display = 'none';
        }
    }

    function updatePipelineStage(stageId, state) {
        const el = document.getElementById(stageId);
        if (!el) return;

        el.className = 'pipeline-stage';
        const iconSpan = el.querySelector('.stage-icon');

        if (state === 'COMPLETED') {
            el.classList.add('stage-completed');
            if (iconSpan) iconSpan.textContent = '✓';
        } else if (state === 'PROCESSING') {
            el.classList.add('stage-processing');
            if (iconSpan) iconSpan.textContent = '';
        } else if (state === 'ERROR') {
            el.classList.add('stage-error');
            if (iconSpan) iconSpan.textContent = '✕';
        } else {
            el.classList.add('stage-waiting');
            if (iconSpan) iconSpan.textContent = '○';
        }
    }

    async function handleFileUpload(file) {
        clearUploadError();
        setFSMState('PROCESSING');
        if (processingCard) processingCard.style.display = 'block';
        if (processStepBadge) {
            processStepBadge.textContent = 'PROCESSING...';
            processStepBadge.className = 'status-badge badge-drawing';
        }

        updatePipelineStage('chkUpload', 'PROCESSING');
        updatePipelineStage('chkBG', 'WAITING');
        updatePipelineStage('chkSVG', 'WAITING');
        updatePipelineStage('chkOpt', 'WAITING');
        updatePipelineStage('chkMotion', 'WAITING');
        updatePipelineStage('chkReady', 'WAITING');

        const formData = new FormData();
        formData.append('file', file);

        try {
            const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
            const uploadData = await uploadRes.json();

            if (!uploadRes.ok || !uploadData.imageId) {
                throw new Error(uploadData.error || "Image upload failed");
            }

            updatePipelineStage('chkUpload', 'COMPLETED');
            updatePipelineStage('chkBG', 'PROCESSING');

            const procRes = await fetch(`/api/process/${uploadData.imageId}`, { method: 'POST' });
            const procData = await procRes.json();

            if (!procRes.ok || procData.status !== 'success') {
                throw new Error(procData.error || "Image processing failed");
            }

            updatePipelineStage('chkBG', 'COMPLETED');
            updatePipelineStage('chkSVG', 'COMPLETED');
            updatePipelineStage('chkOpt', 'COMPLETED');
            updatePipelineStage('chkMotion', 'COMPLETED');
            updatePipelineStage('chkReady', 'COMPLETED');

            if (processStepBadge) {
                processStepBadge.textContent = 'READY';
                processStepBadge.className = 'status-badge badge-drawing';
            }

            rawUnscaledSegments = procData.execution_segments || [];
            espCommands = procData.esp32_commands || [];

            applyDrawingSizeScaling();
            setFSMState('READY');

            if (valPathCount) valPathCount.textContent = procData.diagnostics ? procData.diagnostics.final_svg_paths : rawUnscaledSegments.length;

        } catch (err) {
            console.error("Processing Pipeline Error:", err);
            showUploadError(err.message || "Failed to process image.");
            setFSMState('ERROR');
            updatePipelineStage('chkReady', 'ERROR');
            if (processStepBadge) {
                processStepBadge.textContent = 'ERROR';
                processStepBadge.style.backgroundColor = '#FEF2F2';
                processStepBadge.style.color = '#EF4444';
            }
        }
    }

    if (imageInput) {
        imageInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                handleFileUpload(e.target.files[0]);
            }
        });
    }

    if (dropzone) {
        dropzone.addEventListener('click', () => {
            if (imageInput) imageInput.click();
        });
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#2563EB';
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = '#CBD5E1';
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#CBD5E1';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFileUpload(e.dataTransfer.files[0]);
            }
        });
    }

    // ============================================================================
    // 6. CANVAS & DYNAMIC PATH VISUALIZATION RENDER ENGINE
    // ============================================================================

    function applyDrawingSizeScaling() {
        if (!rawUnscaledSegments || rawUnscaledSegments.length === 0) {
            appState.processedSegments = [];
            totalDrawLengthMm = 0;
            totalDryLengthMm = 0;
            totalTurnsCount = 0;
            renderViewport();
            return;
        }

        const scaleFactor = currentDrawingSizeMm / 610.0;
        const offsetX = (610.0 - currentDrawingSizeMm) / 2.0;
        const offsetY = (610.0 - currentDrawingSizeMm) / 2.0;

        totalDrawLengthMm = 0;
        totalDryLengthMm = 0;
        totalTurnsCount = 0;

        appState.processedSegments = rawUnscaledSegments.map(seg => {
            const scaledPts = seg.pts.map(pt => [
                pt[0] * scaleFactor + offsetX,
                pt[1] * scaleFactor + offsetY
            ]);

            let d = 0;
            for (let i = 0; i < scaledPts.length - 1; i++) {
                d += Math.hypot(scaledPts[i+1][0] - scaledPts[i][0], scaledPts[i+1][1] - scaledPts[i][1]);
            }

            if (seg.type === 'DRAW') totalDrawLengthMm += d;
            else totalDryLengthMm += d;

            return {
                type: seg.type,
                dispense: seg.dispense,
                pts: scaledPts
            };
        });

        // Set initial pose at actual first executable point of trajectory
        if (appState.processedSegments.length > 0 && appState.processedSegments[0].pts.length > 0) {
            const p0 = appState.processedSegments[0].pts[0];
            robotPose.x = p0[0];
            robotPose.y = p0[1];
        }

        updateMetrics();
        renderHeaderStatus();
        renderPrimaryRobotAction();
        renderViewport();
    }

    function updateMetrics() {
        const vDraw = 50.0;
        const vDry = 100.0;

        totalEstimatedSeconds = Math.round((totalDrawLengthMm / vDraw) + (totalDryLengthMm / vDry) + (appState.processedSegments.length * 0.8));
        const mins = Math.floor(totalEstimatedSeconds / 60);
        const secs = totalEstimatedSeconds % 60;
        const formattedTime = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        if (valEstTime) valEstTime.textContent = formattedTime;
        if (valRemTime && appState.robotState === 'IDLE') valRemTime.textContent = formattedTime;

        const powderGrams = Math.round((totalDrawLengthMm * currentLineWidthMm * 0.015) * 10) / 10;
        if (valPowderUsage) valPowderUsage.textContent = `${powderGrams} g`;

        if (valDrawDist) valDrawDist.textContent = `${(totalDrawLengthMm / 1000.0).toFixed(2)} m`;
        if (valTravelDist) valTravelDist.textContent = `${(totalDryLengthMm / 1000.0).toFixed(2)} m`;
    }

    function updateRobotSvgPosition() {
        if (!robotSvgVisual) return;

        // DOM viewport rendering scale relative to 610x610 mm workspace
        const scaleX = (canvas.clientWidth || 610.0) / 610.0;
        const scaleY = (canvas.clientHeight || 610.0) / 610.0;

        const posX = robotPose.x * scaleX;
        const posY = robotPose.y * scaleY;

        // Position 44x48 px SVG center exactly over (posX, posY) and rotate by heading angle
        robotSvgVisual.style.transform = `translate(${posX - 22}px, ${posY - 24}px) rotate(${robotPose.heading}deg)`;

        // Active Powder Dispenser Core Nozzle Indication
        if (robotDispenserNozzle) {
            if (robotPose.powder) {
                robotDispenserNozzle.setAttribute('fill', '#10B981');
                robotDispenserNozzle.style.filter = 'drop-shadow(0px 0px 4px #10B981)';
            } else {
                robotDispenserNozzle.setAttribute('fill', '#64748B');
                robotDispenserNozzle.style.filter = 'none';
            }
        }

        // Status LED Light Color
        if (robotStatusLed) {
            let ledColor = '#EAB308'; // Default DEMO Amber
            if (appState.robotMode === 'REAL') {
                if (appState.robotConnection === 'CONNECTED') {
                    ledColor = '#10B981'; // Green
                } else {
                    ledColor = '#EF4444'; // Red
                }
            } else {
                if (appState.robotState === 'SIMULATING') {
                    ledColor = '#10B981'; // Green
                }
            }

            if (['EMERGENCY_STOP', 'ERROR'].includes(appState.robotState)) {
                ledColor = '#EF4444';
            } else if (['PAUSED'].includes(appState.robotState)) {
                ledColor = '#F59E0B';
            }

            robotStatusLed.setAttribute('fill', ledColor);
        }
    }

    function drawPathSegment(pts, color, width, dash = []) {
        if (!pts || pts.length < 2) return;
        ctx.save();
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const p0 = mmToCanvasCoords(pts[0][0], pts[0][1]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < pts.length; i++) {
            const pt = mmToCanvasCoords(pts[i][0], pts[i][1]);
            ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
        ctx.restore();
    }

    function renderViewport() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. Draw Workspace Outer Border (610 x 610 mm)
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 2.0;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);

        const segments = appState.processedSegments;
        const emptyOverlay = document.getElementById('workspaceEmptyOverlay');

        // Check if there is a loaded design or active REAL robot connection
        const hasDesign = segments && segments.length > 0;
        const hasRealConnection = (appState.robotMode === 'REAL' && appState.robotConnection === 'CONNECTED');

        if (!hasDesign && !hasRealConnection) {
            // Show Empty Workspace Overlay, Hide Robot Visual Marker completely
            if (emptyOverlay) emptyOverlay.style.display = 'flex';
            if (robotSvgVisual) robotSvgVisual.style.display = 'none';
            return;
        } else {
            // Hide Empty Workspace Overlay, Show Robot Visual Marker
            if (emptyOverlay) emptyOverlay.style.display = 'none';
            if (robotSvgVisual) robotSvgVisual.style.display = 'block';
        }

        if (!hasDesign) {
            updateRobotSvgPosition();
            return;
        }

        // Identify First & Last Executable Points of Trajectory
        let startPt = null;
        let endPt = null;

        for (let seg of segments) {
            if (seg.pts && seg.pts.length > 0) {
                if (!startPt) startPt = seg.pts[0];
                endPt = seg.pts[seg.pts.length - 1];
            }
        }

        // 2. Render Travel Paths (Dashed Gray Lines)
        if (legendLayers.travel) {
            segments.forEach(seg => {
                if (seg.type !== 'DRAW' && seg.pts && seg.pts.length >= 2) {
                    drawPathSegment(seg.pts, 'rgba(100, 116, 139, 0.7)', 1.5, [5, 5]);
                }
            });
        }

        // 3. Render Planned Blue Drawing Paths (Unexecuted) & Completed Green Drawing Paths
        segments.forEach((seg, segIdx) => {
            if (seg.type !== 'DRAW' || !seg.pts || seg.pts.length < 2) return;

            const pts = seg.pts;

            if (appState.robotState === 'COMPLETED') {
                // All executed drawing paths are GREEN at 100% completion
                if (legendLayers.completed) {
                    drawPathSegment(pts, '#10B981', currentLineWidthMm, []);
                }
            } else if (appState.robotState === 'SIMULATING' || appState.robotState === 'PAUSED') {
                // In DEMO simulation / pause state
                if (segIdx < animSegIdx) {
                    // Completed segment -> GREEN
                    if (legendLayers.completed) drawPathSegment(pts, '#10B981', currentLineWidthMm, []);
                } else if (segIdx > animSegIdx) {
                    // Remaining planned segment -> BLUE
                    if (legendLayers.draw) drawPathSegment(pts, '#2563EB', currentLineWidthMm, []);
                } else {
                    // Current active segment: split at animPtIdx
                    const donePts = pts.slice(0, Math.min(animPtIdx + 1, pts.length));
                    const remainPts = pts.slice(Math.max(0, animPtIdx));

                    if (legendLayers.completed && donePts.length >= 2) {
                        drawPathSegment(donePts, '#10B981', currentLineWidthMm, []);
                    }
                    if (legendLayers.draw && remainPts.length >= 2) {
                        drawPathSegment(remainPts, '#2563EB', currentLineWidthMm, []);
                    }
                }
            } else {
                // IDLE / READY state -> All planned drawing paths are BLUE
                if (legendLayers.draw) {
                    drawPathSegment(pts, '#2563EB', currentLineWidthMm, []);
                }
            }
        });

        // 4. Render Start Point Marker (Green circle with white/black outline)
        if (legendLayers.start && startPt) {
            const sc = mmToCanvasCoords(startPt[0], startPt[1]);
            ctx.beginPath();
            ctx.arc(sc.x, sc.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = '#10B981';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#FFFFFF';
            ctx.stroke();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#0F172A';
            ctx.stroke();
        }

        // 5. Render End Point Marker (Red circle with white/black outline)
        if (legendLayers.end && endPt) {
            const ec = mmToCanvasCoords(endPt[0], endPt[1]);
            ctx.beginPath();
            ctx.arc(ec.x, ec.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = '#EF4444';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#FFFFFF';
            ctx.stroke();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#0F172A';
            ctx.stroke();
        }

        // 6. Update Top-Down 2D Robot SVG Overlay Position & Orientation
        updateRobotSvgPosition();
    }

    // Initial State Render Startup
    setRobotMode('DEMO');
    setFSMState('IDLE');
    renderViewport();
});
