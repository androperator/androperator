package androperator.operator.agent

import action.math.geometry.Point
import androperator.task.runner.UiAction
import androperator.task.runner.NodePredicate
import androperator.task.runner.NodeMatcher
import androperator.task.runner.OnScreenLogAnchor
import androperator.task.runner.OnScreenLogContract
import androperator.task.runner.OnScreenLogSpec
import androperator.task.runner.OnScreenLogTextAlign
import androperator.task.runner.TaskRetry
import androperator.task.runner.TaskRetryPresets
import androperator.task.runner.TaskScrollDirection
import androperator.task.runner.UiSystemKey
import androperator.task.runner.UiTextValidator
import androperator.uitree.UiTreeClickTypes
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlin.time.Duration.Companion.milliseconds

interface AgentCommandParser {
    fun parse(payload: String): Result<AgentCommand>
}

class AgentCommandParserDefault : AgentCommandParser {
    companion object {
        private const val DEFAULT_TIMEOUT_MS = 30_000L
        private const val DEFAULT_OPEN_APP_NAVIGATION_TIMEOUT_MS = 15_000L
        private const val MIN_TIMEOUT_MS = 1_000L
        private const val MAX_TIMEOUT_MS = 120_000L
        private const val MAX_PAYLOAD_BYTES = 64_000
        private const val MAX_ACTIONS = 64
        private const val MAX_ID_LENGTH = 128
        private const val MAX_SOURCE_LENGTH = 64
        private const val MAX_MATCHER_VALUE_LENGTH = 512
        private const val MAX_URI_LENGTH = 2048
        private val json = Json {
            ignoreUnknownKeys = true
        }
    }

    override fun parse(payload: String): Result<AgentCommand> =
        runCatching {
            require(payload.isNotBlank()) { "payload is required" }
            require(payload.encodeToByteArray().size <= MAX_PAYLOAD_BYTES) {
                "payload exceeds $MAX_PAYLOAD_BYTES bytes"
            }

            val root = json.parseToJsonElement(payload).jsonObject

            val commandId = root.stringRequired("commandId", MAX_ID_LENGTH)
            val taskId = root.stringRequired("taskId", MAX_ID_LENGTH)
            val source = root.stringRequired("source", MAX_SOURCE_LENGTH)

            val timeoutMs =
                root.longOrNull("timeoutMs")
                    ?.coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
                    ?: DEFAULT_TIMEOUT_MS

            val actionsArray = root["actions"]?.jsonArray ?: error("actions is required")
            require(actionsArray.isNotEmpty()) { "actions must not be empty" }
            require(actionsArray.size <= MAX_ACTIONS) { "actions exceeds max size of $MAX_ACTIONS" }

            val actions =
                actionsArray.mapIndexed { index, element ->
                    parseAction(index = index, actionJson = element.jsonObject)
                }

            AgentCommand(
                commandId = commandId,
                taskId = taskId,
                source = source,
                timeoutMs = timeoutMs,
                actions = actions,
            )
        }

