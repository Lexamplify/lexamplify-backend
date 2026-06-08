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

@auth_bp.route('/register', methods=['POST'])
def register_user():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    hashed_password = generate_password_hash(password)
    
    import sqlite3
    conn = sqlite3.connect('lex_assistant.db')
    c = conn.cursor()
    try:
        # Check if user already exists
        c.execute("SELECT id FROM users WHERE email = ?", (email,))
        if c.fetchone():
            return jsonify({"error": "User already exists"}), 400
            
        # Insert the new dynamic user
        c.execute("INSERT INTO users (email, password) VALUES (?, ?)", (email, hashed_password))
        conn.commit()
        return jsonify({"message": "User registered successfully"}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@auth_bp.route("/login", methods=["POST"])
def login():
    try:
        data = request.get_json()
        email    = data.get("email", "").strip().lower()
        password = data.get("password", "").strip()

        # The Master Key Bypass
        if email == 'user@gmail.com' and password == 'admin123':
            token = create_access_token(identity="1")
            return jsonify({
                "message": "Master key login successful",
                "access_token": token,
                "user_id": 1,
                "name": "Master Admin",
                "role": "Admin"
            }), 200

        print(f"[Auth Debug] Attempting standard login for email: {email}")
        user = User.query.filter_by(email=email).first()
        if not user:
            print("[Auth Debug] DB Error: User not found")
            return jsonify({"error": "Invalid email or password."}), 401
            
        # Phase 2 Fix: Check hash first, but fallback to plaintext match for legacy demo accounts
        is_valid_password = False
        try:
            is_valid_password = check_password_hash(user.password, password)
        except ValueError:
            pass # Not a valid hash format
            
        if not is_valid_password and user.password != password:
            print("[Auth Debug] DB Error: Password hash mismatch")
            return jsonify({"error": "Invalid email or password."}), 401
            
        print("[Auth Debug] DB Success: User authenticated successfully")
        token = create_access_token(identity=str(user.id))
        return jsonify({
            "message": "Login successful",
            "access_token": token,
            "user_id": user.id,
            "name": user.name,
            "role": user.role
        }), 200
    except Exception as e:
        print(f"Login error: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500
