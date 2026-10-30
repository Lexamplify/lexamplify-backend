/* MSG91 OTP Widget, driven from our own sign-in screens (exposeMethods mode).
   MSG91 sends the SMS and checks the code; we only receive an access token,
   which the server then confirms with MSG91 before trusting the number.
   The widget id and token are public browser values, not secrets. */

const SCRIPTS = ['https://verify.msg91.com/otp-provider.js', 'https://verify.phone91.com/otp-provider.js'];

let loading = null;
let requestId = null;

const FRIENDLY = 'We could not complete that. Please try again.';

function initWidget(cfg) {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!cfg || !cfg.widget_id || !cfg.token_auth) { reject(new Error(FRIENDLY)); return; }
    const configuration = {
      widgetId: cfg.widget_id,
      tokenAuth: cfg.token_auth,
      exposeMethods: true,
      success: () => {},
      failure: () => {},
    };
    let i = 0;
    const attempt = () => {
      const s = document.createElement('script');
      s.src = SCRIPTS[i];
      s.async = true;
      s.onload = () => {
        if (typeof window.initSendOTP === 'function') { window.initSendOTP(configuration); resolve(); } else reject(new Error(FRIENDLY));
      };
      s.onerror = () => { i += 1; if (i < SCRIPTS.length) attempt(); else reject(new Error('We could not reach the verification service. Check your connection and try again.')); };
      document.head.appendChild(s);
    };
    attempt();
  });
  loading.catch(() => { loading = null; });
  return loading;
}

const messageOf = (e, fallback) => {
  const m = e && (e.message || e.error || e.msg);
  return typeof m === 'string' && m.length < 140 ? m : fallback;
};

/** Ask MSG91 to text a code to a 10-digit Indian mobile number. */
export async function sendWidgetOtp(cfg, tenDigitNumber) {
  await initWidget(cfg);
  if (typeof window.sendOtp !== 'function') throw new Error(FRIENDLY);
  requestId = null;
  await new Promise((resolve, reject) => {
    window.sendOtp(`91${tenDigitNumber}`, (data) => { if (data && typeof data.message === 'string') requestId = data.message; resolve(data); },
      (err) => reject(new Error(messageOf(err, 'We could not send the code. Please try again.'))));
  });
}

/** Check the code with MSG91. Returns the access token our server will confirm. */
export async function verifyWidgetOtp(code) {
  if (typeof window.verifyOtp !== 'function') throw new Error(FRIENDLY);
  const data = await new Promise((resolve, reject) => {
    const ok = (d) => resolve(d);
    const bad = (err) => reject(new Error(messageOf(err, 'That code is incorrect or has expired.')));
    if (requestId) window.verifyOtp(code, ok, bad, requestId); else window.verifyOtp(code, ok, bad);
  });
  const token = data && (data.message || data.token || data.accessToken);
  if (typeof token !== 'string' || !token) throw new Error('That code is incorrect or has expired.');
  return token;
}
