package androperator.data.trigger

import action.system.model.ComponentKey
import androidx.compose.runtime.Stable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.time.Duration

@Stable
@Serializable
sealed interface TriggerEvent {
    @Stable
    @Serializable
    @SerialName("TriggerEvents")
    data class TriggerEvents(
        val events: List<TriggerEvent>,
    ) : TriggerEvent {
        constructor(vararg events: TriggerEvent) : this(events.toList())
    }

    @Stable
    @Serializable
    @SerialName("TriggerDelayed")
    /**
     * [triggerEvent] is triggered after a specified [delay].
     */
    data class DelayedTrigger(
        val delay: Duration,
        val triggerEvent: TriggerEvent,
    ) : TriggerEvent

    @Stable
    @Serializable
    @SerialName("TriggerRouteOpen")
    data class RouteOpen(
        val route: Route,
    ) : TriggerEvent

    @Stable
    @Serializable
    @SerialName("TriggerShowToast")
    data class ShowToast(
        val message: String,
        val isLong: Boolean = false,
        val cancelPrevious: Boolean = true,
    ) : TriggerEvent

    @Stable
    @Serializable
    @SerialName("TriggerSystemActionNotifPanel")
    data object SystemActionNotificationPanel : TriggerEvent

    @Stable
    @Serializable
    @SerialName("TriggerSystemActionQuickSettings")
    data object SystemActionQuickSettings : TriggerEvent

    @Stable
    @Serializable
    @SerialName("TriggerTileRecents")
    data object SystemActionRecentApps : TriggerEvent

    @Stable
    @Serializable
    @SerialName("TriggerSystemActionLockScreen")
    data object SystemActionLockScreen : TriggerEvent

    @Stable
    @Serializable
    @SerialName("TriggerSystemAppInfo")
    data class SystemAppInfo(
        val componentKey: ComponentKey,
    ) : TriggerEvent

    @Stable
    @Serializable
    @SerialName("TriggerSystemVoiceSearch")
    data object SystemVoiceSearch : TriggerEvent

    @Stable
    @Serializable
    @SerialName("TriggerGoogleAppSearch")
    data class GoogleAppSearch(
        val query: String?,
        val fallbackTriggerEvent: TriggerEvent,
    ) : TriggerEvent

    @Stable
    @Serializable
    @SerialName("TriggerPlaceholder")
    data class Placeholder(
        private val message: String,
        private val prefix: String? = "TODO: ",
    ) : TriggerEvent {
        val displayMessage: String
            get() = "$prefix$message"
    }
}

val TriggerEvent.route: Route?
    get() =
        when (this) {
            is TriggerEvent.RouteOpen -> route
            else -> null
        }
