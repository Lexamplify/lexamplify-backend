"""
services/email_service.py
Email sending for LexAmplify notifications (IP renewal alerts etc.)

SMTP credentials are NOT configured yet — add them to backend/.env when ready:
    SMTP_HOST=smtp.gmail.com          # or any SMTP server
    SMTP_PORT=587
    SMTP_USER=your@email.com
    SMTP_PASSWORD=your_app_password
    SMTP_FROM=noreply@lexamplify.in   # optional, defaults to SMTP_USER

Until credentials are added, send_email() logs the attempt and returns False.
"""
import os
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)

SMTP_HOST     = os.environ.get('SMTP_HOST', '')
SMTP_PORT     = int(os.environ.get('SMTP_PORT', 587))
SMTP_USER     = os.environ.get('SMTP_USER', '')
SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD', '')
SMTP_FROM     = os.environ.get('SMTP_FROM', '') or SMTP_USER


def is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def send_email(to: str, subject: str, html_body: str) -> bool:
    """Send an email. Returns True on success, False on failure or if unconfigured."""
    if not is_configured():
        logger.info('Email not sent (SMTP not configured): subject=%r to=%r', subject, to)
        return False
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From']    = SMTP_FROM
        msg['To']      = to
        msg.attach(MIMEText(html_body, 'html'))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, [to], msg.as_string())
        logger.info('Email sent: subject=%r to=%r', subject, to)
        return True
    except Exception as exc:
        logger.error('Email send failed: %s', exc)
        return False


def send_ip_renewal_alert(to: str, assets: list) -> bool:
    """Send an IP renewal alert email listing expiring assets."""
    if not assets:
        return False

    rows = ''.join(
        f'<tr style="border-bottom:1px solid #e2e8f0">'
        f'<td style="padding:8px 12px;font-weight:600">{a.get("title","")}</td>'
        f'<td style="padding:8px 12px">{a.get("ip_type","")}</td>'
        f'<td style="padding:8px 12px">{a.get("renewal_due","")}</td>'
        f'<td style="padding:8px 12px;color:{"#ef4444" if a.get("days_left",99)<=5 else "#f59e0b"};font-weight:700">'
        f'{"EXPIRED" if a.get("days_left",0)<0 else f"{a.get(chr(100)+chr(97)+chr(121)+chr(115)+"_left",0)} days"}</td>'
        f'</tr>'
        for a in assets
    )

    html = f"""
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#173D35;margin-bottom:4px">IP Renewal Alert</h2>
      <p style="color:#475569;margin-bottom:20px">
        The following IP assets in your LexAmplify portfolio are expiring soon.
        Please take action to renew them before the deadline.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f8fafc;text-align:left">
            <th style="padding:8px 12px;color:#64748b;font-weight:600">Asset</th>
            <th style="padding:8px 12px;color:#64748b;font-weight:600">Type</th>
            <th style="padding:8px 12px;color:#64748b;font-weight:600">Due Date</th>
            <th style="padding:8px 12px;color:#64748b;font-weight:600">Status</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <p style="margin-top:24px;font-size:12px;color:#94a3b8">
        Manage your IP portfolio at <a href="https://lexamplify.in/court-resources" style="color:#173D35">LexAmplify Court Resources → IP Tracker</a>.
      </p>
    </div>
    """
    subject = f"⚠️ IP Renewal Alert — {len(assets)} asset{'s' if len(assets) > 1 else ''} expiring soon"
    return send_email(to, subject, html)
