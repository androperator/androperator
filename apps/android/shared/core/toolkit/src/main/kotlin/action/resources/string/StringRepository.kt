package action.resources.string

import androperator.resources.string.Strings
import kotlinx.datetime.Instant

/**
 * Minimal string repository for Androperator operator.
 * Stripped down to only essential functionality.
 */
abstract class StringRepository : Strings {
    abstract fun date(date: Instant): String
    abstract val versionName: String
}
