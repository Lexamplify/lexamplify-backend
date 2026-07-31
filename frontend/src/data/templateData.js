// frontend/src/data/templateData.js
// Static template library for the Legal Forms workspace. Each entry's
// html_template uses {{field_id}} placeholders — plain string tokens, not a
// templating engine — swapped in by LegalForms.jsx's debounced preview
// effect. field_id values here MUST exactly match the schema's field_id so
// the string-replace step has something to substitute.

export const CATEGORIES = ['Legal Notices', 'Contracts & NDAs', 'Court Petitions'];

const TEMPLATES = [
  {
    id: 'legal-notice-recovery-of-dues',
    title: 'Legal Notice for Recovery of Dues',
    category: 'Legal Notices',
    schema: [
      { field_id: 'sender_name', label: "Sender's Name", type: 'text', required: true },
      { field_id: 'sender_address', label: "Sender's Address", type: 'textarea', required: true },
      { field_id: 'recipient_name', label: "Recipient's Name", type: 'text', required: true },
      { field_id: 'recipient_address', label: "Recipient's Address", type: 'textarea', required: true },
      { field_id: 'amount_due', label: 'Amount Due (Rs.)', type: 'text', required: true },
      { field_id: 'due_date', label: 'Original Due Date', type: 'date', required: true },
      { field_id: 'notice_date', label: 'Notice Date', type: 'date', required: true },
      { field_id: 'payment_deadline_days', label: 'Payment Deadline (days)', type: 'number', required: true },
      { field_id: 'facts_summary', label: 'Summary of Transaction', type: 'textarea', required: false },
    ],
    html_template: `
      <p style="text-align:right">{{notice_date}}</p>
      <p><strong>To,</strong><br/>{{recipient_name}}<br/>{{recipient_address}}</p>
      <p style="text-align:center"><strong>LEGAL NOTICE FOR RECOVERY OF DUES</strong></p>
      <p>Under instructions from and on behalf of my client, <strong>{{sender_name}}</strong>, residing at {{sender_address}}, I hereby serve upon you the following legal notice:</p>
      <p>1. That my client had extended monies/goods/services to you, in respect of which a sum of <strong>Rs. {{amount_due}}</strong> became due and payable by you to my client on or before <strong>{{due_date}}</strong>.</p>
      <p>2. {{facts_summary}}</p>
      <p>3. That despite repeated requests and reminders, you have failed and neglected to pay the said outstanding amount to my client.</p>
      <p>4. You are therefore called upon, through this notice, to pay the said sum of <strong>Rs. {{amount_due}}</strong> to my client within <strong>{{payment_deadline_days}} days</strong> from the receipt of this notice, failing which my client shall be constrained to initiate appropriate civil and/or criminal proceedings against you, entirely at your risk, cost, and consequences.</p>
      <p>A copy of this notice has been retained in my office for further necessary action.</p>
      <p>Yours faithfully,<br/>For {{sender_name}}</p>
    `,
  },
  {
    id: 'legal-notice-tenancy-termination',
    title: 'Legal Notice for Termination of Tenancy',
    category: 'Legal Notices',
    schema: [
      { field_id: 'landlord_name', label: "Landlord's Name", type: 'text', required: true },
      { field_id: 'tenant_name', label: "Tenant's Name", type: 'text', required: true },
      { field_id: 'property_address', label: 'Tenanted Property Address', type: 'textarea', required: true },
      { field_id: 'tenancy_start_date', label: 'Tenancy Start Date', type: 'date', required: true },
      { field_id: 'monthly_rent', label: 'Monthly Rent (Rs.)', type: 'text', required: true },
      { field_id: 'vacate_by_date', label: 'Vacate By Date', type: 'date', required: true },
      { field_id: 'reason_for_termination', label: 'Reason for Termination', type: 'textarea', required: false },
    ],
    html_template: `
      <p style="text-align:center"><strong>LEGAL NOTICE FOR TERMINATION OF TENANCY</strong></p>
      <p><strong>To,</strong><br/>{{tenant_name}}<br/>{{property_address}}</p>
      <p>Under instructions from my client, <strong>{{landlord_name}}</strong>, the owner and landlord of the premises situated at {{property_address}}, I hereby serve upon you this notice as follows:</p>
      <p>1. That you are inducted as a tenant in the aforesaid premises since <strong>{{tenancy_start_date}}</strong> at a monthly rent of <strong>Rs. {{monthly_rent}}</strong>.</p>
      <p>2. {{reason_for_termination}}</p>
      <p>3. You are hereby called upon to peacefully vacate and hand over vacant possession of the said premises on or before <strong>{{vacate_by_date}}</strong>, failing which my client shall be constrained to initiate eviction proceedings against you before the competent court, at your entire risk, cost, and consequences as to law.</p>
      <p>Yours faithfully,<br/>For {{landlord_name}}</p>
    `,
  },
  {
    id: 'mutual-nda',
    title: 'Mutual Non-Disclosure Agreement',
    category: 'Contracts & NDAs',
    schema: [
      { field_id: 'party_a_name', label: 'Disclosing Party (Party A)', type: 'text', required: true },
      { field_id: 'party_a_address', label: 'Party A Address', type: 'textarea', required: true },
      { field_id: 'party_b_name', label: 'Receiving Party (Party B)', type: 'text', required: true },
      { field_id: 'party_b_address', label: 'Party B Address', type: 'textarea', required: true },
      { field_id: 'effective_date', label: 'Effective Date', type: 'date', required: true },
      { field_id: 'purpose', label: 'Purpose of Disclosure', type: 'textarea', required: true },
      { field_id: 'term_years', label: 'Term (years)', type: 'number', required: true },
      { field_id: 'governing_state', label: 'Governing Jurisdiction (State)', type: 'text', required: true },
    ],
    html_template: `
      <p style="text-align:center"><strong>MUTUAL NON-DISCLOSURE AGREEMENT</strong></p>
      <p>This Mutual Non-Disclosure Agreement ("Agreement") is entered into on <strong>{{effective_date}}</strong>, by and between:</p>
      <p><strong>{{party_a_name}}</strong>, having its address at {{party_a_address}} ("Party A"); and</p>
      <p><strong>{{party_b_name}}</strong>, having its address at {{party_b_address}} ("Party B"), collectively referred to as the "Parties".</p>
      <p><strong>1. Purpose.</strong> The Parties wish to explore {{purpose}}, and in connection therewith may disclose certain confidential and proprietary information to each other.</p>
      <p><strong>2. Confidentiality Obligations.</strong> Each Party agrees to:</p>
      <ul>
        <li>hold the other Party's Confidential Information in strict confidence;</li>
        <li>not disclose such information to any third party without prior written consent;</li>
        <li>use the Confidential Information solely for the Purpose stated above.</li>
      </ul>
      <p><strong>3. Term.</strong> This Agreement shall remain in effect for a period of <strong>{{term_years}} year(s)</strong> from the Effective Date, unless terminated earlier by mutual written consent.</p>
      <p><strong>4. Governing Law.</strong> This Agreement shall be governed by and construed in accordance with the laws of India, and the courts at <strong>{{governing_state}}</strong> shall have exclusive jurisdiction.</p>
      <p>IN WITNESS WHEREOF, the Parties have executed this Agreement as of the date first written above.</p>
      <p>_______________________<br/>{{party_a_name}}</p>
      <p>_______________________<br/>{{party_b_name}}</p>
    `,
  },
  {
    id: 'employment-offer-letter',
    title: 'Employment Offer Letter',
    category: 'Contracts & NDAs',
    schema: [
      { field_id: 'company_name', label: 'Company Name', type: 'text', required: true },
      { field_id: 'employee_name', label: "Employee's Name", type: 'text', required: true },
      { field_id: 'designation', label: 'Designation', type: 'text', required: true },
      { field_id: 'joining_date', label: 'Date of Joining', type: 'date', required: true },
      { field_id: 'annual_ctc', label: 'Annual CTC (Rs.)', type: 'text', required: true },
      { field_id: 'probation_months', label: 'Probation Period (months)', type: 'number', required: true },
      { field_id: 'reporting_manager', label: 'Reporting Manager', type: 'text', required: false },
      { field_id: 'notice_period_days', label: 'Notice Period (days)', type: 'number', required: true },
    ],
    html_template: `
      <p style="text-align:center"><strong>OFFER OF EMPLOYMENT</strong></p>
      <p>Dear <strong>{{employee_name}}</strong>,</p>
      <p>On behalf of <strong>{{company_name}}</strong> ("the Company"), we are pleased to offer you the position of <strong>{{designation}}</strong>, reporting to {{reporting_manager}}, effective from <strong>{{joining_date}}</strong>.</p>
      <p><strong>1. Compensation.</strong> Your annual Cost to Company (CTC) shall be <strong>Rs. {{annual_ctc}}</strong>, subject to applicable statutory deductions.</p>
      <p><strong>2. Probation.</strong> You will be on probation for a period of <strong>{{probation_months}} months</strong> from your date of joining, during which your performance shall be reviewed.</p>
      <p><strong>3. Notice Period.</strong> Either party may terminate this employment by providing <strong>{{notice_period_days}} days'</strong> written notice, or payment in lieu thereof.</p>
      <p><strong>4. Governing Law.</strong> This offer and the resulting employment relationship shall be governed by applicable Indian labour law.</p>
      <p>We look forward to a mutually rewarding association.</p>
      <p>For {{company_name}}</p>
    `,
  },
  {
    id: 'bail-application-439',
    title: 'Bail Application (Regular Bail)',
    category: 'Court Petitions',
    schema: [
      { field_id: 'court_name', label: 'Court Name', type: 'text', required: true },
      { field_id: 'case_number', label: 'FIR / Case Number', type: 'text', required: true },
      { field_id: 'applicant_name', label: "Applicant's Name", type: 'text', required: true },
      { field_id: 'police_station', label: 'Police Station', type: 'text', required: true },
      { field_id: 'sections_charged', label: 'Sections Charged', type: 'text', required: true },
      { field_id: 'arrest_date', label: 'Date of Arrest', type: 'date', required: true },
      { field_id: 'grounds_for_bail', label: 'Grounds for Bail', type: 'textarea', required: true },
    ],
    html_template: `
      <p style="text-align:center"><strong>IN THE COURT OF {{court_name}}</strong></p>
      <p style="text-align:center">Bail Application arising out of {{case_number}}, {{police_station}} Police Station</p>
      <p style="text-align:center">Under Section 439 of the Code of Criminal Procedure, 1973</p>
      <p><strong>IN THE MATTER OF:</strong></p>
      <p><strong>{{applicant_name}}</strong> ... Applicant</p>
      <p>Versus</p>
      <p>State ... Respondent</p>
      <p><strong>APPLICATION FOR REGULAR BAIL</strong></p>
      <p>1. That the Applicant, <strong>{{applicant_name}}</strong>, has been arrested on <strong>{{arrest_date}}</strong> in connection with {{case_number}} registered at {{police_station}} Police Station, under Sections <strong>{{sections_charged}}</strong>.</p>
      <p>2. That the Applicant is in judicial custody and it is submitted that:</p>
      <p>{{grounds_for_bail}}</p>
      <p>3. That the Applicant undertakes to abide by all conditions imposed by this Hon'ble Court and shall not tamper with evidence or influence witnesses.</p>
      <p><strong>PRAYER</strong></p>
      <p>It is therefore most respectfully prayed that this Hon'ble Court may be pleased to enlarge the Applicant on regular bail in the interest of justice.</p>
      <p>Applicant<br/>Through Counsel</p>
    `,
  },
  {
    id: 'eviction-petition',
    title: 'Eviction / Rent Control Petition',
    category: 'Court Petitions',
    schema: [
      { field_id: 'court_name', label: 'Court / Rent Controller', type: 'text', required: true },
      { field_id: 'petitioner_name', label: "Petitioner's (Landlord's) Name", type: 'text', required: true },
      { field_id: 'respondent_name', label: "Respondent's (Tenant's) Name", type: 'text', required: true },
      { field_id: 'property_address', label: 'Tenanted Premises Address', type: 'textarea', required: true },
      { field_id: 'monthly_rent', label: 'Monthly Rent (Rs.)', type: 'text', required: true },
      { field_id: 'arrears_months', label: 'Rent Arrears (months)', type: 'number', required: false },
      { field_id: 'grounds_for_eviction', label: 'Grounds for Eviction', type: 'textarea', required: true },
    ],
    html_template: `
      <p style="text-align:center"><strong>BEFORE THE {{court_name}}</strong></p>
      <p style="text-align:center"><strong>EVICTION PETITION</strong></p>
      <p><strong>{{petitioner_name}}</strong> ... Petitioner</p>
      <p>Versus</p>
      <p><strong>{{respondent_name}}</strong> ... Respondent</p>
      <p>1. That the Petitioner is the owner/landlord of the premises situated at {{property_address}}, let out to the Respondent at a monthly rent of <strong>Rs. {{monthly_rent}}</strong>.</p>
      <p>2. That the Respondent is in arrears of rent for a period of <strong>{{arrears_months}} month(s)</strong>.</p>
      <p>3. Grounds for eviction: {{grounds_for_eviction}}</p>
      <p><strong>PRAYER</strong></p>
      <p>It is therefore prayed that this Hon'ble Court/Rent Controller may be pleased to direct the Respondent to hand over vacant possession of the said premises to the Petitioner, and to pass such further orders as deemed fit in the interest of justice.</p>
      <p>Petitioner<br/>Through Counsel</p>
    `,
  },
];

export default TEMPLATES;
