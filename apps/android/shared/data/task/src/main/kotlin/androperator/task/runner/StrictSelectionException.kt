package androperator.task.runner

/** A fresh selection failed before the next target or gesture dispatch. */
class StrictSelectionException(
    val code: String,
    val candidateCount: Int,
    val candidates: String,
) : IllegalStateException("$code: resolved $candidateCount candidates") {
    fun stepData(): Map<String, String> = mapOf(
        "error" to code,
        "candidate_count" to candidateCount.toString(),
        "candidates" to candidates,
    )
}
