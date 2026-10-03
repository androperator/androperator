package androperator.trigger

import action.log.Log
import action.system.action.SystemActionManager
import action.system.action.SystemActionState
import action.system.navigation.SystemNavigator
import action.system.toast.ToastDisplayController
import androperator.data.trigger.Route.RouteComponentKey
import androperator.data.trigger.Route.RouteIntentKey
import androperator.data.trigger.Route.RouteUrl
import androperator.data.trigger.TriggerEvent
import androperator.openapp.OpenAppData
import androperator.openapp.OpenAppManager
import androperator.urlnavigator.UrlNavigator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.launch

class TriggerManagerDefault(
    private val openAppManager: OpenAppManager,
    private val urlNavigator: UrlNavigator,
    private val systemNavigator: SystemNavigator,
    private val systemActionManager: SystemActionManager,
    private val toastDisplayController: ToastDisplayController,
    private val coroutineScopeMain: CoroutineScope,
    private val coroutineScopeIo: CoroutineScope,
) : TriggerManager {
    companion object {
        private const val Tag = "[TriggerManager]"

        private fun log(message: String) = Log.d("$Tag $message")
    }

    override fun trigger(event: TriggerEvent) {
        when (event) {
            is TriggerEvent.TriggerEvents -> event.events.forEach { trigger(it) }
            is TriggerEvent.DelayedTrigger -> delayedTrigger(event)
            is TriggerEvent.RouteOpen -> {
                when (val route = event.route) {
                    is RouteComponentKey -> openAppManager.open(OpenAppData(route))
                    is RouteIntentKey -> openAppManager.open(OpenAppData(route))
                    is RouteUrl -> openUrl(route)
                }
            }
            is TriggerEvent.GoogleAppSearch -> openGoogleAppSearch(event)
            is TriggerEvent.Placeholder -> toastDisplayController.showToast(event.displayMessage)
            is TriggerEvent.SystemActionNotificationPanel -> {
                systemActionManager.openNotificationPanel().handleSystemAction()
            }
            is TriggerEvent.SystemActionQuickSettings -> {
                systemActionManager.openQuickSettings().handleSystemAction()
            }
            is TriggerEvent.SystemActionRecentApps -> {
                systemActionManager.openRecentApps().handleSystemAction()
            }
            is TriggerEvent.SystemActionLockScreen -> {
                systemActionManager.lockScreen().handleSystemAction()
            }
            is TriggerEvent.SystemAppInfo -> systemNavigator.toSystemAppInfo(event.componentKey)
            is TriggerEvent.SystemVoiceSearch -> systemNavigator.toVoiceSearch()
            is TriggerEvent.ShowToast -> showToast(event)
        }
    }

    private fun delayedTrigger(triggerEvent: TriggerEvent.DelayedTrigger) {
        coroutineScopeMain.launch {
            log("delayedTrigger: ${triggerEvent.triggerEvent} after ${triggerEvent.delay}ms")
            delay(triggerEvent.delay)
            trigger(triggerEvent.triggerEvent)
        }
    }

    private fun openUrl(routeUrl: RouteUrl) {
        coroutineScopeMain.launch {
            urlNavigator.toUrl(routeUrl.url, routeUrl.urlNavigatorDestinations)
        }
    }

    private fun Flow<SystemActionState>.handleSystemAction() {
        coroutineScopeMain.launch {
            this@handleSystemAction
                .onEach { state ->
                    println("SystemActionState: $state")
                }.takeWhile { state -> state is SystemActionState.Pending }
                .collect { state ->
                    // Handle pending state if needed
                }

            // Collect the final result
            this@handleSystemAction
                .first { state -> state is SystemActionState.Result }
                .let { state ->
                    when (state) {
                        is SystemActionState.Result.Success -> {
                            // Optionally handle success
                        }
                        is SystemActionState.Result.Error -> {
                            toastDisplayController.showToast("Unable to trigger action")
                        }
                        else -> error("Unexpected state: $state")
                    }
                }
        }
    }

    private fun openGoogleAppSearch(triggerEvent: TriggerEvent.GoogleAppSearch) {
        val query = triggerEvent.query
        if (!systemNavigator.toGoogleSearch(query)) {
            trigger(event = triggerEvent.fallbackTriggerEvent)
        }
    }

    private fun showToast(triggerEvent: TriggerEvent.ShowToast) {
        toastDisplayController.showToast(
            message = triggerEvent.message,
            isLong = triggerEvent.isLong,
            cancelPrevious = triggerEvent.cancelPrevious,
        )
    }
}
