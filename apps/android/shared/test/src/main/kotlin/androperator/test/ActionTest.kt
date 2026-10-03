package androperator.test

import androperator.di.Factory
import androperator.di.NamedScope
import androperator.di.module.UnitTestModules
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.koin.core.context.GlobalContext.startKoin
import org.koin.core.context.stopKoin
import org.koin.core.module.Module
import org.koin.dsl.module
import org.koin.test.KoinTest

interface ActionTest : KoinTest

@OptIn(ExperimentalCoroutinesApi::class)
fun actionTest(
    additionalModules: List<Module>? = listOf(ActionTestModule),
    body: suspend TestScope.() -> Unit,
) = runTest {
    val testDispatcher = StandardTestDispatcher(testScheduler)
    Dispatchers.setMain(testDispatcher)

    Factory.runningTest = true

    val coroutineScope = this.backgroundScope
    val testModule: Module =
        module {
            single<CoroutineScope>(NamedScope.CoroutineScopeIo) { coroutineScope }
            single<CoroutineScope>(NamedScope.CoroutineScopeMain) { coroutineScope }
        }

    val modules = (additionalModules ?: emptyList()) + listOf(testModule)

    try {
        startKoin {
            modules(modules + UnitTestModules)
        }
        body()
    } finally {
        stopKoin()
        Dispatchers.resetMain()
    }
}
