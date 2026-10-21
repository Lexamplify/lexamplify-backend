"""Server-rendered page routes (templates/*.html).

Extracted from app.py's create_app() as the first step of the modularization in
docs/BACKEND_REFACTOR_PLAN.md. These are public, template-only views with no
auth or database dependencies, so moving them into a blueprint is behaviour-
preserving (the /api/* default-deny gate never applied to them).
"""
from flask import Blueprint, render_template

page_bp = Blueprint('pages', __name__)


@page_bp.route('/')
def landing():
    return render_template('landing.html')


@page_bp.route('/login')
def login_page():
    return render_template('login.html')


@page_bp.route('/signup')
def signup_page():
    return render_template('signup.html')


@page_bp.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')


@page_bp.route('/contract-viewer')
def contract_viewer():
    return render_template('contract_viewer.html')
