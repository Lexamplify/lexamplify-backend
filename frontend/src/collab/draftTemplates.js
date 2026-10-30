// Client-side draft generation: turn a template choice + brief into seed HTML that
// loads into the editor. (With an AI key set in Settings this could call a model;
// the demo uses well-formed Indian legal skeletons so the editor always has real content.)

function esc(s = '') { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function briefBlock(brief) {
  if (!brief || !brief.trim()) return '';
  return `<p><b>Facts in brief:</b> ${esc(brief.trim())}</p>`;
}

const BUILDERS = {
  'Legal notice': (b) => `
    <h2 style="text-align:center">Legal Notice</h2>
    <p style="text-align:center"><i>Under Section 138, Negotiable Instruments Act, 1881</i></p>
    <p><b>To,</b><br/>[Recipient name]<br/>[Address]</p>
    <p>Dear Sir/Madam,</p>
    <p>Under instructions from and on behalf of my client, <b>[Client name]</b>, I address you as under:</p>
    ${briefBlock(b)}
    <p>1. That the cheque bearing No. [____] dated [____] for a sum of <b>₹[____]/-</b> drawn on [bank] was presented and returned dishonoured with the remark <i>"funds insufficient"</i>.</p>
    <p>2. That you are hereby called upon to pay the said sum within <b>fifteen (15) days</b> of receipt hereof, failing which my client shall be constrained to initiate proceedings under Section 138 of the Negotiable Instruments Act, 1881, entirely at your risk as to cost and consequences.</p>
    <p>Yours faithfully,</p>
    <p>[Advocate name]<br/>Advocate</p>`,
  'Bail application': (b) => `
    <h2 style="text-align:center">In the Court of [____], [City]</h2>
    <p style="text-align:center">Bail Application No. [____] of [year]</p>
    <p style="text-align:center"><b>Application under Section 483 of the BNSS, 2023 for grant of regular bail</b></p>
    <p><b>In the matter of:</b> [Applicant/Accused] … Applicant</p>
    <p>MOST RESPECTFULLY SHOWETH:</p>
    ${briefBlock(b)}
    <p>1. That the applicant is a law-abiding citizen with no criminal antecedents and has been falsely implicated in the present case.</p>
    <p>2. That the applicant undertakes to cooperate with the investigation and to abide by any conditions this Hon’ble Court may impose.</p>
    <p><b>PRAYER:</b> It is therefore most respectfully prayed that this Hon’ble Court may be pleased to grant regular bail to the applicant.</p>`,
  'Written statement': (b) => `
    <h2 style="text-align:center">In the Court of [____], [City]</h2>
    <p style="text-align:center">Suit No. [____] of [year]</p>
    <p style="text-align:center"><b>Written Statement on behalf of the Defendant</b></p>
    <p>MOST RESPECTFULLY SHOWETH:</p>
    ${briefBlock(b)}
    <p><b>Preliminary Objections</b></p>
    <p>1. That the suit as framed is not maintainable in law or on facts and is liable to be dismissed.</p>
    <p>2. That the plaint discloses no cause of action against the answering defendant.</p>
    <p><b>Reply on Merits</b></p>
    <p>3. That the contents of paragraph [__] of the plaint are denied as wholly incorrect and misconceived.</p>`,
  'Rent agreement': (b) => `
    <h2 style="text-align:center">Rent Agreement</h2>
    <p>This Rent Agreement is made on [date] at [place] between <b>[Landlord]</b> (hereinafter "the Lessor") and <b>[Tenant]</b> (hereinafter "the Lessee").</p>
    ${briefBlock(b)}
    <p>1. <b>Premises.</b> The Lessor lets to the Lessee the premises at [address] for residential use only.</p>
    <p>2. <b>Term.</b> The tenancy is for a period of eleven (11) months commencing [date].</p>
    <p>3. <b>Rent.</b> The Lessee shall pay a monthly rent of ₹[____]/- on or before the [__] day of each month.</p>
    <p>4. <b>Security deposit.</b> The Lessee has paid an interest-free refundable deposit of ₹[____]/-.</p>`,
  'Mutual NDA': (b) => `
    <h2 style="text-align:center">Mutual Non-Disclosure Agreement</h2>
    <p>This Agreement is entered into on [date] between <b>[Party A]</b> and <b>[Party B]</b> (each a "Party").</p>
    ${briefBlock(b)}
    <p>1. <b>Purpose.</b> The Parties wish to explore a potential business relationship and may disclose Confidential Information to one another.</p>
    <p>2. <b>Confidential Information.</b> Means any non-public information disclosed by one Party to the other, whether orally, in writing or otherwise.</p>
    <p>3. <b>Obligations.</b> Each Party shall use the Confidential Information solely for the Purpose and shall not disclose it to any third party without prior written consent.</p>`,
  'Plaint': (b) => `
    <h2 style="text-align:center">In the Court of [____], [City]</h2>
    <p style="text-align:center">Suit No. [____] of [year]</p>
    <p style="text-align:center"><b>Plaint under Order VII Rule 1 of the Code of Civil Procedure, 1908</b></p>
    <p><b>[Plaintiff]</b> … Plaintiff<br/>versus<br/><b>[Defendant]</b> … Defendant</p>
    <p>MOST RESPECTFULLY SHOWETH:</p>
    ${briefBlock(b)}
    <p>1. That the plaintiff is [description] and the defendant is [description].</p>
    <p>2. That the cause of action arose on [date] at [place] when [facts].</p>
    <p><b>PRAYER:</b> It is therefore prayed that this Hon’ble Court may be pleased to pass a decree in favour of the plaintiff.</p>`,
};

export function generateDraftHtml({ template, brief }) {
  const build = BUILDERS[template] || BUILDERS['Legal notice'];
  return `<div>${build(brief).trim()}</div>`;
}

export const TEMPLATE_LIST = Object.keys(BUILDERS);
