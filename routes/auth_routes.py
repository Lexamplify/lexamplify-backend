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
        # 🚨 THE FIX: Force Render to create the table if it's missing
        c.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )
        ''')
        
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

@auth_bp.route('/login', methods=['POST'])
def login_user():
    data = request.get_json()
    email = data.get('email') or data.get('username')
    password = data.get('password')

    if not email or not password:
        return jsonify({"error": "Missing credentials"}), 400

    conn = sqlite3.connect('lex_assistant.db')
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    try:
        # 1. Force table creation so it NEVER crashes
        c.execute('''CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        email TEXT UNIQUE NOT NULL,
                        password TEXT NOT NULL)''')
        
        # 2. Look for the user
        c.execute("SELECT id, password FROM users WHERE email = ?", (email,))
        user = c.fetchone()

        if user:
            # 3A. User exists -> Verify password and grant token
            if check_password_hash(user['password'], password):
                token = create_access_token(identity=user['id'])
                return jsonify({"access_token": token, "user_id": user['id']}), 200
            else:
                return jsonify({"error": "Invalid email or password."}), 401
        else:
            # 3B. User DOES NOT exist -> Auto-create them and grant token instantly
            hashed = generate_password_hash(password)
            c.execute("INSERT INTO users (email, password) VALUES (?, ?)", (email, hashed))
            conn.commit()
            user_id = c.lastrowid
            token = create_access_token(identity=user_id)
            return jsonify({"access_token": token, "user_id": user_id}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()
