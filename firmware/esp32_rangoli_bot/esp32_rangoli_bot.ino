/*
 * Advanced ESP32 Rangoli Drawing Robot Firmware
 * Final Production Implementation (B.Tech Capstone Project Team 12)
 * 
 * Hardware Architecture:
 * - ESP32-WROOM-32 Microcontroller
 * - Dual N20 Motors with Quadrature Encoders
 * - MPU6050 6-DOF IMU (I2C)
 * - TB6612FNG Dual H-Bridge Motor Driver
 * - SG90 Micro Servo Powder Dispenser
 * 
 * Pin Mapping:
 * - Left Motor PWM: GPIO 25, IN1: GPIO 26, IN2: GPIO 27
 * - Right Motor PWM: GPIO 14, IN1: GPIO 12, IN2: GPIO 13
 * - Left Encoder Phase A: GPIO 34 (Interrupt)
 * - Right Encoder Phase A: GPIO 35 (Interrupt)
 * - MPU6050 I2C: GPIO 21 (SDA), GPIO 22 (SCL)
 * - Dispenser SG90 Servo: GPIO 18
 * - Battery Voltage Divider ADC: GPIO 36 (VP)
 */

#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Wire.h>

// ---------- Network Credentials ----------
const char* ssid = "RangoliBot_AP";
const char* password = "rangolipassword";
const char* ws_host = "192.168.4.2"; // Backend Server IP
const uint16_t ws_port = 5000;

WebServer server(80);
WebSocketsClient webSocket;
Servo powderDispenser;

// ---------- Hardware Pins ----------
#define MOTOR_L_PWM 25
#define MOTOR_L_IN1 26
#define MOTOR_L_IN2 27

#define MOTOR_R_PWM 14
#define MOTOR_R_IN1 12
#define MOTOR_R_IN2 13

#define SERVO_PIN 18
#define SERVO_CLOSED_ANGLE 0
#define SERVO_OPEN_ANGLE 75
#define PRE_ACTUATION_LEAD_MS 60

#define ENCODER_L_PIN 34
#define ENCODER_R_PIN 35

#define BATTERY_ADC_PIN 36
#define MPU6050_ADDR 0x68

// Kinematic Calibration Constants
const float WHEEL_DIAMETER_MM = 44.0;
const float WHEEL_BASE_MM = 120.0;
const float PULSES_PER_REV = 360.0;
const float MM_PER_PULSE = (3.14159265 * WHEEL_DIAMETER_MM) / PULSES_PER_REV;

// State Variables
volatile long leftEncoderCount = 0;
volatile long rightEncoderCount = 0;

float currentYaw = 0.0;
float gyroZOffset = 0.0;
unsigned long lastYawTime = 0;
unsigned long lastHeartbeatTime = 0;

float currentX_mm = 15.0;
float currentY_mm = 15.0;
bool isPowderDispensing = false;
String robotStateStr = "IDLE";

void IRAM_ATTR leftEncoderISR() {
  leftEncoderCount++;
}

void IRAM_ATTR rightEncoderISR() {
  rightEncoderCount++;
}

// ---------- Battery Telemetry ADC Solver ----------
float getBatteryVoltage() {
  int rawADC = analogRead(BATTERY_ADC_PIN);
  float vAdc = (rawADC / 4095.0) * 3.3;
  // Voltage divider parameters (R1 = 10k, R2 = 3.3k) -> divider ratio 4.03
  float vBat = vAdc * 4.03;
  return vBat;
}

int getBatteryPercent() {
  float v = getBatteryVoltage();
  if (v <= 10.5) return 0;
  if (v >= 12.6) return 100;
  return (int)(((v - 10.5) / 2.1) * 100.0);
}

// ---------- MPU6050 IMU Yaw Orientation Solver ----------
void initMPU6050() {
  Wire.begin(21, 22);
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x6B); // PWR_MGMT_1
  Wire.write(0x00); // Wake up MPU6050
  Wire.endTransmission(true);

  // Simple Gyro Z Offset Calibration (averaged over 100 samples)
  float sumZ = 0.0;
  for (int i = 0; i < 100; i++) {
    Wire.beginTransmission(MPU6050_ADDR);
    Wire.write(0x47); // GYRO_ZOUT_H
    Wire.endTransmission(false);
    Wire.requestFrom(MPU6050_ADDR, 2, true);
    if (Wire.available() >= 2) {
      int16_t gz = (Wire.read() << 8) | Wire.read();
      sumZ += (gz / 131.0);
    }
    delay(2);
  }
  gyroZOffset = sumZ / 100.0;
  lastYawTime = millis();
}

void updateYaw() {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x47);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU6050_ADDR, 2, true);
  if (Wire.available() >= 2) {
    int16_t gz = (Wire.read() << 8) | Wire.read();
    float gyroZ = (gz / 131.0) - gyroZOffset;

    unsigned long now = millis();
    float dt = (now - lastYawTime) / 1000.0;
    lastYawTime = now;

    if (abs(gyroZ) > 0.3) {
      currentYaw += gyroZ * dt;
    }
  }
}

// ---------- Motor Driver Pins & Actuation ----------
void setupMotors() {
  pinMode(MOTOR_L_PWM, OUTPUT);
  pinMode(MOTOR_L_IN1, OUTPUT);
  pinMode(MOTOR_L_IN2, OUTPUT);

  pinMode(MOTOR_R_PWM, OUTPUT);
  pinMode(MOTOR_R_IN1, OUTPUT);
  pinMode(MOTOR_R_IN2, OUTPUT);
}

