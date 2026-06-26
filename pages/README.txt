Clone Hero Chart Manager — landing page
=======================================

Static site, ready for Cloudflare Pages. No build step.

CONTENTS
  index.html      → the page (entry point)
  assets/         → screenshots + app icon used by the page
Fonts load from Google Fonts over the internet (no local files needed).

DEPLOY TO CLOUDFLARE PAGES
  Option A — drag & drop (fastest)
    1. Cloudflare dashboard → Workers & Pages → Create → Pages → "Upload assets".
    2. Drag THIS WHOLE FOLDER (the one containing index.html) in.
    3. Deploy. Done.

  Option B — connect a Git repo
    1. Put these files at the repo root (index.html at the top level).
    2. In Pages, create a project from the repo.
    3. Build command: (leave empty)
       Build output directory: /   (or the folder holding index.html)

NOTES
  • All download buttons point to your GitHub release v0.1.0.
  • To update later, just re-upload the folder or push to the repo.
