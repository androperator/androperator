package androperator.di

import action.di.Lazy
import org.koin.core.scope.Scope

inline fun <reified T> Scope.getLazy(): Lazy<T> {
    return object : Lazy<T> {
        private var initialized = false

        private val _value: T by lazy {
            val result: T = this@getLazy.get()
            initialized = true
            result
        }

        override fun get(): T {
//            Log.d("[di] getLazy() value: $this")
            return _value
        }
    }
}