    private fun parseAction(
        index: Int,
        actionJson: JsonObject,
    ): UiAction {
        val id = actionJson.stringRequired("id", MAX_ID_LENGTH)
        val type = actionJson.stringRequired("type", 64)
        val params: JsonObject = actionJson["params"]?.jsonObject ?: JsonObject(emptyMap())
        val normalizedType = type.lowercase()
        if (
            normalizedType == "set_on_screen_log" || normalizedType == "clear_on_screen_log"
        ) {
            require(type == normalizedType) { "unsupported action type at index=$index: $type" }
        }

        return when (normalizedType) {
            "list_notifications", "list_media_sessions", "get_media_status", "observe_media", "media_pause", "media_play", "media_seek", "dismiss_notification", "invoke_notification_action" -> {
                require(type == normalizedType) { "Service action type must be canonical" }
                val listing = type == "list_notifications" || type == "list_media_sessions"
                val controlling = type == "media_pause" || type == "media_play"
                val notificationMutation = type == "dismiss_notification" || type == "invoke_notification_action"
                val allowed = if (listing) setOf("applicationId", "limit", "maxTextChars")
                    else if (type == "dismiss_notification") setOf("notificationKey", "waitTimeoutMs")
                    else if (type == "invoke_notification_action") setOf("notificationKey", "actionId")
                    else if (type == "observe_media") setOf("applicationId", "mediaSessionId", "durationMs")
                    else if (type == "media_seek") setOf("applicationId", "mediaSessionId", "positionMs", "waitTimeoutMs", "positionToleranceMs")
                    else if (controlling) setOf("applicationId", "mediaSessionId", "waitTimeoutMs")
                    else setOf("applicationId", "mediaSessionId")
                require(params.keys.all { it in allowed }) { "$type has unknown params" }
                fun identifier(key: String, max: Int): String? = params.strictStringOrNull(key)?.also {
                    require(it.isNotBlank() && it.length <= max) { "$key must be nonblank and at most $max characters" }
                }
                val app = identifier("applicationId", 512)
                val session = identifier("mediaSessionId", 128)
                require(listing || notificationMutation || ((app != null) != (session != null))) { "Provide exactly one applicationId or mediaSessionId" }
                val limit = params.strictIntOrDefault("limit", 25)
                val textLimit = params.strictIntOrDefault("maxTextChars", 256)
                val wait = params.strictLongOrDefault("waitTimeoutMs", 0)
                require(limit in 1..100 && textLimit in 1..1024 && wait in 0..30000) { "Service action bounds exceeded" }
                val key = identifier("notificationKey", 4096)
                val actionId = identifier("actionId", 128)
                require(!notificationMutation || key != null) { "notificationKey is required" }
                require(type != "invoke_notification_action" || actionId != null) { "actionId is required" }
                val position = if (type == "media_seek") params.strictLongOrDefault("positionMs", -1) else null
                require(position == null || position in 0..9007199254740991L) { "positionMs must be a nonnegative safe integer" }
                val tolerance = params.strictLongOrDefault("positionToleranceMs", 1000)
                require(tolerance in 0..60000) { "positionToleranceMs must be in [0, 60000]" }
                val duration = if (type == "observe_media") params.strictLongOrDefault("durationMs", -1) else 0
                require(type != "observe_media" || duration in 1..30000) { "durationMs must be in [1, 30000]" }
                UiAction.NotificationMedia(id, type, app, session, limit, textLimit, wait, key, actionId, position, tolerance, duration)
            }

            "open_uri" ->
                UiAction.OpenUri(
                    id = id,
                    uri = params.stringRequired("uri", MAX_URI_LENGTH),
                    retry = params.parseRetryOrDefault(defaultRetry = TaskRetryPresets.AppLaunch),
                )
            "open_app" ->
                UiAction.OpenApp(
                    id = id,
                    applicationId = params.stringRequired("applicationId", MAX_MATCHER_VALUE_LENGTH),
                    skipNavigationWait = params.booleanOrDefaultStrict("skipNavigationWait", false),
                    navigationTimeoutMs =
                        params.longOrDefaultStrict("navigationTimeoutMs", DEFAULT_OPEN_APP_NAVIGATION_TIMEOUT_MS)
                            .also {
                                require(it >= MIN_TIMEOUT_MS && it <= MAX_TIMEOUT_MS) {
                                    "navigationTimeoutMs must be in [$MIN_TIMEOUT_MS, $MAX_TIMEOUT_MS]"
                                }
                            },
                    retry = params.parseRetryOrDefault(defaultRetry = TaskRetryPresets.AppLaunch),
                )
            "close_app" ->
                UiAction.CloseApp(
                    id = id,
                    applicationId = params.stringRequired("applicationId", MAX_MATCHER_VALUE_LENGTH),
                    retry = params.parseRetryOrDefault(defaultRetry = TaskRetryPresets.AppClose),
                )
            "wait_for_node", "find_node" ->
                UiAction.WaitForNode(
                    id = id,
                    matcher = params.parseMatcherRequired("matcher"),
                    retry = params.parseRetryOrDefault(defaultRetry = TaskRetryPresets.UiReadiness),
                    timeoutMs = params.longOrNull("timeoutMs")?.coerceIn(1L, 120_000L),
                    strict = params.parseStrictSelection(),
                    container = params.parseMatcherOrNull("container"),
                )
            "click" ->
                {
                    val matcher = params.parseMatcherOrNull("matcher")
                    val coordinate = params.parsePointOrNull("coordinate")
                    require(coordinate == null || (!params.parseStrictSelection() && "container" !in params)) { "coordinate click cannot use strict or container" }
                    require(matcher != null || coordinate != null) { "click requires matcher or coordinate" }
                    require(!(matcher != null && coordinate != null)) { "click matcher and coordinate are mutually exclusive" }
                    UiAction.Click(
                        id = id,
                        matcher = matcher,
                        coordinate = coordinate,
                        clickTypes = params.parseClickTypes(),
                        retry = params.parseRetryOrDefault(defaultRetry = TaskRetryPresets.UiReadiness),
                        strict = params.parseStrictSelection(),
                        container = params.parseMatcherOrNull("container"),
                    )
                }
            "drag" -> {
                require(params.keys == setOf("start", "end", "holdDurationMs", "moveDurationMs")) { "drag requires only start, end, holdDurationMs, and moveDurationMs" }
                fun point(key: String): Point {
                    val value = params[key] as? JsonObject ?: error("$key must be an object")
                    require(value.keys == setOf("x", "y")) { "$key requires only x and y" }
                    fun coordinate(axis: String): Int {
                        val primitive = value[axis] as? JsonPrimitive ?: error("$key.$axis must be an integer")
                        require(!primitive.isString) { "$key.$axis must be an integer" }
                        val number = primitive.intOrNull ?: error("$key.$axis must be an integer")
                        require(number >= 0) { "$key.$axis must be non-negative" }
                        return number
                    }
                    return Point(coordinate("x"), coordinate("y"))
                }
                val start = point("start")
                val end = point("end")
                require(start != end) { "drag start and end must differ" }
                fun duration(key: String): Long {
                    val value = params[key] as? JsonPrimitive ?: error("$key must be an integer")
                    require(!value.isString) { "$key must be an integer" }
                    val number = value.longOrNull ?: error("$key must be an integer")
                    require(number in 1L..10000L) { "$key must be in [1, 10000]" }
                    return number
                }
                UiAction.Drag(id, start, end, duration("holdDurationMs"), duration("moveDurationMs"))
            }
            "swipe" -> {
                require(params.keys == setOf("start", "end", "durationMs")) { "swipe requires only start, end, and durationMs" }
                fun point(key: String): Point {
                    val value = params[key] as? JsonObject ?: error("$key must be an object")
                    require(value.keys == setOf("x", "y")) { "$key requires only x and y" }
                    fun coordinate(axis: String): Int {
                        val primitive = value[axis] as? JsonPrimitive ?: error("$key.$axis must be an integer")
                        require(!primitive.isString) { "$key.$axis must be an integer" }
                        val number = primitive.intOrNull ?: error("$key.$axis must be an integer")
                        require(number >= 0) { "$key.$axis must be non-negative" }
                        return number
                    }
                    return Point(coordinate("x"), coordinate("y"))
                }
                val start = point("start")
                val end = point("end")
                require(start != end) { "swipe start and end must differ" }
                val durationValue = params["durationMs"] as? JsonPrimitive ?: error("durationMs must be an integer")
                require(!durationValue.isString) { "durationMs must be an integer" }
                val durationMs = durationValue.longOrNull ?: error("durationMs must be an integer")
                require(durationMs in 1L..10000L) { "durationMs must be in [1, 10000]" }
                UiAction.Swipe(id, start, end, durationMs)
            }
            "scroll_and_click" ->
                UiAction.ScrollAndClick(
                    id = id,
                    matcher = params.parseMatcherRequired("matcher"),
                    container = params.parseMatcherOrNull("container"),
                    clickTypes = params.parseClickTypes(),
                    direction = params.parseDirection(),
                    maxSwipes = params.intOrDefault("maxSwipes", 10).coerceIn(1, 50),
                    distanceRatio = params.doubleOrDefault("distanceRatio", 0.7).toFloat().coerceIn(0f, 1f),
                    settleDelayMs = params.longOrDefault("settleDelayMs", 250L).coerceIn(0L, 10_000L),
                    scrollRetry = params.parseRetryOrDefault(key = "scrollRetry", defaultRetry = TaskRetryPresets.UiScroll),
                    clickRetry = params.parseRetryOrDefault(key = "clickRetry", defaultRetry = TaskRetryPresets.UiReadiness),
                    findFirstScrollableChild = params.booleanOrDefault("findFirstScrollableChild", true),
                    clickAfter = params.booleanOrDefault("clickAfter", true),
                    strict = params.parseStrictSelection(),
                )
            "scroll" ->
                UiAction.Scroll(
                    id = id,
                    container = params.parseMatcherOrNull("container"),
                    direction = params.parseDirection(),
                    distanceRatio = params.doubleOrDefault("distanceRatio", 0.7).toFloat().coerceIn(0f, 1f),
                    settleDelayMs = params.longOrDefault("settleDelayMs", 250L).coerceIn(0L, 10_000L),
                    findFirstScrollableChild = params.booleanOrDefault("findFirstScrollableChild", true),
                    retry = params.parseRetryOrDefault(defaultRetry = TaskRetry.None),
                    strict = params.parseStrictSelection(),
                )
            "scroll_until" ->
                UiAction.ScrollUntil(
                    id = id,
                    matcher = params.parseMatcherOrNull("matcher"),
                    container = params.parseMatcherOrNull("container"),
                    clickTypes = params.parseClickTypes(),
                    direction = params.parseDirection(),
                    distanceRatio = params.doubleOrDefault("distanceRatio", 0.7).toFloat().coerceIn(0f, 1f),
                    settleDelayMs = params.longOrDefault("settleDelayMs", 250L).coerceIn(0L, 10_000L),
                    maxScrolls = params.intOrDefault("maxScrolls", 20).coerceIn(1, 200),
                    maxDurationMs = params.longOrDefault("maxDurationMs", 10_000L).coerceIn(0L, 120_000L),
                    noPositionChangeThreshold = params.intOrDefault("noPositionChangeThreshold", 3).coerceIn(1, 20),
                    findFirstScrollableChild = params.booleanOrDefault("findFirstScrollableChild", true),
                    clickAfter = params.booleanOrDefault("clickAfter", false),
                    strict = params.parseStrictSelection(),
                )
            "wait_for_navigation" -> {
                val expectedPackage = params.stringOrNullWithMax("expectedPackage", MAX_MATCHER_VALUE_LENGTH)
                val expectedNode = params.parseMatcherOrNull("expectedNode")
                // Reject blank strings at validation boundary per codebase guidelines
                val hasExpectedPackage = expectedPackage != null && expectedPackage.isNotBlank()
                require(hasExpectedPackage || expectedNode != null) {
                    "wait_for_navigation requires at least one of expectedPackage or expectedNode"
                }
                // Normalize blank strings to null per codebase guidelines
                val normalizedPackage = expectedPackage?.takeIf { it.isNotBlank() }
                UiAction.WaitForNavigation(
                    id = id,
                    expectedPackage = normalizedPackage,
                    expectedNode = expectedNode,
                    timeoutMs = params.longRequired("timeoutMs").coerceIn(1L, 30_000L),
                )
            }
            "read_key_value_pair" ->
                UiAction.ReadKeyValuePair(
                    id = id,
                    labelMatcher = params.parseMatcherRequired("labelMatcher"),
                    retry = params.parseRetryOrDefault(defaultRetry = TaskRetryPresets.UiReadiness),
                )
            "read_text" -> {
                val validator = params.parseValidator()
                val validatorPattern = params.stringOrNull("validatorPattern")
                if (validator == UiTextValidator.Regex) {
                    require(!validatorPattern.isNullOrBlank()) { "validatorPattern is required for regex validator" }
                    Regex(validatorPattern) // throws if invalid
                }
                UiAction.ReadText(
                    id = id,
                    matcher = params.parseMatcherRequired("matcher"),
                    retry = params.parseRetryOrDefault(defaultRetry = TaskRetryPresets.UiReadiness),
                    validator = validator,
                    validatorPattern = validatorPattern,
                    all = params.booleanOrDefault("all", false),
                    container = params.parseMatcherOrNull("container"),
                    strict = params.parseStrictSelection(),
                )
            }
            "enter_text", "type_text" ->
                UiAction.EnterText(
                    id = id,
                    matcher = params.parseMatcherRequired("matcher"),
                    text = params.stringRequired("text", MAX_MATCHER_VALUE_LENGTH),
                    submit = params.booleanOrDefault("submit", false),
                    clear = params.booleanOrDefaultStrict("clear", false),
                    retry = params.parseRetryOrDefault(defaultRetry = TaskRetryPresets.UiReadiness),
                    strict = params.parseStrictSelection(),
                    container = params.parseMatcherOrNull("container"),
                )
            "query_ui" -> {
                require(params.keys.all { it in setOf("matcher", "visibility", "limit") }) { "query_ui has unknown params" }
                val visibility = if ("visibility" in params) params.strictStringRequired("visibility", 16) else "on_screen"
                require(visibility in setOf("on_screen", "all")) { "visibility must be on_screen or all" }
                val limit =
                    if ("limit" in params) {
                        val value = params["limit"] as? JsonPrimitive
                        require(value != null && !value.isString) { "limit must be an integer" }
                        value.intOrNull ?: error("limit must be an integer")
                    } else {
                        100
                    }
                require(limit in 1..1000) { "limit must be between 1 and 1000" }
                UiAction.QueryUi(id, params.parseMatcherOrNull("matcher"), visibility, limit)
            }
            "snapshot", "snapshot_ui" ->
                UiAction.SnapshotUi(
                    id = id,
                    retry = params.parseRetryOrDefault(defaultRetry = TaskRetryPresets.UiReadiness),
                )
            "show_toast" -> {
                require(params.keys.all { it in setOf("text", "duration") }) { "show_toast accepts only text and duration" }
                val text = params.strictStringRequired("text", 2048)
                // Match JavaScript trim whitespace, including BOM but excluding U+001C..U+001F.
                val whitespace = "\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"
                require(text.any { it !in whitespace }) { "show_toast requires nonblank text" }
                val duration = params.strictStringOrNull("duration") ?: "short"
                require(duration == "short" || duration == "long") { "duration must be short or long" }
                UiAction.ShowToast(id, text, duration)
            }
            "cancel_toast" -> {
                require(params.isEmpty()) { "cancel_toast accepts omitted params or {} only" }
                UiAction.CancelToast(id)
            }
            "set_on_screen_log" ->
                UiAction.SetOnScreenLog(
                    id = id,
                    spec = params.parseOnScreenLogSpec(),
                )
            "clear_on_screen_log" -> {
                require(params.isEmpty()) { "clear_on_screen_log accepts omitted params or {} only" }
                UiAction.ClearOnScreenLog(id = id)
            }
            "start_recording" ->
                UiAction.StartRecording(
                    id = id,
                    sessionId = params.optionalNonBlankString("sessionId", MAX_ID_LENGTH),
                )
            "stop_recording" ->
                UiAction.StopRecording(
                    id = id,
                    sessionId = params.optionalNonBlankString("sessionId", MAX_ID_LENGTH),
                )
            "take_screenshot" ->
                UiAction.TakeScreenshot(
                    id = id,
                    retry = params.parseRetryOrDefault(defaultRetry = TaskRetry.None),
                )
            "doctor_ping" ->
                UiAction.DoctorPing(
                    id = id,
                )
            "press_key", "key_press" ->
                UiAction.PressKey(
                    id = id,
                    key = UiSystemKey.fromWire(params.stringRequired("key", 32)),
                )
            "sleep" ->
                UiAction.Sleep(
                    id = id,
                    durationMs = params.longOrDefault("durationMs", 0L).coerceIn(0L, 120_000L),
                    retry = params.parseRetryOrDefault(defaultRetry = TaskRetry.None),
                )
            else -> error("unsupported action type at index=$index: $type")
        }
    }

