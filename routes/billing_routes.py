"""
routes/billing_routes.py
Billing — Time entries, Invoices, PDF generation, Payment tracking.
"""
import os
import sqlite3
import io
from datetime import date, datetime
from flask import Blueprint, request, jsonify, render_template, current_app, send_file

billing_bp = Blueprint('billing', __name__)


def get_db():
    return sqlite3.connect(current_app.config['SQLITE_DB_PATH'])


@billing_bp.route('/billing')
def billing_page():
    return render_template('billing.html')


# ── TIME ENTRIES ──────────────────────────────────────────────────────────────

@billing_bp.route('/api/billing/log-time', methods=['POST'])
def log_time():
    data = request.get_json()
    conn = get_db()
    c = conn.cursor()
    c.execute('''INSERT INTO time_entries (client_id, case_id, date, hours, rate, description)
                 VALUES (?,?,?,?,?,?)''', (
        data.get('client_id'),
        data.get('case_id'),
        data.get('date', str(date.today())),
        float(data.get('hours', 0)),
        float(data.get('rate', 0)),
        data.get('description', ''),
    ))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return jsonify({'status': 'success', 'id': new_id})


@billing_bp.route('/api/billing/time-entries', methods=['GET'])
def list_time_entries():
    conn = get_db()
    conn.row_factory = sqlite3.Row
    rows = conn.execute('''
        SELECT te.*, c.name as client_name, tc.case_name
        FROM time_entries te
        LEFT JOIN clients c ON te.client_id = c.id
        LEFT JOIN tracked_cases tc ON te.case_id = tc.id
        ORDER BY te.date DESC
    ''').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ── INVOICES ──────────────────────────────────────────────────────────────────

@billing_bp.route('/api/billing/generate-invoice', methods=['POST'])
def generate_invoice():
    data = request.get_json()
    conn = get_db()
    c = conn.cursor()

    amount = float(data.get('amount', 0))
    apply_gst = data.get('apply_gst', False)
    gst = round(amount * 0.18, 2) if apply_gst else 0.0
    total = round(amount + gst, 2)

    # Generate invoice number
    count = conn.execute('SELECT COUNT(*) FROM invoices').fetchone()[0]
    inv_num = f'LEX-{date.today().year}-{str(count + 1).zfill(4)}'

    c.execute('''INSERT INTO invoices
        (client_id, invoice_number, amount, gst, total, status, due_date, notes)
        VALUES (?,?,?,?,?,?,?,?)''', (
        data.get('client_id'),
        inv_num,
        amount,
        gst,
        total,
        'Draft',
        data.get('due_date', None),
        data.get('notes', ''),
    ))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return jsonify({'status': 'success', 'id': new_id, 'invoice_number': inv_num})


@billing_bp.route('/api/billing/invoices', methods=['GET'])
def list_invoices():
    conn = get_db()
    conn.row_factory = sqlite3.Row
    rows = conn.execute('''
        SELECT inv.*, c.name as client_name
        FROM invoices inv
        LEFT JOIN clients c ON inv.client_id = c.id
        ORDER BY inv.created_at DESC
    ''').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@billing_bp.route('/api/billing/mark-paid/<int:inv_id>', methods=['PUT'])
def mark_paid(inv_id):
    data = request.get_json()
    conn = get_db()
    conn.execute(
        "UPDATE invoices SET status='Paid', paid_date=? WHERE id=?",
        (data.get('paid_date', str(date.today())), inv_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})


# ── PDF GENERATION ────────────────────────────────────────────────────────────

