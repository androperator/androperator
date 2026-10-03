package androperator.task.runner

/** Pure bounded grammar shared with the Node validator. Values are never parsed recursively. */
object OnScreenLogTemplate {
    const val MAX_EXPANDED_LENGTH = 8192
    const val MAX_VALUE_LENGTH = 256
    val names = setOf(
        "foreground_app.icon", "foreground_app.package_name", "foreground_app.version_code",
        "foreground_app.version_name", "device.manufacturer", "device.model",
        "system.language_code", "system.language_tag", "system.language_name",
    )

    data class Part(val literal: String? = null, val name: String? = null)

    fun parse(template: String): List<Part> {
        val parts = mutableListOf<Part>()
        val literal = StringBuilder()
        fun flush() {
            if (literal.isNotEmpty()) {
                parts.add(Part(literal = literal.toString()))
                literal.setLength(0)
            }
        }
        var index = 0
        while (index < template.length) {
            when {
                template.startsWith("{{{{", index) || template.startsWith("}}}}", index) -> {
                    literal.append(template.substring(index, index + 2))
                    index += 4
                }
                template.startsWith("{{", index) -> {
                    val end = template.indexOf("}}", index + 2)
                    val name = if (end < 0) "" else template.substring(index + 2, end)
                    if (name !in names) invalid()
                    flush()
                    parts.add(Part(name = name))
                    index = end + 2
                }
                template.startsWith("}}", index) -> invalid()
                else -> literal.append(template[index++])
            }
        }
        flush()
        return parts
    }

    private fun invalid(): Nothing = throw OnScreenLogValidationException(
        "Invalid template placeholder; supported names: ${names.joinToString(", ")}. Escape delimiters as {{{{ and }}}}.",
    )
}
