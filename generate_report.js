const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, LevelFormat,
  TableOfContents, ExternalHyperlink, UnderlineType
} = require('docx');
const fs = require('fs');

// ── Colour palette ──────────────────────────────────────────────────────────
const C = {
  navy: '0A0E17',
  blue: '2563EB',
  blueLight: '3B82F6',
  bluePale: 'DBEAFE',
  teal: '0F766E',
  tealPale: 'CCFBF1',
  green: '059669',
  greenPale: 'D1FAE5',
  amber: 'B45309',
  amberPale: 'FEF3C7',
  red: 'B91C1C',
  redPale: 'FEE2E2',
  purple: '6D28D9',
  purplePale: 'EDE9FE',
  slate: '475569',
  slateLight: '94A3B8',
  white: 'FFFFFF',
  offwhite: 'F8FAFC',
  border: 'CBD5E1',
  darkBg: '1E293B',
  mid: '64748B',
};

// ── Shared border style ─────────────────────────────────────────────────────
const cellBorder = (color = C.border) => ({
  top: { style: BorderStyle.SINGLE, size: 1, color },
  bottom: { style: BorderStyle.SINGLE, size: 1, color },
  left: { style: BorderStyle.SINGLE, size: 1, color },
  right: { style: BorderStyle.SINGLE, size: 1, color },
});

const noBorder = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

// ── Helper: plain paragraph ─────────────────────────────────────────────────
const p = (text, opts = {}) => new Paragraph({
  spacing: { before: opts.before ?? 80, after: opts.after ?? 80 },
  alignment: opts.align ?? AlignmentType.LEFT,
  children: [new TextRun({
    text,
    font: 'Arial',
    size: opts.size ?? 22,
    bold: opts.bold ?? false,
    italics: opts.italic ?? false,
    color: opts.color ?? C.slate,
  })],
});

// ── Helper: heading ─────────────────────────────────────────────────────────
const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 360, after: 160 },
  children: [new TextRun({ text, font: 'Arial', size: 36, bold: true, color: C.navy })],
});

const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 280, after: 120 },
  children: [new TextRun({ text, font: 'Arial', size: 28, bold: true, color: C.blue })],
});

const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 200, after: 100 },
  children: [new TextRun({ text, font: 'Arial', size: 24, bold: true, color: C.slate })],
});

// ── Helper: space ───────────────────────────────────────────────────────────
const spacer = (pts = 120) => new Paragraph({
  spacing: { before: 0, after: pts },
  children: [new TextRun({ text: '', size: 2 })],
});

// ── Helper: horizontal rule ─────────────────────────────────────────────────
const hrule = (color = C.border) => new Paragraph({
  spacing: { before: 120, after: 120 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color } },
  children: [new TextRun({ text: '', size: 2 })],
});

// ── Helper: bullet ──────────────────────────────────────────────────────────
const bullet = (text, color = C.slate, bold = false) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing: { before: 40, after: 40 },
  children: [new TextRun({ text, font: 'Arial', size: 21, color, bold })],
});

// ── Helper: check item ─────────────────────────────────────────────────────
const checkItem = (icon, text, iconColor) => new Paragraph({
  spacing: { before: 40, after: 40 },
  indent: { left: 180 },
  children: [
    new TextRun({ text: `${icon}  `, font: 'Arial', size: 21, color: iconColor }),
    new TextRun({ text, font: 'Arial', size: 21, color: C.slate }),
  ],
});

// ── Helper: key-value row in a 2-col table ──────────────────────────────────
const kvRow = (key, val, shade = false) => new TableRow({
  children: [
    new TableCell({
      borders: cellBorder(),
      width: { size: 3200, type: WidthType.DXA },
      shading: shade ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 140, right: 80 },
      children: [new Paragraph({
        children: [new TextRun({ text: key, font: 'Arial', size: 21, bold: true, color: C.slate })],
      })],
    }),
    new TableCell({
      borders: cellBorder(),
      width: { size: 6160, type: WidthType.DXA },
      shading: shade ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 140, right: 80 },
      children: [new Paragraph({
        children: [new TextRun({ text: val, font: 'Arial', size: 21, color: C.slate })],
      })],
    }),
  ],
});

// ── Helper: status badge text ───────────────────────────────────────────────
const badge = (text, bgColor, textColor) =>
  new TextRun({
    text: `  ${text}  `, font: 'Arial', size: 18, bold: true, color: textColor,
    highlight: bgColor === C.greenPale ? 'green' :
      bgColor === C.amberPale ? 'yellow' : 'none'
  });

// ── Helper: stat box row ────────────────────────────────────────────────────
const statRow = (stats) => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2340, 2340, 2340, 2340],
  rows: [
    new TableRow({
      children: stats.map(s => new TableCell({
        borders: noBorder,
        width: { size: 2340, type: WidthType.DXA },
        shading: { fill: s.bg, type: ShadingType.CLEAR },
        margins: { top: 180, bottom: 180, left: 180, right: 180 },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER, children: [
              new TextRun({ text: s.value, font: 'Arial', size: 64, bold: true, color: s.color }),
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { before: 40 }, children: [
              new TextRun({ text: s.label, font: 'Arial', size: 19, color: C.mid }),
            ]
          }),
        ],
      }))
    }),
  ],
});

