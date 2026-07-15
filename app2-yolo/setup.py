"""
setup.py — py2app bundle configuration for ourT YOLO Camera

Build the macOS .app bundle:
  cd app2-yolo
  source venv/bin/activate
  pip install py2app
  python setup.py py2app

Output: dist/ourT YOLO.app
"""

from setuptools import setup

APP     = ['app.py']
NAME    = 'ourT YOLO'
VERSION = '1.0.0'

# Data files bundled inside the .app Resources/ folder
DATA_FILES = [
    ('', [
        'config.yaml',
        'pose_landmarker_lite.task',
    ]),
]

OPTIONS = {
    'argv_emulation': False,   # must be False for Qt apps
    'iconfile': '',            # set to path of .icns if available
    'plist': {
        'CFBundleName':             NAME,
        'CFBundleDisplayName':      NAME,
        'CFBundleVersion':          VERSION,
        'CFBundleShortVersionString': VERSION,
        'NSMicrophoneUsageDescription': 'Camera access for YOLO detection.',
        'NSCameraUsageDescription':     'Camera access for YOLO detection.',
        'NSHighResolutionCapable': True,
    },
    'packages': [
        # Core detection stack
        'ultralytics',
        'mediapipe',
        'cv2',
        'PIL',
        # Web server
        'fastapi',
        'uvicorn',
        'starlette',
        'anyio',
        # Config
        'yaml',
        'dotenv',
        # Qt
        'PyQt6',
    ],
    'excludes': [
        'tkinter', 'test', 'xmlrpc', 'distutils',
    ],
    'frameworks': [],
    # Keep the bundle size reasonable by excluding test data
    'strip': True,
}

setup(
    app=APP,
    name=NAME,
    version=VERSION,
    data_files=DATA_FILES,
    options={'py2app': OPTIONS},
    setup_requires=['py2app'],
)
