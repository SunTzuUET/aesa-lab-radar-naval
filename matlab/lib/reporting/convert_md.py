"""Convierte un .md a .pdf usando markdown (HTML) + xhtml2pdf (PDF).

Dependencias:
    pip install markdown xhtml2pdf

Uso:
    python convert_md.py <ruta_al_report.md>
"""
import sys
from pathlib import Path


def md_to_pdf(md_path: Path, pdf_path: Path) -> None:
    try:
        import markdown
    except ImportError:
        print("ERROR: 'markdown' no instalado. Ejecuta: pip install markdown",
              file=sys.stderr)
        sys.exit(2)
    try:
        from xhtml2pdf import pisa
    except ImportError:
        print("ERROR: 'xhtml2pdf' no instalado. Ejecuta: pip install xhtml2pdf",
              file=sys.stderr)
        sys.exit(2)

    md_text = md_path.read_text(encoding="utf-8")

    # Renderiza markdown -> HTML con extensiones utiles para tablas y codigo.
    html_body = markdown.markdown(
        md_text,
        extensions=["tables", "fenced_code", "sane_lists", "toc"],
        output_format="html5",
    )

    # CSS minimo para que tablas y figuras queden legibles en xhtml2pdf.
    # xhtml2pdf soporta solo un subconjunto de CSS; este estilo es seguro.
    css = """
    @page {
        size: A4;
        margin: 2cm 1.8cm;
    }
    body  { font-family: Helvetica, sans-serif; font-size: 10pt; color: #222; }
    h1    { font-size: 18pt; color: #111; border-bottom: 1px solid #888;
            padding-bottom: 4pt; margin-top: 0; }
    h2    { font-size: 14pt; color: #111; margin-top: 18pt; }
    h3    { font-size: 11pt; color: #333; margin-top: 12pt; }
    p     { margin: 6pt 0; }
    table { border-collapse: collapse; margin: 6pt 0; }
    th, td{ border: 0.5pt solid #888; padding: 3pt 6pt; }
    th    { background-color: #eee; font-weight: bold; }
    code  { font-family: Courier, monospace; background: #f3f3f3;
            padding: 1pt 3pt; }
    pre   { background: #f3f3f3; padding: 6pt; }
    img   { max-width: 100%; }
    em    { color: #555; }
    """

    # Resolver rutas relativas de imagenes respecto al .md
    base_path = str(md_path.parent.resolve()) + "/"

    html_doc = (
        "<!DOCTYPE html><html><head>"
        f"<style>{css}</style>"
        "</head><body>"
        f"{html_body}"
        "</body></html>"
    )

    with open(pdf_path, "wb") as out:
        result = pisa.CreatePDF(
            src=html_doc,
            dest=out,
            encoding="utf-8",
            path=base_path,            # base para resolver <img src="figures/...">
        )

    if result.err:
        print(f"ERROR: xhtml2pdf devolvio {result.err} errores", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python convert_md.py <ruta_al_report.md>", file=sys.stderr)
        sys.exit(1)

    md_path = Path(sys.argv[1])
    if not md_path.exists():
        print(f"ERROR: no existe {md_path}", file=sys.stderr)
        sys.exit(1)

    pdf_path = md_path.with_suffix(".pdf")
    try:
        md_to_pdf(md_path, pdf_path)
        print(f"OK {pdf_path.name}")
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
