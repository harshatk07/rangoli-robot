/*
 * Advanced ESP32 Rangoli Drawing Robot Firmware
 * Research Engineering Level Implementation (< INR 10,000 Budget)
 * 
 * Sensors & Actuators:
 * - ESP32-WROOM-32 Microcontroller
 * - Dual N20 Motors with Quadrature Encoders
 * - MPU6050 6-DOF IMU (I2C)
 * - TB6612FNG Dual H-Bridge Motor Driver
 * - SG90 Micro Servo Powder Dispenser
 * 
 * Hardware Pin Mapping:
 * - Left Motor PWM: GPIO 25, IN1: GPIO 26, IN2: GPIO 27
 * - Right Motor PWM: GPIO 14, IN1: GPIO 12, IN2: GPIO 13
 * - Left Encoder Phase A: GPIO 34 (Interrupt)
 * - Right Encoder Phase A: GPIO 35 (Interrupt)
 * - MPU6050 I2C: GPIO 21 (SDA), GPIO 22 (SCL)
 * - Dispenser SG90 Servo: GPIO 18
 */

#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Wire.h>

// ---------- Wi-Fi Credentials ----------
const char* ssid = "RangoliBot_AP";
const char* password = "rangolipassword";

WebServer server(80);
Servo powderDispenser;

// ---------- Motor Driver Pins ----------
#define MOTOR_L_PWM 25
#define MOTOR_L_IN1 26
#define MOTOR_L_IN2 27

#define MOTOR_R_PWM 14
#define MOTOR_R_IN1 12
#define MOTOR_R_IN2 13

// ---------- Servo Dispenser Pin ----------
#define SERVO_PIN 18
#define SERVO_CLOSED_ANGLE 0
#define SERVO_OPEN_ANGLE 75
#define PRE_ACTUATION_LEAD_MS 60

// ---------- Encoder Pins ----------
#define ENCODER_L_PIN 34
#define ENCODER_R_PIN 35

// ---------- MPU6050 I2C Address ----------
#define MPU6050_ADDR 0x68

// ---------- Physical Robot Parameters ----------
const float WHEEL_DIAMETER_MM = 44.0;
const float WHEELBASE_MM = 120.0;
const int ENCODER_CPR = 360;
const float MM_PER_PULSE = (3.14159265 * WHEEL_DIAMETER_MM) / ENCODER_CPR;

volatile long leftEncoderCount = 0;
volatile long rightEncoderCount = 0;

float gyroZBias = 0.0;
float currentYaw = 0.0;
unsigned long lastImuTime = 0;

void IRAM_ATTR leftEncoderISR() { leftEncoderCount++; }
void IRAM_ATTR rightEncoderISR() { rightEncoderCount++; }

// ---------- MPU6050 Low-Level Helper ----------
void initMPU6050() {
  Wire.begin(21, 22);
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x6B); // Power Management 1 register
  Wire.write(0);    // Wake up MPU6050
  Wire.endTransmission(true);

  delay(100);
  calibrateGyro();
}

void calibrateGyro() {
  float sum = 0.0;
  int samples = 200;
  for (int i = 0; i < samples; i++) {
    Wire.beginTransmission(MPU6050_ADDR);
    Wire.write(0x47); // Gyro Z high byte
    Wire.endTransmission(false);
    Wire.requestFrom(MPU6050_ADDR, 2, true);
    int16_t rawZ = (Wire.read() << 8) | Wire.read();
    sum += (rawZ / 131.0); // 131 LSB/(deg/s) for +/-250dps
    delay(5);
  }
  gyroZBias = sum / samples;
  lastImuTime = millis();
}

float getGyroZRate() {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x47);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU6050_ADDR, 2, true);
  int16_t rawZ = (Wire.read() << 8) | Wire.read();
  return (rawZ / 131.0) - gyroZBias;
}

void updateYaw() {
  unsigned long now = millis();
  float dt = (now - lastImuTime) / 1000.0;
  lastImuTime = now;
  if (dt > 0.0 && dt < 0.5) {
    float gz = getGyroZRate();
    currentYaw += gz * dt;
  }
}

// ---------- Motor Driver Setup ----------
void setupMotors() {
  pinMode(MOTOR_L_IN1, OUTPUT);
  pinMode(MOTOR_L_IN2, OUTPUT);
  pinMode(MOTOR_R_IN1, OUTPUT);
  pinMode(MOTOR_R_IN2, OUTPUT);

#if defined(ESP_IDF_VERSION_MAJOR) && ESP_IDF_VERSION_MAJOR >= 5
  ledcAttach(MOTOR_L_PWM, 5000, 8);
  ledcAttach(MOTOR_R_PWM, 5000, 8);
#else
  ledcSetup(0, 5000, 8);
  ledcAttachPin(MOTOR_L_PWM, 0);
  ledcSetup(1, 5000, 8);
  ledcAttachPin(MOTOR_R_PWM, 1);
#endif
}

void setLeftMotor(int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    digitalWrite(MOTOR_L_IN1, HIGH);
    digitalWrite(MOTOR_L_IN2, LOW);
#if defined(ESP_IDF_VERSION_MAJOR) && ESP_IDF_VERSION_MAJOR >= 5
    ledcWrite(MOTOR_L_PWM, speed);
#else
    ledcWrite(0, speed);
#endif
  } else if (speed < 0) {
    digitalWrite(MOTOR_L_IN1, LOW);
    digitalWrite(MOTOR_L_IN2, HIGH);
#if defined(ESP_IDF_VERSION_MAJOR) && ESP_IDF_VERSION_MAJOR >= 5
    ledcWrite(MOTOR_L_PWM, abs(speed));
#else
    ledcWrite(0, abs(speed));
#endif
  } else {
    digitalWrite(MOTOR_L_IN1, LOW);
    digitalWrite(MOTOR_L_IN2, LOW);
#if defined(ESP_IDF_VERSION_MAJOR) && ESP_IDF_VERSION_MAJOR >= 5
    ledcWrite(MOTOR_L_PWM, 0);
#else
    ledcWrite(0, 0);
#endif
  }
}

