package clawperator.uitree

/** Submission dispatch evidence after accepted text entry; does not verify the destination. */
enum class TextSubmissionOutcome(val wireValue: String) {
    NotRequested("not_requested"),
    ImeEditorAction("ime_action"),
    ClickFallback("click_fallback"),
    Unavailable("submit_unavailable"),
}