@billing_bp.route('/api/billing/generate-pdf/<int:inv_id>', methods=['POST'])
def generate_pdf(inv_id):
    conn = get_db()
    conn.row_factory = sqlite3.Row
    inv = conn.execute('''
        SELECT inv.*, c.name as client_name, c.email, c.phone, c.address
        FROM invoices inv LEFT JOIN clients c ON inv.client_id = c.id
        WHERE inv.id=?
    ''', (inv_id,)).fetchone()
    conn.close()

    if not inv:
        return jsonify({'error': 'Invoice not found'}), 404

    inv = dict(inv)

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.units import mm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_CENTER, TA_RIGHT

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=20*mm, leftMargin=20*mm,
                                topMargin=20*mm, bottomMargin=20*mm)
        styles = getSampleStyleSheet()
        gold = colors.HexColor('#C9A84C')
        navy = colors.HexColor('#0D1B2A')

        header_style = ParagraphStyle('Header', parent=styles['Heading1'],
                                      textColor=navy, fontSize=22, spaceAfter=4)
        sub_style = ParagraphStyle('Sub', parent=styles['Normal'],
                                   textColor=gold, fontSize=10)
        label_style = ParagraphStyle('Label', parent=styles['Normal'],
                                     textColor=colors.grey, fontSize=9)
        right_style = ParagraphStyle('Right', parent=styles['Normal'],
                                     alignment=TA_RIGHT, fontSize=10)

        story = []
        story.append(Paragraph('LexAI India', header_style))
        story.append(Paragraph('Your Intelligent Legal Platform', sub_style))
        story.append(Spacer(1, 8*mm))

        # Invoice meta
        meta_data = [
            ['Invoice Number', inv['invoice_number']],
            ['Date', str(inv['created_at'])[:10]],
            ['Due Date', inv.get('due_date') or '—'],
            ['Status', inv.get('status') or 'Draft'],
        ]
        meta_table = Table(meta_data, colWidths=[60*mm, 100*mm])
        meta_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('TEXTCOLOR', (0, 0), (0, -1), colors.grey),
            ('TEXTCOLOR', (1, 0), (1, -1), navy),
            ('FONTNAME', (1, 0), (1, -1), 'Helvetica-Bold'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        story.append(meta_table)
        story.append(Spacer(1, 6*mm))

        # Client
        story.append(Paragraph('Bill To:', label_style))
        story.append(Paragraph(f"<b>{inv.get('client_name') or 'Client'}</b>", styles['Normal']))
        if inv.get('email'):
            story.append(Paragraph(inv['email'], styles['Normal']))
        if inv.get('phone'):
            story.append(Paragraph(inv['phone'], styles['Normal']))
        if inv.get('address'):
            story.append(Paragraph(inv['address'], styles['Normal']))
        story.append(Spacer(1, 8*mm))

        # Line items table
        item_data = [['Description', 'Amount (₹)']]
        item_data.append(['Legal Services', f"₹ {inv['amount']:,.2f}"])
        if inv['gst'] > 0:
            item_data.append(['GST (18%)', f"₹ {inv['gst']:,.2f}"])
        item_data.append(['TOTAL', f"₹ {inv['total']:,.2f}"])

        item_table = Table(item_data, colWidths=[120*mm, 50*mm])
        item_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), navy),
            ('TEXTCOLOR', (0, 0), (-1, 0), gold),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#f8f9fa')]),
            ('BACKGROUND', (0, -1), (-1, -1), gold),
            ('TEXTCOLOR', (0, -1), (-1, -1), navy),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#dee2e6')),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ]))
        story.append(item_table)
        story.append(Spacer(1, 8*mm))

        if inv.get('notes'):
            story.append(Paragraph(f"Notes: {inv['notes']}", label_style))
            story.append(Spacer(1, 4*mm))

        story.append(Paragraph('Bank Transfer / UPI / NEFT — Details on request', label_style))
        story.append(Spacer(1, 6*mm))
        story.append(Paragraph('Thank you for choosing LexAI India.', sub_style))

        doc.build(story)
        buf.seek(0)
        return send_file(buf, mimetype='application/pdf', as_attachment=True,
                         download_name=f"{inv['invoice_number']}.pdf")

    except ImportError:
        return jsonify({'error': 'reportlab not installed. Run: pip install reportlab'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500