void setRightMotor(int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    digitalWrite(MOTOR_R_IN1, HIGH);
    digitalWrite(MOTOR_R_IN2, LOW);
#if defined(ESP_IDF_VERSION_MAJOR) && ESP_IDF_VERSION_MAJOR >= 5
    ledcWrite(MOTOR_R_PWM, speed);
#else
    ledcWrite(1, speed);
#endif
  } else if (speed < 0) {
    digitalWrite(MOTOR_R_IN1, LOW);
    digitalWrite(MOTOR_R_IN2, HIGH);
#if defined(ESP_IDF_VERSION_MAJOR) && ESP_IDF_VERSION_MAJOR >= 5
    ledcWrite(MOTOR_R_PWM, abs(speed));
#else
    ledcWrite(1, abs(speed));
#endif
  } else {
    digitalWrite(MOTOR_R_IN1, LOW);
    digitalWrite(MOTOR_R_IN2, LOW);
#if defined(ESP_IDF_VERSION_MAJOR) && ESP_IDF_VERSION_MAJOR >= 5
    ledcWrite(MOTOR_R_PWM, 0);
#else
    ledcWrite(1, 0);
#endif
  }
}

void stopMotors() {
  setLeftMotor(0);
  setRightMotor(0);
}

void setDispenser(bool enable) {
  if (enable) {
    powderDispenser.write(SERVO_OPEN_ANGLE);
    delay(PRE_ACTUATION_LEAD_MS); // Pre-actuation lead timing
  } else {
    powderDispenser.write(SERVO_CLOSED_ANGLE);
    delay(PRE_ACTUATION_LEAD_MS);
  }
}

// ---------- Closed-Loop Dual PID Move & Turn ----------
void moveDistance(float dist_mm, int baseSpeed) {
  leftEncoderCount = 0;
  rightEncoderCount = 0;
  long targetPulses = abs(dist_mm) / MM_PER_PULSE;

  float startYaw = currentYaw;
  float Kp_sync = 3.0; // Heading Sync Gain

  int dir = (dist_mm >= 0) ? 1 : -1;

  while ((abs(leftEncoderCount) + abs(rightEncoderCount)) / 2 < targetPulses) {
    updateYaw();
    float yawError = currentYaw - startYaw;

    int leftSpeed = dir * baseSpeed - (yawError * Kp_sync);
    int rightSpeed = dir * baseSpeed + (yawError * Kp_sync);

    setLeftMotor(leftSpeed);
    setRightMotor(rightSpeed);
    delay(10);
  }
  stopMotors();
  delay(50);
}

void turnAngleIMU(float angle_deg, int speed) {
  stopMotors();
  delay(80); // Zero Velocity Stabilization

  float targetYaw = currentYaw + angle_deg;
  float Kp_turn = 2.5;

  while (abs(targetYaw - currentYaw) > 0.5) {
    updateYaw();
    float error = targetYaw - currentYaw;
    int pSpeed = constrain((int)(abs(error) * Kp_turn + 40), 40, speed);

    if (error > 0) { // Turn Right
      setLeftMotor(pSpeed);
      setRightMotor(-pSpeed);
    } else { // Turn Left
      setLeftMotor(-pSpeed);
      setRightMotor(pSpeed);
    }
    delay(10);
  }
  stopMotors();
  delay(80);
}

// ---------- HTTP API Handlers ----------
void handleExecuteCommands() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"No JSON payload\"}");
    return;
  }

  String jsonBody = server.arg("plain");
  DynamicJsonDocument doc(16384);
  DeserializationError err = deserializeJson(doc, jsonBody);

  if (err) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Invalid JSON\"}");
    return;
  }

  JsonArray commands = doc.as<JsonArray>();
  for (JsonObject cmd : commands) {
    String type = cmd["cmd"].as<String>();

    if (type == "MOVE") {
      float dist = cmd["dist"].as<float>();
      int speed = cmd["speed"] | 100;
      moveDistance(dist, speed);
    } else if (type == "TURN") {
      float angle = cmd["angle"].as<float>();
      int speed = cmd["speed"] | 80;
      turnAngleIMU(angle, speed);
    } else if (type == "DISPENSE") {
      int state = cmd["state"].as<int>();
      setDispenser(state == 1);
    } else if (type == "FINISH") {
      setDispenser(false);
      stopMotors();
    }
  }

  server.send(200, "application/json", "{\"status\":\"success\",\"message\":\"Commands executed with IMU closed-loop accuracy\"}");
}

void setup() {
  Serial.begin(115200);
  setupMotors();
  initMPU6050();

  pinMode(ENCODER_L_PIN, INPUT_PULLUP);
  pinMode(ENCODER_R_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(ENCODER_L_PIN), leftEncoderISR, RISING);
  attachInterrupt(digitalPinToInterrupt(ENCODER_R_PIN), rightEncoderISR, RISING);

  powderDispenser.attach(SERVO_PIN);
  setDispenser(false);

  WiFi.softAP(ssid, password);
  Serial.print("Access Point Created. ESP32 IP: ");
  Serial.println(WiFi.softAPIP());

  server.on("/api/command", HTTP_POST, handleExecuteCommands);
  server.begin();
  Serial.println("ESP32 Rangoli Bot Ready.");
}

void loop() {
  server.handleClient();
  updateYaw();
}
