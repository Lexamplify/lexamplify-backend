"""
utils/limiter.py
Shared Flask-Limiter instance — separate module so both app.py and route
blueprints can import it without a circular import through create_app().
"""
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=[])
