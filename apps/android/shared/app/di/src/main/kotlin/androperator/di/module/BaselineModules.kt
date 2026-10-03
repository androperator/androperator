package androperator.di.module

val BaselineModules = listOf(
    AppModule,
) + listOf(
    BuildConfigModules,
).map { it.modules }.flatten()


val UnitTestModules = listOf(
    AppModule,
) + listOf(
    BuildConfigModules,
).map { it.modules }.flatten()