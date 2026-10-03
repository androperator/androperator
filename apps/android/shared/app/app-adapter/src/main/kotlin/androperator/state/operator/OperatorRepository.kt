package androperator.state.operator

import kotlinx.coroutines.flow.StateFlow

interface OperatorRepository {
    val isReady: StateFlow<Boolean>
}
