"""Makes ``tests`` a real package so ``from tests.helpers_app import ...`` resolves to THIS folder.

Without this file the repo's ``tests`` is only a namespace package, and a third-party ``tests`` package installed in
site-packages wins the import, so half the suite fails to collect with "No module named 'tests.helpers_app'".

Older test files import the shared helpers bare (``from conftest import make_pdf``, ``from helpers_app import make_app``).
pytest only put this folder on sys.path while ``tests`` was NOT a package, so keep it there explicitly - otherwise those
files break when run on their own.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