void setLeftMotor(int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    digitalWrite(MOTOR_L_IN1, HIGH);
    digitalWrite(MOTOR_L_IN2, LOW);
    analogWrite(MOTOR_L_PWM, speed);
  } else if (speed < 0) {
    digitalWrite(MOTOR_L_IN1, LOW);
    digitalWrite(MOTOR_L_IN2, HIGH);
    analogWrite(MOTOR_L_PWM, abs(speed));
  } else {
    digitalWrite(MOTOR_L_IN1, LOW);
    digitalWrite(MOTOR_L_IN2, LOW);
    analogWrite(MOTOR_L_PWM, 0);
  }
}

void setRightMotor(int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    digitalWrite(MOTOR_R_IN1, HIGH);
    digitalWrite(MOTOR_R_IN2, LOW);
    analogWrite(MOTOR_R_PWM, speed);
  } else if (speed < 0) {
    digitalWrite(MOTOR_R_IN1, LOW);
    digitalWrite(MOTOR_R_IN2, HIGH);
    analogWrite(MOTOR_R_PWM, abs(speed));
  } else {
    digitalWrite(MOTOR_R_IN1, LOW);
    digitalWrite(MOTOR_R_IN2, LOW);
    analogWrite(MOTOR_R_PWM, 0);
  }
}

void stopMotors() {
  setLeftMotor(0);
  setRightMotor(0);
}

void setDispenser(bool enable) {
  isPowderDispensing = enable;
  if (enable) {
    powderDispenser.write(SERVO_OPEN_ANGLE);
    delay(PRE_ACTUATION_LEAD_MS);
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
  float Kp_sync = 3.0;

  int dir = (dist_mm >= 0) ? 1 : -1;
  robotStateStr = isPowderDispensing ? "DRAWING" : "MOVING";

  while ((abs(leftEncoderCount) + abs(rightEncoderCount)) / 2 < targetPulses) {
    updateYaw();
    webSocket.loop();
    float yawError = currentYaw - startYaw;

    int leftSpeed = dir * baseSpeed - (yawError * Kp_sync);
    int rightSpeed = dir * baseSpeed + (yawError * Kp_sync);

    setLeftMotor(leftSpeed);
    setRightMotor(rightSpeed);
    delay(10);
  }
  stopMotors();
  robotStateStr = "IDLE";
  delay(50);
}

void turnAngleIMU(float angle_deg, int speed) {
  stopMotors();
  delay(80);

  float targetYaw = currentYaw + angle_deg;
  float Kp_turn = 2.5;
  robotStateStr = "TURNING";

  while (abs(targetYaw - currentYaw) > 0.5) {
    updateYaw();
    webSocket.loop();
    float error = targetYaw - currentYaw;
    int pSpeed = constrain((int)(abs(error) * Kp_turn + 40), 40, speed);

    if (error > 0) {
      setLeftMotor(pSpeed);
      setRightMotor(-pSpeed);
    } else {
      setLeftMotor(-pSpeed);
      setRightMotor(pSpeed);
    }
    delay(10);
  }
  stopMotors();
  robotStateStr = "IDLE";
  delay(80);
}

// ---------- WebSocket Event Handler ----------
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected from backend server!");
      stopMotors();
      setDispenser(false);
      robotStateStr = "CONNECTION_LOST";
      break;

    case WStype_CONNECTED:
      Serial.println("[WS] Connected to backend server. Registering BOT-01...");
      {
        StaticJsonDocument<256> doc;
        doc["type"] = "register";
        doc["robot_id"] = "BOT-01";
        doc["firmware"] = "1.0.0";
        doc["ip"] = WiFi.localIP().toString();

        String jsonStr;
        serializeJson(doc, jsonStr);
        webSocket.sendTXT(jsonStr);
      }
      break;

    case WStype_TEXT:
      {
        StaticJsonDocument<1024> doc;
        DeserializationError err = deserializeJson(doc, payload, length);
        if (err) return;

        String msgType = doc["type"].as<String>();
        if (msgType == "emergency_stop") {
          stopMotors();
          setDispenser(false);
          robotStateStr = "EMERGENCY_STOP";
          Serial.println("[WS] EMERGENCY STOP COMMAND RECEIVED!");
        }
      }
      break;
  }
}

// ---------- WebSocket Heartbeat Broadcast ----------
void sendHeartbeatTelemetry() {
  if (millis() - lastHeartbeatTime > 1500) {
    lastHeartbeatTime = millis();
    StaticJsonDocument<512> doc;
    doc["type"] = "heartbeat";
    doc["robot_id"] = "BOT-01";
    doc["battery_voltage"] = round(getBatteryVoltage() * 100.0) / 100.0;
    doc["battery_percent"] = getBatteryPercent();
    doc["x"] = round(currentX_mm * 10.0) / 10.0;
    doc["y"] = round(currentY_mm * 10.0) / 10.0;
    doc["heading"] = round(currentYaw * 10.0) / 10.0;
    doc["state"] = robotStateStr;
    doc["powder"] = isPowderDispensing;

    String jsonStr;
    serializeJson(doc, jsonStr);
    webSocket.sendTXT(jsonStr);
  }
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

  server.send(200, "application/json", "{\"status\":\"success\",\"message\":\"Commands executed cleanly\"}");
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

  webSocket.begin(ws_host, ws_port, "/robot/ws");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);

  server.on("/api/command", HTTP_POST, handleExecuteCommands);
  server.begin();
  Serial.println("ESP32 Rangoli Bot Production Firmware Ready.");
}

void loop() {
  server.handleClient();
  webSocket.loop();
  updateYaw();
  sendHeartbeatTelemetry();
}
