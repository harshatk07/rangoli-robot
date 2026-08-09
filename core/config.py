"""
System Configuration & Hardware Parameters for IoT Autonomous Rangoli Drawing Robot
"""

class RobotConfig:
    # Workspace Bounds (2x2 ft = 610x610 mm)
    CANVAS_WIDTH_MM: float = 610.0
    CANVAS_HEIGHT_MM: float = 610.0
    SAFETY_MARGIN_MM: float = 15.0
    
    # Kinematics & Mechanical Specifications
    WHEELBASE_MM: float = 120.0
    WHEEL_DIAMETER_MM: float = 44.0
    ENCODER_CPR: int = 360 # N20 encoder pulses per revolution (expandable)
    
    # Speed Profiles (mm/s)
    SPEED_SLOW: float = 50.0
    SPEED_MEDIUM: float = 80.0
    SPEED_FAST: float = 120.0
    
    # Battery & Power Thresholds
    BATTERY_NOMINAL_VOLTS: float = 11.1
    BATTERY_LOW_VOLTS: float = 10.5
    BATTERY_CRITICAL_VOLTS: float = 9.9
    
    # Powder Dispenser Settings
    POWDER_DISPENSE_PWM_DEFAULT: int = 200 # 0 - 255 PWM
    
    # Network & Telemetry
    TELEMETRY_INTERVAL_MS: int = 100
    WATCHDOG_TIMEOUT_SEC: float = 35.0

    @classmethod
    def get_usable_bounds(cls):
        return {
            'min_x': cls.SAFETY_MARGIN_MM,
            'max_x': cls.CANVAS_WIDTH_MM - cls.SAFETY_MARGIN_MM,
            'min_y': cls.SAFETY_MARGIN_MM,
            'max_y': cls.CANVAS_HEIGHT_MM - cls.SAFETY_MARGIN_MM
        }
