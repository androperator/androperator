package androperator.uitree

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Represents the semantic role of a UI element.
 * Used for accessibility and UI structure understanding.
 */
@Serializable
@SerialName("UiRole")
enum class UiRole {
    // Layout containers
    Container,
    Row,
    Column,
    Toolbar,
    TabBar,

    // Collection views
    List,
    Grid,
    ListItem,
    Pager,
    Tab,
    Card,

    // Interactive controls
    Button,
    TextField,
    Switch,
    Checkbox,
    Radio,
    Toggle,

    // Visual elements
    Icon,
    Image,
    Chip,
    Menu,
    MenuItem,

    // Text elements
    Text,
    Label,
    Title,

    // Fallback
    Unknown,
}
