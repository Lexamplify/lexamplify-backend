"""
routes/auth_routes.py
Blueprint: /api/auth
  POST /api/auth/signup
  POST /api/auth/login
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token
from werkzeug.security import generate_password_hash, check_password_hash
from database import db
from models.user import User

auth_bp = Blueprint("auth", __name__)

@auth_bp.route("/signup", methods=["POST"])
def signup():
    try:
        data = request.get_json()
        name     = data.get("name", "").strip()
        email    = data.get("email", "").strip().lower()
        password = data.get("password", "").strip()
        role     = data.get("role", "Lawyer")

        if not name or not email or not password:
            return jsonify({"error": "Name, email and password are required."}), 400
        if User.query.filter_by(email=email).first():
            return jsonify({"error": "Email already registered."}), 409

        user = User(
            name=name, email=email,
            password=generate_password_hash(password),
            role=role
        )
        db.session.add(user)
        db.session.commit()
        token = create_access_token(identity=str(user.id))
        return jsonify({"token": token, "name": user.name, "role": user.role}), 201
    except Exception as e:
        db.session.rollback()
        print(f"Signup error: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500

@auth_bp.route("/login", methods=["POST"])
def login():
    try:
        data = request.get_json()
        email    = data.get("email", "").strip().lower()
        password = data.get("password", "").strip()
        user = User.query.filter_by(email=email).first()
        if not user or not check_password_hash(user.password, password):
            return jsonify({"error": "Invalid email or password."}), 401
        token = create_access_token(identity=str(user.id))
        return jsonify({"token": token, "name": user.name, "role": user.role})
    except Exception as e:
        print(f"Login error: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500
