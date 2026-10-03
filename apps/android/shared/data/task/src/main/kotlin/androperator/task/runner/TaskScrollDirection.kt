package androperator.task.runner

/**
 * Direction of **content/viewport movement** (not finger gesture).
 *
 * Examples:
 * - Down = reveal content further down (finger swipes up)
 * - Up   = reveal content further up   (finger swipes down)
 * - Left = reveal items on the right   (finger swipes right)
 * - Right= reveal items on the left    (finger swipes left)
 */
enum class TaskScrollDirection {
    Down,
    Up,
    Left,
    Right,
}
