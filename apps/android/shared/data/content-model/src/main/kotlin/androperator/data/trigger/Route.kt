package androperator.data.trigger

import action.devicepackage.model.DeviceApp
import action.system.model.ApplicationId
import action.system.model.ComponentKey
import action.system.model.IntentKey
import androidx.compose.runtime.Stable
import androperator.data.trigger.Route.RouteComponentKey
import androperator.data.trigger.Route.RouteIntentKey
import androperator.data.urlnavigator.UrlNavigatorDestinations
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Stable
@Serializable
sealed interface Route {
    @Stable
    @Serializable
    @SerialName("RouteComponentKey")
    data class RouteComponentKey(
        val componentKey: ComponentKey,
    ) : Route {
        constructor(deviceApp: DeviceApp.DeviceAppComponent) :
            this(componentKey = deviceApp.componentKey)
    }

    @Stable
    @Serializable
    data class RouteIntentKey(
        val intentKey: IntentKey,
        val applicationId: ApplicationId,
    ) : Route {
        constructor(deviceApp: DeviceApp.DeviceAppIntent) : this(
            intentKey = deviceApp.intentKey,
            applicationId = deviceApp.applicationId,
        )
    }

    @Stable
    @Serializable
    @SerialName("RouteUrl")
    data class RouteUrl(
        val url: String,
        val urlNavigatorDestinations: UrlNavigatorDestinations,
    ) : Route

    companion object {
        val Preset = RouteUrl("https://example.com", UrlNavigatorDestinations.Preset)
    }
}

fun RouteDeviceApp(deviceApp: DeviceApp): Route =
    when (deviceApp) {
        is DeviceApp.DeviceAppComponent -> RouteComponentKey(deviceApp)
        is DeviceApp.DeviceAppIntent -> RouteIntentKey(deviceApp)
    }

val Route?.componentKey: ComponentKey?
    get() =
        when (this) {
            is Route.RouteComponentKey -> componentKey
            is Route.RouteIntentKey -> null
            is Route.RouteUrl -> null
            null -> null
        }

val Route?.applicationId: ApplicationId?
    get() =
        when (this) {
            is Route.RouteComponentKey -> componentKey.applicationId
            is Route.RouteIntentKey -> applicationId
            is Route.RouteUrl -> null
            null -> null
        }