    private fun JsonObject.parseValidator(): UiTextValidator? {
        val raw = this.stringOrNull("validator") ?: return null
        return when (raw.lowercase()) {
            "temperature" -> UiTextValidator.Temperature
            "version" -> UiTextValidator.Version
            "regex" -> UiTextValidator.Regex
            else -> error("unsupported validator: $raw")
        }
    }

    private fun JsonObject.parseOnScreenLogSpec(): OnScreenLogSpec {
        val allowedKeys =
            setOf(
                "text",
                "template",
                "anchor",
                "textAlign",
                "topOffsetDp",
                "edgeOffsetDp",
                "widthDp",
                "fontSizeSp",
                "textColor",
                "backgroundColor",
                "ttlMs",
            )
        val unexpectedKeys = keys - allowedKeys
        require(unexpectedKeys.isEmpty()) {
            "set_on_screen_log accepts only: ${allowedKeys.sorted().joinToString(", ")}; " +
                "unexpected: ${unexpectedKeys.sorted().joinToString(", ")}"
        }

        val spec =
            OnScreenLogSpec(
                text = if (containsKey("text")) strictStringRequired("text", OnScreenLogContract.MAX_TEXT_LENGTH) else null,
                template = if (containsKey("template")) strictStringRequired("template", OnScreenLogContract.MAX_TEXT_LENGTH) else null,
                anchor =
                    when (strictStringOrNull("anchor") ?: "left") {
                        "left" -> OnScreenLogAnchor.Left
                        "right" -> OnScreenLogAnchor.Right
                        else -> error("anchor must be left or right")
                    },
                textAlign =
                    when (strictStringOrNull("textAlign") ?: "left") {
                        "left" -> OnScreenLogTextAlign.Left
                        "right" -> OnScreenLogTextAlign.Right
                        else -> error("textAlign must be left or right")
                    },
                topOffsetDp = strictIntOrDefault("topOffsetDp", OnScreenLogContract.DEFAULT_TOP_OFFSET_DP),
                edgeOffsetDp = strictIntOrDefault("edgeOffsetDp", OnScreenLogContract.DEFAULT_EDGE_OFFSET_DP),
                widthDp = strictIntOrDefault("widthDp", OnScreenLogContract.DEFAULT_WIDTH_DP),
                fontSizeSp = strictIntOrDefault("fontSizeSp", OnScreenLogContract.DEFAULT_FONT_SIZE_SP),
                textColor = strictStringOrNull("textColor") ?: OnScreenLogContract.DEFAULT_TEXT_COLOR,
                backgroundColor = strictStringOrNull("backgroundColor") ?: OnScreenLogContract.DEFAULT_BACKGROUND_COLOR,
                ttlMs = strictLongOrDefault("ttlMs", OnScreenLogContract.DEFAULT_TTL_MS),
            )
        val normalized = OnScreenLogContract.normalize(spec)
        return spec.copy(
            textColor = normalized.textColor,
            backgroundColor = normalized.backgroundColor,
        )
    }

