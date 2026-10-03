package androperator.openapp

import action.system.model.ApplicationId
import action.system.model.ComponentKey
import action.system.model.IntentKey
import androperator.data.trigger.Route
import androperator.openapp.OpenAppData.Component
import androperator.openapp.OpenAppData.Intent

sealed interface OpenAppData {
    val applicationId: ApplicationId?

    data class Component(
        val componentKey: ComponentKey,
    ) : OpenAppData {
        override val applicationId: ApplicationId
            get() = componentKey.applicationId
    }

    data class Intent(
        val intentKey: IntentKey,
        override val applicationId: ApplicationId?,
    ) : OpenAppData

    data class Uri(
        val uri: String,
        override val applicationId: ApplicationId?,
    ) : OpenAppData
}

fun OpenAppData(componentKey: ComponentKey): OpenAppData = OpenAppData.Component(componentKey)

fun OpenAppData(route: Route): OpenAppData =
    when (route) {
        is Route.RouteComponentKey -> Component(route.componentKey)
        is Route.RouteIntentKey -> Intent(route.intentKey, route.applicationId)
        else -> error("Unsupported route type for OpenAppData: $route")
    }
