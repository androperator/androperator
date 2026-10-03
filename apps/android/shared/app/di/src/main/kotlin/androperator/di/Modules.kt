package androperator.di

import org.koin.core.module.Module

data class Modules(val modules: List<Module>) {

    constructor(module: Module) : this(listOf(module))

    constructor(vararg modules: Module) : this(modules.toList())

    constructor(commonModule: Module, platformModule: Module)
            : this(listOf(commonModule, platformModule))

    constructor(commonModule: Module, platformModules: List<Module>)
            : this(listOf(commonModule) + platformModules)
}