    private fun JsonObject.parseDirection(): TaskScrollDirection {
        val raw = this.stringOrNull("direction") ?: return TaskScrollDirection.Down
        return when (raw.lowercase()) {
            "down" -> TaskScrollDirection.Down
            "up" -> TaskScrollDirection.Up
            "left" -> TaskScrollDirection.Left
            "right" -> TaskScrollDirection.Right
            else -> error("unsupported direction: $raw")
        }
    }

    private fun JsonObject.parseClickTypes(): UiTreeClickTypes {
        val raw = this.stringOrNull("clickType") ?: return UiTreeClickTypes.Default
        return when (raw.lowercase()) {
            "default", "click" -> UiTreeClickTypes.Click
            "long_click", "longclick" -> UiTreeClickTypes.LongClick
            "focus" -> UiTreeClickTypes.Focus
            else -> error("unsupported clickType: $raw")
        }
    }

    private fun JsonObject.parseRetryOrDefault(
        key: String? = null,
        defaultRetry: TaskRetry,
    ): TaskRetry {
        val retryObject =
            when (key) {
                null -> this["retry"]?.jsonObject
                else -> this[key]?.jsonObject
            } ?: return defaultRetry

        val maxAttempts = retryObject.intOrDefault("maxAttempts", 1).coerceIn(1, 10)
        val initialDelayMs = retryObject.longOrDefault("initialDelayMs", 0L).coerceIn(0L, 30_000L)
        val maxDelayMs = retryObject.longOrDefault("maxDelayMs", initialDelayMs).coerceIn(initialDelayMs, 60_000L)
        val backoffMultiplier = retryObject.doubleOrDefault("backoffMultiplier", 1.0).coerceIn(1.0, 5.0)
        val jitterRatio = retryObject.doubleOrDefault("jitterRatio", 0.0).coerceIn(0.0, 1.0)

        return TaskRetry(
            maxAttempts = maxAttempts,
            initialDelay = initialDelayMs.milliseconds,
            maxDelay = maxDelayMs.milliseconds,
            backoffMultiplier = backoffMultiplier,
            jitterRatio = jitterRatio,
        )
    }