// ── Helper: module table row ────────────────────────────────────────────────
const moduleRow = (icon, name, route, desc, status, statusColor, statusBg, shade) =>
  new TableRow({
    children: [
      new TableCell({
        borders: cellBorder(),
        width: { size: 1600, type: WidthType.DXA },
        shading: shade ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
        margins: { top: 100, bottom: 100, left: 120, right: 80 },
        verticalAlign: VerticalAlign.TOP,
        children: [
          new Paragraph({ children: [new TextRun({ text: `${icon} ${name}`, font: 'Arial', size: 21, bold: true, color: C.darkBg })] }),
          new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: route, font: 'Arial', size: 17, color: C.slateLight, italics: true })] }),
        ],
      }),
      new TableCell({
        borders: cellBorder(),
        width: { size: 5960, type: WidthType.DXA },
        shading: shade ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
        margins: { top: 100, bottom: 100, left: 120, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text: desc, font: 'Arial', size: 21, color: C.slate })] })],
      }),
      new TableCell({
        borders: cellBorder(),
        width: { size: 1800, type: WidthType.DXA },
        shading: { fill: statusBg, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 120, right: 80 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER, children: [
            new TextRun({ text: status, font: 'Arial', size: 19, bold: true, color: statusColor }),
          ]
        })],
      }),
    ]
  });

// ── Helper: gap table row ───────────────────────────────────────────────────
const gapRow = (num, module, desc, priority, priColor, priBg, shade) =>
  new TableRow({
    children: [
      new TableCell({
        borders: cellBorder(),
        width: { size: 600, type: WidthType.DXA },
        shading: shade ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 100, right: 60 },
        verticalAlign: VerticalAlign.TOP,
        children: [new Paragraph({ children: [new TextRun({ text: num, font: 'Arial', size: 21, bold: true, color: C.slateLight })] })],
      }),
      new TableCell({
        borders: cellBorder(),
        width: { size: 1600, type: WidthType.DXA },
        shading: shade ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 100, right: 60 },
        verticalAlign: VerticalAlign.TOP,
        children: [new Paragraph({ children: [new TextRun({ text: module, font: 'Arial', size: 21, bold: true, color: C.blue })] })],
      }),
      new TableCell({
        borders: cellBorder(),
        width: { size: 5360, type: WidthType.DXA },
        shading: shade ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 100, right: 60 },
        children: [new Paragraph({ children: [new TextRun({ text: desc, font: 'Arial', size: 21, color: C.slate })] })],
      }),
      new TableCell({
        borders: cellBorder(),
        width: { size: 1800, type: WidthType.DXA },
        shading: { fill: priBg, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 100, right: 60 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER, children: [
            new TextRun({ text: priority, font: 'Arial', size: 19, bold: true, color: priColor }),
          ]
        })],
      }),
    ]
  });

