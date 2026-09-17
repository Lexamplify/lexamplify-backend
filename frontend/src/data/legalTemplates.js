// frontend/src/data/legalTemplates.js
// Single source of truth for the Legal Forms Library and Drafting Workspace.

export const CATEGORIES = ['Legal Notices', 'Contracts & NDAs', 'Court Petitions'];

export const TEMPLATES = [
  {
    id: 'recovery-of-dues',
    aliases: ['legal-notice-recovery-of-dues'],
    title: 'Legal Notice for Recovery of Dues',
    category: 'Legal Notices',
    fields: [
      { key: 'sender_name', field_id: 'sender_name', label: "Sender's Name", type: 'text', required: true },
      { key: 'sender_address', field_id: 'sender_address', label: "Sender's Address", type: 'textarea', required: true },
      { key: 'recipient_name', field_id: 'recipient_name', label: "Recipient's Name", type: 'text', required: true },
      { key: 'recipient_address', field_id: 'recipient_address', label: "Recipient's Address", type: 'textarea', required: true },
      { key: 'amount_due', field_id: 'amount_due', label: 'Amount Due (Rs.)', type: 'text', required: true },
      { key: 'due_date', field_id: 'due_date', label: 'Original Due Date', type: 'date', required: true },
      { key: 'notice_date', field_id: 'notice_date', label: 'Notice Date', type: 'date', required: true },
      { key: 'payment_deadline_days', field_id: 'payment_deadline_days', label: 'Payment Deadline (days)', type: 'number', required: true },
      { key: 'facts_summary', field_id: 'facts_summary', label: 'Facts Summary', type: 'textarea', required: true },
    ],
    preview: `{{notice_date}}

To,
{{recipient_name}}
{{recipient_address}}

**LEGAL NOTICE FOR RECOVERY OF DUES**

Under instructions from and on behalf of my client, {{sender_name}}, residing at {{sender_address}}, I hereby serve upon you the following legal notice:

1. That my client had extended monies/goods/services to you, in respect of which a sum of Rs. {{amount_due}} became due and payable by you to my client on or before {{due_date}}.

2. {{facts_summary}}

3. That despite repeated requests and reminders, you have failed and neglected to pay the said outstanding amount to my client.

4. You are therefore called upon, through this notice, to pay the said sum of Rs. {{amount_due}} to my client within {{payment_deadline_days}} days from the receipt of this notice, failing which my client shall be constrained to initiate appropriate civil and/or criminal proceedings against you, entirely at your risk, cost, and consequences.

A copy of this notice has been retained in my office for further necessary action.

Yours faithfully,
For {{sender_name}}`,
    demo: {
      sender_name: 'Rohan Mehta',
      sender_address: '14 Anna Salai, Chennai 600002',
      recipient_name: 'Vikram Traders Pvt. Ltd.',
      recipient_address: '22 GST Road, Chennai 600032',
      amount_due: '2,40,000',
      payment_deadline_days: '15',
      facts_summary: 'That my client supplied goods to you under Invoice No. 118/2026 dated 12 March 2026, which you duly accepted without objection.',
    },
  },
  {
    id: 'termination-tenancy',
    aliases: ['legal-notice-tenancy-termination'],
    title: 'Legal Notice for Termination of Tenancy',
    category: 'Legal Notices',
    fields: [
      { key: 'landlord_name', field_id: 'landlord_name', label: "Landlord's Name", type: 'text', required: true },
      { key: 'tenant_name', field_id: 'tenant_name', label: "Tenant's Name", type: 'text', required: true },
      { key: 'property_address', field_id: 'property_address', label: 'Tenanted Property Address', type: 'textarea', required: true },
      { key: 'tenancy_start_date', field_id: 'tenancy_start_date', label: 'Tenancy Start Date', type: 'date', required: true },
      { key: 'monthly_rent', field_id: 'monthly_rent', label: 'Monthly Rent (Rs.)', type: 'text', required: true },
      { key: 'vacate_by_date', field_id: 'vacate_by_date', label: 'Vacate By Date', type: 'date', required: true },
      { key: 'reason_for_termination', field_id: 'reason_for_termination', label: 'Reason for Termination', type: 'textarea', required: false },
    ],
    preview: `**LEGAL NOTICE FOR TERMINATION OF TENANCY**

To,
{{tenant_name}}
{{property_address}}

Under instructions from my client, {{landlord_name}}, the owner and landlord of the premises situated at {{property_address}}, I hereby serve upon you this notice as follows:

1. That you are inducted as a tenant in the aforesaid premises since {{tenancy_start_date}} at a monthly rent of Rs. {{monthly_rent}}.

2. {{reason_for_termination}}

3. You are hereby called upon to peacefully vacate and hand over vacant possession of the said premises on or before {{vacate_by_date}}, failing which my client shall be constrained to initiate eviction proceedings against you before the competent court, at your entire risk, cost, and consequences as to law.

Yours faithfully,
For {{landlord_name}}`,
    demo: {
      landlord_name: 'S. Kalyanasundaram',
      tenant_name: 'Arjun Nair',
      property_address: 'Flat 3B, Lakeview Apartments, Nungambakkam, Chennai',
      monthly_rent: '32,000',
      reason_for_termination: 'That the landlord requires the premises bona fide for his own use and occupation.',
    },
  },
  {
    id: 'mutual-nda',
    aliases: [],
    title: 'Mutual Non-Disclosure Agreement',
    category: 'Contracts & NDAs',
    fields: [
      { key: 'party_a_name', field_id: 'party_a_name', label: 'Disclosing Party (Party A)', type: 'text', required: true },
      { key: 'party_a_address', field_id: 'party_a_address', label: 'Party A Address', type: 'textarea', required: true },
      { key: 'party_b_name', field_id: 'party_b_name', label: 'Receiving Party (Party B)', type: 'text', required: true },
      { key: 'party_b_address', field_id: 'party_b_address', label: 'Party B Address', type: 'textarea', required: true },
      { key: 'effective_date', field_id: 'effective_date', label: 'Effective Date', type: 'date', required: true },
      { key: 'purpose', field_id: 'purpose', label: 'Purpose of Disclosure', type: 'textarea', required: true },
      { key: 'term_years', field_id: 'term_years', label: 'Term (years)', type: 'number', required: true },
      { key: 'governing_state', field_id: 'governing_state', label: 'Governing Jurisdiction (State)', type: 'text', required: true },
    ],
    preview: `**MUTUAL NON-DISCLOSURE AGREEMENT**

This Mutual Non-Disclosure Agreement ("Agreement") is entered into on {{effective_date}}, by and between:

{{party_a_name}}, having its address at {{party_a_address}} ("Party A"); and
{{party_b_name}}, having its address at {{party_b_address}} ("Party B"), collectively referred to as the "Parties".

1. Purpose. The Parties wish to explore {{purpose}}, and in connection therewith may disclose certain confidential and proprietary information to each other.

2. Confidentiality Obligations. Each Party agrees to:
• hold the other Party's Confidential Information in strict confidence;
• not disclose such information to any third party without prior written consent;
• use the Confidential Information solely for the Purpose stated above.

3. Term. This Agreement shall remain in effect for a period of {{term_years}} year(s) from the Effective Date, unless terminated earlier by mutual written consent.

4. Governing Law. This Agreement shall be governed by and construed in accordance with the laws of India, and the courts at {{governing_state}} shall have exclusive jurisdiction.

IN WITNESS WHEREOF, the Parties have executed this Agreement as of the date first written above.

_____________________
{{party_a_name}}

_____________________
{{party_b_name}}`,
    demo: {
      party_a_name: 'Vertex Analytics Pvt. Ltd.',
      party_a_address: 'Tidel Park, Taramani, Chennai',
      party_b_name: 'Kavya Subramaniam',
      party_b_address: '12 Poes Garden, Chennai',
      purpose: 'a potential data-analytics services engagement',
      term_years: '3',
      governing_state: 'Chennai',
    },
  },
  {
    id: 'employment-offer',
    aliases: ['employment-offer-letter'],
    title: 'Employment Offer Letter',
    category: 'Contracts & NDAs',
    fields: [
      { key: 'company_name', field_id: 'company_name', label: 'Company Name', type: 'text', required: true },
      { key: 'employee_name', field_id: 'employee_name', label: "Employee's Name", type: 'text', required: true },
      { key: 'designation', field_id: 'designation', label: 'Designation', type: 'text', required: true },
      { key: 'joining_date', field_id: 'joining_date', label: 'Date of Joining', type: 'date', required: true },
      { key: 'annual_ctc', field_id: 'annual_ctc', label: 'Annual CTC (Rs.)', type: 'text', required: true },
      { key: 'probation_months', field_id: 'probation_months', label: 'Probation Period (months)', type: 'number', required: true },
      { key: 'reporting_manager', field_id: 'reporting_manager', label: 'Reporting Manager', type: 'text', required: false },
      { key: 'notice_period_days', field_id: 'notice_period_days', label: 'Notice Period (days)', type: 'number', required: true },
    ],
    preview: `**OFFER OF EMPLOYMENT**

Dear {{employee_name}},

On behalf of {{company_name}} ("the Company"), we are pleased to offer you the position of {{designation}}, reporting to {{reporting_manager}}, effective from {{joining_date}}.

1. Compensation. Your annual Cost to Company (CTC) shall be Rs. {{annual_ctc}}, subject to applicable statutory deductions.

2. Probation. You will be on probation for a period of {{probation_months}} months from your date of joining, during which your performance shall be reviewed.

3. Notice Period. Either party may terminate this employment by providing {{notice_period_days}} days' written notice, or payment in lieu thereof.

4. Governing Law. This offer and the resulting employment relationship shall be governed by applicable Indian labour law.

We look forward to a mutually rewarding association.

For {{company_name}}`,
    demo: {
      company_name: 'Northbridge Legal Tech Pvt. Ltd.',
      employee_name: 'Divya Krishnan',
      designation: 'Associate Software Engineer',
      annual_ctc: '9,60,000',
      probation_months: '6',
      reporting_manager: 'Karthik Iyer',
      notice_period_days: '30',
    },
  },
  {
    id: 'bail-application',
    aliases: ['bail-application-439'],
    title: 'Bail Application (Regular Bail)',
    category: 'Court Petitions',
    fields: [
      { key: 'court_name', field_id: 'court_name', label: 'Court Name', type: 'text', required: true },
      { key: 'case_number', field_id: 'case_number', label: 'FIR / Case Number', type: 'text', required: true },
      { key: 'applicant_name', field_id: 'applicant_name', label: "Applicant's Name", type: 'text', required: true },
      { key: 'police_station', field_id: 'police_station', label: 'Police Station', type: 'text', required: true },
      { key: 'sections_charged', field_id: 'sections_charged', label: 'Sections Charged', type: 'text', required: true },
      { key: 'arrest_date', field_id: 'arrest_date', label: 'Date of Arrest', type: 'date', required: true },
      { key: 'grounds_for_bail', field_id: 'grounds_for_bail', label: 'Grounds for Bail', type: 'textarea', required: true },
    ],
    preview: `IN THE COURT OF {{court_name}}

Bail Application arising out of {{case_number}}, {{police_station}} Police Station
Under Section 439 of the Code of Criminal Procedure, 1973

IN THE MATTER OF:
{{applicant_name}} ... Applicant
Versus
State ... Respondent

**APPLICATION FOR REGULAR BAIL**

1. That the Applicant, {{applicant_name}}, has been arrested on {{arrest_date}} in connection with {{case_number}} registered at {{police_station}} Police Station, under Sections {{sections_charged}}.

2. That the Applicant is in judicial custody and it is submitted that:
{{grounds_for_bail}}

3. That the Applicant undertakes to abide by all conditions imposed by this Hon'ble Court and shall not tamper with evidence or influence witnesses.

**PRAYER**

It is therefore most respectfully prayed that this Hon'ble Court may be pleased to enlarge the Applicant on regular bail in the interest of justice.

Applicant
Through Counsel`,
    demo: {
      court_name: 'the Principal Sessions Court, Chennai',
      case_number: 'FIR No. 214/2026',
      applicant_name: 'Suresh Babu',
      police_station: 'T. Nagar',
      sections_charged: '420, 406 IPC',
      grounds_for_bail: 'That the Applicant is a permanent resident of Chennai with no criminal antecedents, has cooperated fully with the investigation, and is not likely to abscond or tamper with evidence.',
    },
  },
  {
    id: 'eviction-petition',
    aliases: [],
    title: 'Eviction / Rent Control Petition',
    category: 'Court Petitions',
    fields: [
      { key: 'court_name', field_id: 'court_name', label: 'Court / Rent Controller', type: 'text', required: true },
      { key: 'petitioner_name', field_id: 'petitioner_name', label: "Petitioner's (Landlord's) Name", type: 'text', required: true },
      { key: 'respondent_name', field_id: 'respondent_name', label: "Respondent's (Tenant's) Name", type: 'text', required: true },
      { key: 'property_address', field_id: 'property_address', label: 'Tenanted Premises Address', type: 'textarea', required: true },
      { key: 'monthly_rent', field_id: 'monthly_rent', label: 'Monthly Rent (Rs.)', type: 'text', required: true },
      { key: 'arrears_months', field_id: 'arrears_months', label: 'Rent Arrears (months)', type: 'number', required: false },
      { key: 'grounds_for_eviction', field_id: 'grounds_for_eviction', label: 'Grounds for Eviction', type: 'textarea', required: true },
    ],
    preview: `BEFORE THE {{court_name}}

**EVICTION PETITION**

{{petitioner_name}} ... Petitioner
Versus
{{respondent_name}} ... Respondent

1. That the Petitioner is the owner/landlord of the premises situated at {{property_address}}, let out to the Respondent at a monthly rent of Rs. {{monthly_rent}}.

2. That the Respondent is in arrears of rent for a period of {{arrears_months}} month(s).

3. Grounds for eviction: {{grounds_for_eviction}}

**PRAYER**

It is therefore prayed that this Hon'ble Court/Rent Controller may be pleased to direct the Respondent to hand over vacant possession of the said premises to the Petitioner, and to pass such further orders as deemed fit in the interest of justice.

Petitioner
Through Counsel`,
    demo: {
      court_name: 'the Rent Controller, Chennai',
      petitioner_name: 'R. Venkataraman',
      respondent_name: 'Manoj Kumar',
      property_address: 'No. 7, Eldams Road, Alwarpet, Chennai',
      monthly_rent: '45,000',
      arrears_months: '4',
      grounds_for_eviction: 'Wilful default in payment of rent for a continuous period exceeding three months.',
    },
  },
].map((tpl) => {
  // Ensure backward compatibility by providing schema and html_template properties
  const schema = tpl.fields.map((f) => ({
    field_id: f.key,
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
  }));
  return {
    ...tpl,
    schema,
    html_template: tpl.preview
      .split('\n\n')
      .map((p) => {
        let formatted = p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>');
        return `<p>${formatted}</p>`;
      })
      .join(''),
  };
});

export default TEMPLATES;
