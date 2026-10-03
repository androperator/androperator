package androperator.uitree

fun UiTree(ascii: String): UiTree = UiTreeAsciiParser.parse(ascii)

fun UiTree(
    ascii: String,
    windowId: Int,
): UiTree = UiTreeAsciiParser.parse(ascii, windowId)
