"""
setup.py — py2app bundle configuration for ourT YOLO Camera

Build the macOS .app bundle:
  cd app2-yolo
  source venv/bin/activate
  pip install py2app
  python setup.py py2app

Output: dist/ourT YOLO.app
"""

import sys

from setuptools import setup


# modulegraph exceeds Python's default recursion limit while scanning PyTorch.
sys.setrecursionlimit(5000)

APP     = ['app.py']
NAME    = 'ourT YOLO'
VERSION = '1.0.0'

# Data files bundled inside the .app Resources/ folder
DATA_FILES = [
    ('', [
        'config.yaml',
        'yolo26n.pt',
        'LICENSE',
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
        'cv2',
        'PIL',
        'torch',
        'torchvision',
        'numpy',
        # Web server
        'fastapi',
        'uvicorn',
        'starlette',
        'anyio',
        'pydantic',
        # Config / env
        'yaml',
        'dotenv',
        # Qt
        'PyQt6',
    ],
    'excludes': [
        'tkinter', 'test', 'xmlrpc', 'distutils',
    ],
    'frameworks': [
        # Python stdlib extensions use @rpath to these miniconda libs.
        # macholib doesn't auto-discover them; they must be explicit.
        '/opt/homebrew/Caskroom/miniconda/base/lib/libbz2.dylib',
        '/opt/homebrew/Caskroom/miniconda/base/lib/libcrypto.3.dylib',
        '/opt/homebrew/Caskroom/miniconda/base/lib/libffi.8.dylib',
        '/opt/homebrew/Caskroom/miniconda/base/lib/liblzma.5.dylib',
        '/opt/homebrew/Caskroom/miniconda/base/lib/libncursesw.6.dylib',
        '/opt/homebrew/Caskroom/miniconda/base/lib/libsqlite3.0.dylib',
        '/opt/homebrew/Caskroom/miniconda/base/lib/libssl.3.dylib',
        '/opt/homebrew/Caskroom/miniconda/base/lib/libz.1.dylib',
    ],
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
