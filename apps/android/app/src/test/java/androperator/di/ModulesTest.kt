package androperator.di

import androperator.di.module.AllModules
import android.app.Application
import android.os.Build
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.runner.RunWith
import org.koin.android.ext.koin.androidContext
import org.koin.core.annotation.KoinExperimentalAPI
import org.koin.core.context.GlobalContext.startKoin
import org.koin.test.KoinTest
import org.koin.test.check.checkModules
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.Test

@OptIn(KoinExperimentalAPI::class)
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class, sdk = [Build.VERSION_CODES.O_MR1])
class ModulesTest : KoinTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun checkAllModules() {
        Factory.runningTest = true
        Factory.multiProcessAllowed = false
        startKoin {
            androidContext(context)
            modules(AllModules)
        }.checkModules()
//        appModule.verify()
    }
}
