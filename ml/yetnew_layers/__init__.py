"""Yet New CAD layer labeling: summarize DXF layers, label them with a local model."""

from .labels import CONFIRM_ALL_LAYERS, LABELS, REVIEW_THRESHOLD, must_confirm, needs_review, validate_label
from .summarize import SUMMARIZER_VERSION, summarize_doc, summarize_file

__all__ = [
    "CONFIRM_ALL_LAYERS", "LABELS", "REVIEW_THRESHOLD", "SUMMARIZER_VERSION",
    "must_confirm", "needs_review", "summarize_doc", "summarize_file", "validate_label",
]
