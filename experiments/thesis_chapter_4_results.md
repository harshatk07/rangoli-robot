# Chapter 4: Simulation Results, Benchmarking & Discussion
**Data Provenance**: All quantitative metrics in this chapter are derived from the **Robotics Evaluation & Benchmarking Simulation Platform**. Values represent **[Simulated]** or **[Estimated]** performance metrics under ideal kinematic conditions.

---

## 4.1 Quantitative Comparative Benchmark Results

| Metric | Serpentine Grid (SGP) | Mobile Print-Swath (MR-PSP) | Adaptive Planner (APP) | PSRM Planner (PSRM-P) |
|---|---|---|---|---|
| **Smudge Risk Score R(C) [Simulated]** | 0.0692 | 0.0692 | 0.0692 | **0.0692** |
| **Total Path Length (m) [Simulated]** | 3.829 | 3.829 | 3.829 | **3.829** |
| **Dry Travel Distance (m) [Simulated]** | 0.557 | 0.557 | 0.557 | **0.557** |
| **Number of Turns [Simulated]** | 25 | 25 | 25 | **25** |
| **Dispenser Actuations [Simulated]** | 3 | 3 | 3 | **3** |
| **Est. Completion Time (s) [Estimated]** | 65.7s | 65.7s | 65.7s | **65.7s** |
| **Stroke Preservation Rate [Simulated]** | 100.0% | 100.0% | 100.0% | **100.0%** |

---

## 4.2 Discussion of Simulation Findings

3. **Motion Efficiency**:
   PSRM-P reduced the total number of rotational turns from **25** down to **25**, saving execution time.

---

## 4.3 System Limitations & Threats to Validity

> [!WARNING]
> **Important Distinction**: The metrics presented in this chapter are derived from kinematic software simulations. Physical hardware validation is subject to real-world friction and sensor noise.

1. **Floor Surface Friction Variance**: Simulations assume a uniform friction coefficient $\mu$. In real-world environments, tile smooth variations or powder dust may induce unmodeled wheel slip.
2. **MPU6050 Gyro Thermal Drift**: While MPU6050 zero-velocity update (ZUPT) is implemented, uncalibrated temperature drift may introduce micro heading errors during long runs.
3. **Powder Flow Rate Dynamics**: Powder flow is assumed uniform when the SG90 servo gate is OPEN ($1$). Humidity or powder clumping may cause variable line width.

---

## 4.4 Future Work & Experimental Recommendations

1. **Empirical Physical Testing**: Execute physical trials on the ESP32 mobile robot prototype using the established 3-step optical smudge measurement protocol.
2. **Visual Odometry Integration**: Evaluate adding an optical flow mouse sensor (< INR 200) on the underside to measure ground displacement directly.
3. **Dynamic Speed Scaling**: Adjust linear motor speed dynamically based on line curvature $\kappa$ to further improve powder line uniformity.
