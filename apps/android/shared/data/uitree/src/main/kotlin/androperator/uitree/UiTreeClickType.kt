package androperator.uitree

import androperator.uitree.UiTreeClickTypes.Companion.Click

/**
 * Enum representing different types of click interactions that can be performed on UI elements.
 */
enum class UiTreeClickType {
    /**
     * Regular click action (ACTION_CLICK or gesture tap)
     */
    Click,

    /**
     * Long click action (ACTION_LONG_CLICK or long-press gesture)
     */
    LongClick,

    /**
     * Focus action (ACTION_FOCUS with ACTION_SELECT fallback)
     */
    Focus,
}

/**
 * Data class that holds multiple click types to be attempted in order.
 * Defaults to [Click] if constructed empty.
 */
data class UiTreeClickTypes(
    val types: List<UiTreeClickType>,
) {
    constructor(vararg types: UiTreeClickType) : this(types.toList())

    companion object {
        /**
         * Default click types - just a regular click
         */
        val Default = UiTreeClickTypes(UiTreeClickType.Click)
        val Click = UiTreeClickTypes(UiTreeClickType.Click)
        val LongClick = UiTreeClickTypes(UiTreeClickType.LongClick)
        val Focus = UiTreeClickTypes(UiTreeClickType.Focus)
    }

    /**
     * Returns the ordered list of click types, defaulting to [Click] if empty
     */
    val ordered: List<UiTreeClickType>
        get() = if (types.isEmpty()) listOf(UiTreeClickType.Click) else types
}