// ══════════════════════════════════════════════════════════════════════════════
//  BUILD DOCUMENT
// ══════════════════════════════════════════════════════════════════════════════
const doc = new Document({
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: '•',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 260 } } }
      }],
    }],
  },
  styles: {
    default: { document: { run: { font: 'Arial', size: 22, color: C.slate } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: C.navy },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 }
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: C.blue },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 }
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: C.slate },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 }
      },
    ],
  },

  sections: [
    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 1 — COVER PAGE
    // ══════════════════════════════════════════════════════════════════════════
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        spacer(1800),

        // Blue accent bar — top
        new Paragraph({
          spacing: { before: 0, after: 0 },
          border: { top: { style: BorderStyle.SINGLE, size: 36, color: C.blueLight } },
          children: [new TextRun({ text: '' })],
        }),

        spacer(400),

        // Badge line
        new Paragraph({
          spacing: { before: 120, after: 200 },
          children: [
            new TextRun({
              text: 'PRODUCT UX AUDIT', font: 'Arial', size: 22, bold: true,
              color: C.blueLight, characterSpacing: 140
            }),
          ],
        }),

        // Main title
        new Paragraph({
          spacing: { before: 0, after: 80 },
          children: [new TextRun({ text: 'LexAmplify', font: 'Georgia', size: 88, bold: true, color: C.navy })],
        }),

        // Subtitle
        new Paragraph({
          spacing: { before: 0, after: 400 },
          children: [new TextRun({ text: 'Software Platform — Full Status Report', font: 'Arial', size: 36, color: C.mid })],
        }),

        hrule(C.blueLight),
        spacer(240),

        // Meta table
        new Table({
          width: { size: 5400, type: WidthType.DXA },
          columnWidths: [1800, 3600],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: noBorder, width: { size: 1800, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Prepared by', font: 'Arial', size: 21, color: C.mid })] })]
                }),
                new TableCell({
                  borders: noBorder, width: { size: 3600, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Narendar V', font: 'Arial', size: 21, bold: true, color: C.darkBg })] })]
                }),
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: noBorder, width: { size: 1800, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Date', font: 'Arial', size: 21, color: C.mid })] })]
                }),
                new TableCell({
                  borders: noBorder, width: { size: 3600, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: 'June 2026', font: 'Arial', size: 21, bold: true, color: C.darkBg })] })]
                }),
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: noBorder, width: { size: 1800, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Platform', font: 'Arial', size: 21, color: C.mid })] })]
                }),
                new TableCell({
                  borders: noBorder, width: { size: 3600, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: 'React 18 + Flask (Python)', font: 'Arial', size: 21, bold: true, color: C.darkBg })] })]
                }),
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: noBorder, width: { size: 1800, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Domain', font: 'Arial', size: 21, color: C.mid })] })]
                }),
                new TableCell({
                  borders: noBorder, width: { size: 3600, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Indian Legal Technology', font: 'Arial', size: 21, bold: true, color: C.darkBg })] })]
                }),
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: noBorder, width: { size: 1800, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Build Stage', font: 'Arial', size: 21, color: C.mid })] })]
                }),
                new TableCell({
                  borders: noBorder, width: { size: 3600, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Production-Grade MVP', font: 'Arial', size: 21, bold: true, color: C.green })] })]
                }),
              ]
            }),
          ],
        }),

        spacer(400),
        new Paragraph({ children: [new PageBreak()] }),
      ],
    },

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 2 — TOC + BODY
    // ══════════════════════════════════════════════════════════════════════════
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1260, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            spacing: { before: 0, after: 0 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.bluePale } },
            children: [
              new TextRun({ text: 'LexAmplify ', font: 'Arial', size: 19, bold: true, color: C.blue }),
              new TextRun({ text: '— Product UX Report  ·  June 2026', font: 'Arial', size: 19, color: C.slateLight }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            spacing: { before: 0, after: 0 },
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.bluePale } },
            children: [
              new TextRun({ text: 'Confidential · LexAmplify India · Page ', font: 'Arial', size: 18, color: C.slateLight }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 18, color: C.slate }),
            ],
          })],
        }),
      },

      children: [
        // ── TABLE OF CONTENTS ───────────────────────────────────────────
        h1('Table of Contents'),
        new TableOfContents('Table of Contents', {
          hyperlink: true,
          headingStyleRange: '1-3',
        }),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 1: EXECUTIVE SUMMARY ─────────────────────────────
        h1('1. Executive Summary'),
        p('LexAmplify is a full-stack AI-powered legal practice management platform purpose-built for Indian advocates and law firms. It integrates an AI command palette, contract analysis, conflict checking, a document vault, a legal calendar, court resource browsing, and a virtual courtroom simulation into a single unified enterprise console.', { size: 23, before: 100, after: 120 }),
        p('This report audits every module that has been built, catalogues the exact features delivered, identifies the remaining gaps, and provides a prioritised build list for the next phase of development.', { size: 23, before: 0, after: 200 }),

        // Snapshot stats
        h2('1.1 At a Glance'),
        spacer(80),
        statRow([
          { value: '8', label: 'Modules Built', color: C.green, bg: C.greenPale },
          { value: '17', label: 'React Components', color: C.blue, bg: C.bluePale },
          { value: '40+', label: 'Backend API Routes', color: C.purple, bg: C.purplePale },
          { value: '12', label: 'Gaps / Next Items', color: C.amber, bg: C.amberPale },
        ]),
        spacer(200),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 2: ARCHITECTURE ────────────────────────────────────
        h1('2. Technical Architecture'),

        h2('2.1 Frontend Stack'),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3200, 6160],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 3200, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Component', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 6160, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Detail', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
              ]
            }),
            ...[
              ['Framework', 'React 18 + Vite (SPA)'],
              ['Routing', 'React Router v6 with nested layouts'],
              ['Theming', 'CSS custom properties + data-theme attribute on <html>'],
              ['State Management', 'useState / useReducer per component — no Redux'],
              ['AI Streaming', 'Server-Sent Events (SSE) via ReadableStream'],
              ['Icons', 'Inline SVG — zero external icon dependency'],
              ['Fonts', 'Georgia (serif headings) + System-UI (body)'],
              ['Deploy Target', 'Firebase Hosting (lexamplify.web.app)'],
            ].map(([k, v], i) => kvRow(k, v, i % 2 === 0)),
          ],
        }),

        spacer(160),
        h2('2.2 Backend Stack'),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3200, 6160],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 3200, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Component', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 6160, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Detail', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
              ]
            }),
            ...[
              ['Framework', 'Python Flask — single create_app() factory in app.py'],
              ['Database', 'SQLite (lex_assistant.db) — adjacency-list folder tree'],
              ['AI / LLM', 'Groq (Llama / Mixtral) for all generation tasks'],
              ['Legal Search', 'Tavily + Indian Kanoon API for live precedent lookup'],
              ['Authentication', 'Flask-JWT-Extended with Bearer token scheme'],
              ['PDF Generation', 'ReportLab (pure Python — no wkhtmltopdf binary)'],
              ['DOCX Generation', 'python-docx (pure Python — no Pandoc binary)'],
              ['Deploy Target', 'Render.com (lexamplify-backend.onrender.com)'],
            ].map(([k, v], i) => kvRow(k, v, i % 2 === 0)),
          ],
        }),

        spacer(160),
        h2('2.3 Database Schema — Key Tables'),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2200, 7160],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 2200, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Table', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 7160, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Purpose & Key Columns', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
              ]
            }),
            ...[
              ['cases', 'Core case registry — case_id, title, status, client, opposing_counsel, court'],
              ['case_vault', 'Document storage — content (TEXT), file_blob (BLOB), file_format, folder_id, smart_title, tags'],
              ['vault_folders', 'Adjacency-list folder tree — id, name, parent_id (self-referential FK with CASCADE)'],
              ['vault_audit', 'AI provenance — links each saved document to the agent conversation (messages_json) that produced it'],
              ['calendar_events', 'Hearing dates — event_date, event_type (hearing/drop_dead/tickler), title, related_case_id'],
              ['ip_assets', 'IP tracker — ip_type, registration_number, filing_date, renewal_due, status'],
              ['tasks', 'Internal task assignments — title, assigned_to, status'],
            ].map(([k, v], i) => new TableRow({
              children: [
                new TableCell({
                  borders: cellBorder(), width: { size: 2200, type: WidthType.DXA },
                  shading: i % 2 === 0 ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: k, font: 'Courier New', size: 19, bold: true, color: C.blue })] })]
                }),
                new TableCell({
                  borders: cellBorder(), width: { size: 7160, type: WidthType.DXA },
                  shading: i % 2 === 0 ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: v, font: 'Arial', size: 21, color: C.slate })] })]
                }),
              ]
            })),
          ],
        }),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 3: MODULE STATUS ────────────────────────────────────
        h1('3. Module Status'),
        p('The following table covers every user-facing module, its route, what it delivers, and its current completion status.', { before: 60, after: 160 }),

        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [1600, 5960, 1800],
          rows: [
            // Header
            new TableRow({
              children: [
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 1600, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Module', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 5960, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Description', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 1800, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 80 },
                  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Status', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
              ]
            }),
            moduleRow('🏠', 'Landing Page', '/ (public)',
              'Dark glassmorphic hero with split layout, animated terminal mockup, feature showcase, testimonials, pricing teaser, sticky header, light/dark theme toggle, and CTA buttons to Login.',
              'Complete', C.green, C.greenPale, false),
            moduleRow('🔐', 'Authentication', '/login  /signup',
              'Split-panel login with branded left panel (hidden on mobile), JWT tokens stored in localStorage, themed form fields, error messaging. Sign-up exists. No password reset or email verification yet.',
              'Partial', C.amber, C.amberPale, true),
            moduleRow('📊', 'Dashboard', '/dashboard',
              'Live triage stats (limitation expiries, pending judgments, draft counts, tracked cases) from API. CNR number sync bar linking to eCourts. Morning brief of 48-hour events. Quick-action tiles for all tools. Zero hardcoded data.',
              'Complete', C.green, C.greenPale, false),
            moduleRow('💬', 'InzIQ', '⌘K global overlay',
              'Full-screen AI command palette with SSE streaming. Multi-session sidebar (pin, rename, share, delete). Rich-text draft editor with toolbar. File upload mid-conversation. Save-to-Vault with PDF/DOCX/Native format selector. AI provenance audit trail. LLM intent-driven navigation to any module.',
              'Complete', C.green, C.greenPale, true),
            moduleRow('📄', 'Contract Analyzer', '/contract-analyzer',
              'Upload PDF/DOCX → AI risk analysis with colour-coded risk pills (High/Amber/Green). Collapsible summary banner. Clause-level risk annotation sidebar. AI-powered clause rewrite. One-click export. Summary and Recommendations tabs. Chat-with-contract panel.',
              'Complete', C.green, C.greenPale, false),
            moduleRow('⚖️', 'Court Resources', '/court-resources',
              'Tabbed browser: live court session indicator (In/Holiday), district court data, IPC/BNS/CrPC/PoSH/FEMA statute lookup, court fee calculator, IP asset tracker (full CRUD), cause-list pull from eCourts API.',
              'Complete', C.green, C.greenPale, true),
            moduleRow('🔍', 'Conflict Engine', '/conflict-engine',
              'Name-check tab and multi-document cross-check tab. Batch file upload (multiple PDFs/DOCX). Deduplication with yellow warning toast. Drag-and-drop slots with progressive set addition — preserved slots show purple "From previous run" badge. Conflict severity badges. Clearance memo generation.',
              'Complete', C.green, C.greenPale, false),
            moduleRow('📅', 'Legal Calendar', '/calendar',
              'Full month-grid with animated hover. Event types: Hearing (blue), Deadline/Drop-dead (red), General (grey). Portal-rendered tooltips avoiding z-index clipping. Add/Delete events. CNR sync auto-populates hearing dates from eCourts.',
              'Complete', C.green, C.greenPale, true),
            moduleRow('🔒', 'Case Vault', '/vault',
              'Infinite recursive folder tree (create, rename, move, delete) with circular-parentage guard. Breadcrumb navigation. Document grid with 3-dots context menu (Analyze, Summarize, Extract Facts, Download, Delete). FolderMoveModal. Audit trail per document.',
              'Complete', C.green, C.greenPale, false),
            moduleRow('📝', 'Document Viewer', '/vault/document/:id',
              'Split-panel — left: paper-styled document with contentEditable body and light-theme markdown. Right: AI analysis sidebar. Rich-text toolbar (Bold, Italic, Underline, Strikethrough, Lists). Floating animated Save FAB. isDirty guard with beforeunload warning and navigation confirmation.',
              'Complete', C.green, C.greenPale, true),
            moduleRow('⚔️', 'Virtual Courtroom', '/war-room',
              '5-stage animated pipeline loader. Live Indian Kanoon precedent search. AI-drafted strategic opening argument. Red-team opposing counsel simulation. Results: Issues cards, Arguments panel, Rebuttal cards, Precedents rail. Export to Vault. Triggered from direct route or via LLM intent from InzIQ.',
              'Complete', C.green, C.greenPale, false),
            moduleRow('🗂️', 'Case Workspace', '/case/:caseId',
              'Per-case deep-dive view with case header (title, status badge, suit number). Embedded VaultView filtered to case ID. Case timeline, parties, hearing history. AI insights tab. Deep-linked from sidebar tracked-cases list and Dashboard.',
              'Partial', C.amber, C.amberPale, true),
          ],
        }),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 4: FEATURE COMPLETENESS ───────────────────────────
        h1('4. Feature Completeness'),
        p('Legend:  ✓ Done    ⚠ Partial / Known Issue    ○ Not Yet Built', { bold: true, before: 60, after: 160 }),

        h2('4.1 Authentication & Access'),
        checkItem('✓', 'JWT login with localStorage persistence', C.green),
        checkItem('✓', 'Sign-up page with form validation', C.green),
        checkItem('✓', 'Secure sign-out (clears all tokens)', C.green),
        checkItem('⚠', 'Email verification on sign-up', C.amber),
        checkItem('○', 'Forgot password / password-reset flow', C.slateLight),
        checkItem('○', 'Google OAuth / Bar Council SSO integration', C.slateLight),
        checkItem('○', 'Multi-user firm accounts with role-based access', C.slateLight),
        spacer(100),

        h2('4.2 InzIQ (AI Chat)'),
        checkItem('✓', 'Server-Sent Events (SSE) real-time streaming responses', C.green),
        checkItem('✓', 'Multi-session history — pin, rename, share, delete', C.green),
        checkItem('✓', 'File upload mid-conversation (PDF, DOCX, images)', C.green),
        checkItem('✓', 'Draft document generation with rich-text editor toolbar', C.green),
        checkItem('✓', 'Save-to-Vault from chat (Native / PDF / DOCX format selector)', C.green),
        checkItem('✓', 'AI provenance audit trail (agent session linked to saved doc)', C.green),
        checkItem('✓', 'LLM intent routing — navigates to any module from chat', C.green),
        checkItem('✓', 'Courtroom simulation trigger from InzIQ', C.green),
        checkItem('○', 'Voice input (microphone button)', C.slateLight),
        checkItem('○', 'Inline citation hyperlinks to Indian Kanoon judgments', C.slateLight),
        spacer(100),

        h2('4.3 Case Vault'),
        checkItem('✓', 'Infinite recursive folder nesting (adjacency-list model)', C.green),
        checkItem('✓', 'Rename, Move, Delete folders with circular-parentage guard', C.green),
        checkItem('✓', 'Document 3-dots context menu (Analyze, Summarize, Extract, Download, Delete)', C.green),
        checkItem('✓', 'contentEditable inline document editing with dirty-state guard', C.green),
        checkItem('✓', 'Floating Save FAB with animation and unsaved-changes warning', C.green),
        checkItem('✓', 'PDF and DOCX export on save (stored as BLOB in SQLite)', C.green),
        checkItem('✓', 'Explorer-style drill-down Save Modal with breadcrumb navigation', C.green),
        checkItem('✓', 'Folder badge shown on document cards', C.green),
        checkItem('○', 'Full-text search across all vault documents', C.slateLight),
        checkItem('○', 'Bulk select, bulk move, bulk delete, bulk download as ZIP', C.slateLight),
        checkItem('○', 'Download binary file (PDF/DOCX) from vault card menu', C.slateLight),
        spacer(100),

        h2('4.4 Contract Analyzer'),
        checkItem('✓', 'PDF and DOCX upload with server-side text extraction', C.green),
        checkItem('✓', 'AI risk scoring with colour-coded High / Amber / Green pills', C.green),
        checkItem('✓', 'Clause-level annotation sidebar with inline highlighting', C.green),
        checkItem('✓', 'AI-powered clause rewrite with one-click replace', C.green),
        checkItem('✓', 'Collapsible summary banner and Recommendations tab', C.green),
        checkItem('✓', 'Chat-with-contract panel for ad-hoc questions', C.green),
        checkItem('⚠', 'Export does not retain original document formatting', C.amber),
        checkItem('○', 'Redline / diff view comparing original vs rewritten clause', C.slateLight),
        checkItem('○', 'Template library for standard Indian law clause variants', C.slateLight),
        spacer(100),

        h2('4.5 Conflict Engine'),
        checkItem('✓', 'Entity name conflict check against case database', C.green),
        checkItem('✓', 'Batch multi-file upload (drag-and-drop + file picker)', C.green),
        checkItem('✓', 'Deduplication guard with yellow warning toast', C.green),
        checkItem('✓', 'Progressive set addition — preserved slots with purple badge', C.green),
        checkItem('✓', 'Conflict severity: Direct Conflict / Potential / Monitor / Clear', C.green),
        checkItem('✓', 'Breadcrumb chain display per conflict result', C.green),
        checkItem('✓', 'Clearance memo auto-generation and save to Vault', C.green),
        checkItem('○', 'Historical conflict check log / search archive', C.slateLight),
        checkItem('○', 'Client intake form triggered from conflict-clear result', C.slateLight),
        spacer(100),

        h2('4.6 Virtual Courtroom'),
        checkItem('✓', '5-stage animated pipeline loader with per-stage status dots', C.green),
        checkItem('✓', 'Live Indian Kanoon precedent search integrated in pipeline', C.green),
        checkItem('✓', 'Strategic opening argument drafted by AI', C.green),
        checkItem('✓', 'Opposing-counsel AI red-team with rebuttal cards', C.green),
        checkItem('✓', 'Results page: Issues, Arguments, Rebuttals, Precedents tabs', C.green),
        checkItem('✓', 'Export full simulation package to Case Vault', C.green),
        checkItem('○', 'Interactive turn-by-turn debate mode (lawyer types, AI rebuts)', C.slateLight),
        checkItem('○', 'Judge AI scoring and ruling simulation', C.slateLight),
        spacer(100),

        h2('4.7 Legal Calendar'),
        checkItem('✓', 'Full month-grid calendar with event dot indicators', C.green),
        checkItem('✓', 'Portal-rendered hover tooltip (avoids z-index / overflow clipping)', C.green),
        checkItem('✓', 'Add event modal with type, date, title, case-link fields', C.green),
        checkItem('✓', 'Delete events from day view', C.green),
        checkItem('✓', 'CNR sync auto-populates hearing dates from eCourts API', C.green),
        checkItem('✓', 'Drop-dead / limitation deadline shown in red accent', C.green),
        checkItem('○', 'Recurring event support (weekly hearings)', C.slateLight),
        checkItem('○', 'Email and in-app push reminders before deadlines', C.slateLight),
        checkItem('○', 'Google Calendar / Outlook two-way sync', C.slateLight),
        spacer(100),

        h2('4.8 Shell & UX System'),
        checkItem('✓', 'Persistent sidebar with 7 primary nav items + live case list', C.green),
        checkItem('✓', 'Topbar breadcrumbs auto-generated from current route', C.green),
        checkItem('✓', 'Light / Dark / Light-Matte theme toggle, persisted to localStorage', C.green),
        checkItem('✓', 'Focus Mode — CSS-only sidebar hide with smooth 300ms transition', C.green),
        checkItem('✓', 'Focus Mode escape hatch button (fixed position, outside sidebar)', C.green),
        checkItem('✓', 'Ctrl+\\ / Cmd+\\ global keyboard shortcut to toggle Focus Mode', C.green),
        checkItem('✓', 'Mobile hamburger + off-canvas drawer with overlay', C.green),
        checkItem('✓', 'Page-enter animation (fade + slide) on every route change', C.green),
        checkItem('○', 'Global toast / notification system for async feedback', C.slateLight),
        checkItem('○', 'Onboarding / empty-state coaching for new users', C.slateLight),

        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 5: GAPS & BUILD LIST ───────────────────────────────
        h1('5. Gaps & Prioritised Build List'),
        p('The following 12 items represent everything that has not yet been built, ranked by deployment impact. P1 items block real-world usage by lawyers. P2 items block firm-level adoption. P3 items are polish.', { before: 60, after: 160 }),

        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [600, 1600, 5360, 1800],
          rows: [
            // Header
            new TableRow({
              children: [
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 600, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 100, right: 60 },
                  children: [new Paragraph({ children: [new TextRun({ text: '#', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 1600, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 100, right: 60 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Module', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 5360, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 100, right: 60 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Gap Description', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 1800, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 100, right: 60 },
                  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Priority', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
              ]
            }),
            gapRow('01', 'Case Vault', 'Download button for PDF/DOCX blobs — backend route /api/vault/documents/<id>/download exists but is not yet wired to the VaultView card context menu.', 'P1 Critical', C.red, C.redPale, false),
            gapRow('02', 'Auth', 'Password reset / forgot-password flow is completely absent. Any lawyer who forgets their password has no recovery path — a hard deployment blocker for real users.', 'P1 Critical', C.red, C.redPale, true),
            gapRow('03', 'Case Vault', 'Full-text search across all vault documents. Currently only folder navigation exists. Lawyers need to find documents by keyword, case name, or tag across the entire vault.', 'P1 Critical', C.red, C.redPale, false),
            gapRow('04', 'Calendar', 'No notification or reminder system. Events are stored but nothing alerts the lawyer before a hearing or deadline. Email / in-app push reminders are essential for any legal deadline tool.', 'P1 Critical', C.red, C.redPale, true),
            gapRow('05', 'Contract Analyzer', 'Redline / diff view when a clause is rewritten by AI. Currently the rewrite replaces text with no visual comparison to the original. Lawyers need before/after comparison or tracked-changes view.', 'P2 High', C.amber, C.amberPale, false),
            gapRow('06', 'Auth', 'Multi-user / firm-level accounts. All data is currently per-device with no concept of a firm, team, or shared vault. Required before any firm-level sale.', 'P2 High', C.amber, C.amberPale, true),
            gapRow('07', 'Virtual Courtroom', 'Interactive turn-by-turn debate mode — the lawyer types a response, the opposing AI rebuts. Currently the simulation is a single one-shot generation, not a real conversation.', 'P2 High', C.amber, C.amberPale, false),
            gapRow('08', 'Case Vault', 'Bulk select operations — checkboxes, select-all, bulk move-to-folder, bulk delete, bulk download as ZIP. Standard file-manager behaviour lawyers expect from a Windows-explorer-style UI.', 'P2 High', C.amber, C.amberPale, true),
            gapRow('09', 'InzIQ', 'Inline citation hyperlinks — when the LLM cites a judgment, the text should be a clickable link to Indian Kanoon rather than plain text. Builds verifiability and trust.', 'P2 High', C.amber, C.amberPale, false),
            gapRow('10', 'Calendar', 'Google Calendar / Outlook two-way sync. Lawyers use external calendars on mobile. Hearing dates added via CNR sync should propagate automatically to their existing calendar.', 'P3 Medium', C.purple, C.purplePale, true),
            gapRow('11', 'Shell', 'Onboarding flow for new users — empty-state screens with guided first-action prompts (e.g. "Upload your first contract", "Sync your first CNR case"). Currently new users land on a blank dashboard.', 'P3 Medium', C.purple, C.purplePale, false),
            gapRow('12', 'Conflict Engine', 'Search history / log for past conflict checks. Lawyers need to go back to a previous clearance memo without re-running the full check. No persistence of check history currently.', 'P3 Medium', C.purple, C.purplePale, true),
          ],
        }),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 6: DESIGN SYSTEM ─────────────────────────────────
        h1('6. Design System'),

        h2('6.1 Colour Tokens'),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2400, 2400, 4560],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 2400, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Token', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 2400, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Hex Value', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 4560, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Usage', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
              ]
            }),
            ...[
              ['--accent-primary', '#3B82F6', 'Primary interactive colour — buttons, links, active states'],
              ['--accent-success', '#10B981', 'Success states, complete badges, positive metrics'],
              ['--accent-danger', '#EF4444', 'Errors, deletions, high-risk flags, deadlines'],
              ['--accent-warning', '#F59E0B', 'Warnings, amber risk, partial states'],
              ['--accent-purple', '#8B5CF6', 'Progressive set badges, draft-pending indicators'],
              ['--bg-app', '#0A0E17', 'Main application background (dark mode)'],
              ['--bg-sidebar', '#121620', 'Sidebar and navigation surface'],
              ['--bg-panel', '#171c26', 'Cards, modals, floating panels'],
              ['--text-primary', '#E2E8F0', 'Primary readable text'],
              ['--text-muted', '#64748B', 'Secondary / supporting text, placeholders'],
            ].map(([token, hex, usage], i) => new TableRow({
              children: [
                new TableCell({
                  borders: cellBorder(), width: { size: 2400, type: WidthType.DXA },
                  shading: i % 2 === 0 ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: token, font: 'Courier New', size: 19, color: C.blue })] })]
                }),
                new TableCell({
                  borders: cellBorder(), width: { size: 2400, type: WidthType.DXA },
                  shading: i % 2 === 0 ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: hex, font: 'Courier New', size: 19, color: C.slate })] })]
                }),
                new TableCell({
                  borders: cellBorder(), width: { size: 4560, type: WidthType.DXA },
                  shading: i % 2 === 0 ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: usage, font: 'Arial', size: 21, color: C.slate })] })]
                }),
              ]
            })),
          ],
        }),

        spacer(160),
        h2('6.2 Typography'),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2400, 2400, 4560],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 2400, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Role', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 2400, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Font', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
                new TableCell({
                  borders: cellBorder(C.blue), width: { size: 4560, type: WidthType.DXA },
                  shading: { fill: '1E3A5F', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Notes', font: 'Arial', size: 21, bold: true, color: C.white })] })]
                }),
              ]
            }),
            ...[
              ['Module headings', 'Georgia (--font-serif)', 'Conveys authority and legal gravitas — used on all H1 page titles'],
              ['UI labels / body', 'System-UI (--font-sans)', 'Maximum legibility at small sizes — all buttons, inputs, tables'],
              ['Monospace / code', 'System monospace', 'Code tokens, keyboard shortcuts, API references, CNR numbers'],
            ].map(([role, font, notes], i) => new TableRow({
              children: [
                new TableCell({
                  borders: cellBorder(), width: { size: 2400, type: WidthType.DXA },
                  shading: i % 2 === 0 ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: role, font: 'Arial', size: 21, bold: true, color: C.darkBg })] })]
                }),
                new TableCell({
                  borders: cellBorder(), width: { size: 2400, type: WidthType.DXA },
                  shading: i % 2 === 0 ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: font, font: 'Arial', size: 21, color: C.blue })] })]
                }),
                new TableCell({
                  borders: cellBorder(), width: { size: 4560, type: WidthType.DXA },
                  shading: i % 2 === 0 ? { fill: C.offwhite, type: ShadingType.CLEAR } : undefined,
                  margins: { top: 80, bottom: 80, left: 140, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: notes, font: 'Arial', size: 21, color: C.slate })] })]
                }),
              ]
            })),
          ],
        }),

        spacer(160),
        h2('6.3 Themes'),
        bullet('Dark (default) — Deep navy-black (#0A0E17). Glassmorphic panels with backdrop blur. All primary development done in this theme.'),
        bullet('Light — Full light-mode override via [data-theme="light"] CSS selector. All primary text, inputs, sidebar and topbar surfaces switched.'),
        bullet('Light-Matte — Alternative light theme with no sidebar border, soft box-shadow instead.'),
        bullet('Theme persisted to localStorage (lexai_theme key) and applied via data-theme attribute on <html>.'),
        spacer(160),

        h2('6.4 Interaction Patterns'),
        bullet('3-dots context menus — consistent pattern across folder cards and document cards. Single global openMenuId state prevents two menus opening simultaneously.'),
        bullet('SSE streaming — all AI responses stream token-by-token into the UI. No spinners waiting for full response.'),
        bullet('Dirty-state guards — any screen with editable content (Document Viewer, draft editor) shows unsaved-changes warning on navigation and beforeunload.'),
        bullet('Focus Mode — sidebar hides via CSS transform (not unmount), ensuring no layout shift and smooth 300ms cubic-bezier transition.'),
        bullet('Page animations — every route change triggers a CSS page-enter animation (fade + translateY) for perceived performance.'),
        bullet('Toast notifications — used in Conflict Engine for dedup warnings. Global toast system not yet unified across all modules.'),

        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 7: NEXT STEPS ─────────────────────────────────────
        h1('7. Recommended Next Steps'),

        h2('7.1 Immediate (P1 — Ship Blockers)'),
        bullet('Wire the download endpoint — connect /api/vault/documents/<id>/download to the VaultView card menu for PDF and DOCX files.', C.slate, false),
        bullet('Build password reset flow — email-based token reset is the minimum; without it no lawyer can recover their account.', C.slate, false),
        bullet('Add vault full-text search — a search bar above the document grid that queries content, smart_title, and tags columns via SQLite FTS5.', C.slate, false),
        bullet('Implement reminder notifications — at minimum, a daily digest email of deadlines in the next 7 days, using calendar_events table data.', C.slate, false),

        spacer(80),
        h2('7.2 Short-Term (P2 — Firm Adoption)'),
        bullet('Contract redline diff view — render a before/after split or track-changes-style highlight when a clause is rewritten.'),
        bullet('Multi-user accounts — introduce a firms table, user-to-firm membership, and shared vault with per-user write guards.'),
        bullet('Interactive courtroom debate — convert the one-shot simulation into a turn-by-turn streaming conversation with the AI opponent.'),
        bullet('Bulk vault operations — checkboxes on document cards, select-all header, bulk move/delete/download as ZIP.'),
        bullet('Citation hyperlinks in AI — post-process LLM output to detect citation patterns and wrap them in Indian Kanoon deep-links.'),

        spacer(80),
        h2('7.3 Medium-Term (P3 — Polish)'),
        bullet('Google Calendar / Outlook sync via OAuth — two-way so hearing dates appear in lawyers\' existing mobile calendars.'),
        bullet('Onboarding flow — guided empty states for first-time users with step-by-step prompts for first contract upload, first CNR sync, first vault save.'),
        bullet('Conflict check history log — persist each check with its entity names, documents ingested, results, and clearance memo link.'),
        bullet('Unified global toast system — replace per-component toast state with a single context-driven toast queue for consistent in-app feedback.'),

        spacer(400),
        hrule(C.blueLight),
        spacer(120),

        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 40 },
          children: [new TextRun({ text: 'LexAmplify India · Product UX Report · June 2026', font: 'Arial', size: 20, color: C.slateLight })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: 'Prepared by Narendar V · Confidential', font: 'Arial', size: 18, italics: true, color: C.slateLight })],
        }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('E:\\lexai-india\\LexAmplify_UX_Report.docx', buffer);
  console.log('SUCCESS: E:\\lexai-india\\LexAmplify_UX_Report.docx written.');
}).catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