    private fun JsonObject.parseMatcherRequired(key: String): NodeMatcher =
        parseMatcherOrNull(key) ?: error("$key is required")

    private fun JsonObject.parseMatcherOrNull(key: String): NodeMatcher? {
        if (key !in this) return null
        val matcherObject = this[key] as? JsonObject ?: error("$key must be an object")
        val leafKeys = setOf("resourceId", "role", "textEquals", "textContains", "contentDescEquals", "contentDescContains")
        require(matcherObject.keys.all { it in leafKeys || it == "ancestor" || it == "descendant" }) { "$key has unknown matcher fields" }

        fun predicate(
            obj: JsonObject,
            name: String,
            requireNonblank: Boolean = true,
        ): NodePredicate {
            require(obj.isNotEmpty() && obj.keys.all { it in leafKeys }) { "$name must contain only scalar predicate fields" }

            fun value(field: String): String? {
                if (field !in obj) return null
                return obj.strictStringRequired(field, MAX_MATCHER_VALUE_LENGTH)
            }
            val predicate = NodePredicate(value("resourceId"), value("role"), value("textEquals"), value("textContains"), value("contentDescEquals"), value("contentDescContains"))
            require(!requireNonblank || obj.values.any { (it as JsonPrimitive).content.isNotBlank() }) {
                "$name must include at least one nonblank field"
            }
            return predicate
        }

        fun relationship(name: String): NodePredicate? {
            if (name !in matcherObject) return null
            return predicate(matcherObject[name] as? JsonObject ?: error("$name must be an object"), name)
        }
        val scalarFields = JsonObject(matcherObject.filterKeys { it in leafKeys })
        val scalar = if (scalarFields.isEmpty()) NodePredicate() else predicate(scalarFields, key, requireNonblank = false)
        val ancestor = relationship("ancestor")
        val descendant = relationship("descendant")
        require(scalarFields.values.any { (it as JsonPrimitive).content.isNotBlank() } || ancestor != null || descendant != null) { "$key must include at least one matcher field" }
        return NodeMatcher(
            scalar.resourceId,
            scalar.role,
            scalar.textEquals,
            scalar.textContains,
            scalar.contentDescEquals,
            scalar.contentDescContains,
            ancestor,
            descendant,
        )
    }

