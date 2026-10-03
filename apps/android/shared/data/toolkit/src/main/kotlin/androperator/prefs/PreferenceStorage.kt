package androperator.prefs

import action.preference.MutableObservableValue
import kotlinx.coroutines.flow.MutableStateFlow

interface PreferenceStorage {
    val acceptedTerms: MutableStateFlow<Boolean>
    val joinNewsletter: MutableStateFlow<Boolean>
    val reportUsageStats: MutableStateFlow<Boolean>

    val crashTrackingEnabled: MutableObservableValue<Boolean>

    val useMilitaryTimeFormat: MutableObservableValue<Boolean>
}
