"""
Flask Backend Application for IoT Rangoli Drawing Robot
Provides 2D Trajectory Simulator, Image Processing Pipeline, and ESP32 Control API.
"""

import os
import math
import requests
from flask import Flask, render_template, request, jsonify

from core.image_processing import preprocess_rangoli_image
from core.vectorizer import skeleton_to_polylines, export_polylines_to_svg, parse_svg_to_continuous_paths
from core.grid_planner import GridPlanner
from core.kinematics import KinematicSolver
from core.benchmark_engine import BenchmarkEngine
from core.experiment_logger import ExperimentLogger

app = Flask(__name__, template_folder='templates', static_folder='static')

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

logger = ExperimentLogger()


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/benchmark', methods=['POST'])
def run_benchmark():
    """
    Automatic Benchmark Engine Endpoint:
    Runs all 4 planners (SGP, MR-PSP, APP, PSRM-P) on current paths,
    computes 13 robotics metrics, logs experiment JSON/CSV, and builds Thesis Chapter 4.
    """
    data = request.json or {}
    image_name = data.get('image_name', 'demo_rangoli.png')

    # If continuous paths provided or generated from demo
    cx, cy = 300.0, 300.0
    demo_paths = [
        [(300.0, 50.0), (550.0, 300.0), (300.0, 550.0), (50.0, 300.0), (300.0, 50.0)],
        [(cx + (180.0 * abs(math.sin(2 * math.radians(deg))) + 40.0) * math.cos(math.radians(deg)),
          cy + (180.0 * abs(math.sin(2 * math.radians(deg))) + 40.0) * math.sin(math.radians(deg))) for deg in range(0, 361, 10)]
    ]

    engine = BenchmarkEngine(canvas_width_mm=600.0, canvas_height_mm=600.0)
    benchmark_results = engine.run_benchmark_suite(demo_paths)

    # Log experiment
    json_path = logger.log_experiment(benchmark_results, image_name=image_name)
    csv_path = os.path.join(logger.experiment_dir, 'benchmark_comparison.csv')
    logger.export_csv(benchmark_results, csv_path)
    thesis_path = logger.generate_thesis_chapter_4(benchmark_results)

    return jsonify({
        'status': 'success',
        'provenance': '[Simulated Benchmark Outcome]',
        'benchmark_results': benchmark_results,
        'experiment_file': os.path.basename(json_path),
        'csv_file': os.path.basename(csv_path),
        'thesis_chapter_file': os.path.basename(thesis_path)
    })


@app.route('/api/export_thesis', methods=['GET'])
def export_thesis_chapter():
    """Returns generated Thesis Chapter 4 Markdown content."""
    thesis_path = os.path.join(logger.experiment_dir, 'thesis_chapter_4_results.md')
    if not os.path.exists(thesis_path):
        # Generate default chapter
        engine = BenchmarkEngine(canvas_width_mm=600.0, canvas_height_mm=600.0)
        demo_paths = [[(300.0, 50.0), (550.0, 300.0), (300.0, 550.0), (50.0, 300.0), (300.0, 50.0)]]
        benchmark_results = engine.run_benchmark_suite(demo_paths)
        thesis_path = logger.generate_thesis_chapter_4(benchmark_results)

    with open(thesis_path, 'r') as f:
        content = f.read()

    return jsonify({
        'status': 'success',
        'chapter_title': 'Chapter 4: Results, Discussion, Limitations & Future Work',
        'markdown_content': content
    })


@app.route('/api/demo_path', methods=['GET'])
def get_demo_path():
    """
    Generates a pre-built 8x8 Rangoli Lotus / Mandana vector design
    for immediate 2D simulation without needing to upload an image.
    """
    # Create geometric continuous strokes (8x8 grid: 0 to 600mm)
    cx, cy = 300.0, 300.0
    demo_paths = []

    # 1. Outer Diamond Border (spans grid cells A4->D8->H4->D1)
    diamond = [
        (300.0, 50.0), (550.0, 300.0), (300.0, 550.0), (50.0, 300.0), (300.0, 50.0)
    ]
    demo_paths.append(diamond)

    # 2. Inner Lotus Petals (continuous smooth curves)
    petal1 = []
    petal2 = []
    for deg in range(0, 361, 10):
        rad = math.radians(deg)
        r = 180.0 * abs(math.sin(2 * rad)) + 40.0
        x = cx + r * math.cos(rad)
        y = cy + r * math.sin(rad)
        petal1.append((round(x, 1), round(y, 1)))

        r2 = 120.0 * abs(math.cos(2 * rad)) + 30.0
        x2 = cx + r2 * math.cos(rad)
        y2 = cy + r2 * math.sin(rad)
        petal2.append((round(x2, 1), round(y2, 1)))

    demo_paths.append(petal1)
    demo_paths.append(petal2)

    # 3. Inner Center Circle
    circle = []
    for deg in range(0, 361, 15):
        rad = math.radians(deg)
        x = cx + 50.0 * math.cos(rad)
        y = cy + 50.0 * math.sin(rad)
        circle.append((round(x, 1), round(y, 1)))
    demo_paths.append(circle)

    # Plan serpentine 8x8 grid path starting at A1 (0,0)
    planner = GridPlanner(canvas_width_mm=600.0, canvas_height_mm=600.0, grid_cols=8, grid_rows=8)
    execution_segments = planner.plan_grid_aware_path(demo_paths)
    predicted_risk_score = planner.get_predicted_risk_score(execution_segments)

    # Kinematics command generation
    solver = KinematicSolver(wheelbase_mm=120.0, wheel_diameter_mm=44.0)
    esp32_commands = solver.generate_commands(execution_segments)

    return jsonify({
        'status': 'success',
        'execution_segments': execution_segments,
        'esp32_commands': esp32_commands,
        'predicted_risk_score': round(predicted_risk_score, 4),
        'risk_map': planner.risk_model.risk_map.tolist(),
        'summary': {
            'total_commands': len(esp32_commands),
            'total_draw_segments': len([s for s in execution_segments if s['type'] == 'DRAW']),
            'total_move_segments': len([s for s in execution_segments if s['type'] == 'MOVE'])
        }
    })