    private fun JsonObject.parsePointOrNull(key: String): Point? {
        val pointObject = this[key]?.jsonObject ?: return null
        val x = pointObject.intOrNull("x") ?: error("$key.x is required")
        val y = pointObject.intOrNull("y") ?: error("$key.y is required")
        require(x >= 0 && y >= 0) { "$key must contain non-negative integers" }
        return Point(x, y)
    }

    private fun JsonObject.stringRequired(
        key: String,
        maxLen: Int,
    ): String {
        val value = stringOrNull(key) ?: error("$key is required")
        require(value.isNotBlank()) { "$key must not be blank" }
        require(value.length <= maxLen) { "$key exceeds max length of $maxLen" }
        return value
    }

    private fun JsonObject.stringOrNull(key: String): String? {
        val primitive = this[key] as? JsonPrimitive ?: return null
        return primitive.content
    }

    private fun JsonObject.strictStringRequired(
        key: String,
        maxLen: Int,
    ): String {
        val value = strictStringOrNull(key) ?: error("$key is required")
        require(value.length <= maxLen) { "$key exceeds max length of $maxLen" }
        return value
    }

    private fun JsonObject.strictStringOrNull(key: String): String? {
        val value = this[key] ?: return null
        val primitive = value as? JsonPrimitive ?: error("$key must be a string")
        require(primitive.isJsonString()) { "$key must be a string" }
        return primitive.content
    }

