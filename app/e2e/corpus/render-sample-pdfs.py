"""Render one fictional legal-source PDF per persona for document ingestion QA."""
from __future__ import annotations

import html
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

CORPUS_DIR = Path(__file__).resolve().parent
SOURCE = CORPUS_DIR / "generated" / "qwen-episodes.jsonl"
OUTPUT = CORPUS_DIR / "output" / "pdf"
OUTPUT.mkdir(parents=True, exist_ok=True)

font_path = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
if font_path.exists():
    pdfmetrics.registerFont(TTFont("CorpusSans", str(font_path)))
    FONT = "CorpusSans"
else:
    FONT = "Helvetica"

records = [json.loads(line) for line in SOURCE.read_text(encoding="utf-8").splitlines() if line]
revisions_source = CORPUS_DIR / "generated" / "qwen-revisions.jsonl"
if revisions_source.exists():
    revisions = {entry["id"]: entry for entry in (json.loads(line) for line in revisions_source.read_text(encoding="utf-8").splitlines() if line)}
    records = [revisions.get(entry["id"], entry) for entry in records]
personas = ["lena-weber", "sofia-morales", "rowan-chen"]

def clean(value: str) -> str:
    return html.escape(value.replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-"))

for persona_id in personas:
    episode = next((entry for entry in records if entry["personaId"] == persona_id and entry["kind"] == "legal"), None)
    if episode is None:
        raise ValueError(f"No legal episode for {persona_id}")
    artifact = episode["artifact"]
    path = OUTPUT / f"{persona_id}-legal-source.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=48, leftMargin=48,
                            topMargin=46, bottomMargin=48, title=artifact["title"],
                            author="avenOS synthetic corpus")
    styles = {
        "eyebrow": ParagraphStyle("eyebrow", fontName=FONT, fontSize=8.5, leading=12,
                                   textColor=colors.HexColor("#3d6e79"), spaceAfter=9),
        "title": ParagraphStyle("title", fontName=FONT, fontSize=18, leading=24,
                                 textColor=colors.HexColor("#1b2d3e"), spaceAfter=19),
        "meta": ParagraphStyle("meta", fontName=FONT, fontSize=9.5, leading=14,
                                textColor=colors.HexColor("#344657")),
        "body": ParagraphStyle("body", fontName=FONT, fontSize=10.5, leading=16,
                                textColor=colors.HexColor("#243342"), alignment=TA_LEFT,
                                spaceAfter=12),
        "footer": ParagraphStyle("footer", fontName=FONT, fontSize=8, leading=11,
                                  textColor=colors.HexColor("#647482")),
    }
    story = [Paragraph("SYNTHETIC CORPUS - LEGAL SOURCE", styles["eyebrow"]),
             Paragraph(clean(artifact["title"]), styles["title"])]
    metadata = Table([
        [Paragraph("Date", styles["meta"]), Paragraph(clean(episode["date"]), styles["meta"])],
        [Paragraph("From", styles["meta"]), Paragraph(clean(artifact["from"]), styles["meta"])],
        [Paragraph("Matter", styles["meta"]), Paragraph(clean(episode["intentId"]), styles["meta"])],
        [Paragraph("Language", styles["meta"]), Paragraph(clean(artifact["language"]), styles["meta"])],
    ], colWidths=[78, 390])
    metadata.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f5f6")),
        ("BOX", (0, 0), (-1, -1), .5, colors.HexColor("#d8e1e5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story += [metadata, Spacer(1, 22)]
    paragraphs = [segment.strip() for segment in artifact["body"].split("\n\n") if segment.strip()]
    for segment in paragraphs:
        story.append(Paragraph(clean(segment).replace("\n", "<br/>"), styles["body"]))
    story += [Spacer(1, 20), Paragraph("Fictional test record. This file does not create a valid agreement or signature.", styles["footer"])]

    def page_footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#d8e1e5"))
        canvas.line(48, 39, A4[0] - 48, 39)
        canvas.setFont(FONT, 7.5)
        canvas.setFillColor(colors.HexColor("#657581"))
        canvas.drawString(48, 26, f"Synthetic source {episode['id']}")
        canvas.drawRightString(A4[0] - 48, 26, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=page_footer, onLaterPages=page_footer)
    print(path)
