"""
Flask Backend Application for IoT Rangoli Drawing Robot
Provides 2D Trajectory Simulator, Image Processing Pipeline, and ESP32 Control API.
"""

import os
import math
import requests
import cv2
from flask import Flask, render_template, request, jsonify

from core.image_processing import preprocess_rangoli_image
from core.vectorizer import contours_to_polylines, skeleton_to_polylines, export_polylines_to_svg, parse_svg_to_continuous_paths
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

    cx, cy = 300.0, 300.0
    demo_paths = [
        [(300.0, 50.0), (550.0, 300.0), (300.0, 550.0), (50.0, 300.0), (300.0, 50.0)],
        [(cx + (180.0 * abs(math.sin(2 * math.radians(deg))) + 40.0) * math.cos(math.radians(deg)),
          cy + (180.0 * abs(math.sin(2 * math.radians(deg))) + 40.0) * math.sin(math.radians(deg))) for deg in range(0, 361, 10)]
    ]

    engine = BenchmarkEngine(canvas_width_mm=600.0, canvas_height_mm=600.0)
    benchmark_results = engine.run_benchmark_suite(demo_paths)

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
    cx, cy = 300.0, 300.0
    demo_paths = []

    diamond = [
        (300.0, 50.0), (550.0, 300.0), (300.0, 550.0), (50.0, 300.0), (300.0, 50.0)
    ]
    demo_paths.append(diamond)

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

    circle = []
    for deg in range(0, 361, 15):
        rad = math.radians(deg)
        x = cx + 50.0 * math.cos(rad)
        y = cy + 50.0 * math.sin(rad)
        circle.append((round(x, 1), round(y, 1)))
    demo_paths.append(circle)

    planner = GridPlanner(canvas_width_mm=600.0, canvas_height_mm=600.0, grid_cols=8, grid_rows=8)
    execution_segments = planner.plan_grid_aware_path(demo_paths)
    predicted_risk_score = planner.get_predicted_risk_score(execution_segments)

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
    OpenCV preprocessing (Original -> Grayscale -> Otsu Binary -> Morph Closing -> Morph Opening -> FindContours RETR_TREE)
    -> SVG vectorization -> 8x8 Grid planning -> ESP32 command generation.
    """
    if 'image' not in request.files:
        return jsonify({'error': 'No image file uploaded'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    grid_cols = int(request.form.get('grid_cols', 8))
    grid_rows = int(request.form.get('grid_rows', 8))
    min_area = float(request.form.get('min_area', 50.0))

    image_bytes = file.read()

    # Step 1: Preprocess with Contour Pipeline & Save Intermediate Stage Images
    contours, saved_images, diagnostics = preprocess_rangoli_image(image_bytes, target_size=(600, 600), min_area=min_area, output_dir=UPLOAD_FOLDER)

    if diagnostics.get('failed_stage'):
        return jsonify({
            'status': 'error',
            'failed_stage': diagnostics['failed_stage'],
            'diagnostics': diagnostics,
            'image_urls': {
                'original': f'/static/uploads/{saved_images.get("original", "original.png")}',
                'grayscale': f'/static/uploads/{saved_images.get("grayscale", "grayscale.png")}',
                'threshold': f'/static/uploads/{saved_images.get("threshold", "threshold.png")}',
                'morphology': f'/static/uploads/{saved_images.get("morphology", "morphology.png")}',
                'contours': f'/static/uploads/{saved_images.get("contours", "contours.png")}'
            }
        }), 422

    # Step 2: Vectorize Contours to Continuous SVG Paths
    polylines, vec_stats = contours_to_polylines(contours, min_length=4, epsilon=None)
    diagnostics.update(vec_stats)

    svg_filename = "rangoli_vector.svg"
    svg_path = os.path.join(UPLOAD_FOLDER, svg_filename)
    export_polylines_to_svg(polylines, svg_path, canvas_size=(600, 600))

    # Generate SVG Overlay Image on top of Original Image
    from core.image_processing import generate_svg_overlay_image
    orig_img_path = os.path.join(UPLOAD_FOLDER, saved_images.get('original', 'original.png'))
    overlay_filename = "svg_overlay.png"
    if os.path.exists(orig_img_path):
        orig_img_mat = cv2.imread(orig_img_path)
        generate_svg_overlay_image(orig_img_mat, polylines, os.path.join(UPLOAD_FOLDER, overlay_filename))

    # Step 3: Parse SVG Continuous Paths directly from generated SVG
    continuous_paths = parse_svg_to_continuous_paths(svg_path, sampling_density=5.0)

    # Step 4: Serpentine Grid Planner (A1 to H8)
    planner = GridPlanner(canvas_width_mm=600.0, canvas_height_mm=600.0, grid_cols=grid_cols, grid_rows=grid_rows)
    execution_segments = planner.plan_grid_aware_path(continuous_paths)
    predicted_risk_score = planner.get_predicted_risk_score(execution_segments)

    # Step 5: Kinematics Commands Generation
    solver = KinematicSolver(wheelbase_mm=120.0, wheel_diameter_mm=44.0)
    esp32_commands = solver.generate_commands(execution_segments)

    # Step 6: Path Statistics & Command Continuity Verification
    draw_travel_mm = 0.0
    dry_travel_mm = 0.0
    total_turns = 0
    discontinuities_count = 0
    discontinuity_points = []

    first_point = None
    last_point = None

    for i, seg in enumerate(execution_segments):
        pts = seg['pts']
        if not pts:
            continue
        if first_point is None:
            first_point = [round(pts[0][0], 1), round(pts[0][1], 1)]
        last_point = [round(pts[-1][0], 1), round(pts[-1][1], 1)]

        seg_dist = sum(math.hypot(pts[k+1][0] - pts[k][0], pts[k+1][1] - pts[k][1]) for k in range(len(pts) - 1))

        if seg['type'] == 'DRAW':
            draw_travel_mm += seg_dist
        else:
            dry_travel_mm += seg_dist
            discontinuities_count += 1
            discontinuity_points.append([round(pts[0][0], 1), round(pts[0][1], 1)])

        # Count turns (> 15 deg)
        for k in range(len(pts) - 2):
            v1 = (pts[k+1][0] - pts[k][0], pts[k+1][1] - pts[k][1])
            v2 = (pts[k+2][0] - pts[k+1][0], pts[k+2][1] - pts[k+1][1])
            len1 = math.hypot(v1[0], v1[1])
            len2 = math.hypot(v2[0], v2[1])
            if len1 > 0.1 and len2 > 0.1:
                dot = (v1[0]*v2[0] + v1[1]*v2[1]) / (len1 * len2)
                dot = max(-1.0, min(1.0, dot))
                angle_deg = math.degrees(math.acos(dot))
                if angle_deg > 15.0:
                    total_turns += 1

    total_path_length_mm = draw_travel_mm + dry_travel_mm
    v_draw = 80.0  # mm/s medium speed
    v_dry = 120.0  # mm/s dry relocation speed
    est_drawing_time_s = round((draw_travel_mm / v_draw) + (dry_travel_mm / v_dry) + len(polylines) * 1.2, 1)
    avg_speed_mm_s = round(total_path_length_mm / max(1.0, est_drawing_time_s), 1)

    diagnostics['final_svg_paths'] = len(polylines)
    diagnostics['robot_commands_count'] = len(esp32_commands)
    diagnostics['draw_travel_m'] = round(draw_travel_mm / 1000.0, 3)
    diagnostics['dry_travel_m'] = round(dry_travel_mm / 1000.0, 3)
    diagnostics['total_path_length_mm'] = round(total_path_length_mm, 1)
    diagnostics['total_path_length_m'] = round(total_path_length_mm / 1000.0, 3)
    diagnostics['estimated_drawing_time_s'] = est_drawing_time_s
    diagnostics['total_turns'] = total_turns
    diagnostics['discontinuities_count'] = discontinuities_count
    diagnostics['discontinuity_points'] = discontinuity_points
    diagnostics['average_speed_mm_s'] = avg_speed_mm_s
    diagnostics['first_point'] = first_point or [0.0, 0.0]
    diagnostics['last_point'] = last_point or [0.0, 0.0]

    # Final Engineering Verification Report
    final_engineering_report = {
        'image_type': diagnostics['image_type_detected'],
        'contours_found': diagnostics['total_contours_found'],
        'contours_removed': diagnostics['contours_removed'],
        'valid_contours': diagnostics['valid_contours_count'],
        'raw_points': diagnostics['raw_points_count'],
        'optimized_points': diagnostics['optimized_points_count'],
        'reduction_pct': diagnostics['point_reduction_pct'],
        'robot_commands': diagnostics['robot_commands_count'],
        'draw_distance_m': diagnostics['draw_travel_m'],
        'travel_distance_m': diagnostics['dry_travel_m'],
        'total_distance_m': diagnostics['total_path_length_m'],
        'total_turns': total_turns,
        'discontinuities_count': discontinuities_count,
        'estimated_time_s': diagnostics['estimated_drawing_time_s'],
        'average_speed_mm_s': avg_speed_mm_s,
        'processing_time_ms': diagnostics['processing_time_ms'],
        'first_point': diagnostics['first_point'],
        'last_point': diagnostics['last_point']
    }

    # Print Verification Report to Server Terminal Console
    print("\n================ FINAL ENGINEERING VERIFICATION REPORT ================")
    print(f"  - Image Type Detected   : {final_engineering_report['image_type']}")
    print(f"  - Contours Found        : {final_engineering_report['contours_found']}")
    print(f"  - Contours Removed      : {final_engineering_report['contours_removed']} (< {min_area} px^2)")
    print(f"  - Valid Contours        : {final_engineering_report['valid_contours']}")
    print(f"  - SVG Point Reduction   : {final_engineering_report['raw_points']} -> {final_engineering_report['optimized_points']} pts ({final_engineering_report['reduction_pct']}%)")
    print(f"  - Robot Commands Count  : {final_engineering_report['robot_commands']}")
    print(f"  - Draw Distance (m)     : {final_engineering_report['draw_distance_m']} m")
    print(f"  - Dry Travel Distance   : {final_engineering_report['travel_distance_m']} m")
    print(f"  - Total Path Distance   : {final_engineering_report['total_distance_m']} m")
    print(f"  - Total Turns           : {final_engineering_report['total_turns']}")
    print(f"  - Discontinuities Count : {final_engineering_report['discontinuities_count']}")
    print(f"  - Est. Execution Time   : {final_engineering_report['estimated_time_s']} s")
    print(f"  - Average Speed         : {final_engineering_report['average_speed_mm_s']} mm/s")
    print(f"  - Processing Time       : {final_engineering_report['processing_time_ms']} ms")
    print(f"  - Motion Sequence Bounds: Start {final_engineering_report['first_point']} -> End {final_engineering_report['last_point']}")
    print("=======================================================================\n")

    image_urls = {
        'original': f'/static/uploads/{saved_images.get("original", "original.png")}',
        'grayscale': f'/static/uploads/{saved_images.get("grayscale", "grayscale.png")}',
        'threshold': f'/static/uploads/{saved_images.get("threshold", "threshold.png")}',
        'morphology': f'/static/uploads/{saved_images.get("morphology", "morphology.png")}',
        'contours': f'/static/uploads/{saved_images.get("contours", "contours.png")}',
        'overlay': f'/static/uploads/{overlay_filename}',
        'edges': f'/static/uploads/{saved_images.get("contours", "contours.png")}',
        'svg': f'/static/uploads/{svg_filename}'
    }

    return jsonify({
        'status': 'success',
        'image_urls': image_urls,
        'diagnostics': diagnostics,
        'final_engineering_report': final_engineering_report,
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
