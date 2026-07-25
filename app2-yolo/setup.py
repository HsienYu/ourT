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
sys.setrecursionlimit(5000)   # modulegraph hits default 1000 on torch's deep AST

# Patch macholib: libmediapipe.dylib's LC_ID_DYLIB install name is
# "@rpath/libmediapipe_source.so" (30 chars).  macholib rewrites it to the
# full bundle path (~82 chars), expanding the header by exactly 56 bytes —
# but the file has zero header slack (code starts at byte 4880).
# Root cause: the dylib's own install name is a vestigial source-build artifact.
# Fix: skip rewriteLoadCommands entirely for libmediapipe.dylib so the file is
# left as-is in the bundle.  At runtime dyld loads it via its original rpath;
# mediapipe Tasks API works without libmediapipe_source.so.
from macholib.MachO import MachOHeader as _MachOHeader
def _patch_macho():
    _orig = _MachOHeader.rewriteLoadCommands
    def _safe(self, changefunc):
        if 'libmediapipe.dylib' in str(self.parent.filename):
            return False   # leave file unchanged — no header room for rewrite
        return _orig(self, changefunc)
    _MachOHeader.rewriteLoadCommands = _safe
_patch_macho()
del _patch_macho, _MachOHeader
from setuptools import setup

APP     = ['app.py']
NAME    = 'ourT YOLO'
VERSION = '1.0.0'

# Data files bundled inside the .app Resources/ folder
DATA_FILES = [
    ('', [
        'config.yaml',
        'pose_landmarker_lite.task',
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
        'mediapipe',
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
