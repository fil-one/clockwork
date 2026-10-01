# Fonts

The interface reuses Fil One's self-hosted Inter variable font. Native system
fonts cover Japanese, Chinese, and Arabic; no external font request is needed.

The eight small `og-*.ttf` subsets are Noto Sans (Latin), Noto Sans JP, Noto
Sans SC, and Tajawal (Arabic) at weight 500, obtained from the Google Fonts CSS
API with the exact social-card text as its `text` parameter on 2026-09-30. They
supply deterministic localized social cards without runtime network requests.
Corresponding upstream SIL Open Font License files are included. If social-card
copy changes, regenerate the relevant text subset before release.