    private fun JsonObject.stringOrNullWithMax(key: String, maxLen: Int): String? {
        val value = stringOrNull(key) ?: return null
        require(value.length <= maxLen) { "$key exceeds max length of $maxLen" }
        return value
    }

    private fun JsonObject.optionalNonBlankString(key: String, maxLen: Int): String? {
        val value = stringOrNullWithMax(key, maxLen) ?: return null
        require(value.isNotBlank()) { "$key must not be blank" }
        return value
    }

    private fun JsonObject.intOrDefault(
        key: String,
        default: Int,
    ): Int = intOrNull(key) ?: default

    private fun JsonObject.intOrNull(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

    private fun JsonObject.strictIntOrDefault(
        key: String,
        default: Int,
    ): Int {
        val value = this[key] ?: return default
        val primitive = value as? JsonPrimitive ?: error("$key must be an integer")
        require(!primitive.isJsonString()) { "$key must be an integer" }
        val number = primitive.doubleOrNull ?: error("$key must be an integer")
        require(
            number.isFinite() &&
                number >= Int.MIN_VALUE.toDouble() &&
                number <= Int.MAX_VALUE.toDouble() &&
                number == number.toInt().toDouble(),
        ) { "$key must be an integer" }
        return number.toInt()
    }

    private fun JsonObject.longOrDefault(
        key: String,
        default: Long,
    ): Long = longOrNull(key) ?: default

    private fun JsonObject.longOrDefaultStrict(
        key: String,
        default: Long,
    ): Long {
        val value = this[key] ?: return default
        val primitive = value as? JsonPrimitive ?: error("$key must be a number")
        return primitive.longOrNull ?: error("$key must be a number")
    }

    private fun JsonObject.longOrNull(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

    private fun JsonObject.strictLongOrDefault(
        key: String,
        default: Long,
    ): Long {
        val value = this[key] ?: return default
        val primitive = value as? JsonPrimitive ?: error("$key must be an integer")
        require(!primitive.isJsonString()) { "$key must be an integer" }
        val number = primitive.doubleOrNull ?: error("$key must be an integer")
        require(
            number.isFinite() &&
                number >= Long.MIN_VALUE.toDouble() &&
                number <= Long.MAX_VALUE.toDouble() &&
                number == number.toLong().toDouble(),
        ) { "$key must be an integer" }
        return number.toLong()
    }

    private fun JsonObject.longRequired(key: String): Long {
        return longOrNull(key) ?: error("$key is required")
    }

    private fun JsonObject.doubleOrDefault(
        key: String,
        default: Double,
    ): Double = doubleOrNull(key) ?: default

    private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

    private fun JsonObject.booleanOrDefault(
        key: String,
        default: Boolean,
    ): Boolean = booleanOrNull(key) ?: default

    private fun JsonObject.parseStrictSelection(): Boolean {
        val value = this["strict"] ?: return false
        require(value is JsonPrimitive && !value.isString) { "strict must be a boolean" }
        return value.booleanOrNull ?: error("strict must be a boolean")
    }

    private fun JsonObject.booleanOrDefaultStrict(
        key: String,
        default: Boolean,
    ): Boolean {
        val value = this[key] ?: return default
        val primitive = value as? JsonPrimitive ?: error("$key must be a boolean")
        return primitive.booleanOrNull ?: error("$key must be a boolean")
    }

    private fun JsonObject.booleanOrNull(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

    private fun JsonPrimitive.isJsonString(): Boolean = toString().startsWith('"')

}
