import io
import os
import re
import warnings
from pathlib import Path
from threading import BoundedSemaphore
from urllib.parse import urlencode, urlsplit

from flask import Flask, jsonify, redirect, render_template, request, url_for
from flask_cors import CORS
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import RequestEntityTooLarge

MAX_UPLOAD_BYTES = 16 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000

FOOD_NAMES = {
    'bay_leaf': '월계수잎',
    'bell_pepper': '파프리카',
    'broccoli': '브로콜리',
    'cabbage': '양배추',
    'carrot': '당근',
    'cauliflower': '콜리플라워',
    'chicken': '닭',
    'chickpeas': '병아리콩',
    'coriander': '고수',
    'cucumber': '오이',
    'egg': '계란',
    'eggplant': '가지',
    'fish': '생선',
    'garlic': '마늘',
    'ginger': '생강',
    'kumquat': '귤',
    'lemon': '레몬',
    'long_pepper': '고추',
    'mutton': '양고기',
    'okra': '오크라',
    'onion': '양파',
    'pork': '돼지고기',
    'potato': '감자',
    'pumpkin': '호박',
    'radish': '무',
    'salt': '소금',
    'shrimp': '새우',
    'small_pepper': '고추',
    'spring_onion': '양파',
    'tofu': '두부',
    'tomato': '토마토',
    'turmeric': '강황',
}

app = Flask(__name__)
app.config.update(
    MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES,
    MAX_FORM_MEMORY_SIZE=128 * 1024,
    MAX_FORM_PARTS=64,
    TRUSTED_HOSTS=[
        host.strip() for host in os.getenv('TRUSTED_HOSTS', '127.0.0.1,localhost,[::1]').split(',')
        if host.strip()
    ],
)
allowed_origins = [origin.strip() for origin in os.getenv('CORS_ORIGINS', '').split(',') if origin.strip()]
CORS(app, resources={'/upload': {
    'origins': [f'^{re.escape(origin)}$' for origin in allowed_origins],
    'methods': ['POST'],
    'allow_headers': ['Content-Type'],
}})
upload_slot = BoundedSemaphore(1)
model = None


def load_model():
    source = os.getenv('YOLOV5_DIR')
    weights = os.getenv('YOLO_MODEL_PATH')
    if not source or not (Path(source) / 'hubconf.py').is_file():
        raise SystemExit('Set YOLOV5_DIR to a local YOLOv5 checkout containing hubconf.py.')
    if not weights or not Path(weights).is_file():
        raise SystemExit('Set YOLO_MODEL_PATH to a trusted local weights file.')

    try:
        import torch
    except ImportError:
        raise SystemExit('Install PyTorch and the YOLOv5 dependencies in this Python environment.') from None

    os.environ['YOLOv5_AUTOINSTALL'] = 'false'
    os.environ['YOLO_AUTOINSTALL'] = 'false'
    return torch.hub.load(str(Path(source).resolve()), 'custom',
                          path=str(Path(weights).resolve()), source='local', verbose=False)


def decode_image(data):
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data), formats=('JPEG', 'PNG', 'WEBP')) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError('Image dimensions exceed the limit.')
            image.verify()
        with Image.open(io.BytesIO(data), formats=('JPEG', 'PNG', 'WEBP')) as image:
            return ImageOps.exif_transpose(image).convert('RGB')


@app.after_request
def security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Content-Security-Policy'] = (
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    return response


@app.errorhandler(RequestEntityTooLarge)
def upload_too_large(_error):
    return jsonify(error='Request is too large.'), 413


@app.route('/')
def index():
    return render_template('upload_form.html')


@app.post('/upload')
def upload_file():
    origin = request.headers.get('Origin')
    if origin and origin not in allowed_origins and origin not in (
        f'https://{request.host}', f'http://{request.host}',
    ):
        return jsonify(error='Origin is not allowed.'), 403

    if not upload_slot.acquire(blocking=False):
        return jsonify(error='Image analysis is busy.'), 503, {'Retry-After': '2'}

    try:
        files = request.files.getlist('file')
        if len(files) != 1 or len(request.files) != 1 or not files[0].filename:
            return jsonify(error='Upload one image.'), 400

        try:
            image = decode_image(files[0].read())
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError,
                Image.DecompressionBombError, Image.DecompressionBombWarning):
            return jsonify(error='Upload a valid JPEG, PNG or WebP within the image size limit.'), 400

        try:
            with image:
                if model is None:
                    return jsonify(error='Image analysis is unavailable.'), 503
                result = model(image)
                labels = {
                    result.names[int(detection[-1])]
                    for detection in result.xyxy[0]
                }
        except Exception as error:
            app.logger.error('Image inference failed (%s)', type(error).__name__)
            return jsonify(error='Image analysis failed.'), 500

        if not labels:
            return jsonify(error='No ingredients detected.'), 400
        names = dict.fromkeys(FOOD_NAMES.get(label, label) for label in sorted(labels))
        return jsonify(detected_ingredients=list(names))
    finally:
        upload_slot.release()


@app.post('/select_ingredients')
def select_ingredients():
    selected = request.form.getlist('use_ingredients')
    excluded = request.form.getlist('exclude_ingredients')
    if not selected:
        return redirect(url_for('index'), code=303)
    if len(selected) > 20 or len(excluded) > 20 or any(label not in FOOD_NAMES for label in selected + excluded):
        return jsonify(error='Invalid ingredients.'), 400

    api_url = os.getenv('PUBLIC_API_URL', '')
    if not api_url:
        return jsonify(error='Recipe API is unavailable.'), 503
    query = urlencode({
        'ingredients': ','.join(FOOD_NAMES[label] for label in selected),
        'not_ingredients': ','.join(FOOD_NAMES[label] for label in excluded),
    })
    return redirect(f'{api_url.rstrip("/")}/search?{query}', code=303)


def main():
    from waitress import serve

    global model
    api_url = os.getenv('PUBLIC_API_URL')
    if api_url:
        url = urlsplit(api_url)
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
            raise ValueError('PUBLIC_API_URL must be an HTTPS origin.')

    model = load_model()
    serve(
        app,
        host=os.getenv('HOST', '127.0.0.1'),
        port=int(os.getenv('PORT', '5001')),
        threads=4,
        max_request_body_size=MAX_UPLOAD_BYTES,
        connection_limit=30,
        channel_timeout=30,
    )


if __name__ == '__main__':
    main()
