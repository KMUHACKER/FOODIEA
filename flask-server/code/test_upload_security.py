import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

from PIL import Image

import test5


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.client = test5.app.test_client()

    def submit(self, data):
        return self.client.post('/upload', data={'file': (data, 'photo.jpg')})

    @staticmethod
    def image():
        data = io.BytesIO()
        with Image.new('RGB', (4, 4)) as image:
            image.save(data, 'PNG')
        data.seek(0)
        return data

    def test_valid_upload_and_security_headers(self):
        result = SimpleNamespace(names=['carrot'], xyxy=[[(0, 0, 2, 2, 0.9, 0)]])
        with patch.object(test5, 'model', Mock(return_value=result)):
            response = self.submit(self.image())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'detected_ingredients': ['당근']})
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertNotIn('Access-Control-Allow-Origin', response.headers)

    def test_mutton_and_pork_have_distinct_labels(self):
        result = SimpleNamespace(
            names=['mutton', 'pork'],
            xyxy=[[(0, 0, 2, 2, 0.9, 0), (0, 0, 2, 2, 0.9, 1)]],
        )
        with patch.object(test5, 'model', Mock(return_value=result)):
            response = self.submit(self.image())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'detected_ingredients': ['양고기', '돼지고기']})

    def test_missing_model_settings_have_specific_startup_errors(self):
        with patch.dict('os.environ', clear=True):
            with self.assertRaisesRegex(SystemExit, 'YOLOV5_DIR'):
                test5.load_model()
        with TemporaryDirectory() as source:
            (Path(source) / 'hubconf.py').touch()
            with patch.dict('os.environ', {'YOLOV5_DIR': source, 'YOLO_MODEL_PATH': ''}):
                with self.assertRaisesRegex(SystemExit, 'YOLO_MODEL_PATH'):
                    test5.load_model()

    def test_invalid_and_over_limit_images_never_reach_model(self):
        with patch.object(test5, 'model') as model:
            self.assertEqual(self.submit(io.BytesIO(b'not an image')).status_code, 400)
            with patch.object(test5, 'MAX_IMAGE_PIXELS', 10):
                self.assertEqual(self.submit(self.image()).status_code, 400)
            with patch.dict(test5.app.config, MAX_CONTENT_LENGTH=128):
                self.assertEqual(self.submit(self.image()).status_code, 413)
            model.assert_not_called()

    def test_busy_and_failed_inference(self):
        self.assertTrue(test5.upload_slot.acquire(blocking=False))
        try:
            self.assertEqual(self.submit(self.image()).status_code, 503)
        finally:
            test5.upload_slot.release()

        with patch.object(test5, 'model', Mock(side_effect=RuntimeError('internal model details'))):
            response = self.submit(self.image())
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json, {'error': 'Image analysis failed.'})

    def test_upload_form_and_invalid_selection(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        response = self.client.post('/select_ingredients', data={'use_ingredients': 'unknown'})
        self.assertEqual(response.status_code, 400)

    def test_unexpected_host_and_browser_origin_are_rejected(self):
        with patch.object(test5, 'model') as model:
            response = self.client.get('/', headers={'Host': 'unexpected.example.test'})
            self.assertEqual(response.status_code, 400)
            response = self.client.post('/upload', headers={'Origin': 'https://other.example.test'})
            self.assertEqual(response.status_code, 403)
            model.assert_not_called()


if __name__ == '__main__':
    unittest.main()
