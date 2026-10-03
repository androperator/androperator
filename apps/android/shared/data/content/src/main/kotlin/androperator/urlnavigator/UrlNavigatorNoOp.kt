package androperator.urlnavigator

import androperator.data.urlnavigator.UrlNavigatorDestinations

class UrlNavigatorNoOp : UrlNavigator {
    override suspend fun toUrl(
        url: String,
        destinations: UrlNavigatorDestinations,
    ): Boolean = false

    override suspend fun toUri(uri: String): Boolean = false
}