@app.route('/api/process', methods=['POST'])
def process_image():
    """
    OpenCV preprocessing -> SVG vectorization -> 8x8 Grid planning -> ESP32 command generation.
    Saves intermediate pipeline images (original, grayscale, threshold, edges, svg) and returns static URLs.
    """
    if 'image' not in request.files:
        return jsonify({'error': 'No image file uploaded'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    grid_cols = int(request.form.get('grid_cols', 8))
    grid_rows = int(request.form.get('grid_rows', 8))

    image_bytes = file.read()

    # Step 1: Preprocess, Skeletonize & Save Intermediate Images
    skeleton_matrix, saved_images = preprocess_rangoli_image(image_bytes, target_size=(600, 600), output_dir=UPLOAD_FOLDER)

    # Step 2: Vectorize to SVG
    polylines = skeleton_to_polylines(skeleton_matrix, min_length=5, epsilon=2.0)
    svg_filename = "rangoli_vector.svg"
    svg_path = os.path.join(UPLOAD_FOLDER, svg_filename)
    export_polylines_to_svg(polylines, svg_path, canvas_size=(600, 600))

    # Step 3: Parse SVG Continuous Paths
    continuous_paths = parse_svg_to_continuous_paths(svg_path, sampling_density=5.0)

    # Step 4: Serpentine Grid Planner (A1 to H8)
    planner = GridPlanner(canvas_width_mm=600.0, canvas_height_mm=600.0, grid_cols=grid_cols, grid_rows=grid_rows)
    execution_segments = planner.plan_grid_aware_path(continuous_paths)
    predicted_risk_score = planner.get_predicted_risk_score(execution_segments)

    # Step 5: Kinematics
    solver = KinematicSolver(wheelbase_mm=120.0, wheel_diameter_mm=44.0)
    esp32_commands = solver.generate_commands(execution_segments)

    image_urls = {
        'original': f'/static/uploads/{saved_images.get("original", "original.png")}',
        'grayscale': f'/static/uploads/{saved_images.get("grayscale", "grayscale.png")}',
        'threshold': f'/static/uploads/{saved_images.get("threshold", "threshold.png")}',
        'edges': f'/static/uploads/{saved_images.get("edges", "edges.png")}',
        'svg': f'/static/uploads/{svg_filename}'
    }

    return jsonify({
        'status': 'success',
        'image_urls': image_urls,
        'execution_segments': execution_segments,
        'esp32_commands': esp32_commands,
        'predicted_risk_score': round(predicted_risk_score, 4),
        'risk_map': planner.risk_model.risk_map.tolist(),
        'summary': {
            'total_commands': len(esp32_commands),
            'total_draw_segments': len([s for s in execution_segments if s['type'] == 'DRAW']),
            'total_move_segments': len([s for s in execution_segments if s['type'] == 'MOVE'])
        }
    })


@app.route('/api/send_to_esp32', methods=['POST'])
def send_to_esp32():
    data = request.json
    esp32_ip = data.get('esp32_ip', '192.168.4.1')
    commands = data.get('commands', [])

    if not commands:
        return jsonify({'error': 'No commands to send'}), 400

    esp32_url = f"http://{esp32_ip}/api/command"

    try:
        response = requests.post(esp32_url, json=commands, timeout=10)
        return jsonify({
            'status': 'success',
            'esp32_response': response.json()
        })
    except requests.exceptions.RequestException as e:
        return jsonify({
            'status': 'error',
            'message': f'Failed to connect to ESP32 at {esp32_ip}: {str(e)}'
        }), 500


if __name__ == '__main__':
    print("Starting Rangoli Simulator & Control Server at http://127.0.0.1:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
