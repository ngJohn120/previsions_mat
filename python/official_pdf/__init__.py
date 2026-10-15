"""SILOE official PDF renderer package.

`renderer.render_pdf(payload)` renders the paper-faithful A4-landscape
Prévision PDF from a print-only payload (see `src/lib/pdf-renderer-contract.ts`
for the canonical shape).  This package must stay free of any database,
network, or credential access so it can run inside the Vercel Python runtime.
"""