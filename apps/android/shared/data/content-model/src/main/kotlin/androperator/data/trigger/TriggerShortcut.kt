package androperator.data.trigger

import action.devicepackage.model.DeviceApp
import action.system.model.ApplicationId
import androperator.data.urlnavigator.UrlNavigatorDestinations
import kotlinx.serialization.Serializable

@Serializable
data class TriggerShortcut(
    val triggerEvent: TriggerEvent,
    val label: String,
) {
    val route: Route?
        get() =
            when (triggerEvent) {
                is TriggerEvent.RouteOpen -> triggerEvent.route
                else -> null
            }
    val applicationId: ApplicationId?
        get() =
            when (triggerEvent) {
                is TriggerEvent.RouteOpen -> triggerEvent.route.componentKey?.applicationId
                else -> null
            }

    constructor(
        route: Route,
        label: String,
    ) : this(
        triggerEvent = TriggerEvent.RouteOpen(route = route),
        label = label,
    )

    constructor(deviceApp: DeviceApp) : this(
        triggerEvent = TriggerEvent.RouteOpen(route = RouteDeviceApp(deviceApp)),
        label = deviceApp.label,
    )

    companion object {
        val Preset =
            TriggerShortcut(
                triggerEvent = TriggerEvent.RouteOpen(Route.Preset),
                label = "Preset",
            )
    }
}

fun TriggerShortcutUrl(
    url: String,
    urlNavigatorDestinations: UrlNavigatorDestinations,
    label: String,
): TriggerShortcut =
    TriggerShortcut(
        route = Route.RouteUrl(url, urlNavigatorDestinations),
        label = label,
    )
